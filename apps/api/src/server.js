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
      // v27.0 Admin Dashboard — operator console for tenants, conversations,
      // leads, ML insights, capabilities, and test runs. Served by the same
      // process so the dashboard exercises the exact production engine.
      if (req.method === "GET" && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
        return serveAdminAsset(res, url.pathname);
      }
      // v28.0 Website Widget SDK — drop-in embeddable script.
      // Customers include <script src="https://your-nova.com/widget.js" data-tenant="cleaning-demo"></script>
      // and the widget auto-mounts on any page. Served with strict CSP + Cache-Control.
      if (req.method === "GET" && (url.pathname === "/widget.js" || url.pathname === "/widget-config.js" || url.pathname === "/avatars.js" || url.pathname === "/widget-test")) {
        return serveWidgetAsset(res, url.pathname);
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

      // ─── v27.0 Admin Dashboard endpoints ────────────────────────────────────
      // All admin endpoints reuse the same NOVA_DEV_TOKEN gate as /api/dev/*.
      // They are intentionally consolidated for the operator dashboard so the
      // UI doesn't have to fan out to dozens of dev endpoints per page load.
      if (url.pathname.startsWith("/api/admin/") && !authorizeDeveloperRequest(req)) {
        return sendJson(res, 401, { ok:false, error:"Admin token is required" });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/overview") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        const [replays, capabilities, health] = await Promise.all([
          container.replayService.list({ limit: 1 }),
          Promise.resolve(container.registry.list().map((c)=>({ id:c.id, manifest:c.manifest }))),
          Promise.all(container.registry.list().map((item)=>item.health()))
        ]);
        const overview = {
          version: packageJson.version,
          uptimeSeconds: Math.round(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          storageMode: container.config.storageMode,
          postgres: !!container.storage?.db,
          redis: !!container.storage?.redis,
          mlTrained: container.mlIntentClassifier?.trained || false,
          mlVersion: container.mlIntentClassifier?.model?.version || 'unknown',
          transformerEnabled: !!container.transformerEmbeddingService?.enableMultilingual,
          feedbackDir: container.feedbackCollector?.storageDir || null,
          onlineLearnerLastRun: container.onlineLearner?.getLastRetrainSummary?.() || null,
          tenantCount: tenants.length,
          tenantIds: tenants.map(t=>t.id),
          capabilityCount: capabilities.length,
          capabilityIds: capabilities.map(c=>c.id),
          recentReplayCount: replays.length,
          capabilityHealth: health
        };
        return sendJson(res, 200, { ok:true, overview });
      }

      const adminFeedbackMatch = url.pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/);
      if (req.method === "GET" && adminFeedbackMatch) {
        const tenantId = decodeURIComponent(adminFeedbackMatch[1]);
        container.tenantRepository.getById(tenantId);
        const counts = container.feedbackCollector?.getExampleCount?.(tenantId) || { total:0, positive:0, negative:0 };
        const examples = container.feedbackCollector?.getExamples?.(tenantId) || [];
        return sendJson(res, 200, { ok:true, tenantId, counts, examples: examples.slice(-200).reverse() });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ml/status") {
        const tenantsWithFeedback = container.feedbackCollector?.getTenantsWithExamples?.() || [];
        const perTenant = tenantsWithFeedback.map((tenantId)=>({
          tenantId,
          counts: container.feedbackCollector.getExampleCount(tenantId)
        }));
        const status = {
          mlClassifier: {
            trained: container.mlIntentClassifier?.trained || false,
            version: container.mlIntentClassifier?.model?.version || 'unknown',
            classCount: container.mlIntentClassifier?.model?.classes?.length || 0,
            modelSize: container.mlIntentClassifier?.model ? Object.keys(container.mlIntentClassifier.model.classes || {}).length : 0
          },
          hybridRouter: { enabled: !!container.hybridRouter },
          transformer: {
            enabled: !!container.transformerEmbeddingService?.enableMultilingual,
            initialized: !!(container.transformerEmbeddingService?.englishExtractor),
            multilingualLoaded: !!(container.transformerEmbeddingService?.multilingualExtractor)
          },
          productEmbeddingMatcher: { enabled: !!container.productEmbeddingMatcher },
          feedbackCollector: {
            storageDir: container.feedbackCollector?.storageDir || null,
            tenantsWithExamples: tenantsWithFeedback,
            perTenant,
            totalExamples: perTenant.reduce((sum,t)=>sum+t.counts.total, 0),
            totalPositive: perTenant.reduce((sum,t)=>sum+t.counts.positive, 0),
            totalNegative: perTenant.reduce((sum,t)=>sum+t.counts.negative, 0)
          },
          onlineLearner: {
            enabled: !!container.onlineLearner,
            lastRetrain: container.onlineLearner?.getLastRetrainSummary?.() || null,
            status: container.onlineLearner?.getStatus?.() || 'Not initialized'
          }
        };
        return sendJson(res, 200, { ok:true, status });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/online-learner/run") {
        if (!container.onlineLearner) return sendJson(res, 503, { ok:false, error:"Online learner is not initialized" });
        const body = await readJson(req).catch(()=>({}));
        const result = await container.onlineLearner.learn({
          minExamples: Number(body.minExamples || 5),
          minPositiveRatio: Number(body.minPositiveRatio || 0.0)
        });
        return sendJson(res, 200, { ok: result.learned === true, result });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/replays") {
        const limit = Number(url.searchParams.get("limit") || 100);
        const replays = await container.replayService.list({ limit });
        return sendJson(res, 200, { ok:true, replays });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/tenants") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        const enriched = tenants.map((t)=>{
          const profile = container.tenantRepository.getById(t.id);
          const branding = profile?.branding || {};
          const business = profile?.business || {};
          const notifications = profile?.notifications || {};
          // Try to get activity counts (best-effort, doesn't fail if no data)
          let leadCount = 0, bookingCount = 0, notificationCount = 0, lastActivity = null;
          try {
            const leadSummary = container.leadService?.summary?.(t.id);
            if (leadSummary) leadCount = leadSummary.total || 0;
          } catch {}
          try {
            notificationCount = container.notificationService ? container.notificationService.notificationLog.totalCount(t.id) : 0;
          } catch {}
          return {
            id: t.id,
            name: t.name,
            domain: t.domain || profile?.domain || 'generic',
            capabilities: t.capabilities || profile?.capabilities || [],
            assistantName: branding.assistantName || 'Nova',
            description: business.description || '',
            hours: business.hours || profile?.hours || '',
            contact: business.contact || '',
            location: business.location || profile?.location || '',
            currency: business.currency || profile?.currency || 'PKR',
            status: profile?.status || 'active',
            defaultLanguage: profile?.defaultLanguage || 'english',
            templateId: profile?._template?.templateId || null,
            sourceTenant: profile?._template?.sourceTenant || null,
            isCustom: !profile?._template?.templateId,
            createdAt: profile?._template?.createdAt || null,
            widgetEnabled: profile?.widget?.enabled !== false,
            notificationsEnabled: notifications.enabled !== false,
            notificationRecipients: (notifications.recipientEmails || []).length,
            stats: { leads: leadCount, notifications: notificationCount }
          };
        });
        return sendJson(res, 200, { ok:true, tenants: enriched });
      }

      // ─── v30.1 Template & Tenant Creation endpoints ────────────────────────
      if (req.method === "GET" && url.pathname === "/api/admin/templates") {
        const templatesDir = path.resolve(container.config.tenantsDir, "_templates");
        const templates = [];
        if (fs.existsSync(templatesDir)) {
          for (const dir of fs.readdirSync(templatesDir).sort()) {
            const templateJsonPath = path.join(templatesDir, dir, "template.json");
            if (!fs.existsSync(templateJsonPath)) continue;
            try {
              const tpl = JSON.parse(fs.readFileSync(templateJsonPath, 'utf8'));
              templates.push(tpl);
            } catch {}
          }
        }
        return sendJson(res, 200, { ok:true, templates });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/templates/create") {
        const body = await readJson(req);
        const templateId = String(body.id || '').trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const label = String(body.label || '').trim();
        if (!templateId || !label) return sendJson(res, 400, { ok:false, error:'id and label are required' });
        if (!/^[a-z0-9-]+$/.test(templateId)) return sendJson(res, 400, { ok:false, error:'id must be lowercase letters, numbers, hyphens only' });

        const templatesDir = path.resolve(container.config.tenantsDir, "_templates");
        const newTemplateDir = path.join(templatesDir, templateId);
        if (fs.existsSync(newTemplateDir)) return sendJson(res, 409, { ok:false, error:'Template already exists' });

        // For custom templates, we build a minimal but functional tenant from scratch
        const capabilities = Array.isArray(body.capabilities) && body.capabilities.length
          ? body.capabilities : ['assistant', 'crm'];
        const domain = String(body.domain || 'generic').trim();
        const services = Array.isArray(body.services) ? body.services : [];
        const faqs = Array.isArray(body.faqs) ? body.faqs : [];
        const businessFacts = body.businessFacts && typeof body.businessFacts === 'object' ? body.businessFacts : {};

        fs.mkdirSync(path.join(newTemplateDir, 'knowledge'), { recursive: true });
        fs.mkdirSync(path.join(newTemplateDir, 'templates'), { recursive: true });

        // template.json
        fs.writeFileSync(path.join(newTemplateDir, 'template.json'), JSON.stringify({
          id: templateId, label, description: String(body.description || ''), icon: body.icon || '🏢',
          domain, capabilities, defaultServices: services, sourceTenant: null,
          isCustom: true, createdAt: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        // profile.json with placeholders
        const profile = {
          id: '{{tenant_id}}', name: '{{business_name}}', status: 'active', defaultLanguage: 'english',
          capabilities, domain,
          branding: {
            assistantName: '{{business_name}} Assistant',
            welcomeMessage: body.welcomeMessage || 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?'
          },
          business: {
            description: '{{business_description}}', contact: '{{owner_phone}}', email: '{{owner_email}}',
            hours: '{{business_hours}}', location: '{{business_location}}'
          },
          features: { llmFallback: true },
          permissions: ['knowledge.read', 'memory.read:assistant', 'memory.write:assistant', 'crm.customer.read:assistant', 'crm.customer.write:assistant', 'crm.activity.write:assistant'],
          widget: {
            enabled: true, position: 'bottom-right', themeColor: '{{theme_color}}', language: 'auto',
            welcomeMessage: body.welcomeMessage || 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?',
            agentAvatar: body.agentAvatar || 'marcus', agentName: '{{agent_name}}', agentTitle: 'Assistant',
            suggestions: body.suggestions || ['What services do you offer?', 'Book now', 'What are your hours?'],
            preChatForm: { enabled: true, fields: [
              { id: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'John Doe' },
              { id: 'phone', label: 'Phone (optional)', type: 'tel', required: false, placeholder: '+971 50 123 4567' }
            ]},
            proactiveGreeting: { enabled: true, delaySeconds: 5, message: "Hi! 👋 I'm {{agent_name}}. How can I help you today?", pageRules: [] }
          },
          notifications: {
            enabled: true, recipientEmails: ['{{owner_email}}'],
            events: { booking_confirmed: true, order_placed: true, lead_captured: true, handoff_requested: true, nova_failed: true },
            quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
            dailyDigest: { enabled: false, sendAt: '09:00' }
          },
          _template: { isTemplate: true, templateId, sourceTenant: null, createdAt: new Date().toISOString() }
        };
        fs.writeFileSync(path.join(newTemplateDir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');

        // knowledge/business.json
        fs.writeFileSync(path.join(newTemplateDir, 'knowledge/business.json'), JSON.stringify({
          name: '{{business_name}}', description: '{{business_description}}',
          contact: '{{owner_phone}}', email: '{{owner_email}}', hours: '{{business_hours}}', location: '{{business_location}}',
          ...businessFacts
        }, null, 2) + '\n', 'utf8');

        // knowledge/faqs.json
        fs.writeFileSync(path.join(newTemplateDir, 'knowledge/faqs.json'), JSON.stringify(faqs, null, 2) + '\n', 'utf8');

        // personality.json
        fs.writeFileSync(path.join(newTemplateDir, 'personality.json'), JSON.stringify({
          tone: 'friendly, professional, helpful',
          style: 'concise but warm, uses emojis sparingly',
          language: 'auto'
        }, null, 2) + '\n', 'utf8');

        // policies.json
        fs.writeFileSync(path.join(newTemplateDir, 'policies.json'), JSON.stringify({
          cancellation: 'Please contact us at least 24 hours in advance for cancellations.',
          refunds: 'Refund policy varies by service. Please ask for details.',
          rescheduling: 'Rescheduling is free up to 12 hours before the appointment.'
        }, null, 2) + '\n', 'utf8');

        // If cleaning capability, create cleaning/services.json with the template services
        if (capabilities.includes('cleaning') && services.length) {
          fs.mkdirSync(path.join(newTemplateDir, 'cleaning'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'cleaning/services.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
          fs.mkdirSync(path.join(newTemplateDir, 'pricing'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'pricing/services.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
        }

        // If catalog capability, create catalog files
        if (capabilities.includes('catalog')) {
          fs.mkdirSync(path.join(newTemplateDir, 'catalog'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/products.json'), JSON.stringify([], null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/categories.json'), JSON.stringify([], null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/synonyms.json'), JSON.stringify({}, null, 2) + '\n', 'utf8');
        }

        // If offering capability, create offerings files
        if (capabilities.includes('offering')) {
          fs.mkdirSync(path.join(newTemplateDir, 'offerings'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'offerings/items.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'offerings/config.json'), JSON.stringify({ bookingMode: 'appointment' }, null, 2) + '\n', 'utf8');
        }

        // If booking capability, create booking config
        if (capabilities.includes('booking')) {
          fs.mkdirSync(path.join(newTemplateDir, 'booking'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'booking/config.json'), JSON.stringify({
            enabled: true, mode: 'appointment', slotDurationMinutes: 60, leadTimeHours: 2
          }, null, 2) + '\n', 'utf8');
          fs.mkdirSync(path.join(newTemplateDir, 'calendar'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'calendar/config.json'), JSON.stringify({
            enabled: true, provider: 'local', timezone: 'Asia/Karachi'
          }, null, 2) + '\n', 'utf8');
        }

        // WhatsApp channel (disabled by default)
        fs.mkdirSync(path.join(newTemplateDir, 'channels'), { recursive: true });
        fs.writeFileSync(path.join(newTemplateDir, 'channels/whatsapp.json'), JSON.stringify({
          enabled: false, graphVersion: 'v23.0'
        }, null, 2) + '\n', 'utf8');

        // Templates (response templates)
        fs.writeFileSync(path.join(newTemplateDir, 'templates/assistant.json'), JSON.stringify({
          greeting: '{{welcome_message}}',
          fallback: "I'm not sure about that. Let me connect you with our team.",
          closing: 'Is there anything else I can help you with?'
        }, null, 2) + '\n', 'utf8');
        fs.writeFileSync(path.join(newTemplateDir, 'templates/crm.json'), JSON.stringify({
          customerCreated: 'Welcome {{customer_name}}! Your details have been saved.',
          customerUpdated: 'Your details have been updated.'
        }, null, 2) + '\n', 'utf8');

        return sendJson(res, 201, { ok:true, templateId, message: `Custom template '${label}' created. Use it to onboard new tenants.` });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/tenants/create") {
        const body = await readJson(req);
        const templateId = String(body.templateId || '').trim();
        const businessName = String(body.businessName || '').trim();
        if (!templateId || !businessName) return sendJson(res, 400, { ok:false, error:'templateId and businessName are required' });

        // Verify template exists
        const templateDir = path.resolve(container.config.tenantsDir, "_templates", templateId);
        if (!fs.existsSync(templateDir)) return sendJson(res, 404, { ok:false, error:'Template not found' });

        // Generate tenant ID from business name
        let tenantId = String(body.tenantId || '').trim();
        if (!tenantId) {
          tenantId = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          // Ensure uniqueness
          let suffix = 1;
          while (fs.existsSync(path.join(container.config.tenantsDir, tenantId))) {
            tenantId = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${suffix}`;
            suffix += 1;
          }
        }
        if (!/^[a-z0-9-]+$/.test(tenantId)) return sendJson(res, 400, { ok:false, error:'tenantId must be lowercase letters, numbers, hyphens only' });

        const newTenantDir = path.join(container.config.tenantsDir, tenantId);
        if (fs.existsSync(newTenantDir)) return sendJson(res, 409, { ok:false, error:'Tenant already exists' });

        // Clone template directory recursively
        const copyTemplate = (src, dst) => {
          fs.mkdirSync(dst, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const dstPath = path.join(dst, entry.name);
            if (entry.isDirectory()) copyTemplate(srcPath, dstPath);
            else fs.copyFileSync(srcPath, dstPath);
          }
        };
        copyTemplate(templateDir, newTenantDir);

        // Replace placeholders in profile.json
        const replacements = {
          '{{tenant_id}}': tenantId,
          '{{business_name}}': businessName,
          '{{business_description}}': String(body.description || `${businessName} - ${businessName}`),
          '{{owner_email}}': String(body.ownerEmail || ''),
          '{{owner_phone}}': String(body.ownerPhone || ''),
          '{{business_hours}}': String(body.hours || ''),
          '{{business_location}}': String(body.location || ''),
          '{{theme_color}}': String(body.themeColor || '#2d5bd1'),
          '{{agent_name}}': String(body.agentName || `${businessName} Assistant`),
          '{{welcome_message}}': String(body.welcomeMessage || `Hi! 👋 Welcome to ${businessName}. How can I help you today?`)
        };

        const profilePath = path.join(newTenantDir, 'profile.json');
        let profileContent = fs.readFileSync(profilePath, 'utf8');
        for (const [placeholder, value] of Object.entries(replacements)) {
          profileContent = profileContent.split(placeholder).join(value);
        }
        // Remove the _template marker (this is now a real tenant)
        const profile = JSON.parse(profileContent);
        delete profile._template;
        profile.id = tenantId;
        profile.name = businessName;
        if (body.agentAvatar) profile.widget = profile.widget || {}, profile.widget.agentAvatar = body.agentAvatar;
        if (body.agentName) profile.widget = profile.widget || {}, profile.widget.agentName = body.agentName;
        if (body.agentTitle) profile.widget = profile.widget || {}, profile.widget.agentTitle = body.agentTitle;
        if (body.suggestions && Array.isArray(body.suggestions)) profile.widget = profile.widget || {}, profile.widget.suggestions = body.suggestions;
        if (body.ownerEmail) {
          profile.notifications = profile.notifications || {};
          profile.notifications.recipientEmails = [body.ownerEmail];
        }
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');

        // Replace placeholders in other JSON files (knowledge, etc.)
        function replaceInDir(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { replaceInDir(fullPath); continue; }
            if (!entry.name.endsWith('.json') && !entry.name.endsWith('.md')) continue;
            try {
              let content = fs.readFileSync(fullPath, 'utf8');
              let changed = false;
              for (const [placeholder, value] of Object.entries(replacements)) {
                if (content.includes(placeholder)) { content = content.split(placeholder).join(value); changed = true; }
              }
              if (changed) fs.writeFileSync(fullPath, content, 'utf8');
            } catch {}
          }
        }
        replaceInDir(newTenantDir);

        // Clear tenant cache so the new tenant is picked up
        container.tenantRepository.clearCache(tenantId);

        // Return success with the new tenant + embed snippet
        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        const embedSnippet = `<script src="${novaOrigin}/widget.js" data-tenant="${tenantId}" async></script>`;

        return sendJson(res, 201, {
          ok: true,
          tenant: { id: tenantId, name: businessName, templateId, domain: profile.domain || 'generic', capabilities: profile.capabilities || [] },
          embedSnippet,
          adminUrl: `/admin`,
          message: `Tenant '${businessName}' created from template '${templateId}'. Widget is ready to embed.`
        });
      }

      const adminTenantActionMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(suspend|activate|delete|export)$/);
      if (req.method === "POST" && adminTenantActionMatch) {
        const tenantId = decodeURIComponent(adminTenantActionMatch[1]);
        const action = adminTenantActionMatch[2];
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Tenant not found' }); }

        if (action === 'export') {
          // Export tenant folder as a zip so it can be committed to git
          // (Render's ephemeral filesystem wipes new tenants on restart)
          const tenantDir = path.join(container.config.tenantsDir, tenantId);
          if (!fs.existsSync(tenantDir)) return sendJson(res, 404, { ok:false, error:'Tenant folder not found' });
          // Return a JSON manifest of all files in the tenant folder
          // so the dashboard can reconstruct them
          const files = [];
          function walk(dir, rel='') {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fullPath = path.join(dir, entry.name);
              const relPath = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) { walk(fullPath, relPath); continue; }
              try {
                const content = fs.readFileSync(fullPath, 'utf8');
                files.push({ path: relPath, content });
              } catch {}
            }
          }
          walk(tenantDir);
          return sendJson(res, 200, { ok:true, tenantId, files });
        }
        if (action === 'delete') {
          // Don't actually delete demo tenants — just mark them suspended for safety
          const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
          const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          if (profile._template?.isTemplate) return sendJson(res, 403, { ok:false, error:'Cannot delete a template' });
          // Move to _deleted folder instead of permanent delete
          const deletedDir = path.join(container.config.tenantsDir, '_deleted');
          fs.mkdirSync(deletedDir, { recursive: true });
          fs.renameSync(path.join(container.config.tenantsDir, tenantId), path.join(deletedDir, `${tenantId}-${Date.now()}`));
          container.tenantRepository.clearCache(tenantId);
          return sendJson(res, 200, { ok:true, message:`Tenant '${tenantId}' deleted.` });
        }
        // suspend/activate
        const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        profile.status = action === 'suspend' ? 'suspended' : 'active';
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
        container.tenantRepository.clearCache(tenantId);
        return sendJson(res, 200, { ok:true, tenantId, status: profile.status });
      }
      // ─── End v30.1 template & tenant creation endpoints ─────────────────────

      const adminLeadsMatch = url.pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
      if (req.method === "GET" && adminLeadsMatch) {
        const tenantId = decodeURIComponent(adminLeadsMatch[1]);
        container.tenantRepository.getById(tenantId);
        const [summary, leads] = await Promise.all([
          container.leadService.summary(tenantId),
          container.leadService.list(tenantId, { limit: 200 })
        ]);
        return sendJson(res, 200, { ok:true, tenantId, summary, leads });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/datasets") {
        const datasetsRoot = path.resolve(__dirname, "../../../tests/datasets");
        const datasets = [];
        const walk = (dir, prefix="") => {
          if (!fs.existsSync(dir)) return;
          for (const name of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            if (fs.statSync(full).isDirectory()) { walk(full, rel); continue; }
            if (name.endsWith(".json")) {
              try {
                const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
                datasets.push({
                  path: rel,
                  tenantId: parsed.tenantId || null,
                  caseCount: parsed.cases?.length || 0,
                  turnCount: (parsed.cases||[]).reduce((s,c)=>s+(c.turns?.length||0),0)
                });
              } catch {}
            }
          }
        };
        walk(datasetsRoot);
        return sendJson(res, 200, { ok:true, datasets });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/datasets/run") {
        const body = await readJson(req);
        const report = await runDataset(container, String(body.dataset || ""));
        return sendJson(res, 200, report);
      }

      // ─── v30.0 Notification endpoints ─────────────────────────────────────
      const adminNotificationsMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)$/);
      if (req.method === "GET" && adminNotificationsMatch) {
        const tenantId = decodeURIComponent(adminNotificationsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const limit = Number(url.searchParams.get("limit") || 100);
        const unreadOnly = url.searchParams.get("unreadOnly") === "true";
        const [notifications, unreadCount, totalCount] = await Promise.all([
          container.notificationService.listNotifications(tenantId, { limit, unreadOnly }),
          container.notificationService.unreadCount(tenantId),
          container.notificationService.notificationLog.totalCount(tenantId)
        ]);
        return sendJson(res, 200, { ok:true, tenantId, notifications, unreadCount, totalCount, emailService: container.emailService.getStatus() });
      }
      if (req.method === "POST" && adminNotificationsMatch) {
        const body = await readJson(req);
        const tenantId = decodeURIComponent(adminNotificationsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const result = await container.notificationService.markAllRead(tenantId);
        return sendJson(res, 200, { ok:true, markedRead: result });
      }

      const adminNotificationReadMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/([^/]+)\/read$/);
      if (req.method === "POST" && adminNotificationReadMatch) {
        const tenantId = decodeURIComponent(adminNotificationReadMatch[1]);
        const notificationId = decodeURIComponent(adminNotificationReadMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const result = await container.notificationService.markRead(tenantId, notificationId);
        return result ? sendJson(res, 200, { ok:true, notification: result }) : sendJson(res, 404, { ok:false, error:'Notification not found' });
      }

      const adminNotificationPrefsMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/preferences$/);
      if (req.method === "GET" && adminNotificationPrefsMatch) {
        const tenantId = decodeURIComponent(adminNotificationPrefsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const prefs = container.notificationService.getPreferences(tenantId);
        return sendJson(res, 200, { ok:true, tenantId, preferences: prefs, emailService: container.emailService.getStatus() });
      }
      if (req.method === "PUT" && adminNotificationPrefsMatch) {
        const tenantId = decodeURIComponent(adminNotificationPrefsMatch[1]);
        const body = await readJson(req);
        try {
          const profile = container.tenantRepository.getById(tenantId);
          profile.notifications = body.preferences || body;
          // Persist back to profile.json
          const profilePath = path.join(container.config.tenantsDir, tenantId, "profile.json");
          fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
          container.tenantRepository.clearCache(tenantId);
          return sendJson(res, 200, { ok:true, tenantId, preferences: profile.notifications });
        } catch (error) {
          return sendJson(res, 500, { ok:false, error: error.message });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/admin/notifications/email/test") {
        const result = await container.emailService.verifyConnection();
        return sendJson(res, 200, { ok: result.ok, status: result });
      }
      // ─── End v30.0 notification endpoints ───────────────────────────────────
      // ─── End admin dashboard endpoints ──────────────────────────────────────

      // v28.0 — CORS preflight for all widget endpoints.
      // Must be the very first thing checked so OPTIONS never hits auth.
      if (req.method === "OPTIONS" && (url.pathname === "/api/chat" || url.pathname.startsWith("/api/widget/"))) {
        const origin = String(req.headers['origin'] || '*');
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-nova-tenant-id',
          'Access-Control-Max-Age': '600',
          'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Remaining'
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        // ─── v30.1.4 Widget API Key Security ──────────────────────────────────
        // Tenants can require an API key for widget requests by setting
        // widget.apiKey in their profile.json. If set, requests must include
        // x-nova-api-key header matching the key.
        // This prevents unauthorized websites from embedding your Nova agent.
        // If widget.apiKey is NOT set, the widget is open (anyone can embed).
        const origin = String(req.headers['origin'] || '*');
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const body = await readJson(req);
        const tenantIdForRateLimit = String(body.tenantId || container.config.defaultTenantId);

        // v30.1.4: Check if tenant has API key protection enabled
        let tenantProfile = null;
        try { tenantProfile = container.tenantRepository.getById(tenantIdForRateLimit); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }

        const widgetApiKey = tenantProfile?.widget?.apiKey;
        const allowedDomains = tenantProfile?.widget?.allowedDomains;

        if (widgetApiKey) {
          // API key is required
          const suppliedKey = String(req.headers['x-nova-api-key'] || body.apiKey || '');
          if (suppliedKey !== widgetApiKey) {
            return sendJson(res, 403, { ok:false, error:'Invalid API key. This widget requires authorization.' });
          }
        }

        // v30.1.4: Domain whitelist (optional)
        if (allowedDomains && Array.isArray(allowedDomains) && allowedDomains.length > 0) {
          const requestOrigin = String(req.headers['origin'] || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
          const isAllowed = allowedDomains.some(d => {
            const clean = d.replace(/^https?:\/\//, '').replace(/\/$/, '');
            return requestOrigin === clean || requestOrigin.endsWith('.' + clean);
          });
          if (!isAllowed && requestOrigin) {
            return sendJson(res, 403, { ok:false, error:'This domain is not authorized to use this widget.' });
          }
        }

        const rateResult = checkWidgetRateLimit(`${clientIp}:${tenantIdForRateLimit}`);
        if (!rateResult.allowed) {
          res.writeHead(429, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type',
            'Retry-After': String(rateResult.retryAfterSeconds),
            'X-RateLimit-Limit': '30',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateResult.resetAt)
          });
          return res.end(JSON.stringify({ ok:false, error:'Rate limit exceeded. Please slow down.', retryAfterSeconds: rateResult.retryAfterSeconds }));
        }
        if(String(body.text||'').trim().length>4000)throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
        // Tenant verification: reject unknown tenants so attackers cannot
        // probe internal tenant IDs through the public endpoint.
        const tenantId = String(body.tenantId || container.config.defaultTenantId);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        // CustomerId cap: 128 chars, alphanumeric + dash/underscore only.
        // The widget generates a per-browser UUID; we just need to prevent
        // abuse vectors like injecting tenantIds or SQL via customerId.
        // Auto-generate if missing so anonymous widget users work out-of-box.
        let customerId = String(body.customerId || '').trim();
        if (customerId.length === 0) {
          customerId = `widget-${crypto.randomUUID()}`;
        } else if (customerId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(customerId)) {
          return sendJson(res, 400, { ok:false, error:'Invalid customerId' });
        }
        body.customerId = customerId;
        body.tenantId = tenantId;
        body.channel = 'widget';
        if (!body.metadata) body.metadata = {};
        body.metadata.source = 'widget';
        body.metadata.origin = origin;
        body.metadata.clientIp = clientIp;
        const adapter = container.channelRegistry.get("http");
        const message = adapter.normalizeIncoming(body);
        const result = await container.executionEngine.process(message);
        // CORS headers on the response so the browser exposes the body to JS
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, X-RateLimit-Remaining');
        res.setHeader('X-Request-Id', requestCorrelationId(req) || crypto.randomUUID());
        res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
        return sendJson(res, 200, adapter.formatOutgoing(result));
      }

      // v28.0 — Public widget config endpoint (no auth required, read-only)
      // Returns ONLY what the widget needs to bootstrap: assistantName,
      // welcomeMessage, themeColor, position, language, suggestions.
      // v29.0 — extended with agent persona, pre-chat form, proactive greeting.
      // Sensitive tenant data (permissions, internal IDs) never leaves the server.
      const widgetConfigMatch = url.pathname.match(/^\/api\/widget\/config\/([^/]+)$/);
      if (req.method === "GET" && widgetConfigMatch) {
        const tenantId = decodeURIComponent(widgetConfigMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const profile = container.tenantRepository.getById(tenantId);
        const branding = profile.branding || {};
        const widget = profile.widget || {};
        const business = profile.business || {};
        const origin = String(req.headers['origin'] || '*');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Cache-Control', 'public, max-age=300');
        return sendJson(res, 200, {
          ok:true,
          tenantId,
          // v28 core fields
          assistantName: branding.assistantName || 'Nova',
          welcomeMessage: widget.welcomeMessage || branding.welcomeMessage || 'Hi! How can I help you today?',
          welcomeMessageRomanUrdu: widget.welcomeMessageRomanUrdu || branding.welcomeMessageRomanUrdu || null,
          themeColor: widget.themeColor || '#2d5bd1',
          position: widget.position || 'bottom-right',
          language: widget.language || 'auto',
          suggestions: widget.suggestions || [],
          businessName: profile.name || '',
          businessDescription: business.description || '',
          enabled: widget.enabled !== false,
          // v30.1.4: Security status (does NOT expose the actual key)
          requiresApiKey: !!widget.apiKey,
          allowedDomains: widget.allowedDomains || [],
          // v29 agent persona
          agent: {
            avatar: widget.agentAvatar || 'marcus',
            name: widget.agentName || branding.assistantName || 'Nova',
            title: widget.agentTitle || 'Assistant',
            online: true
          },
          // v29 pre-chat form (optional)
          preChatForm: widget.preChatForm || { enabled: false, fields: [] },
          // v29 proactive greeting (optional)
          proactiveGreeting: widget.proactiveGreeting || { enabled: false, delaySeconds: 5, message: null, pageRules: [] }
        });
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

// ─── v28.0 Widget rate limiter ──────────────────────────────────────────────
// In-memory sliding-window rate limiter. No Redis required.
// Limits: 30 messages per 60 seconds per (IP + tenantId) bucket.
// Buckets older than 5 minutes are garbage-collected on every call.
// On a multi-instance deployment without Redis this limiter is per-process,
// so each Nova instance allows 30/min independently (e.g., 3 pods × 30 = 90/min).
// When Redis is configured in v26 hardening, swap this for a Redis SETEX-based
// limiter for global counting across instances.
const WIDGET_RATE_LIMIT = { windowMs: 60_000, max: 30, gcMs: 5 * 60_000 };
const _widgetBuckets = new Map();
let _widgetLastGc = Date.now();
function checkWidgetRateLimit(key) {
  const now = Date.now();
  if (now - _widgetLastGc > WIDGET_RATE_LIMIT.gcMs) {
    for (const [k, entry] of _widgetBuckets) if (now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) _widgetBuckets.delete(k);
    _widgetLastGc = now;
  }
  let entry = _widgetBuckets.get(key);
  if (!entry || now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) {
    entry = { windowStart: now, count: 0 };
    _widgetBuckets.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, WIDGET_RATE_LIMIT.max - entry.count);
  const resetAt = entry.windowStart + WIDGET_RATE_LIMIT.windowMs;
  return {
    allowed: entry.count <= WIDGET_RATE_LIMIT.max,
    remaining,
    resetAt,
    retryAfterSeconds: entry.count > WIDGET_RATE_LIMIT.max ? Math.ceil((resetAt - now) / 1000) : 0
  };
}
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
function serveAdminAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../admin-dashboard/public");
  const relative = ["/admin","/admin/"].includes(pathname) ? "index.html" : pathname.replace(/^\/admin\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function serveWidgetAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../widget/public");
  const relativeMap = {
    "/widget.js": "widget.js",
    "/widget-config.js": "widget-config.js",
    "/avatars.js": "avatars.js",
    "/widget-test": "index.html"
  };
  const relative = relativeMap[pathname];
  if (!relative) return sendText(res, 404, "Not found");
  const file = path.resolve(root, relative);
  if (!fs.existsSync(file)) return sendText(res, 404, "Widget asset not found: " + relative);
  const ext = path.extname(file);
  const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  // widget.js is served cross-origin; CSP ensures the script cannot be
  // hijacked to inject other origins' content. Cache-Control no-store so
  // tenants get instant config changes when they update their profile.
  if (pathname === "/widget-test") {
    res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" });
  } else {
    // Served with CORS Access-Control-Allow-Origin: * so any website can
    // load the script. The script is self-contained and only talks to
    // /api/widget/config and /api/chat (which have their own CORS).
    res.writeHead(200, {
      "Content-Type":types[ext] || "application/octet-stream",
      "Cache-Control":"no-store, must-revalidate",
      "Access-Control-Allow-Origin":"*",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":"default-src 'none'; script-src 'self'"
    });
  }
  res.end(fs.readFileSync(file));
}
function listTenants(tenantsDir, tenantRepository = null) {
  if (!fs.existsSync(tenantsDir)) return [];
  return fs.readdirSync(tenantsDir).sort().flatMap((id) => {
    // v30.1: skip internal folders (_templates, _deleted)
    if (id.startsWith('_')) return [];
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
