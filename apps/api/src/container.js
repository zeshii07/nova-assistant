const {KnowledgeSourceRepository}=require('../../../packages/knowledge-platform/src/knowledgeSourceRepository');
const {TenantKnowledgeManager}=require('../../../packages/knowledge-platform/src/tenantKnowledgeManager');
const {FileServiceAvailabilityRepository}=require('../../../packages/service-availability/src/fileServiceAvailabilityRepository');
const {StaticBusinessHoursProvider}=require('../../../packages/service-availability/src/staticBusinessHoursProvider');
const {ServiceAvailabilityEngine}=require('../../../packages/service-availability/src/serviceAvailabilityEngine');
const {AvailabilityConversationAdapter}=require('../../../capabilities/availability/conversation');
const {HandoffService}=require('../../../packages/handoff/src/handoffService');
const {FilePricingRepository}=require('../../../packages/service-pricing/src/filePricingRepository');
const {ServicePricingEngine}=require('../../../packages/service-pricing/src/servicePricingEngine');
const {PricingConversationAdapter}=require('../../../capabilities/pricing/conversation');
const path = require("path");
const { loadConfig } = require("../../../packages/config/src/config");
const { Logger } = require("../../../packages/logger/src/logger");
const { FileTenantRepository } = require("../../../packages/tenant/src/tenantRepository");
const { buildStorage } = require("../../../packages/storage/src/storageFactory");
const { ChannelRegistry } = require("../../../packages/channel/src/channelRegistry");
const { HttpChatAdapter } = require("../../../packages/channel/src/httpChatAdapter");
const { WhatsAppTenantConfigRepository, ProcessedMessageStore, WhatsAppCloudClient, WhatsAppWebhookService } = require("../../../packages/channel/src/whatsapp");
const { FileKnowledgeRepository } = require("../../../packages/knowledge/src/fileKnowledgeRepository");
const { DocumentIngestor } = require("../../../packages/knowledge-ingestion/src/documentIngestor");
const { UniversalTenantOnboardingService } = require("../../../packages/tenant-onboarding/src/universalTenantOnboardingService");
const { LanguageEngine } = require("../../../packages/assistant/src/languageEngine");
const { IntentEngine } = require("../../../packages/assistant/src/intentEngine");
const { KnowledgeService } = require("../../../packages/assistant/src/knowledgeService");
const { ResponseEngine } = require("../../../packages/assistant/src/responseEngine");
const { AssistantService } = require("../../../packages/assistant/src/assistantService");
const { LlmRouter } = require("../../../packages/llm/src/llmRouter");
const { EventBus } = require("../../../packages/event-engine/src/eventBus");
const { CapabilityPermissionService } = require("../../../packages/permission-engine/src/capabilityPermissionService");
const { CapabilityRegistry } = require("../../../packages/capability-engine/src/capabilityRegistry");
const { CapabilityLoader } = require("../../../packages/capability-engine/src/capabilityLoader");
const { CapabilityRouter } = require("../../../packages/capability-engine/src/capabilityRouter");
const { ExecutionEngine } = require("../../../packages/execution-engine/src/executionEngine");
// v16.0: ML intent classifier + hybrid router
const { MlIntentClassifier } = require("../../../packages/ml-intent-classifier/src/mlIntentClassifier");
const { HybridRouter } = require("../../../packages/ml-intent-classifier/src/hybridRouter");
// v17.0: Embedding-based product matcher
const { ProductEmbeddingMatcher } = require("../../../packages/product-matcher/src/productEmbeddingMatcher");
// v19.0: Transformer-based sentence embeddings (optional upgrade)
const { TransformerEmbeddingService } = require("../../../packages/transformer-embeddings/src/transformerEmbeddingService");
// v21.0: Online learning & feedback loop
const { FeedbackCollector } = require("../../../packages/feedback-collector/src/feedbackCollector");
const { OnlineLearner } = require("../../../packages/online-learner/src/onlineLearner");
const { InMemoryMemoryRepository } = require("../../../packages/memory-engine/src/inMemoryMemoryRepository");
const { MemoryPermissionService } = require("../../../packages/memory-engine/src/memoryPermissionService");
const { MemoryService } = require("../../../packages/memory-engine/src/memoryService");

const { CrmPermissionService } = require("../../../packages/crm-engine/src/crmPermissionService");
const { CrmService } = require("../../../packages/crm-engine/src/crmService");
const { FileLeadRepository } = require("../../../packages/lead-engine/src/fileLeadRepository");
const { LeadService } = require("../../../packages/lead-engine/src/leadService");
const { CustomerDataBridge } = require("../../../packages/customer-data/src/customerDataBridge");
const { FileCatalogRepository } = require("../../../packages/catalog-engine/src/fileCatalogRepository");
const { CatalogPermissionService } = require("../../../packages/catalog-engine/src/catalogPermissionService");
const { SynonymService } = require("../../../packages/catalog-engine/src/synonymService");
const { AttributeExtractor } = require("../../../packages/catalog-engine/src/attributeExtractor");
const { ProductMatcher } = require("../../../packages/catalog-engine/src/productMatcher");
const { CatalogService } = require("../../../packages/catalog-engine/src/catalogService");

const { CommercePermissionService } = require("../../../packages/commerce-engine/src/commercePermissionService");
const { CommerceService } = require("../../../packages/commerce-engine/src/commerceService");
const { IntentRenderer } = require("../../../packages/intent-renderer/src/intentRenderer");
const { FileTemplateRepository } = require("../../../packages/template-engine/src/fileTemplateRepository");
const { TemplateEngine } = require("../../../packages/template-engine/src/templateEngine");
const { PersonaEngine } = require("../../../packages/persona-engine/src/personaEngine");
const { ExperienceLanguageEngine } = require("../../../packages/experience-language-engine/src/experienceLanguageEngine");
const { RelationshipEngine } = require("../../../packages/relationship-engine/src/relationshipEngine");
const { PolicyEngine } = require("../../../packages/policy-engine/src/policyEngine");
const { ChannelRendererRegistry } = require("../../../packages/channel-renderer/src/channelRendererRegistry");
const { WhatsAppRenderer } = require("../../../packages/channel-renderer/src/whatsappRenderer");
const { PlainTextRenderer } = require("../../../packages/channel-renderer/src/plainTextRenderer");
const { HumanizationEngine } = require("../../../packages/humanization-engine/src/humanizationEngine");
const { PromptEngine } = require("../../../packages/prompt-engine/src/promptEngine");
const { CleaningPermissionService } = require("../../../packages/cleaning-engine/src/cleaningPermissionService");
const { FileCleaningRepository } = require("../../../packages/cleaning-engine/src/fileCleaningRepository");

const { CleaningService } = require("../../../packages/cleaning-engine/src/cleaningService");
const { ConversationAdapterRegistry, ConversationIntelligenceEngine } = require("../../../packages/conversation-intelligence/src");
const { CatalogConversationAdapter } = require("../../../capabilities/catalog/conversation");
const { CommerceConversationAdapter } = require("../../../capabilities/commerce/conversation");
const { CleaningConversationAdapter } = require("../../../capabilities/cleaning/conversation");
const { AssistantConversationAdapter } = require("../../../capabilities/assistant/conversation");
const { CrmConversationAdapter } = require("../../../capabilities/crm/conversation");
const { InMemoryReplayRepository } = require("../../../packages/replay-engine/src/inMemoryReplayRepository");
const { ReplayService } = require("../../../packages/replay-engine/src/replayService");
const { SocialIntelligenceEngine } = require("../../../packages/social-intelligence/src/socialIntelligenceEngine");
const { DomainSchemaRegistry, DomainResolver } = require("../../../packages/domain-engine/src");
const { EntityResolver } = require("../../../packages/entity-resolution-engine/src/entityResolver");
const { FileOfferingRepository } = require("../../../packages/offering-engine/src/fileOfferingRepository");
const { OfferingService } = require("../../../packages/offering-engine/src/offeringService");
const { FileBookingConfigRepository } = require("../../../packages/booking-engine/src/fileBookingConfigRepository");

const { BookingService } = require("../../../packages/booking-engine/src/bookingService");

const { OfferingOrderService } = require("../../../packages/offering-order-engine/src/offeringOrderService");
const { UniversalEngagementEngine } = require("../../../packages/universal-engagement-engine/src/universalEngagementEngine");
const { OfferingConversationAdapter } = require("../../../capabilities/offering/conversation");
const { BookingConversationAdapter } = require("../../../capabilities/booking/conversation");
const { GroqNluClient, RemoteNluInterpreter, NluDecisionPolicy, NluInvocationPolicy, NluContextBuilder } = require("../../../packages/multilingual-nlu/src");
const { AiLanguageLayer } = require("../../../packages/ai-language-layer/src");
const { LightweightSemanticRouter, SemanticRoutePolicy } = require("../../../packages/semantic-router/src");
const { FileControlPlaneRepository, ControlPlaneAccessPolicy, TenantControlPlaneService } = require("../../../packages/tenant-control-plane/src");
const { InventoryService } = require("../../../packages/inventory-engine/src");
const { FileCalendarConfigRepository, CalendarService } = require("../../../packages/calendar-engine/src");

async function buildContainer() {
  const config = loadConfig();
  const logger = new Logger({ level: config.logLevel, context: { service: "nova-api" } });
  const controlPlaneRepository = new FileControlPlaneRepository({ operationalDataDir: config.operationalDataDir });
  const tenantRepository = new FileTenantRepository({ tenantsDir: config.tenantsDir, logger, controlPlaneRepository });
  const storage = await buildStorage({ config, logger });
  const stateRepository = storage.stateRepository;
  const eventBus = new EventBus({ logger });
  const inventoryRepository = storage.inventoryRepository;
  const inventoryService = new InventoryService({ repository:inventoryRepository, defaultTtlSeconds:config.inventoryReservationTtlSeconds, eventBus, logger });
  const memoryRepository = new InMemoryMemoryRepository({ snapshotFile:path.join(config.localDataDir,"memory.json") });
  const memoryPermissionService = new MemoryPermissionService();
  const memoryService = new MemoryService({ repository: memoryRepository, permissionService: memoryPermissionService, eventBus, logger });
  const crmRepository = storage.crmRepository;
  const crmPermissionService = new CrmPermissionService();
  const crmService = new CrmService({ repository: crmRepository, permissionService: crmPermissionService, eventBus, logger });
  // Lead capture is a platform concern: onboarding a new tenant requires only
  // business/catalog data, never a tenant-specific lead implementation.
  const leadRepository = new FileLeadRepository({ snapshotFile:path.join(config.operationalDataDir,"leads.json") });
  const leadService = new LeadService({ repository:leadRepository, eventBus, logger });
  const engagementService = new UniversalEngagementEngine();
  const customerDataBridge = new CustomerDataBridge({ crmService, engagementService, logger });
  const catalogRepository = new FileCatalogRepository({ tenantsDir: config.tenantsDir, logger, controlPlaneRepository });
  const catalogPermissionService = new CatalogPermissionService();
  const catalogService = new CatalogService({
    repository: catalogRepository,
    matcher: new ProductMatcher({ synonymService: new SynonymService(), attributeExtractor: new AttributeExtractor() }),
    permissionService: catalogPermissionService,
    eventBus,
    logger,
    inventoryService
  });
  const commerceRepository = storage.commerceRepository;
  const commercePermissionService = new CommercePermissionService();
  const commerceService = new CommerceService({ repository: commerceRepository, permissionService: commercePermissionService, eventBus, logger, inventoryService });
  const cleaningServiceRepository = new FileCleaningRepository({ tenantsDir: config.tenantsDir, controlPlaneRepository });
  const cleaningRequestRepository = storage.cleaningRequestRepository;
  const cleaningPermissionService = new CleaningPermissionService();
  const cleaningService = new CleaningService({ serviceRepository: cleaningServiceRepository, requestRepository: cleaningRequestRepository, permissionService: cleaningPermissionService, eventBus, logger });
  const offeringRepository = new FileOfferingRepository({ tenantsDir: config.tenantsDir, controlPlaneRepository });
  const offeringService = new OfferingService({ repository: offeringRepository, resolver: new EntityResolver(), eventBus, logger });
  const bookingConfigRepository = new FileBookingConfigRepository({ tenantsDir: config.tenantsDir });
  const bookingRepository = storage.bookingRepository;
  const bookingService = new BookingService({ configRepository: bookingConfigRepository, repository: bookingRepository, eventBus, calendarService:null });
  const offeringOrderRepository = storage.offeringOrderRepository;
  const offeringOrderService = new OfferingOrderService({ repository:offeringOrderRepository, eventBus });
  const pricingRepository = new FilePricingRepository({ tenantsDir: config.tenantsDir, operationalDataDir:config.operationalDataDir, controlPlaneRepository });
  const pricingService = new ServicePricingEngine({ repository: pricingRepository });
  const calendarConfigRepository = new FileCalendarConfigRepository({ tenantsDir:config.tenantsDir, controlPlaneRepository });
  const controlPlaneAccessPolicy = new ControlPlaneAccessPolicy();
  const tenantControlPlaneService = new TenantControlPlaneService({
    tenantsDir:config.tenantsDir,
    repository:controlPlaneRepository,
    accessPolicy:controlPlaneAccessPolicy,
    invalidators:{
      profile:(tenantId)=>tenantRepository.clearCache(tenantId),
      products:(tenantId)=>{catalogRepository.clearCache(tenantId);catalogRepository.listProducts(tenantId).then(products=>inventoryService.syncCatalog({tenantId,products})).catch(error=>logger.error("inventory.catalog_sync_failed",{tenantId,error:error.message}));},
      services:(tenantId)=>{cleaningServiceRepository.clear(tenantId);offeringRepository.clear(tenantId);},
      calendar:(tenantId)=>calendarConfigRepository.clear(tenantId)
    }
  });
  const handoffService = new HandoffService({ eventBus });
  const knowledgeRepository = new FileKnowledgeRepository({ tenantsDir: config.tenantsDir, knowledgeDataDir:config.knowledgeDataDir, logger });
  const knowledgeService = new KnowledgeService({ knowledgeRepository, controlPlaneRepository });
  const availabilityRuleRepository = new FileServiceAvailabilityRepository({ tenantsDir: config.tenantsDir });
  const businessHoursProvider = new StaticBusinessHoursProvider({ knowledgeRepository, controlPlaneRepository });
  const calendarRepository = storage.calendarRepository;
  const calendarService = new CalendarService({ configRepository:calendarConfigRepository, repository:calendarRepository, hoursProvider:businessHoursProvider, eventBus });
  bookingService.calendarService = calendarService;
  cleaningService.calendarService = calendarService;
  const availabilityService = new ServiceAvailabilityEngine({
    ruleRepository: availabilityRuleRepository,
    hoursProvider: businessHoursProvider,
    offeringService,
    cleaningRepository: cleaningServiceRepository,
    slotProviders: [calendarService.provider()]
  });
  const documentIngestor = new DocumentIngestor({ knowledgeRepository });
  const knowledgeSourceRepository = new KnowledgeSourceRepository({ tenantsDir: config.tenantsDir, knowledgeDataDir:config.knowledgeDataDir });
  const tenantKnowledgeManager = new TenantKnowledgeManager({
    tenantsDir: config.tenantsDir,
    knowledgeDataDir:config.knowledgeDataDir,
    sourceRepository: knowledgeSourceRepository,
    knowledgeRepository,
    documentIngestor
  });
  const tenantOnboardingService = new UniversalTenantOnboardingService({ tenantsDir: config.tenantsDir, knowledgeRepository, tenantRepository });
  // Groq is deliberately reserved for schema-constrained NLU arbitration.
  // Business answers remain deterministic/grounded and cannot trigger an
  // untracked second model call through the general response path.
  const llmRouter = new LlmRouter({ providers: [], logger });
  const assistantService = new AssistantService({ languageEngine: new LanguageEngine(), intentEngine: new IntentEngine(), knowledgeService, responseEngine: new ResponseEngine(), llmRouter, logger });
  const templateRepository = new FileTemplateRepository({ tenantsDir: config.tenantsDir });
  const templateEngine = new TemplateEngine({ repository: templateRepository });
  const personaEngine = new PersonaEngine({ tenantsDir: config.tenantsDir });
  const policyEngine = new PolicyEngine({ tenantsDir: config.tenantsDir });
  const experienceLanguageEngine = new ExperienceLanguageEngine();
  const relationshipEngine = new RelationshipEngine();
  const channelRenderers = new ChannelRendererRegistry()
    .register("whatsapp", new WhatsAppRenderer())
    .register("http", new PlainTextRenderer())
    .register("default", new PlainTextRenderer());
  const humanizationEngine = new HumanizationEngine({
    intentRenderer: new IntentRenderer(), templateEngine, personaEngine,
    languageEngine: experienceLanguageEngine, relationshipEngine, policyEngine,
    channelRenderers, logger
  });
  const promptEngine = new PromptEngine();
  const permissionService = new CapabilityPermissionService();
  const registry = new CapabilityRegistry({ logger });
  const loader = new CapabilityLoader({ capabilitiesDir: path.resolve(__dirname, "../../../capabilities"), logger });
  for (const descriptor of loader.discover()) await registry.register(loader.instantiate(descriptor, { assistantService, commerceService, offeringService, bookingService }));
  const capabilityRouter = new CapabilityRouter({ registry, permissionService, logger });
  // === v16.0: ML Intent Classifier + Hybrid Router ===
  // The ML classifier is a TF-IDF + logistic regression ensemble that runs
  // alongside the regex capability router. It provides a SECOND OPINION on
  // intent — never overrides regex when regex is confident, but breaks ties
  // and surfaces ambiguity when regex is uncertain.
  const mlIntentClassifier = new MlIntentClassifier({ logger });
  const hybridRouter = new HybridRouter({ mlClassifier: mlIntentClassifier, logger });
  capabilityRouter.mlClassifier = mlIntentClassifier;
  capabilityRouter.hybridRouter = hybridRouter;

  // === v17.0: Embedding-Based Product Matcher ===
  // Indexes each tenant's product/service catalog as TF-IDF embeddings and
  // matches user queries via cosine similarity + token overlap. Augments
  // (does not replace) the existing regex-based findService/findProducts.
  //
  // === v19.0: Transformer Embeddings (optional upgrade) ===
  // The TransformerEmbeddingService uses @xenova/transformers all-MiniLM-L6-v2
  // (384-dim, 22MB) for semantic matching. When available, the product matcher
  // uses transformer embeddings for the cosine channel; when not available
  // (e.g., @xenova/transformers not installed), it falls back to TF-IDF.
  const transformerEmbeddingService = new TransformerEmbeddingService({ logger });
  const productEmbeddingMatcher = new ProductEmbeddingMatcher({ logger, transformerService: transformerEmbeddingService });
  // Pre-index all known tenants at startup so the first request has zero
  // indexing latency. Scan the tenants directory directly because the
  // FileTenantRepository doesn't expose a list() method.
  try {
    const fs = require('fs');
    const tenantFolderEntries = fs.readdirSync(config.tenantsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    for (const tenantId of tenantFolderEntries) {
      try {
        const tenant = tenantRepository.getById(tenantId);
        if (!tenant) continue;
        // Index cleaning services if tenant has cleaning capability.
        // Use the repository directly to bypass capability-permission
        // checks (this is read-only indexing, not a customer request).
        if (tenant.capabilities && tenant.capabilities.includes('cleaning') && cleaningServiceRepository) {
          const services = cleaningServiceRepository.loadServices ? cleaningServiceRepository.loadServices(tenantId) : await cleaningServiceRepository.listServices?.(tenantId);
          if (services && services.length) productEmbeddingMatcher.indexTenant(tenantId + ':cleaning', services);
        }
        // Index catalog products if tenant has catalog capability
        if (tenant.capabilities && tenant.capabilities.includes('catalog') && catalogRepository) {
          const products = await catalogRepository.listProducts(tenantId);
          if (products && products.length) productEmbeddingMatcher.indexTenant(tenantId + ':catalog', products);
        }
      } catch (err) {
        logger.warn('product_matcher.tenant_index_failed', { tenantId, error: err.message });
      }
    }
  } catch (err) {
    logger.warn('product_matcher.startup_index_failed', { error: err.message });
  }
  const conversationAdapterRegistry = new ConversationAdapterRegistry()
    .register(new AvailabilityConversationAdapter())
    .register(new PricingConversationAdapter())
    .register(new BookingConversationAdapter())
    .register(new OfferingConversationAdapter())
    .register(new CommerceConversationAdapter())
    .register(new CatalogConversationAdapter())
    .register(new CleaningConversationAdapter())
    .register(new CrmConversationAdapter())
    .register(new AssistantConversationAdapter());
  const groqNluClient = new GroqNluClient({
    baseUrl:config.groqNluBaseUrl,
    model:config.groqNluModel,
    apiKey:config.groqNluApiKey,
    timeoutMs:config.groqNluTimeoutMs,
    failureCooldownMs:config.groqNluFailureCooldownMs,
    logger
  });
  const remoteNluInterpreter = new RemoteNluInterpreter({
    client:groqNluClient,
    mode:config.nluMode,
    contextBuilder:new NluContextBuilder({defaultTimezone:config.defaultTimezone}),
    maxInputChars:config.nluMaxInputChars,
    logger
  });
  const nluDecisionPolicy = new NluDecisionPolicy({
    minConfidence:config.nluMinConfidence,
    informationThreshold:config.nluInformationThreshold,
    actionThreshold:config.nluActionThreshold
  });
  const nluInvocationPolicy = new NluInvocationPolicy({
    strategy:config.nluStrategy,
    confidenceThreshold:config.nluInvocationThreshold,
    ambiguityMargin:config.nluAmbiguityMargin
  });
  const aiLanguageLayer = new AiLanguageLayer({
    interpreter:remoteNluInterpreter,
    strategy:config.nluStrategy,
    logger
  });
  const semanticRouter=new LightweightSemanticRouter({
    enabled:config.semanticRouterMode==='on',
    contextBuilder:new NluContextBuilder({defaultTimezone:config.defaultTimezone}),
    minConfidence:config.semanticRouterMinConfidence,
    minMargin:config.semanticRouterMinMargin,
    minSimilarity:config.semanticRouterMinSimilarity,
    maxLocalIntents:config.semanticRouterMaxLocalIntents,
    logger
  });
  const semanticRoutePolicy=new SemanticRoutePolicy({
    selectionThreshold:Math.max(.8,config.semanticRouterMinConfidence),
    selectionMargin:config.semanticRouterMinMargin
  });
  const socialIntelligenceEngine = new SocialIntelligenceEngine();
  const domainSchemaRegistry = new DomainSchemaRegistry({ domainsDir:path.resolve(__dirname, "../../../domains"), logger });
  const domainResolver = new DomainResolver({ schemaRegistry:domainSchemaRegistry });
  const conversationIntelligenceEngine = new ConversationIntelligenceEngine({ adapterRegistry: conversationAdapterRegistry, llmInterpreter:null, nluInterpreter:remoteNluInterpreter, aiLanguageLayer, semanticRouter, semanticRoutePolicy, nluDecisionPolicy, nluInvocationPolicy, logger, socialIntelligenceEngine, domainResolver });
  const replayRepository = new InMemoryReplayRepository();
  const replayService = new ReplayService({ repository: replayRepository });

  // === v21.0: Online Learning & Feedback Loop ===
  // The feedback collector observes conversation outcomes (booking confirmed
  // = positive example, cancelled/corrected = negative example) and stores
  // them per tenant. The online learner periodically retrains the ML
  // classifier using the collected examples.
  const feedbackCollector = new FeedbackCollector({
    logger,
    storageDir: path.resolve(__dirname, "../../../.nova-feedback"),
  });
  const onlineLearner = new OnlineLearner({
    feedbackCollector,
    mlIntentClassifier,
    logger,
  });

  const executionEngine = new ExecutionEngine({ tenantRepository, stateRepository, capabilityRouter, eventBus, logger, defaultTenantId: config.defaultTenantId, services: { knowledgeService, llmRouter, memoryService, crmService, leadService, customerDataBridge, catalogService, commerceService, inventoryService, cleaningService, offeringService, bookingService, calendarService, offeringOrderService, engagementService, pricingService, handoffService, availabilityService, promptEngine, productMatcher: productEmbeddingMatcher }, humanizationEngine, socialIntelligenceEngine, conversationIntelligenceEngine, replayService, feedbackCollector });
  const channelRegistry = new ChannelRegistry().register(new HttpChatAdapter());
  const whatsappConfigRepository = new WhatsAppTenantConfigRepository({ tenantsDir: config.tenantsDir });
  const whatsappCloudClient = new WhatsAppCloudClient({ logger });
  const whatsappProcessedStore = new ProcessedMessageStore();
  const whatsappWebhookService = new WhatsAppWebhookService({
    configRepository: whatsappConfigRepository,
    processedStore: whatsappProcessedStore,
    cloudClient: whatsappCloudClient,
    executionEngine,
    logger
  });
  return { config, logger, storage, inventoryRepository, inventoryService, calendarConfigRepository, calendarRepository, calendarService, knowledgeRepository, knowledgeService, documentIngestor, knowledgeSourceRepository, tenantKnowledgeManager, controlPlaneRepository, controlPlaneAccessPolicy, tenantControlPlaneService, tenantOnboardingService, llmRouter, groqNluClient, remoteNluInterpreter, aiLanguageLayer, semanticRouter, semanticRoutePolicy, nluDecisionPolicy, nluInvocationPolicy, socialIntelligenceEngine, domainSchemaRegistry, domainResolver, tenantRepository, stateRepository, memoryRepository, memoryPermissionService, memoryService, crmRepository, crmPermissionService, crmService, leadRepository, leadService, customerDataBridge, catalogRepository, catalogPermissionService, catalogService, commerceRepository, commercePermissionService, commerceService, cleaningServiceRepository, cleaningRequestRepository, cleaningPermissionService, cleaningService, offeringRepository, offeringService, bookingConfigRepository, bookingRepository, bookingService, offeringOrderRepository, offeringOrderService, engagementService, pricingRepository, pricingService, handoffService, availabilityRuleRepository, businessHoursProvider, availabilityService, humanizationEngine, templateEngine, personaEngine, policyEngine, promptEngine, eventBus, permissionService, registry, loader, capabilityRouter, conversationAdapterRegistry, conversationIntelligenceEngine, replayRepository, replayService, executionEngine, conversationOrchestrator: executionEngine, channelRegistry, whatsappConfigRepository, whatsappCloudClient, whatsappProcessedStore, whatsappWebhookService, mlIntentClassifier, hybridRouter, productEmbeddingMatcher, transformerEmbeddingService, feedbackCollector, onlineLearner };
}
module.exports = { buildContainer };
