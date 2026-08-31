/**
 * Sprint 93 — v20.0 Multilingual Transformer Embeddings
 *
 * Validates the multilingual model support (paraphrase-multilingual-MiniLM-L12-v2):
 *   - Language detection (Roman-Urdu, Urdu-script, Arabic)
 *   - Lazy multilingual model loading (only loads when needed)
 *   - Cross-lingual semantic matching (English catalog vs Roman-Urdu query)
 *   - Better Urdu-script/Arabic cosine similarity than English-only model
 *   - Graceful fallback to English model when multilingual fails to load
 *
 * NOTE: These tests require @xenova/transformers AND downloading the
 * paraphrase-multilingual-MiniLM-L12-v2 model (~60MB on first use).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const { TransformerEmbeddingService } = require("../packages/transformer-embeddings/src/transformerEmbeddingService");

let transformerService;
let cleaningServices;
let retailProducts;
let transformersAvailable = false;

test.before(async () => {
  transformerService = new TransformerEmbeddingService({ logger: null, enableMultilingual: true });
  transformersAvailable = await transformerService.isAvailable();
  cleaningServices = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "tenants", "cleaning-demo", "cleaning", "services.json"), "utf8"
  ));
  retailProducts = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "tenants", "default", "catalog", "products.json"), "utf8"
  ));
});

// === Language detection ===

test("_needsMultilingualModel() detects Urdu-script", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.ok(svc._needsMultilingualModel("مجھے گھر کی صفائی چاہیے"));
  assert.ok(svc._needsMultilingualModel("صوفہ کلیننگ"));
});

test("_needsMultilingualModel() detects Arabic", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.ok(svc._needsMultilingualModel("أريد تنظيف المنزل"));
  assert.ok(svc._needsMultilingualModel("كم سعر هذا"));
});

test("_needsMultilingualModel() detects Roman-Urdu", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.ok(svc._needsMultilingualModel("mujhy ghar ki safai chahiye"));
  assert.ok(svc._needsMultilingualModel("mera order cancel kar do"));
  assert.ok(svc._needsMultilingualModel("aap ka naam kya hai"));
});

test("_needsMultilingualModel() returns false for English", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.ok(!svc._needsMultilingualModel("i want deep cleaning for my villa"));
  assert.ok(!svc._needsMultilingualModel("show me watches"));
  assert.ok(!svc._needsMultilingualModel("cancel my booking"));
});

test("_needsMultilingualModel() returns false for empty/null", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.ok(!svc._needsMultilingualModel(""));
  assert.ok(!svc._needsMultilingualModel(null));
  assert.ok(!svc._needsMultilingualModel(undefined));
});

// === Multilingual model availability ===

test("isMultilingualAvailable() returns true when enabled", async function () {
  if (!transformersAvailable) return this.skip();
  const avail = await transformerService.isMultilingualAvailable();
  assert.ok(avail, "Multilingual should be available");
});

test("isMultilingualAvailable() returns false when disabled", async function () {
  if (!transformersAvailable) return this.skip();
  const svc = new TransformerEmbeddingService({ logger: null, enableMultilingual: false });
  await svc.isAvailable();
  const avail = await svc.isMultilingualAvailable();
  assert.equal(avail, false);
});

// === Multilingual embedding ===

test("Roman-Urdu query embeds successfully with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  const emb = await transformerService.embed("mujhy ghar ki safai chahiye");
  assert.ok(emb, "Should produce embedding");
  assert.equal(emb.length, 384);
});

test("Urdu-script query embeds successfully with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  const emb = await transformerService.embed("مجھے گھر کی صفائی چاہیے");
  assert.ok(emb, "Should produce embedding");
  assert.equal(emb.length, 384);
});

test("Arabic query embeds successfully with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  const emb = await transformerService.embed("أريد تنظيف المنزل");
  assert.ok(emb, "Should produce embedding");
  assert.equal(emb.length, 384);
});

// === Cross-lingual semantic matching ===

test("Urdu-script query has BETTER similarity to English with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  // Compare multilingual model vs English-only model for Urdu-script → English
  const urduText = "مجھے گھر کی صفائی چاہیے";
  const englishText = "i want home cleaning";

  // Multilingual model (auto-routed because Urdu-script is detected)
  const embMulti1 = await transformerService.embed(urduText);
  const embMulti2 = await transformerService.embed(englishText, { forceModel: 'multi' });
  let dotMulti = 0;
  for (let i = 0; i < embMulti1.length; i++) dotMulti += embMulti1[i] * embMulti2[i];

  // English model (force 'en')
  const embEn1 = await transformerService.embed(urduText, { forceModel: 'en' });
  const embEn2 = await transformerService.embed(englishText, { forceModel: 'en' });
  let dotEn = 0;
  for (let i = 0; i < embEn1.length; i++) dotEn += embEn1[i] * embEn2[i];

  // The multilingual model should produce HIGHER similarity for Urdu↔English
  // than the English-only model. (This is the whole point of using it.)
  assert.ok(dotMulti > dotEn,
    `Multilingual similarity (${dotMulti.toFixed(4)}) should be > English-only (${dotEn.toFixed(4)}) for Urdu↔English`);
});

test("Arabic query has BETTER similarity to English with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  const arabicText = "أريد تنظيف الشقة";
  const englishText = "i want apartment cleaning";

  const embMulti1 = await transformerService.embed(arabicText);
  const embMulti2 = await transformerService.embed(englishText, { forceModel: 'multi' });
  let dotMulti = 0;
  for (let i = 0; i < embMulti1.length; i++) dotMulti += embMulti1[i] * embMulti2[i];

  const embEn1 = await transformerService.embed(arabicText, { forceModel: 'en' });
  const embEn2 = await transformerService.embed(englishText, { forceModel: 'en' });
  let dotEn = 0;
  for (let i = 0; i < embEn1.length; i++) dotEn += embEn1[i] * embEn2[i];

  assert.ok(dotMulti > dotEn,
    `Multilingual similarity (${dotMulti.toFixed(4)}) should be > English-only (${dotEn.toFixed(4)}) for Arabic↔English`);
});

// === Match with multilingual query ===

test("match() routes Urdu-script query to multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  await transformerService.indexTenant('cleaning-demo:cleaning', cleaningServices);
  const r = await transformerService.match('cleaning-demo:cleaning', 'صوفہ کلیننگ چاہیے', { maxResults: 3, minScore: 0.20 });
  assert.ok(r.used);
  assert.equal(r.queryModel, 'multi', "Should use multilingual model for Urdu-script");
});

test("match() routes English query to English model", async function () {
  if (!transformersAvailable) return this.skip();
  await transformerService.indexTenant('cleaning-demo:cleaning', cleaningServices);
  const r = await transformerService.match('cleaning-demo:cleaning', 'sofa cleaning', { maxResults: 3, minScore: 0.30 });
  assert.ok(r.used);
  assert.equal(r.queryModel, 'en', "Should use English model for English queries");
});

test("match() routes Roman-Urdu query to multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  await transformerService.indexTenant('cleaning-demo:cleaning', cleaningServices);
  const r = await transformerService.match('cleaning-demo:cleaning', 'mujhy ghar ki safai chahiye', { maxResults: 3, minScore: 0.20 });
  assert.ok(r.used);
  assert.equal(r.queryModel, 'multi', "Should use multilingual model for Roman-Urdu");
});

// === Force model override ===

test("forceModel='multi' overrides language detection", async function () {
  if (!transformersAvailable) return this.skip();
  // English query, but force multilingual model
  const r = await transformerService.match('cleaning-demo:cleaning', 'sofa cleaning', { maxResults: 3, minScore: 0.20, forceModel: 'multi' });
  assert.ok(r.used);
  assert.equal(r.queryModel, 'multi');
});

test("forceModel='en' overrides language detection", async function () {
  if (!transformersAvailable) return this.skip();
  // Urdu query, but force English model
  const r = await transformerService.match('cleaning-demo:cleaning', 'صوفہ کلیننگ', { maxResults: 3, minScore: 0.10, forceModel: 'en' });
  assert.ok(r.used);
  assert.equal(r.queryModel, 'en');
});

// === Graceful fallback ===

test("multilingual model loads lazily (not at startup)", async function () {
  if (!transformersAvailable) return this.skip();
  // Fresh service — only English should be loaded after isAvailable()
  const svc = new TransformerEmbeddingService({ logger: null, enableMultilingual: true });
  await svc.isAvailable();
  assert.ok(svc.englishExtractor, "English should be loaded");
  assert.equal(svc.multilingualExtractor, null, "Multilingual should NOT be loaded yet");
  // Now trigger a multilingual query
  await svc.embed("مجھے صفائی چاہیے");
  assert.ok(svc.multilingualExtractor, "Multilingual should be loaded after first multilingual query");
});

test("service works with enableMultilingual=false", async function () {
  if (!transformersAvailable) return this.skip();
  const svc = new TransformerEmbeddingService({ logger: null, enableMultilingual: false });
  await svc.isAvailable();
  // Urdu query with multilingual disabled — should fall back to English
  const emb = await svc.embed("مجھے صفائی چاہیے");
  assert.ok(emb, "Should still produce embedding via English fallback");
  assert.equal(emb.length, 384);
});

// === Configuration ===

test("constructor accepts custom model names", () => {
  const svc = new TransformerEmbeddingService({
    logger: null,
    englishModel: 'custom-english-model',
    multilingualModel: 'custom-multilingual-model',
  });
  assert.equal(svc.englishModel, 'custom-english-model');
  assert.equal(svc.multilingualModel, 'custom-multilingual-model');
});

test("default models are all-MiniLM-L6-v2 and paraphrase-multilingual-MiniLM-L12-v2", () => {
  const svc = new TransformerEmbeddingService({ logger: null });
  assert.equal(svc.englishModel, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(svc.multilingualModel, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
});

// === Index with multilingual model ===

test("indexTenant() with forceModel='multi' indexes with multilingual model", async function () {
  if (!transformersAvailable) return this.skip();
  const summary = await transformerService.indexTenant('multi-index-test', cleaningServices, { forceModel: 'multi' });
  assert.equal(summary.model, 'multi');
  assert.ok(summary.indexedCount > 0);
  // Check that the cache entries have model='multi'
  const entries = transformerService.embeddingCache.get('multi-index-test');
  assert.ok(entries[0].model === 'multi');
  transformerService.clearTenant('multi-index-test');
});
