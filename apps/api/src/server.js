const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { importBusinessFile } = require("../../../packages/tenant-onboarding/src/businessFileImporter");
const { buildContainer } = require("./container");
const packageJson = require("../../../package.json");
const { ForbiddenError, ValidationError } = require("../../../packages/shared/src/errors");
const { replyToNovaVisitor } = require("./novaMarketingAssistant");

async function startServer() {
  const container = await buildContainer();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const whatsappMatch = url.pathname.match(/^\/webhooks\/whatsapp\/([^/]+)$/);

      // Developer Console is intentionally served by the same process during
      // development so the Playground exercises the exact production engine.
      if (req.method === "GET" && (url.pathname === "/developer" || url.pathname.startsWith("/developer/") || url.pathname === "/developers" || url.pathname.startsWith("/developers/"))) {
        return serveDeveloperAsset(res, url.pathname);
      }
      if (req.method === "GET" && (url.pathname === "/assistant" || url.pathname.startsWith("/assistant/") || url.pathname === "/chat" || url.pathname.startsWith("/chat/"))) {
        return servePublicChatAsset(res,url.pathname);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const health = await Promise.all(container.registry.list().map((item) => item.health()));
        const checks = { service: "nova-api", version: packageJson.version, capabilities: health, channels: ["http", "whatsapp"] };
        // v22.0: Storage health checks
        checks.storage = { mode: container.config.storageMode };
        if (container.storage?.db) {
          try {
            await container.storage.db.query('SELECT 1 as ok');
            checks.storage.postgres = { ok: true, poolMax: container.config.dbPoolMax };
          } catch (error) {
            checks.storage.postgres = { ok: false, error: error.message };
          }
        }
        if (container.storage?.redis) {
          try {
            // RedisStateRepository doesn't expose a ping, so we test via a get
            await container.storage.redis.get('__health_check__');
            checks.storage.redis = { ok: true, ttlSeconds: container.config.stateTtlSeconds };
          } catch (error) {
            checks.storage.redis = { ok: false, error: error.message };
          }
        }
        // v21.0: Feedback collector status
        if (container.feedbackCollector) {
          checks.feedback = { storageDir: container.feedbackCollector.storageDir };
        }
        // v16-v20: ML status
        if (container.mlIntentClassifier) {
          checks.ml = { version: container.mlIntentClassifier.model?.version || 'unknown', trained: container.mlIntentClassifier.trained };
        }
        const allOk = (!checks.storage.postgres || checks.storage.postgres.ok) && (!checks.storage.redis || checks.storage.redis.ok);
        return sendJson(res, allOk ? 200 : 503, { ok: allOk, ...checks });
      }

      if (whatsappMatch && req.method === "GET") {
        const tenantId = decodeURIComponent(whatsappMatch[1]);
        const result = container.whatsappWebhookService.verifySubscription({
          tenantId,
          mode: url.searchParams.get("hub.mode"),
          token: url.searchParams.get("hub.verify_token"),
          challenge: url.searchParams.get("hub.challenge")
        });
        if (!result.ok) return sendText(res, result.statusCode, "Forbidden");
        return sendText(res, 200, result.challenge);
      }

      if (whatsappMatch && req.method === "POST") {
        const tenantId = decodeURIComponent(whatsappMatch[1]);
        const rawBody = await readRaw(req);
        const signatureHeader = req.headers["x-hub-signature-256"];
        if (!container.whatsappWebhookService.authenticate({ tenantId, rawBody, signatureHeader })) {
          return sendJson(res, 401, { ok: false, error: "Invalid webhook signature" });
        }
        let payload;
        try { payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {}; }
        catch { return sendJson(res, 400, { ok: false, error: "Invalid JSON body" }); }

        // Acknowledge Meta immediately, then process outside the response lifecycle.
        sendJson(res, 200, { ok: true });
        setImmediate(() => container.whatsappWebhookService.processPayload({ tenantId, payload }).catch((error) => {
          container.logger.error("whatsapp.webhook_processing_failed", { tenantId, error: error.message });
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/crm/customer") {
        if(!authorizeDeveloperRequest(req))return sendJson(res,401,{ok:false,error:"Developer Console token is required"});
        const tenantId = url.searchParams.get("tenantId") || container.config.defaultTenantId;
        const customerId = url.searchParams.get("customerId");
        if (!customerId) return sendJson(res, 400, { ok: false, error: "customerId is required" });
        const customer = await container.crmService.getCustomer(tenantId, customerId);
        const activities = await container.crmService.listActivities(tenantId, customerId, { limit: 20 });
        return sendJson(res, 200, { ok: true, customer, activities });
      }

      if (req.method === "GET" && url.pathname === "/api/catalog/products") {
        const tenantId = url.searchParams.get("tenantId") || container.config.defaultTenantId;
        const products = await container.catalogService.listProducts(tenantId);
        return sendJson(res, 200, { ok: true, products });
      }

      if(req.method==="GET"&&url.pathname==="/api/public/tenants"){
        const tenants=listTenants(container.config.tenantsDir,container.tenantRepository).map(item=>{
          const tenant=container.tenantRepository.getById(item.id);
          return {id:item.id,name:item.name,domain:item.domain,assistantName:tenant.branding?.assistantName||'Nova'};
        });
        return sendJson(res,200,{ok:true,tenants});
      }

      if(req.method==="POST"&&url.pathname==="/api/assistant/chat"){
        const body=await readJson(req);
        const text=String(body.text||'').trim();
        if(!text)return sendJson(res,400,{ok:false,error:'text is required'});
        if(text.length>4000)throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
        const answer=replyToNovaVisitor(text,{previousTopic:String(body.previousTopic||'').trim()||null,language:String(body.language||'auto')});
        return sendJson(res,200,{ok:true,conversationId:String(body.conversationId||`nova-${crypto.randomUUID()}`),reply:answer.reply,topic:answer.topic,suggestions:answer.suggestions});
      }

      if (url.pathname.startsWith("/api/dev/") && !authorizeDeveloperRequest(req)) {
        return sendJson(res, 401, { ok:false, error:"Developer Console token is required" });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/chat") {
        const body = await readJson(req);
        const message = { channel: "playground", customerId: String(body.customerId || "playground-user"), tenantId: String(body.tenantId || container.config.defaultTenantId), messageId: body.messageId ? String(body.messageId) : null, text: String(body.text || ""), metadata: { source: "developer-console" } };
        if (!message.text.trim()) return sendJson(res, 400, { ok:false, error:"text is required" });
        const result = await container.executionEngine.process(message);
        return sendJson(res, 200, { ok:true, ...result });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/reset") {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || container.config.defaultTenantId);
        const customerId = String(body.customerId || "playground-user");
        const channel = String(body.channel || "playground");
        await container.stateRepository.delete(`${tenantId}:${channel}:${customerId}`);
        // Conversation reset intentionally preserves CRM, orders, bookings and
        // the active cart. The developer-only fresh-test option clears only the
        // active cart so acceptance runs can start clean without erasing audit
        // history or customer records.
        if(body.clearCart===true){const cart=await container.commerceRepository.getCart(tenantId,customerId);if(cart?.id)await container.inventoryService.releaseCart({tenantId,cartId:cart.id,reason:"developer_fresh_test"});await container.commerceRepository.clearCart(tenantId,customerId);}
        return sendJson(res, 200, { ok:true,conversationReset:true,cartCleared:body.clearCart===true });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/replays") {
        const replays = await container.replayService.list({ conversationId:url.searchParams.get("conversationId") || null, limit:Number(url.searchParams.get("limit") || 50) });
        return sendJson(res, 200, { ok:true, replays });
      }

      if(req.method==="GET"&&url.pathname==="/api/dev/leads"){
        const tenantId=String(url.searchParams.get("tenantId")||container.config.defaultTenantId);
        container.tenantRepository.getById(tenantId);
        const leads=await container.leadService.list(tenantId,{status:url.searchParams.get("status")||null,grade:url.searchParams.get("grade")||null,limit:Number(url.searchParams.get("limit")||100)});
        const summary=await container.leadService.summary(tenantId);
        return sendJson(res,200,{ok:true,tenantId,summary,leads});
      }

      const leadMatch=url.pathname.match(/^\/api\/dev\/leads\/([^/]+)$/);
      if(req.method==="GET"&&leadMatch){
        const tenantId=String(url.searchParams.get("tenantId")||container.config.defaultTenantId);
        container.tenantRepository.getById(tenantId);
        const lead=await container.leadService.get(tenantId,decodeURIComponent(leadMatch[1]));
        return lead?sendJson(res,200,{ok:true,lead}):sendJson(res,404,{ok:false,error:"Lead not found"});
      }

      const replayMatch = url.pathname.match(/^\/api\/dev\/replays\/([^/]+)$/);
      if (req.method === "GET" && replayMatch) {
        const replay = await container.replayService.get(decodeURIComponent(replayMatch[1]));
        return replay ? sendJson(res, 200, { ok:true, replay }) : sendJson(res, 404, { ok:false, error:"Replay not found" });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/capabilities") {
        return sendJson(res, 200, { ok:true, capabilities:container.registry.list().map((capability)=>({ id:capability.id, manifest:capability.manifest })) });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/data/inspect") {
        const tenantId = String(url.searchParams.get("tenantId") || container.config.defaultTenantId);
        const customerId = String(url.searchParams.get("customerId") || "playground-user");
        const channel = String(url.searchParams.get("channel") || "playground");
        const conversationId = `${tenantId}:${channel}:${customerId}`;
        const [state, customer, activities, cart, orders, bookings, serviceRequests, inventory, calendarEvents] = await Promise.all([
          container.stateRepository.get(conversationId),
          container.crmRepository.getCustomer(tenantId, customerId),
          container.crmRepository.listActivities(tenantId, customerId, { limit:20 }),
          container.commerceRepository.getCart(tenantId, customerId),
          container.commerceRepository.listOrders(tenantId, customerId),
          container.bookingRepository.list(tenantId, customerId),
          container.cleaningRequestRepository?.listByCustomer?.(tenantId, customerId) || Promise.resolve([]),
          container.inventoryService.overview(tenantId),
          container.calendarService.listEvents({tenantId,customerId,includeCancelled:true})
        ]);
        return sendJson(res, 200, {
          ok:true, storageMode:container.storage.mode, tenantId, customerId, conversationId, state,
          crm:{customer,activities}, commerce:{cart,orders}, inventory, calendarEvents, bookings, serviceRequests,
          transactions:{orders,bookings,serviceRequests}
        });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/tenants") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        return sendJson(res, 200, { ok:true, tenants });
      }

      const controlPlaneRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneRootMatch){
        const tenantId=decodeURIComponent(controlPlaneRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,controlPlane:container.tenantControlPlaneService.overview(tenantId,actor)});
      }

      const controlPlaneResourceMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneResourceMatch){
        const tenantId=decodeURIComponent(controlPlaneResourceMatch[1]),resourceType=decodeURIComponent(controlPlaneResourceMatch[2]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,resource:container.tenantControlPlaneService.getResource(tenantId,resourceType,actor)});
      }

      const controlPlaneDraftsMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts$/);
      if(req.method==="GET"&&controlPlaneDraftsMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftsMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,drafts:container.tenantControlPlaneService.listDrafts(tenantId,actor,{status:url.searchParams.get('status')||null})});
      }
      if(req.method==="POST"&&controlPlaneDraftsMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftsMatch[1]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const draft=container.tenantControlPlaneService.createDraft({tenantId,resourceType:String(body.resourceType||''),document:body.document,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,201,{ok:true,draft});
      }

      const controlPlaneDraftActionMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts\/([^/]+)\/(validate|preview|publish)$/);
      if(req.method==="POST"&&controlPlaneDraftActionMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftActionMatch[1]),draftId=decodeURIComponent(controlPlaneDraftActionMatch[2]),action=controlPlaneDraftActionMatch[3],actor=controlPlaneActor(req,tenantId);
        const input={tenantId,draftId,actor,requestId:requestCorrelationId(req)};
        const result=action==='validate'?container.tenantControlPlaneService.validateDraft(input):action==='preview'?container.tenantControlPlaneService.previewDraft(input):container.tenantControlPlaneService.publishDraft(input);
        return sendJson(res,200,{ok:true,[action==='publish'?'revision':action]:result});
      }

      const controlPlaneDraftMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,draft:container.tenantControlPlaneService.getDraft(tenantId,draftId,actor)});
      }
      if(req.method==="PATCH"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const draft=container.tenantControlPlaneService.updateDraft({tenantId,draftId,document:body.document,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,draft});
      }
      if(req.method==="DELETE"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId);
        const draft=container.tenantControlPlaneService.discardDraft({tenantId,draftId,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,draft});
      }

      const controlPlaneRevisionsMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)\/revisions$/);
      if(req.method==="GET"&&controlPlaneRevisionsMatch){
        const tenantId=decodeURIComponent(controlPlaneRevisionsMatch[1]),resourceType=decodeURIComponent(controlPlaneRevisionsMatch[2]),actor=controlPlaneActor(req,tenantId);
        const revisions=container.tenantControlPlaneService.listRevisions(tenantId,resourceType,actor,{includeDocument:url.searchParams.get('includeDocument')==='true'});
        return sendJson(res,200,{ok:true,revisions});
      }

      const controlPlaneRollbackMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)\/rollback$/);
      if(req.method==="POST"&&controlPlaneRollbackMatch){
        const tenantId=decodeURIComponent(controlPlaneRollbackMatch[1]),resourceType=decodeURIComponent(controlPlaneRollbackMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const revision=container.tenantControlPlaneService.rollback({tenantId,resourceType,targetRevision:Number(body.revision),actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,revision});
      }

      const controlPlaneAuditMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/audit$/);
      if(req.method==="GET"&&controlPlaneAuditMatch){
        const tenantId=decodeURIComponent(controlPlaneAuditMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,audit:container.tenantControlPlaneService.listAudit(tenantId,actor,{limit:Number(url.searchParams.get('limit')||100)})});
      }

      const inventoryRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/inventory$/);
      if(req.method==="GET"&&inventoryRootMatch){
        const tenantId=decodeURIComponent(inventoryRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"products"});
        await container.inventoryService.syncCatalog({tenantId,products:await container.catalogService.listProducts(tenantId),actorId:actor.id});
        return sendJson(res,200,{ok:true,inventory:await container.inventoryService.overview(tenantId)});
      }
      const inventorySkuMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/inventory\/([^/]+)$/);
      if(req.method==="PATCH"&&inventorySkuMatch){
        const tenantId=decodeURIComponent(inventorySkuMatch[1]),sku=decodeURIComponent(inventorySkuMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"products"});
        const products=await container.catalogService.listProducts(tenantId);
        const match=products.flatMap(product=>product.variants?.length?product.variants.map(variant=>({product,variant,sku:variant.sku,inventory:variant.inventory})):[]).find(row=>String(row.sku).toLowerCase()===String(sku).toLowerCase());
        if(!match||match.inventory==null)throw new ValidationError(`SKU '${sku}' is not an inventory-tracked SKU in this tenant catalog.`);
        const stock=await container.inventoryService.setOnHand({tenantId,sku:match.sku,productId:match.product.id,variantId:match.variant?.id||null,quantity:Number(body.onHand),actorId:actor.id,reason:String(body.reason||"control_plane_adjustment")});
        return sendJson(res,200,{ok:true,stock});
      }

      const calendarRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar$/);
      if(req.method==="GET"&&calendarRootMatch){
        const tenantId=decodeURIComponent(calendarRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"calendar"});
        return sendJson(res,200,{ok:true,calendar:{config:container.calendarService.getConfig(tenantId),events:await container.calendarService.listEvents({tenantId,includeCancelled:true}),holds:container.calendarService.listHolds({tenantId,activeOnly:false})}});
      }
      const calendarBlocksMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar\/blocks$/);
      if(req.method==="POST"&&calendarBlocksMatch){
        const tenantId=decodeURIComponent(calendarBlocksMatch[1]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
        const result=await container.calendarService.createBlock({tenantId,date:String(body.date||""),time:String(body.time||""),durationMinutes:Number(body.durationMinutes||60),capacityRequired:Number(body.capacityRequired||1),poolId:body.poolId?String(body.poolId):null,subject:String(body.subject||"Blocked time"),actorId:actor.id});
        return sendJson(res,result.status==='confirmed'?201:409,{ok:result.status==='confirmed',result,...(result.status==='confirmed'?{}:{error:result.message||"Calendar block could not be created."})});
      }
      const calendarCancelMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar\/events\/([^/]+)\/cancel$/);
      if(req.method==="POST"&&calendarCancelMatch){
        const tenantId=decodeURIComponent(calendarCancelMatch[1]),eventId=decodeURIComponent(calendarCancelMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
        const event=(await container.calendarService.listEvents({tenantId,includeCancelled:true})).find((entry)=>entry.id===eventId);
        if(!event)throw new ValidationError(`Calendar event '${eventId}' was not found in this tenant.`);
        if(event.type!=="block")throw new ValidationError("Customer booking events must be cancelled through their booking/service-request workflow so transaction and calendar records stay consistent.");
        const result=await container.calendarService.cancel({tenantId,eventId,reason:String(body.reason||`control_plane:${actor.id}`)});
        return sendJson(res,200,{ok:true,result});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/import-business-file") {
        const body=await readJson(req);
        const imported=importBusinessFile({name:String(body.name||""),text:String(body.text||"")});
        return sendJson(res,200,{ok:true,format:imported.format,spec:normalizeOnboardingSpec(imported.spec),summary:{offerings:imported.spec.offerings?.length||0,faqs:imported.spec.faqs?.length||0}});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/tenant") {
        const body = await readJson(req);
        const spec = normalizeOnboardingSpec(body);
        const result = container.tenantOnboardingService.create(spec);
        container.tenantKnowledgeManager.ensureRegistry(result.id);
        for (const document of Array.isArray(body.knowledgeDocuments) ? body.knowledgeDocuments : []) {
          if (!String(document?.text || "").trim()) continue;
          container.tenantKnowledgeManager.addDocument(result.id,{
            title:String(document.name || "Business notes"),text:String(document.text),format:"txt",priority:60
          });
        }
        container.knowledgeRepository.clearCache(result.id);
        container.tenantRepository.clearCache(result.id);
        return sendJson(res, 201, { ok:true, tenant:{ id:result.id, name:result.profile.name, domain:result.profile.domain, capabilities:result.profile.capabilities }, summary:result.summary });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/knowledge") {
        const body = await readJson(req);
        const tenantId=String(body.tenantId || "").trim();
        const text=String(body.text || "").trim();
        if(!tenantId || !text) return sendJson(res,400,{ok:false,error:"tenantId and text are required"});
        container.tenantRepository.getById(tenantId);
        const result=container.tenantKnowledgeManager.addDocument(tenantId,{title:String(body.name||"Business notes"),text,format:String(body.format||"txt"),priority:Number(body.priority||50)});
        return sendJson(res,201,{ok:true,document:{tenantId,name:path.basename(result.path),format:result.format,sourceId:result.source.id}});
      }


      const knowledgeOverviewMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)$/);
      if(req.method==="GET" && knowledgeOverviewMatch){
        const tenantId=decodeURIComponent(knowledgeOverviewMatch[1]);
        container.tenantRepository.getById(tenantId);
        return sendJson(res,200,{ok:true,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const operationalPricingMatch=url.pathname.match(/^\/api\/dev\/operations\/([^/]+)\/pricing$/);
      if(["GET","PUT"].includes(req.method)&&operationalPricingMatch){
        const tenantId=decodeURIComponent(operationalPricingMatch[1]);container.tenantRepository.getById(tenantId);
        return sendJson(res,410,{ok:false,error:"Operational pricing has moved to Control Plane → Services & Pricing. Products and variant prices belong in Products & Prices. Knowledge Manager cannot publish commercial values."});
      }

      const knowledgeFileMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/files$/);
      if(req.method==="POST" && knowledgeFileMatch){
        const tenantId=decodeURIComponent(knowledgeFileMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const filename=String(body.filename||"").trim(),contentBase64=String(body.contentBase64||"").trim();
        if(!filename||!contentBase64)return sendJson(res,400,{ok:false,error:"filename and contentBase64 are required"});
        const ext=path.extname(filename).toLowerCase();
        if(!['.txt','.md','.pdf','.csv','.json'].includes(ext))return sendJson(res,400,{ok:false,error:"Supported knowledge files: TXT, MD, PDF, CSV, JSON"});
        const tempDir=path.join(require('os').tmpdir(),'nova-knowledge-upload');fs.mkdirSync(tempDir,{recursive:true});
        const tempFile=path.join(tempDir,`${Date.now()}-${path.basename(filename)}`);
        try{
          fs.writeFileSync(tempFile,Buffer.from(contentBase64,'base64'));
          const result=await container.tenantKnowledgeManager.addFile(tenantId,{filePath:tempFile,title:String(body.title||path.basename(filename,ext)),tags:Array.isArray(body.tags)?body.tags:[],priority:Number(body.priority||50),evidenceType:String(body.evidenceType||'customer_fact')});
          return sendJson(res,201,{ok:true,document:result,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
        } finally { try{fs.rmSync(tempFile,{force:true})}catch{} }
      }

      const knowledgeDocumentMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/documents$/);
      if(req.method==="POST" && knowledgeDocumentMatch){
        const tenantId=decodeURIComponent(knowledgeDocumentMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const result=container.tenantKnowledgeManager.addDocument(tenantId,{
          title:String(body.title||"Knowledge note"),text:String(body.text||""),format:String(body.format||"txt"),
          tags:Array.isArray(body.tags)?body.tags:[],priority:Number(body.priority||50)
        });
        return sendJson(res,201,{ok:true,document:result,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const knowledgeFaqMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/faqs$/);
      if(req.method==="POST" && knowledgeFaqMatch){
        const tenantId=decodeURIComponent(knowledgeFaqMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const faq=container.tenantKnowledgeManager.addFaq(tenantId,{question:String(body.question||""),answer:String(body.answer||""),tags:Array.isArray(body.tags)?body.tags:[]});
        return sendJson(res,201,{ok:true,faq,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const knowledgeFactMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/facts$/);
      if(req.method==="POST" && knowledgeFactMatch){
        const tenantId=decodeURIComponent(knowledgeFactMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const fact=container.tenantKnowledgeManager.setFact(tenantId,{key:String(body.key||""),value:body.value});
        return sendJson(res,200,{ok:true,fact,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }


      const knowledgeSearchMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/search$/);
      if(req.method==="POST" && knowledgeSearchMatch){
        const tenantId=decodeURIComponent(knowledgeSearchMatch[1]),body=await readJson(req);container.tenantRepository.getById(tenantId);
        const query=String(body.query||"").trim();if(!query)return sendJson(res,400,{ok:false,error:"query is required"});
        const matches=container.knowledgeRepository.search(tenantId,query,{limit:Number(body.limit||6),minScore:Number(body.minScore??.10)});
        return sendJson(res,200,{ok:true,query,matches:matches.map(x=>({
          text:x.text,source:x.source,sourceId:x.sourceId,sourceTitle:x.sourceTitle,sourceKind:x.sourceKind,path:x.path,priority:x.priority,
          score:x.score,hybridScore:x.hybridScore,lexicalScore:x.lexicalScore,semanticScore:x.semanticScore,evidenceType:x.evidenceType,customerSafe:x.customerSafe
        }))});
      }

      const knowledgeReindexMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/reindex$/);
      if(req.method==="POST" && knowledgeReindexMatch){
        const tenantId=decodeURIComponent(knowledgeReindexMatch[1]);container.tenantRepository.getById(tenantId);
        return sendJson(res,200,{ok:true,index:container.tenantKnowledgeManager.reindex(tenantId)});
      }

      const knowledgeSourceMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/sources\/([^/]+)$/);
      if(req.method==="PATCH" && knowledgeSourceMatch){
        const tenantId=decodeURIComponent(knowledgeSourceMatch[1]),sourceId=decodeURIComponent(knowledgeSourceMatch[2]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const updated=container.tenantKnowledgeManager.updateDocument(tenantId,sourceId,{
          title:body.title??null,text:body.text??null,format:String(body.format||'txt'),tags:Array.isArray(body.tags)?body.tags:null,
          priority:body.priority==null?null:Number(body.priority),evidenceType:body.evidenceType??null,status:body.status??null
        });
        return sendJson(res,200,{ok:true,source:updated,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }
      if(req.method==="DELETE" && knowledgeSourceMatch){
        const tenantId=decodeURIComponent(knowledgeSourceMatch[1]),sourceId=decodeURIComponent(knowledgeSourceMatch[2]);container.tenantRepository.getById(tenantId);
        const removed=container.tenantKnowledgeManager.removeSource(tenantId,sourceId);
        return sendJson(res,removed?200:404,{ok:removed,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/datasets/run") {
        const body = await readJson(req);
        const report = await runDataset(container, String(body.dataset || ""));
        return sendJson(res, 200, report);
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(req);
        if(String(body.text||'').trim().length>4000)throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
        const adapter = container.channelRegistry.get("http");
        const message = adapter.normalizeIncoming(body);
        const result = await container.executionEngine.process(message);
        // Public chat returns only the customer-facing envelope. Routing,
        // workflow state and experience diagnostics remain developer-only.
        return sendJson(res, 200, adapter.formatOutgoing(result));
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      container.logger.error("http.request_failed", { error: error.message });
      return sendJson(res, error.statusCode || 500, { ok: false, error: error.message, ...(error.code?{code:error.code}:{}), ...(error.details?{details:error.details}:{}) });
    }
  });
  server.listen(container.config.port, () => container.logger.info("api.started", { port: container.config.port }));
  const close=async()=>new Promise((resolve,reject)=>server.close(async(error)=>{
    if(error)return reject(error);
    try{await container.storage?.close?.();resolve();}catch(e){reject(e);}
  }));
  return { server, container, close };
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const raw = await readRaw(req);
  try { return raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
  catch { throw new ValidationError("Invalid JSON body."); }
}
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendText(res, statusCode, text) { res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" }); res.end(String(text)); }
function authorizeDeveloperRequest(req) {
  const expected = String(process.env.NOVA_DEV_TOKEN || "");
  // Local development remains zero-config. Public production deployments fail
  // closed so replay, CRM, inventory, knowledge, and Control Plane data cannot
  // become writable merely because a secret was omitted.
  if (!expected) return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
  const supplied = String(req.headers["x-nova-dev-token"] || "");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}
function controlPlaneActor(req, tenantId) {
  const scopedTenant=String(req.headers['x-nova-tenant-id']||'').trim();
  if(process.env.NOVA_DEV_TOKEN&&!scopedTenant)throw new ValidationError('x-nova-tenant-id is required for control-plane requests.');
  if(scopedTenant&&scopedTenant!==tenantId)throw new ForbiddenError('The authenticated tenant scope does not match the requested tenant.');
  return {
    id:String(req.headers['x-nova-actor-id']||process.env.NOVA_DEV_ACTOR_ID||'local-developer').trim(),
    role:String(req.headers['x-nova-role']||process.env.NOVA_DEV_ROLE||'owner').trim().toLowerCase(),
    tenantId:scopedTenant||tenantId
  };
}
function requestCorrelationId(req){return String(req.headers['x-request-id']||req.headers['x-correlation-id']||'').trim()||null;}
function serveDeveloperAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../developer-console/public");
  const relative = ["/developer","/developer/","/developers","/developers/"].includes(pathname) ? "index.html" : pathname.replace(/^\/developers?\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function servePublicChatAsset(res,pathname){
  const root=path.resolve(__dirname,'../../public-chat/public');
  const relative=pathname==='/assistant'||pathname==='/assistant/'||pathname==='/chat'||pathname==='/chat/'
    ? 'index.html'
    : pathname.replace(/^\/(?:assistant|chat)\//,'');
  const file=path.resolve(root,relative);
  const relation=path.relative(root,file);
  const outsideRoot=relation.startsWith('..')||path.isAbsolute(relation);
  if(outsideRoot||!fs.existsSync(file)||fs.statSync(file).isDirectory())return sendText(res,404,'Not found');
  const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:"});
  res.end(fs.readFileSync(file));
}
function listTenants(tenantsDir, tenantRepository = null) {
  if (!fs.existsSync(tenantsDir)) return [];
  return fs.readdirSync(tenantsDir).sort().flatMap((id) => {
    const profilePath=path.join(tenantsDir,id,"profile.json");
    if(!fs.existsSync(profilePath)) return [];
    try { const p=tenantRepository?.getById(id)||JSON.parse(fs.readFileSync(profilePath,"utf8")); return [{id:p.id,name:p.name,domain:p.domain||"generic",capabilities:p.capabilities||[]}]; }
    catch { return []; }
  });
}
function normalizeOnboardingSpec(body) {
  const offerings=(Array.isArray(body.offerings)?body.offerings:[]).map((x)=>({
    name:String(x.name||"").trim(), type:String(x.type||"service").trim(), category:String(x.category||"general").trim(),
    description:String(x.description||"").trim(), aliases:Array.isArray(x.aliases)?x.aliases.map(String).map(v=>v.trim()).filter(Boolean):String(x.aliases||"").split(",").map(v=>v.trim()).filter(Boolean),
    ...(x.price!==""&&x.price!=null?{price:Number(x.price)}:{}), ...(x.durationMinutes?{durationMinutes:Number(x.durationMinutes)}:{}),
    bookable:x.type==='product'?false:x.bookable!==false, orderable:x.type==='product'?x.orderable!==false:false,
    inStock:x.inStock!==false, ...(x.inventory==null||x.inventory===''?{}:{inventory:Number(x.inventory)}), ...(x.unit?{unit:String(x.unit).trim()}:{}),
    sizes:Array.isArray(x.sizes)?x.sizes:String(x.sizes||"").split(",").map(v=>v.trim()).filter(Boolean),
    colors:Array.isArray(x.colors)?x.colors:String(x.colors||"").split(",").map(v=>v.trim()).filter(Boolean),
    tags:Array.isArray(x.tags)?x.tags:String(x.tags||"").split(",").map(v=>v.trim()).filter(Boolean)
  })).filter(x=>x.name);
  return {
    id:String(body.id||"").trim()||undefined,name:String(body.name||"").trim(),domain:String(body.domain||"generic").trim()||"generic",
    assistantName:String(body.assistantName||"").trim()||undefined,description:String(body.description||"").trim(),hours:String(body.hours||"").trim(),
    location:String(body.location||"").trim(),contact:String(body.contact||"").trim(),currency:String(body.currency||"PKR").trim()||"PKR",
    offerings,faqs:Array.isArray(body.faqs)?body.faqs:[],businessFacts:body.businessFacts&&typeof body.businessFacts==='object'?body.businessFacts:{},
    bookingFields:Array.isArray(body.bookingFields)&&body.bookingFields.length?body.bookingFields:undefined,bookingMode:String(body.bookingMode||"appointment"),overwrite:Boolean(body.overwrite)
  };
}
async function runDataset(container, datasetName) {
  if (!/^[a-z0-9/_-]+\.json$/i.test(datasetName)) return { ok:false, error:"Invalid dataset path" };
  const root = path.resolve(__dirname, "../../../tests/datasets"); const file = path.resolve(root, datasetName);
  if (!file.startsWith(root) || !fs.existsSync(file)) return { ok:false, error:"Dataset not found" };
  const dataset = JSON.parse(fs.readFileSync(file, "utf8")); const failures=[]; let passed=0; const started=Date.now();
  for (let index=0; index<dataset.cases.length; index+=1) {
    const test=dataset.cases[index]; const customerId=`dataset-${Date.now()}-${index}`; let last=null; let turnFailed=false;
    for (const turn of test.turns) {
      last=await container.executionEngine.process({tenantId:dataset.tenantId,channel:"dataset",customerId,text:turn.text,messageId:null,metadata:{dataset:datasetName}});
      const expected=turn.expect || {}; const actualIntent=last.intelligence?.selected?.intent || null;
      const problems=[];
      if(expected.capabilityId && last.capabilityId!==expected.capabilityId) problems.push(`capability ${last.capabilityId} != ${expected.capabilityId}`);
      if(expected.intent && actualIntent!==expected.intent) problems.push(`intent ${actualIntent} != ${expected.intent}`);
      if(expected.replyContains && !String(last.reply).toLowerCase().includes(String(expected.replyContains).toLowerCase())) problems.push(`reply missing ${expected.replyContains}`);
      for(const [key,value] of Object.entries(expected.entities||{})) if(JSON.stringify(last.intelligence?.entities?.[key])!==JSON.stringify(value)) problems.push(`entity ${key} mismatch`);
      if(problems.length){failures.push({case:test.name,turn:turn.text,problems,actual:{capabilityId:last.capabilityId,intent:actualIntent,entities:last.intelligence?.entities,reply:last.reply}});turnFailed=true;break;}
    }
    if(!turnFailed) passed+=1;
  }
  return { ok:failures.length===0, dataset:datasetName, total:dataset.cases.length, passed, failed:failures.length, durationMs:Date.now()-started, failures:failures.slice(0,50) };
}
if (require.main === module) startServer().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { startServer, readRaw, readJson, authorizeDeveloperRequest, servePublicChatAsset };
