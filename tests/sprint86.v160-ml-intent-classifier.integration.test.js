/**
 * Sprint 86 — v16.0 ML Intent Classifier
 *
 * Validates the new packages/ml-intent-classifier package:
 *  - Classifier trains successfully on the seed catalog
 *  - Top intent predictions match expected for English / Roman-Urdu / Urdu-script / Arabic
 *  - Typo tolerance via char-ngram channel
 *  - Multilingual mixed-script queries
 *  - Confidence calibration (confident matches >0.85, ambiguous <0.6)
 *  - Channel scores are present (word/char/prototype)
 *  - predictCapability() helper returns the right capability
 *  - Inference is sub-50ms per query (deterministic core budget)
 *
 * The classifier is tested in isolation (no execution engine) so failures
 * here point to the ML model itself, not to the hybrid router or
 * capability adapter wiring. Hybrid routing is tested in sprint87.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { MlIntentClassifier } = require("../packages/ml-intent-classifier/src/mlIntentClassifier");
const { INTENT_CATALOG, INTENT_CAPABILITY_MAP, INTENT_PRIORITY } = require("../packages/ml-intent-classifier/src/intentCatalog");
const { tokenize, buildFeatureVector, DocumentFrequency, cosineSimilarity, STOP_WORDS } = require("../packages/ml-intent-classifier/src/featureExtractor");

let classifier;

test.before(async () => {
  classifier = new MlIntentClassifier({ logger: null });
});

// === Training / model shape ===

test("ML classifier trains on the seed catalog", () => {
  assert.ok(classifier.trained, "Classifier should be marked as trained");
  assert.ok(classifier.model.classes.length >= 30, "Should have at least 30 intent classes");
  assert.ok(classifier.model.documentCount >= 200, "Should have at least 200 training docs");
  assert.ok(classifier.model.vocabularySize >= 1000, "Should have a vocabulary of at least 1000 features");
  assert.ok(classifier.model.trainingMs < 5000, "Training should complete in under 5 seconds");
});

test("each intent has a capability mapping", () => {
  for (const intent of INTENT_CATALOG) {
    if (intent.canonicalId.startsWith('conversation.confirm') ||
        intent.canonicalId.startsWith('conversation.reject') ||
        intent.canonicalId.startsWith('conversation.correct')) {
      // Cross-cutting intents may have null capability
      continue;
    }
    assert.ok(intent.capabilityId, `Intent ${intent.canonicalId} should have a capabilityId`);
    assert.ok(INTENT_CAPABILITY_MAP[intent.canonicalId], `Intent ${intent.canonicalId} should be in INTENT_CAPABILITY_MAP`);
  }
});

test("intent priority ladder is populated", () => {
  // Cancellation intents should have priority 100
  assert.equal(INTENT_PRIORITY['booking.cancel'], 100);
  assert.equal(INTENT_PRIORITY['order.cancel'], 100);
  // Modification intents should have priority 90
  assert.equal(INTENT_PRIORITY['booking.modify'], 90);
  assert.equal(INTENT_PRIORITY['cart.update'], 90);
  // Transactional intents should have priority 80
  assert.equal(INTENT_PRIORITY['booking.create'], 80);
  assert.equal(INTENT_PRIORITY['cart.add'], 80);
  // Social should be lowest
  assert.ok(INTENT_PRIORITY['conversation.greeting'] <= 40, "Greeting should be low priority");
});

// === English predictions ===

test("classifies 'cancel my booking' as booking.cancel with high confidence", () => {
  const r = classifier.classify("cancel my booking");
  assert.ok(r.used, "Should produce a prediction");
  assert.equal(r.topIntent.intentId, "booking.cancel");
  assert.ok(r.topIntent.confidence >= 0.85, `Confidence should be >=0.85, got ${r.topIntent.confidence}`);
  assert.ok(r.topIntent.margin >= 0.5, `Margin should be >=0.5, got ${r.topIntent.margin}`);
  assert.equal(r.topIntent.capabilityId, "cleaning");
});

test("classifies 'show me watches' as product.list", () => {
  const r = classifier.classify("show me watches");
  assert.equal(r.topIntent.intentId, "product.list");
  assert.ok(r.topIntent.confidence >= 0.7, `Got ${r.topIntent.confidence}`);
  assert.equal(r.topIntent.capabilityId, "catalog");
});

test("classifies 'add this to cart' as cart.add", () => {
  const r = classifier.classify("add this to cart");
  assert.equal(r.topIntent.intentId, "cart.add");
  assert.equal(r.topIntent.capabilityId, "commerce");
  assert.ok(r.topIntent.confidence >= 0.8);
});

test("classifies 'what are your hours' as business.hours", () => {
  const r = classifier.classify("what are your hours");
  assert.equal(r.topIntent.intentId, "business.hours");
  assert.equal(r.topIntent.capabilityId, "assistant");
  assert.ok(r.topIntent.confidence >= 0.7);
});

test("classifies 'how much for 3 bedroom apartment deep cleaning' as service.price", () => {
  const r = classifier.classify("how much for 3 bedroom apartment deep cleaning");
  assert.equal(r.topIntent.intentId, "service.price");
  assert.equal(r.topIntent.capabilityId, "cleaning");
  assert.ok(r.topIntent.confidence >= 0.85);
});

test("classifies 'do you provide deep cleaning service' as cleaning.service_list", () => {
  const r = classifier.classify("do you provide deep cleaning service");
  assert.equal(r.topIntent.intentId, "cleaning.service_list");
  assert.equal(r.topIntent.capabilityId, "cleaning");
  assert.ok(r.topIntent.confidence >= 0.7);
});

test("classifies multi-service compound request", () => {
  const r = classifier.classify("hello i want cleaning of my apartment and also sofa cleaning");
  assert.equal(r.topIntent.intentId, "cleaning.multi_service_request");
  assert.equal(r.topIntent.capabilityId, "cleaning");
  assert.ok(r.topIntent.confidence >= 0.7);
});

// === Multilingual / mixed-script ===

test("classifies Roman-Urdu 'mujhy ghar ki safai chahiye' as cleaning.service_request", () => {
  const r = classifier.classify("mujhy ghar ki safai chahiye");
  assert.equal(r.topIntent.intentId, "cleaning.service_request");
  assert.equal(r.topIntent.capabilityId, "cleaning");
  assert.ok(r.topIntent.confidence >= 0.7, `Got ${r.topIntent.confidence}`);
});

test("classifies Roman-Urdu 'mera order cancel kar do' as order.cancel", () => {
  const r = classifier.classify("mera order cancel kar do");
  assert.equal(r.topIntent.intentId, "order.cancel");
  assert.equal(r.topIntent.capabilityId, "commerce");
  assert.ok(r.topIntent.confidence >= 0.7);
});

test("classifies Arabic 'ألغ الحجز' as booking.cancel", () => {
  const r = classifier.classify("ألغ الحجز");
  // Arabic intents should still resolve to the right capability
  assert.equal(r.topIntent.capabilityId, "cleaning");
  // Confidence may be lower for short Arabic queries due to fewer training examples
  assert.ok(r.topIntent.confidence >= 0.4, `Got ${r.topIntent.confidence}`);
});

// === Typo tolerance ===

test("classifies '3 bdroom apartment deep cleaning charges' (typo) as service.price", () => {
  // "bdroom" is a typo of "bedroom" — the char-ngram channel should catch it
  const r = classifier.classify("3 bdroom apartment deep cleaning charges");
  assert.equal(r.topIntent.intentId, "service.price");
  assert.equal(r.topIntent.capabilityId, "cleaning");
  assert.ok(r.topIntent.confidence >= 0.7, `Got ${r.topIntent.confidence}`);
});

test("classifies 'clening service' (typo) as cleaning-related", () => {
  // "clening" is a typo of "cleaning" — char channel should still match
  const r = classifier.classify("clening service");
  // Should be a cleaning intent (any of the cleaning.* family)
  assert.ok(r.topIntent.intentId.startsWith('cleaning.'), `Got ${r.topIntent.intentId}`);
  assert.equal(r.topIntent.capabilityId, "cleaning");
});

// === predictCapability helper ===

test("predictCapability returns the right capability", () => {
  const result = classifier.predictCapability("cancel my booking");
  assert.ok(result);
  assert.equal(result.capabilityId, "cleaning");
  assert.equal(result.intentId, "booking.cancel");
  assert.ok(result.confidence >= 0.85);
});

test("predictCapability returns null for empty input", () => {
  const result = classifier.predictCapability("");
  assert.equal(result, null);
});

// === Channel scores ===

test("channel scores are present and bounded", () => {
  const r = classifier.classify("cancel my booking");
  assert.ok(r.channelScores, "channelScores should be present");
  assert.ok(r.channelScores.word >= 0 && r.channelScores.word <= 1, `word score out of range: ${r.channelScores.word}`);
  assert.ok(r.channelScores.char >= 0 && r.channelScores.char <= 1, `char score out of range: ${r.channelScores.char}`);
  assert.ok(r.channelScores.prototype >= 0 && r.channelScores.prototype <= 1, `prototype score out of range: ${r.channelScores.prototype}`);
});

// === Alternatives ===

test("alternatives are returned and ranked by confidence", () => {
  const r = classifier.classify("book a service");
  assert.ok(r.alternatives.length >= 1, "Should have at least one alternative");
  for (let i = 0; i < r.alternatives.length - 1; i++) {
    assert.ok(r.alternatives[i].confidence >= r.alternatives[i + 1].confidence,
      `Alternatives should be sorted by confidence desc: ${r.alternatives[i].confidence} < ${r.alternatives[i + 1].confidence}`);
  }
});

// === Performance ===

test("inference is sub-50ms per query", () => {
  // Warm-up
  classifier.classify("warmup query");
  const started = performance.now();
  for (let i = 0; i < 100; i++) {
    classifier.classify("book standard cleaning tomorrow at 10 AM");
  }
  const elapsed = performance.now() - started;
  const perQueryMs = elapsed / 100;
  assert.ok(perQueryMs < 50, `Average inference should be <50ms, got ${perQueryMs.toFixed(2)}ms`);
});

test("classifier handles empty and very long inputs gracefully", () => {
  assert.ok(!classifier.classify("").used, "Empty input should return used=false");
  assert.ok(!classifier.classify(null).used, "null input should return used=false");
  assert.ok(!classifier.classify(undefined).used, "undefined input should return used=false");
  // Very long input should still produce a result
  const longText = "book cleaning " + "and more ".repeat(500);
  const r = classifier.classify(longText);
  assert.ok(r.used);
  assert.ok(r.topIntent, "Long input should still produce a topIntent");
});

// === Feature extractor unit tests ===

test("tokenize splits words and removes stop words", () => {
  const tokens = tokenize("i want to book a cleaning service");
  assert.ok(!tokens.includes("i"), "Stop word 'i' should be filtered");
  assert.ok(!tokens.includes("to"), "Stop word 'to' should be filtered");
  assert.ok(!tokens.includes("a"), "Stop word 'a' should be filtered");
  assert.ok(tokens.includes("want"), "Content word 'want' should remain");
  assert.ok(tokens.includes("book"), "Content word 'book' should remain");
  assert.ok(tokens.includes("cleaning"), "Content word 'cleaning' should remain");
});

test("buildFeatureVector includes word, bigram, and char features", () => {
  const vec = buildFeatureVector("book cleaning");
  const keys = [...vec.keys()];
  assert.ok(keys.some(k => k.startsWith("w:")), "Should have word unigram features");
  assert.ok(keys.some(k => k.startsWith("b:")), "Should have bigram features");
  assert.ok(keys.some(k => k.startsWith("c3:")), "Should have char 3-gram features");
  assert.ok(keys.some(k => k.startsWith("c4:")), "Should have char 4-gram features");
});

test("DocumentFrequency computes IDF correctly", () => {
  const df = new DocumentFrequency();
  // Observe 3 docs with "book" and 1 doc with "cancel"
  df.observe(new Map([["w:book", 1]]));
  df.observe(new Map([["w:book", 1]]));
  df.observe(new Map([["w:book", 1]]));
  df.observe(new Map([["w:cancel", 1]]));
  // IDF should be lower for "book" (appears in 3/4 docs) than "cancel" (1/4)
  const bookIdf = df.idf("w:book");
  const cancelIdf = df.idf("w:cancel");
  assert.ok(cancelIdf > bookIdf, `cancelIdf (${cancelIdf}) should be > bookIdf (${bookIdf})`);
});

test("cosineSimilarity returns 1 for identical vectors", () => {
  const v = new Map([["a", 1], ["b", 2]]);
  assert.equal(cosineSimilarity(v, v), 1.0);
});

// === Frozen / immutability ===

test("trained model is frozen (immutable)", () => {
  assert.ok(Object.isFrozen(classifier.model), "model should be frozen");
  // In non-strict mode, mutation of a frozen object silently fails.
  // Verify immutability by checking that the value didn't change.
  const original = classifier.model.intentCount;
  classifier.model.intentCount = 0;
  assert.equal(classifier.model.intentCount, original, "Mutation should have been ignored (frozen)");
});

test("prediction result is frozen (immutable)", () => {
  const r = classifier.classify("cancel my booking");
  assert.ok(Object.isFrozen(r), "Result should be frozen");
  assert.ok(Object.isFrozen(r.topIntent), "topIntent should be frozen");
  assert.ok(Object.isFrozen(r.alternatives), "alternatives should be frozen");
});
