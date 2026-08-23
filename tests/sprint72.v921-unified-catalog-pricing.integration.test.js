const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FileControlPlaneRepository, ControlPlaneAccessPolicy, TenantControlPlaneService } = require("../packages/tenant-control-plane/src");
const { FilePricingRepository } = require("../packages/service-pricing/src/filePricingRepository");
const { ServicePricingEngine } = require("../packages/service-pricing/src/servicePricingEngine");
const { FileCleaningRepository } = require("../packages/cleaning-engine/src/fileCleaningRepository");
const { FileOfferingRepository } = require("../packages/offering-engine/src/fileOfferingRepository");
const { FileCatalogRepository } = require("../packages/catalog-engine/src/fileCatalogRepository");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-v921-commercial-source-"));
  const operationalDataDir = path.join(root, "operations");
  const tenantsDir = path.resolve(__dirname, "../tenants");
  const repository = new FileControlPlaneRepository({ operationalDataDir });
  const cleaningRepository = new FileCleaningRepository({ tenantsDir, controlPlaneRepository: repository });
  const offeringRepository = new FileOfferingRepository({ tenantsDir, controlPlaneRepository: repository });
  const catalogRepository = new FileCatalogRepository({ tenantsDir, controlPlaneRepository: repository });
  const controlPlane = new TenantControlPlaneService({
    tenantsDir,
    repository,
    accessPolicy: new ControlPlaneAccessPolicy(),
    invalidators: {
      products: (tenantId) => catalogRepository.clearCache(tenantId),
      services: (tenantId) => { cleaningRepository.clear(tenantId); offeringRepository.clear(tenantId); }
    }
  });
  const pricingRepository = new FilePricingRepository({ tenantsDir, operationalDataDir, controlPlaneRepository: repository });
  const pricing = new ServicePricingEngine({ repository: pricingRepository });
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return { root, operationalDataDir, tenantsDir, repository, controlPlane, cleaningRepository, offeringRepository, catalogRepository, pricingRepository, pricing };
}

function actor(tenantId) { return { id:"owner-1", role:"owner", tenantId }; }
function publish(controlPlane, tenantId, resourceType, document) {
  const owner = actor(tenantId);
  const draft = controlPlane.createDraft({ tenantId, resourceType, document, actor:owner });
  const validation = controlPlane.validateDraft({ tenantId, draftId:draft.id, actor:owner });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  return controlPlane.publishDraft({ tenantId, draftId:draft.id, actor:owner });
}

test("Services & Pricing exposes one normalized commercial document", (t) => {
  const { controlPlane } = fixture(t);
  const document = controlPlane.getResource("cleaning-demo", "services", actor("cleaning-demo")).document;
  assert.equal(document.kind, "cleaning");
  assert.equal(document.currency, "AED");
  assert.ok(document.items.length > 20);
  assert.ok(document.pricingRules.length > 10);
  assert.equal(Object.hasOwn(document, "pricingPolicy"), false);
  for (const service of document.items) {
    assert.ok(service.pricingRuleIds.length > 0);
    for (const field of ["price", "currency", "priceType", "pricingServiceId", "pricePrefix", "packages"]) assert.equal(Object.hasOwn(service, field), false, `${service.id}/${field}`);
    assert.doesNotMatch(String(service.description || ""), /(?:AED|PKR|USD|Rs|\$|€|£)\s*\d/i);
  }
  const hourly = document.pricingRules.find((rule) => rule.id === "hourly-cleaner");
  assert.deepEqual({ model:hourly.model, rate:hourly.rate, currency:hourly.currency }, { model:"hourly", rate:40, currency:"AED" });
});

test("a published service rule drives quotes and service display while a legacy override is ignored", (t) => {
  const { operationalDataDir, tenantsDir, controlPlane, pricing, cleaningRepository } = fixture(t);
  const document = controlPlane.getResource("cleaning-demo", "services", actor("cleaning-demo")).document;
  document.pricingRules.find((rule) => rule.id === "hourly-cleaner").rate = 47;
  publish(controlPlane, "cleaning-demo", "services", document);

  const legacy = JSON.parse(fs.readFileSync(path.join(tenantsDir, "cleaning-demo", "pricing", "services.json"), "utf8"));
  legacy.services.find((rule) => rule.id === "hourly-cleaner").rate = 999;
  const legacyFile = path.join(operationalDataDir, "cleaning-demo", "pricing", "services.json");
  fs.mkdirSync(path.dirname(legacyFile), { recursive:true });
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));

  const quote = pricing.quote("cleaning-demo", { serviceId:"hourly-cleaner", hours:3, workers:2 });
  assert.equal(quote.ok, true);
  assert.equal(quote.total, 282);
  assert.equal(cleaningRepository.loadServices("cleaning-demo").find((item) => item.id === "CLN001").price, 47);
  assert.equal(controlPlane.getResource("cleaning-demo", "services", actor("cleaning-demo")).document.pricingRules.find((rule) => rule.id === "hourly-cleaner").rate, 47);
});

test("service validation rejects duplicate or cross-document price sources", (t) => {
  const { controlPlane } = fixture(t);
  const owner = actor("cleaning-demo");
  const duplicate = controlPlane.getResource("cleaning-demo", "services", owner).document;
  duplicate.items[0].price = 1;
  duplicate.items[0].description = "Special price AED 1.";
  const duplicateDraft = controlPlane.createDraft({ tenantId:"cleaning-demo", resourceType:"services", document:duplicate, actor:owner });
  const duplicateValidation = controlPlane.validateDraft({ tenantId:"cleaning-demo", draftId:duplicateDraft.id, actor:owner });
  assert.equal(duplicateValidation.valid, false);
  assert.ok(duplicateValidation.errors.filter((row) => row.code === "duplicate_price_source").length >= 2);

  const unknown = controlPlane.getResource("cleaning-demo", "services", owner).document;
  unknown.items[0].pricingRuleIds = ["foreign-tenant-rule"];
  const unknownDraft = controlPlane.createDraft({ tenantId:"cleaning-demo", resourceType:"services", document:unknown, actor:owner });
  const unknownValidation = controlPlane.validateDraft({ tenantId:"cleaning-demo", draftId:unknownDraft.id, actor:owner });
  assert.ok(unknownValidation.errors.some((row) => row.code === "unknown_pricing_rule"));
});

test("Products & Prices is the sole source for base and variant prices", async (t) => {
  const { controlPlane, catalogRepository } = fixture(t);
  const owner = actor("default");
  const products = controlPlane.getResource("default", "products", owner).document;
  products.push({
    id:"P-ONE-SOURCE", sku:"ONE-SOURCE", name:"One Source Polo", category:"clothing",
    price:1800, currency:"PKR", aliases:[], colors:["Black"], sizes:["S"], tags:[], inStock:true,
    variants:[{ id:"ONE-SOURCE-BLK-S", sku:"ONE-SOURCE-BLK-S", attributes:{color:"Black",size:"S"}, price:1950, inventory:3, active:true }]
  });
  publish(controlPlane, "default", "products", products);
  const product = (await catalogRepository.listProducts("default")).find((item) => item.id === "P-ONE-SOURCE");
  assert.equal(product.price, 1800);
  assert.equal(product.variants[0].price, 1950);

  const invalid = controlPlane.getResource("default", "products", owner).document;
  invalid[0].pricingRuleId = "somewhere-else";
  const draft = controlPlane.createDraft({ tenantId:"default", resourceType:"products", document:invalid, actor:owner });
  const validation = controlPlane.validateDraft({ tenantId:"default", draftId:draft.id, actor:owner });
  assert.ok(validation.errors.some((row) => row.code === "duplicate_price_source"));
});

test("generic tenant services use their published pricing rule and remain tenant isolated", (t) => {
  const { controlPlane, offeringRepository, pricing } = fixture(t);
  const document = controlPlane.getResource("salon-demo", "services", actor("salon-demo")).document;
  const haircut = document.items.find((item) => item.id === "haircut");
  document.pricingRules.find((rule) => haircut.pricingRuleIds.includes(rule.id)).price = 1650;
  publish(controlPlane, "salon-demo", "services", document);
  assert.equal(offeringRepository.load("salon-demo").items.find((item) => item.id === "haircut").price, 1650);
  assert.equal(pricing.quote("salon-demo", { serviceId:haircut.pricingRuleIds[0] }).subtotal, 1650);
  assert.equal(pricing.quote("cleaning-demo", { serviceId:"deep-villa-cleaning", bedrooms:2 }).subtotal, 370);
});

test("custom and starting-from rules never masquerade as exact prices", () => {
  const pricing = new ServicePricingEngine({ repository:{ load:() => ({ currency:"AED", services:[
    { id:"inspection", name:"Inspection", model:"custom_quote", currency:"AED" },
    { id:"complex", name:"Complex Service", model:"starting_from", price:100, currency:"AED" }
  ], addOns:[], discounts:[] }) } });
  assert.deepEqual(pricing.quote("tenant", { serviceId:"inspection" }).reason, "custom_quote_required");
  const starting = pricing.quote("tenant", { serviceId:"complex" });
  assert.equal(starting.reason, "scope_required");
  assert.equal(starting.startingFrom, 100);
});

test("Knowledge Manager no longer exposes a pricing editor and the old endpoint is retired", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../apps/developer-console/public/index.html"), "utf8");
  const app = fs.readFileSync(path.resolve(__dirname, "../apps/developer-console/public/app.js"), "utf8");
  const server = fs.readFileSync(path.resolve(__dirname, "../apps/api/src/server.js"), "utf8");
  assert.match(page, /Products & prices/);
  assert.match(page, /Services & pricing/);
  assert.doesNotMatch(page, /kmPricingJson|kmPublishPricing|Publish operational pricing/);
  assert.doesNotMatch(app, /kmLoadPricing|kmPublishPricing/);
  assert.match(server, /sendJson\(res,410/);
  assert.match(server, /Knowledge Manager cannot publish commercial values/);
});
