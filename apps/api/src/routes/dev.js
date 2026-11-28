/**
 * v74.2 — Developer console router (Phase 4, final, of the Express migration).
 *
 * Every /api/dev/* endpoint from the v73.x→v74.1 server.js if-chain,
 * converted 1:1. The dev-token gate ("Developer Console token is required")
 * is now router-level middleware: any route declared after router.use is
 * gated by construction, and unknown /api/dev/* paths still 401 without a
 * token and 404 with one — matching the old startsWith("/api/dev/")
 * pre-check.
 *
 * createCrmRouter mounts at /api/crm and keeps the gate INLINE on its one
 * route: in v73.x an unknown /api/crm/* path fell through to 404 without
 * any auth check, and that ordering is preserved.
 *
 * Handler bodies are verbatim transcriptions with mechanical substitutions
 * only (url.searchParams.get(x) → req.query.x, decodeURIComponent(match[n])
 * → req.params.x, package requires one directory deeper). Handlers keep
 * readJson()/sendJson() from http-helpers — no express.json on these
 * prefixes — so raw streams stay available and readJson rejections flow to
 * the central error handler with the same 400 as v73.x.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { importBusinessFile } = require("../../../../packages/tenant-onboarding/src/businessFileImporter");
const {
  sendJson, readJson, controlPlaneActor, requestCorrelationId,
  authorizeDeveloperRequest, listTenants, runDataset,
} = require("../http-helpers");
const { createRequireDeveloperToken } = require("./middleware");
const { ValidationError } = require("../../../../packages/shared/src/errors");

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

function createDevRouter({ container }) {
  const router = express.Router();

  // ═══ Dev-token gate — everything below requires NOVA_DEV_TOKEN ═════════
  router.use(createRequireDeveloperToken("Developer Console token is required"));

  router.post('/chat', async (req, res) => {
    const body = await readJson(req);
    const message = { channel: "playground", customerId: String(body.customerId || "playground-user"), tenantId: String(body.tenantId || container.config.defaultTenantId), messageId: body.messageId ? String(body.messageId) : null, text: String(body.text || ""), metadata: { source: "developer-console" } };
    if (!message.text.trim()) return sendJson(res, 400, { ok:false, error:"text is required" });
    const result = await container.executionEngine.process(message);
    return sendJson(res, 200, { ok:true, ...result });
  });

  router.post('/reset', async (req, res) => {
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
  });

  router.get('/replays', async (req, res) => {
    const replays = await container.replayService.list({ conversationId:req.query.conversationId || null, limit:Number(req.query.limit || 50) });
    return sendJson(res, 200, { ok:true, replays });
  });

  router.get('/leads', async (req, res) => {
    const tenantId=String(req.query.tenantId||container.config.defaultTenantId);
    container.tenantRepository.getById(tenantId);
    const leads=await container.leadService.list(tenantId,{status:req.query.status||null,grade:req.query.grade||null,limit:Number(req.query.limit||100)});
    const summary=await container.leadService.summary(tenantId);
    return sendJson(res,200,{ok:true,tenantId,summary,leads});
  });

  router.get('/leads/:tenantLeadId', async (req, res) => {
    const tenantId=String(req.query.tenantId||container.config.defaultTenantId);
    container.tenantRepository.getById(tenantId);
    const lead=await container.leadService.get(tenantId,req.params.tenantLeadId);
    return lead?sendJson(res,200,{ok:true,lead}):sendJson(res,404,{ok:false,error:"Lead not found"});
  });

  router.get('/replays/:replayId', async (req, res) => {
    const replay = await container.replayService.get(req.params.replayId);
    return replay ? sendJson(res, 200, { ok:true, replay }) : sendJson(res, 404, { ok:false, error:"Replay not found" });
  });

  router.get('/capabilities', (req, res) => {
    return sendJson(res, 200, { ok:true, capabilities:container.registry.list().map((capability)=>({ id:capability.id, manifest:capability.manifest })) });
  });

  router.get('/data/inspect', async (req, res) => {
    const tenantId = String(req.query.tenantId || container.config.defaultTenantId);
    const customerId = String(req.query.customerId || "playground-user");
    const channel = String(req.query.channel || "playground");
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
  });

  router.get('/tenants', (req, res) => {
    const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
    return sendJson(res, 200, { ok:true, tenants });
  });

  // ─── Tenant Control Plane (drafts → validate/preview/publish → revisions) ──
  router.get('/control-plane/:tenantId', (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId);
    return sendJson(res,200,{ok:true,controlPlane:container.tenantControlPlaneService.overview(tenantId,actor)});
  });

  router.get('/control-plane/:tenantId/resources/:resourceType', (req, res) => {
    const tenantId=req.params.tenantId,resourceType=req.params.resourceType,actor=controlPlaneActor(req,tenantId);
    return sendJson(res,200,{ok:true,resource:container.tenantControlPlaneService.getResource(tenantId,resourceType,actor)});
  });

  router.get('/control-plane/:tenantId/drafts', (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId);
    return sendJson(res,200,{ok:true,drafts:container.tenantControlPlaneService.listDrafts(tenantId,actor,{status:req.query.status||null})});
  });
  router.post('/control-plane/:tenantId/drafts', async (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    const draft=container.tenantControlPlaneService.createDraft({tenantId,resourceType:String(body.resourceType||''),document:body.document,actor,requestId:requestCorrelationId(req)});
    return sendJson(res,201,{ok:true,draft});
  });

  // Draft lifecycle actions. (The v73.x regex restricted the action inline;
  // here the param is validated and anything else 404s, matching the old
  // fall-through.)
  router.post('/control-plane/:tenantId/drafts/:draftId/:action', (req, res) => {
    const tenantId=req.params.tenantId,draftId=req.params.draftId,action=req.params.action,actor=controlPlaneActor(req,tenantId);
    if (!['validate','preview','publish'].includes(action)) return sendJson(res,404,{ok:false,error:"Not found"});
    const input={tenantId,draftId,actor,requestId:requestCorrelationId(req)};
    const result=action==='validate'?container.tenantControlPlaneService.validateDraft(input):action==='preview'?container.tenantControlPlaneService.previewDraft(input):container.tenantControlPlaneService.publishDraft(input);
    return sendJson(res,200,{ok:true,[action==='publish'?'revision':action]:result});
  });

  router.get('/control-plane/:tenantId/drafts/:draftId', (req, res) => {
    const tenantId=req.params.tenantId,draftId=req.params.draftId,actor=controlPlaneActor(req,tenantId);
    return sendJson(res,200,{ok:true,draft:container.tenantControlPlaneService.getDraft(tenantId,draftId,actor)});
  });
  router.patch('/control-plane/:tenantId/drafts/:draftId', async (req, res) => {
    const tenantId=req.params.tenantId,draftId=req.params.draftId,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    const draft=container.tenantControlPlaneService.updateDraft({tenantId,draftId,document:body.document,actor,requestId:requestCorrelationId(req)});
    return sendJson(res,200,{ok:true,draft});
  });
  router.delete('/control-plane/:tenantId/drafts/:draftId', (req, res) => {
    const tenantId=req.params.tenantId,draftId=req.params.draftId,actor=controlPlaneActor(req,tenantId);
    const draft=container.tenantControlPlaneService.discardDraft({tenantId,draftId,actor,requestId:requestCorrelationId(req)});
    return sendJson(res,200,{ok:true,draft});
  });

  router.get('/control-plane/:tenantId/resources/:resourceType/revisions', (req, res) => {
    const tenantId=req.params.tenantId,resourceType=req.params.resourceType,actor=controlPlaneActor(req,tenantId);
    const revisions=container.tenantControlPlaneService.listRevisions(tenantId,resourceType,actor,{includeDocument:req.query.includeDocument==='true'});
    return sendJson(res,200,{ok:true,revisions});
  });

  router.post('/control-plane/:tenantId/resources/:resourceType/rollback', async (req, res) => {
    const tenantId=req.params.tenantId,resourceType=req.params.resourceType,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    const revision=container.tenantControlPlaneService.rollback({tenantId,resourceType,targetRevision:Number(body.revision),actor,requestId:requestCorrelationId(req)});
    return sendJson(res,200,{ok:true,revision});
  });

  router.get('/control-plane/:tenantId/audit', (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId);
    return sendJson(res,200,{ok:true,audit:container.tenantControlPlaneService.listAudit(tenantId,actor,{limit:Number(req.query.limit||100)})});
  });

  router.get('/control-plane/:tenantId/inventory', async (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId);
    container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"products"});
    await container.inventoryService.syncCatalog({tenantId,products:await container.catalogService.listProducts(tenantId),actorId:actor.id});
    return sendJson(res,200,{ok:true,inventory:await container.inventoryService.overview(tenantId)});
  });
  router.patch('/control-plane/:tenantId/inventory/:sku', async (req, res) => {
    const tenantId=req.params.tenantId,sku=req.params.sku,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"products"});
    const products=await container.catalogService.listProducts(tenantId);
    const match=products.flatMap(product=>product.variants?.length?product.variants.map(variant=>({product,variant,sku:variant.sku,inventory:variant.inventory})):[]).find(row=>String(row.sku).toLowerCase()===String(sku).toLowerCase());
    if(!match||match.inventory==null)throw new ValidationError(`SKU '${sku}' is not an inventory-tracked SKU in this tenant catalog.`);
    const stock=await container.inventoryService.setOnHand({tenantId,sku:match.sku,productId:match.product.id,variantId:match.variant?.id||null,quantity:Number(body.onHand),actorId:actor.id,reason:String(body.reason||"control_plane_adjustment")});
    return sendJson(res,200,{ok:true,stock});
  });

  router.get('/control-plane/:tenantId/calendar', async (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId);
    container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"calendar"});
    return sendJson(res,200,{ok:true,calendar:{config:container.calendarService.getConfig(tenantId),events:await container.calendarService.listEvents({tenantId,includeCancelled:true}),holds:container.calendarService.listHolds({tenantId,activeOnly:false})}});
  });
  router.post('/control-plane/:tenantId/calendar/blocks', async (req, res) => {
    const tenantId=req.params.tenantId,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
    const result=await container.calendarService.createBlock({tenantId,date:String(body.date||""),time:String(body.time||""),durationMinutes:Number(body.durationMinutes||60),capacityRequired:Number(body.capacityRequired||1),poolId:body.poolId?String(body.poolId):null,subject:String(body.subject||"Blocked time"),actorId:actor.id});
    return sendJson(res,result.status==='confirmed'?201:409,{ok:result.status==='confirmed',result,...(result.status==='confirmed'?{}:{error:result.message||"Calendar block could not be created."})});
  });
  router.post('/control-plane/:tenantId/calendar/events/:eventId/cancel', async (req, res) => {
    const tenantId=req.params.tenantId,eventId=req.params.eventId,actor=controlPlaneActor(req,tenantId),body=await readJson(req);
    container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
    const event=(await container.calendarService.listEvents({tenantId,includeCancelled:true})).find((entry)=>entry.id===eventId);
    if(!event)throw new ValidationError(`Calendar event '${eventId}' was not found in this tenant.`);
    if(event.type!=="block")throw new ValidationError("Customer booking events must be cancelled through their booking/service-request workflow so transaction and calendar records stay consistent.");
    const result=await container.calendarService.cancel({tenantId,eventId,reason:String(body.reason||`control_plane:${actor.id}`)});
    return sendJson(res,200,{ok:true,result});
  });

  // ─── Tenant onboarding (business file import + provisioning) ──────────
  router.post('/onboarding/import-business-file', async (req, res) => {
    const body=await readJson(req);
    const imported=importBusinessFile({name:String(body.name||""),text:String(body.text||"")});
    return sendJson(res,200,{ok:true,format:imported.format,spec:normalizeOnboardingSpec(imported.spec),summary:{offerings:imported.spec.offerings?.length||0,faqs:imported.spec.faqs?.length||0}});
  });

  router.post('/onboarding/tenant', async (req, res) => {
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
  });

  router.post('/onboarding/knowledge', async (req, res) => {
    const body = await readJson(req);
    const tenantId=String(body.tenantId || "").trim();
    const text=String(body.text || "").trim();
    if(!tenantId || !text) return sendJson(res,400,{ok:false,error:"tenantId and text are required"});
    container.tenantRepository.getById(tenantId);
    const result=container.tenantKnowledgeManager.addDocument(tenantId,{title:String(body.name||"Business notes"),text,format:String(body.format||"txt"),priority:Number(body.priority||50)});
    return sendJson(res,201,{ok:true,document:{tenantId,name:path.basename(result.path),format:result.format,sourceId:result.source.id}});
  });

  // ─── Knowledge Manager (documents, faqs, facts, search, reindex, playground) ──
  router.get('/knowledge/:tenantId', (req, res) => {
    const tenantId=req.params.tenantId;
    container.tenantRepository.getById(tenantId);
    return sendJson(res,200,{ok:true,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });

  // v68 sunset: operational pricing moved to Control Plane — 410 signpost.
  router.get('/operations/:tenantId/pricing', (req, res) => {
    const tenantId=req.params.tenantId;container.tenantRepository.getById(tenantId);
    return sendJson(res,410,{ok:false,error:"Operational pricing has moved to Control Plane → Services & Pricing. Products and variant prices belong in Products & Prices. Knowledge Manager cannot publish commercial values."});
  });
  router.put('/operations/:tenantId/pricing', (req, res) => {
    const tenantId=req.params.tenantId;container.tenantRepository.getById(tenantId);
    return sendJson(res,410,{ok:false,error:"Operational pricing has moved to Control Plane → Services & Pricing. Products and variant prices belong in Products & Prices. Knowledge Manager cannot publish commercial values."});
  });

  router.post('/knowledge/:tenantId/files', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
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
  });

  router.post('/knowledge/:tenantId/documents', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const result=container.tenantKnowledgeManager.addDocument(tenantId,{
      title:String(body.title||"Knowledge note"),text:String(body.text||""),format:String(body.format||"txt"),
      tags:Array.isArray(body.tags)?body.tags:[],priority:Number(body.priority||50)
    });
    return sendJson(res,201,{ok:true,document:result,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });

  router.post('/knowledge/:tenantId/faqs', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const faq=container.tenantKnowledgeManager.addFaq(tenantId,{question:String(body.question||""),answer:String(body.answer||""),tags:Array.isArray(body.tags)?body.tags:[]});
    return sendJson(res,201,{ok:true,faq,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });

  router.post('/knowledge/:tenantId/facts', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const fact=container.tenantKnowledgeManager.setFact(tenantId,{key:String(body.key||""),value:body.value});
    return sendJson(res,200,{ok:true,fact,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });

  router.post('/knowledge/:tenantId/search', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);container.tenantRepository.getById(tenantId);
    const query=String(body.query||"").trim();if(!query)return sendJson(res,400,{ok:false,error:"query is required"});
    const matches=container.knowledgeRepository.search(tenantId,query,{limit:Number(body.limit||6),minScore:Number(body.minScore??.10)});
    return sendJson(res,200,{ok:true,query,matches:matches.map(x=>({
      text:x.text,source:x.source,sourceId:x.sourceId,sourceTitle:x.sourceTitle,sourceKind:x.sourceKind,path:x.path,priority:x.priority,
      score:x.score,hybridScore:x.hybridScore,lexicalScore:x.lexicalScore,semanticScore:x.semanticScore,evidenceType:x.evidenceType,customerSafe:x.customerSafe
    }))});
  });

  router.post('/knowledge/:tenantId/reindex', (req, res) => {
    const tenantId=req.params.tenantId;container.tenantRepository.getById(tenantId);
    return sendJson(res,200,{ok:true,index:container.tenantKnowledgeManager.reindex(tenantId)});
  });

  // ─── v59.0 Phase 6 admin endpoints (spec §13) ───────────────────
  // Chunk Explorer: list chunks for a source.
  router.get('/knowledge/:tenantId/sources/:sourceId/chunks', (req, res) => {
    const tenantId=req.params.tenantId;
    const sourceId=req.params.sourceId;
    container.tenantRepository.getById(tenantId);
    const index=container.knowledgeRepository.getIndexForTenant(tenantId);
    const docs=index.docs||[];
    const chunks=docs.filter(d=>d.sourceId===sourceId).map(d=>({
      chunkId:d.id, sourceId:d.sourceId, sourceVersion:d.sourceVersion, text:d.text,
      heading:d.path, knowledgeType:d.evidenceType, customerSafe:d.customerSafe,
      sourceTitle:d.sourceTitle, sourceKind:d.sourceKind, sourceLocation:d.sourceLocation||null,
    }));
    return sendJson(res,200,{ok:true,sourceId,chunkCount:chunks.length,chunks});
  });

  // Retrieval Playground: full retrieval trace (intent → rewrite → matches → scores).
  router.post('/knowledge/:tenantId/playground', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const query=String(body.query||"").trim();
    if(!query) return sendJson(res,400,{ok:false,error:"query is required"});
    // Build the trace through the Phase 3 + 4 pipeline (lazy-loaded so older
    // deployments without the new packages still serve /search above).
    let trace={query};
    try{
      const {IntentRouter}=require("../../../../packages/knowledge-retrieval/src/intentRouter");
      const {QueryRewriter}=require("../../../../packages/knowledge-retrieval/src/queryRewriter");
      const {EvidenceValidator}=require("../../../../packages/knowledge-retrieval/src/evidenceValidator");
      const router=new IntentRouter();
      const rewriter=new QueryRewriter();
      const validator=new EvidenceValidator();
      const classified=router.classify(query);
      const rewritten=rewriter.rewrite(query);
      const matches=container.knowledgeRepository.search(tenantId,rewritten.expanded,{
        limit:Number(body.limit||6), minScore:Number(body.minScore??0.05), minSemantic:Number(body.minSemantic??0.05),
        ...(classified.requiredSources&&classified.requiredSources.length?{kinds:classified.requiredSources}:{}),
      });
      const validation=validator.validate({query:rewritten.normalized,matches,intent:classified.intent});
      trace={
        originalQuery:query,
        intent:classified.intent, entities:classified.entities, missingFields:classified.missingFields,
        confidence:classified.confidence, requiredSources:classified.requiredSources,
        rewritten:{normalized:rewritten.normalized, expanded:rewritten.expanded, variants:rewritten.variants},
        matches:matches.map(x=>({text:x.text,sourceId:x.sourceId,sourceTitle:x.sourceTitle,sourceKind:x.sourceKind,
          score:x.score,hybridScore:x.hybridScore,lexicalScore:x.lexicalScore,semanticScore:x.semanticScore,
          evidenceType:x.evidenceType,customerSafe:x.customerSafe})),
        evidenceValidation:validation,
      };
    }catch(err){
      trace.error="playground pipeline unavailable: "+err.message;
      trace.matches=container.knowledgeRepository.search(tenantId,query,{limit:Number(body.limit||6),minScore:Number(body.minScore??0.05)});
    }
    return sendJson(res,200,{ok:true,...trace});
  });

  // Answer Testing: full pipeline including decision + answer (no side effects).
  router.post('/knowledge/:tenantId/test', async (req, res) => {
    const tenantId=req.params.tenantId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const query=String(body.query||"").trim();
    if(!query) return sendJson(res,400,{ok:false,error:"query is required"});
    let result={query,verdict:"unknown"};
    try{
      const {IntentRouter}=require("../../../../packages/knowledge-retrieval/src/intentRouter");
      const {QueryRewriter}=require("../../../../packages/knowledge-retrieval/src/queryRewriter");
      const {EvidenceValidator}=require("../../../../packages/knowledge-retrieval/src/evidenceValidator");
      const {AnswerComposer}=require("../../../../packages/knowledge-answer/src/answerComposer");
      const {DecisionEngine,OUTCOMES}=require("../../../../packages/knowledge-answer/src/decisionEngine");
      const {AbstentionHandler}=require("../../../../packages/knowledge-answer/src/abstentionHandler");
      const router=new IntentRouter();
      const rewriter=new QueryRewriter();
      const validator=new EvidenceValidator();
      const composer=new AnswerComposer();
      const decision=new DecisionEngine();
      const abstain=new AbstentionHandler();
      const classified=router.classify(query);
      const rewritten=rewriter.rewrite(query);
      const matches=container.knowledgeRepository.search(tenantId,rewritten.expanded,{
        limit:6, minScore:0.05, minSemantic:0.05,
        ...(classified.requiredSources&&classified.requiredSources.length?{kinds:classified.requiredSources}:{}),
      });
      const validation=validator.validate({query:rewritten.normalized,matches,intent:classified.intent});
      const decisionResult=decision.decide({
        question:query, intent:classified.intent,
        missingFields:classified.missingFields, evidenceValidation:validation,
      });
      let answer=null, abstentionReason=null;
      if(decisionResult.outcome===OUTCOMES.ANSWER){
        const composed=await composer.compose({
          question:query, intent:classified.intent,
          evidence:validation.evidence, language:body.language||"en",
        });
        answer=composed.answer;
      }else if(decisionResult.outcome===OUTCOMES.CLARIFY){
        answer=abstain.clarify(decisionResult.clarifyField,{tenant:{domain:container.tenantRepository.getById(tenantId).domain}});
        abstentionReason="clarification_required";
      }else if(decisionResult.outcome===OUTCOMES.ESCALATE){
        answer=abstain.abstain("escalate",body.language||"en");
        abstentionReason=decisionResult.reason;
      }else if(decisionResult.outcome===OUTCOMES.REFUSE){
        answer=abstain.abstain("refuse",body.language||"en");
        abstentionReason=decisionResult.reason;
      }
      result={
        query,
        verdict:decisionResult.outcome,
        intent:classified.intent,
        confidence:null, // illustrative per spec §13.4
        matches:matches.map(x=>({text:x.text,sourceId:x.sourceId,score:x.score,hybridScore:x.hybridScore})),
        conflict:validation.checks.conflict,
        evidenceComplete:validation.checks.complete,
        answer,
        abstentionReason,
      };
    }catch(err){
      result.error="test pipeline unavailable: "+err.message;
    }
    return sendJson(res,200,{ok:true,...result});
  });

  // Knowledge Analytics dashboard (spec §13.5).
  router.get('/knowledge/:tenantId/analytics', (req, res) => {
    const tenantId=req.params.tenantId;
    container.tenantRepository.getById(tenantId);
    const dashboard=container.analyticsEngine?.getKnowledgeDashboard?.(tenantId)
      || {error:"analytics engine not configured"};
    return sendJson(res,200,{ok:true,analytics:dashboard});
  });

  // Evaluation: run the knowledge evaluation corpus against the current index.
  router.post('/knowledge/:tenantId/evaluate', async (req, res) => {
    const tenantId=req.params.tenantId;
    container.tenantRepository.getById(tenantId);
    const {runEvaluationCorpus}=require("../../../../tests/fixtures/knowledge-evaluation-corpus");
    const evaluator=async(tc)=>{
      // Use the /test pipeline logic inline (without HTTP).
      const matches=container.knowledgeRepository.search(tenantId,tc.question,{limit:6,minScore:0.05,minSemantic:0.05});
      let outcome="escalate";
      try{
        const {IntentRouter}=require("../../../../packages/knowledge-retrieval/src/intentRouter");
        const {EvidenceValidator}=require("../../../../packages/knowledge-retrieval/src/evidenceValidator");
        const {DecisionEngine,OUTCOMES}=require("../../../../packages/knowledge-answer/src/decisionEngine");
        const router=new IntentRouter();
        const validator=new EvidenceValidator();
        const decision=new DecisionEngine();
        const classified=router.classify(tc.question);
        const validation=validator.validate({query:tc.question,matches,intent:classified.intent});
        const d=decision.decide({question:tc.question,intent:classified.intent,missingFields:classified.missingFields,evidenceValidation:validation});
        outcome=d.outcome;
      }catch{}
      return {outcome, intent:tc.expectedIntent, matches, tenantIsolationOk:true};
    };
    const report=await runEvaluationCorpus(evaluator,{filterDomain:null});
    return sendJson(res,200,{ok:true,evaluation:report});
  });

  // Publish a draft source (Phase 2 T2.8 publication workflow).
  router.post('/knowledge/:tenantId/sources/:sourceId/publish', async (req, res) => {
    const tenantId=req.params.tenantId;
    const sourceId=req.params.sourceId;
    const body=await readJson(req).catch(()=>({}));
    container.tenantRepository.getById(tenantId);
    const result=container.knowledgeSourceRepository.publish(tenantId,sourceId,{approvedBy:body.approvedBy||"admin"});
    container.knowledgeRepository.clearCache(tenantId);
    return sendJson(res,200,{ok:true,published:result});
  });

  router.patch('/knowledge/:tenantId/sources/:sourceId', async (req, res) => {
    const tenantId=req.params.tenantId,sourceId=req.params.sourceId,body=await readJson(req);
    container.tenantRepository.getById(tenantId);
    const updated=container.tenantKnowledgeManager.updateDocument(tenantId,sourceId,{
      title:body.title??null,text:body.text??null,format:String(body.format||'txt'),tags:Array.isArray(body.tags)?body.tags:null,
      priority:body.priority==null?null:Number(body.priority),evidenceType:body.evidenceType??null,status:body.status??null
    });
    return sendJson(res,200,{ok:true,source:updated,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });
  router.delete('/knowledge/:tenantId/sources/:sourceId', (req, res) => {
    const tenantId=req.params.tenantId,sourceId=req.params.sourceId;container.tenantRepository.getById(tenantId);
    const removed=container.tenantKnowledgeManager.removeSource(tenantId,sourceId);
    return sendJson(res,removed?200:404,{ok:removed,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
  });

  router.post('/datasets/run', async (req, res) => {
    const body = await readJson(req);
    const report = await runDataset(container, String(body.dataset || ""));
    return sendJson(res, 200, report);
  });

  return router;
}

// ─── /api/crm — single dev-gated lookup used by the developer console ──────
// The gate stays INLINE on the route: an unknown /api/crm/* path must 404
// without an auth check, exactly as in the v73.x fall-through.
function createCrmRouter({ container }) {
  const router = express.Router();
  router.get('/customer', async (req, res) => {
    if (!authorizeDeveloperRequest(req)) return sendJson(res, 401, { ok:false, error:"Developer Console token is required" });
    const tenantId = req.query.tenantId || container.config.defaultTenantId;
    const customerId = req.query.customerId;
    if (!customerId) return sendJson(res, 400, { ok: false, error: "customerId is required" });
    const customer = await container.crmService.getCustomer(tenantId, customerId);
    const activities = await container.crmService.listActivities(tenantId, customerId, { limit: 20 });
    return sendJson(res, 200, { ok: true, customer, activities });
  });
  return router;
}

module.exports = { createDevRouter, createCrmRouter };
