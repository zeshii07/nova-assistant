const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  FileControlPlaneRepository,
  ControlPlaneAccessPolicy,
  TenantControlPlaneService
} = require("../packages/tenant-control-plane/src");
const { FileTenantRepository } = require("../packages/tenant/src/tenantRepository");
const { FileCatalogRepository } = require("../packages/catalog-engine/src/fileCatalogRepository");
const { FileCleaningRepository } = require("../packages/cleaning-engine/src/fileCleaningRepository");
const { FileOfferingRepository } = require("../packages/offering-engine/src/fileOfferingRepository");
const { FileKnowledgeRepository } = require("../packages/knowledge/src/fileKnowledgeRepository");
const { StaticBusinessHoursProvider } = require("../packages/service-availability/src/staticBusinessHoursProvider");
const { KnowledgeService } = require("../packages/assistant/src/knowledgeService");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-v900-"));
  const operationalDataDir = path.join(root, "operations");
  const knowledgeDataDir = path.join(root, "knowledge");
  const tenantsDir = path.resolve(__dirname, "../tenants");
  const repository = new FileControlPlaneRepository({ operationalDataDir });
  const tenantRepository = new FileTenantRepository({ tenantsDir, controlPlaneRepository: repository });
  const catalogRepository = new FileCatalogRepository({ tenantsDir, controlPlaneRepository: repository });
  const cleaningRepository = new FileCleaningRepository({ tenantsDir, controlPlaneRepository: repository });
  const offeringRepository = new FileOfferingRepository({ tenantsDir, controlPlaneRepository: repository });
  const service = new TenantControlPlaneService({
    tenantsDir, repository, accessPolicy: new ControlPlaneAccessPolicy(),
    invalidators: {
      profile: (tenantId) => tenantRepository.clearCache(tenantId),
      products: (tenantId) => catalogRepository.clearCache(tenantId),
      services: (tenantId) => { cleaningRepository.clear(tenantId); offeringRepository.clear(tenantId); }
    }
  });
  const knowledgeRepository = new FileKnowledgeRepository({ tenantsDir, knowledgeDataDir });
  const hoursProvider = new StaticBusinessHoursProvider({ knowledgeRepository, controlPlaneRepository: repository });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { repository, tenantRepository, catalogRepository, cleaningRepository, offeringRepository, service, hoursProvider, knowledgeRepository };
}

const owner = (tenantId, id = "owner-1") => ({ id, role: "owner", tenantId });

test("drafts stay invisible until validated and published", async (t) => {
  const { service, tenantRepository, repository, knowledgeRepository } = fixture(t);
  const actor = owner("cleaning-demo");
  const effective = service.getResource("cleaning-demo", "profile", actor);
  const document = { ...effective.document, name: "SparkleCare Published", business: { ...effective.document.business, contact: "+971 50 000 9000" } };
  const draft = service.createDraft({ tenantId: "cleaning-demo", resourceType: "profile", document, actor, requestId: "REQ-1" });

  assert.equal(tenantRepository.getById("cleaning-demo").name, "SparkleCare Cleaning");
  const validation = service.validateDraft({ tenantId: "cleaning-demo", draftId: draft.id, actor });
  assert.equal(validation.valid, true);
  const preview = service.previewDraft({ tenantId: "cleaning-demo", draftId: draft.id, actor });
  assert.equal(preview.diff.changed, true);
  assert.equal(preview.currentRevision, 0);

  const published = service.publishDraft({ tenantId: "cleaning-demo", draftId: draft.id, actor, requestId: "REQ-2" });
  assert.equal(published.revision, 1);
  assert.equal(tenantRepository.getById("cleaning-demo").name, "SparkleCare Published");
  const knowledgeService = new KnowledgeService({ knowledgeRepository, controlPlaneRepository: repository });
  assert.equal(knowledgeService.answer("ask_contact", tenantRepository.getById("cleaning-demo")), "+971 50 000 9000");
  assert.equal(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../tenants/cleaning-demo/profile.json"))).name, "SparkleCare Cleaning");
});

test("every shipped tenant can seed and validate its control-plane resources", (t) => {
  const { service } = fixture(t);
  // Other integration files create temporary tenants under the project tenant
  // directory. Node's test runner executes files concurrently, so directory
  // enumeration can observe a half-built fixture. Validate the actual shipped
  // demo set explicitly instead of racing unrelated test setup/cleanup.
  const shippedTenantIds=["cleaning-demo","default","driving-school-demo","education-demo","healthcare-demo","restaurant-demo","salon-demo","tutor-demo"];
  for (const tenantId of shippedTenantIds) {
    const actor = owner(tenantId);
    for (const resourceType of ["profile", "products", "services", "hours", "calendar"]) {
      const document = service.getResource(tenantId, resourceType, actor).document;
      const draft = service.createDraft({ tenantId, resourceType, document, actor });
      const validation = service.validateDraft({ tenantId, draftId: draft.id, actor });
      assert.equal(validation.valid, true, `${tenantId}/${resourceType}: ${JSON.stringify(validation.errors)}`);
      service.discardDraft({ tenantId, draftId: draft.id, actor });
    }
  }
});

test("profile identity, product values, and service references are validated", (t) => {
  const { service } = fixture(t);
  const cleaningActor = owner("cleaning-demo");
  const badProfile = service.getResource("cleaning-demo", "profile", cleaningActor).document;
  badProfile.id = "default";
  const profileDraft = service.createDraft({ tenantId: "cleaning-demo", resourceType: "profile", document: badProfile, actor: cleaningActor });
  const profileValidation = service.validateDraft({ tenantId: "cleaning-demo", draftId: profileDraft.id, actor: cleaningActor });
  assert.equal(profileValidation.valid, false);
  assert.ok(profileValidation.errors.some((item) => item.code === "immutable_tenant_id"));

  const retailActor = owner("default");
  const products = service.getResource("default", "products", retailActor).document;
  products.push({ ...products[0], id: "P001", price: -1 });
  const productDraft = service.createDraft({ tenantId: "default", resourceType: "products", document: products, actor: retailActor });
  const productValidation = service.validateDraft({ tenantId: "default", draftId: productDraft.id, actor: retailActor });
  assert.equal(productValidation.valid, false);
  assert.ok(productValidation.errors.some((item) => item.code === "duplicate_id"));
  assert.ok(productValidation.errors.some((item) => item.code === "invalid_number"));

  const services = service.getResource("cleaning-demo", "services", cleaningActor).document;
  services.items[0].pricingRuleIds = ["another-tenants-price"];
  const serviceDraft = service.createDraft({ tenantId: "cleaning-demo", resourceType: "services", document: services, actor: cleaningActor });
  const serviceValidation = service.validateDraft({ tenantId: "cleaning-demo", draftId: serviceDraft.id, actor: cleaningActor });
  assert.equal(serviceValidation.valid, false);
  assert.ok(serviceValidation.errors.some((item) => item.code === "unknown_pricing_rule"));
});

test("published products and services reach only the intended runtime repository", async (t) => {
  const { service, catalogRepository, cleaningRepository, offeringRepository } = fixture(t);
  const retailActor = owner("default");
  const products = service.getResource("default", "products", retailActor).document;
  products.push({ id: "P099", sku: "TEST-P099", name: "Control Plane Product", category: "stationery", price: 99, currency: "PKR", aliases: [], colors: [], sizes: [], tags: [], inStock: true, inventory: 4 });
  const productDraft = service.createDraft({ tenantId: "default", resourceType: "products", document: products, actor: retailActor });
  assert.equal((await catalogRepository.listProducts("default")).some((item) => item.id === "P099"), false);
  service.validateDraft({ tenantId: "default", draftId: productDraft.id, actor: retailActor });
  service.publishDraft({ tenantId: "default", draftId: productDraft.id, actor: retailActor });
  assert.equal((await catalogRepository.listProducts("default")).find((item) => item.id === "P099").inventory, 4);

  const cleaningActor = owner("cleaning-demo");
  const services = service.getResource("cleaning-demo", "services", cleaningActor).document;
  services.items[0].name = "Published Standard Cleaning";
  const serviceDraft = service.createDraft({ tenantId: "cleaning-demo", resourceType: "services", document: services, actor: cleaningActor });
  service.validateDraft({ tenantId: "cleaning-demo", draftId: serviceDraft.id, actor: cleaningActor });
  service.publishDraft({ tenantId: "cleaning-demo", draftId: serviceDraft.id, actor: cleaningActor });
  assert.equal(cleaningRepository.loadServices("cleaning-demo")[0].name, "Published Standard Cleaning");
  assert.equal(offeringRepository.load("salon-demo").items[0].name, "Haircut");
});

test("structured hours publish atomically and drive business-time validation", (t) => {
  const { service, hoursProvider } = fixture(t);
  const actor = owner("cleaning-demo");
  const document = {
    timezone: "Asia/Dubai",
    schedule: {
      monday: [{ open: "10:00", close: "18:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
    }
  };
  const draft = service.createDraft({ tenantId: "cleaning-demo", resourceType: "hours", document, actor });
  assert.notEqual(hoursProvider.check({ tenantId: "cleaning-demo", day: "monday" }).hours, "10 AM to 6 PM");
  assert.equal(service.validateDraft({ tenantId: "cleaning-demo", draftId: draft.id, actor }).valid, true);
  service.publishDraft({ tenantId: "cleaning-demo", draftId: draft.id, actor });
  assert.deepEqual(hoursProvider.check({ tenantId: "cleaning-demo", day: "monday" }), { source: "control_plane_hours", status: "open", day: "monday", hours: "10 AM to 6 PM", timezone: "Asia/Dubai" });
  assert.equal(hoursProvider.check({ tenantId: "cleaning-demo", day: "sunday" }).status, "closed");
});

test("optimistic concurrency, immutable rollback, audit, and tenant roles are enforced", (t) => {
  const { service } = fixture(t);
  const actor = owner("default", "admin-alice");
  const base = service.getResource("default", "profile", actor).document;
  const first = service.createDraft({ tenantId: "default", resourceType: "profile", document: { ...base, name: "Revision One" }, actor });
  const stale = service.createDraft({ tenantId: "default", resourceType: "profile", document: { ...base, name: "Stale Draft" }, actor });
  service.validateDraft({ tenantId: "default", draftId: first.id, actor });
  service.publishDraft({ tenantId: "default", draftId: first.id, actor });
  service.validateDraft({ tenantId: "default", draftId: stale.id, actor });
  assert.throws(() => service.publishDraft({ tenantId: "default", draftId: stale.id, actor }), (error) => error.statusCode === 409);

  const secondDoc = service.getResource("default", "profile", actor).document;
  secondDoc.name = "Revision Two";
  const second = service.createDraft({ tenantId: "default", resourceType: "profile", document: secondDoc, actor });
  service.validateDraft({ tenantId: "default", draftId: second.id, actor });
  service.publishDraft({ tenantId: "default", draftId: second.id, actor });
  const rollback = service.rollback({ tenantId: "default", resourceType: "profile", targetRevision: 1, actor });
  assert.equal(rollback.revision, 3);
  assert.equal(rollback.rolledBackFromRevision, 1);
  assert.equal(service.getResource("default", "profile", actor).document.name, "Revision One");
  assert.deepEqual(service.listRevisions("default", "profile", actor).map((item) => item.revision), [3, 2, 1]);
  assert.ok(service.listAudit("default", actor).some((entry) => entry.action === "resource.rolled_back" && entry.actorId === "admin-alice"));

  assert.throws(() => service.overview("default", { id: "foreign", role: "owner", tenantId: "cleaning-demo" }), (error) => error.statusCode === 403);
  const viewer = { id: "viewer", role: "viewer", tenantId: "default" };
  assert.throws(() => service.createDraft({ tenantId: "default", resourceType: "profile", document: base, actor: viewer }), (error) => error.statusCode === 403);
  const manager = { id: "catalog", role: "catalog_manager", tenantId: "default" };
  assert.throws(() => service.createDraft({ tenantId: "default", resourceType: "hours", document: { text: "Daily, 9 AM to 5 PM" }, actor: manager }), (error) => error.statusCode === 403);
});
