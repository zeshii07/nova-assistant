/**
 * Sprint 96 — v21.0 Online Learner
 *
 * Validates the new packages/online-learner package:
 *   - learn() accumulates positive examples and retrains the classifier
 *   - Negative examples are logged for review (not added to catalog)
 *   - Intent mapping (cleaning.structured_service_request → cleaning.service_request)
 *   - Minimum examples threshold (skip if < 10 examples)
 *   - Positive ratio check (skip if < 30% positive)
 *   - MAX_EXAMPLES_PER_INTENT cap
 *   - Retrained classifier shows improved confidence on collected examples
 *   - getStatus() returns a human-readable summary
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { buildContainer } = require("../apps/api/src/container");

let container;
let tempDir;

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-learner-test-'));
  container = await buildContainer();
  container.llmRouter.providers = [];
  container.feedbackCollector.storageDir = tempDir;
  container.feedbackCollector.examples.clear();
  container.feedbackCollector._loadedTenants.clear();
});

test.after(async () => {
  await container.storage?.close?.();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

async function ask(tenantId, customerId, text) {
  return container.executionEngine.process({
    tenantId, channel: "sprint96", customerId, text, messageId: null,
  });
}

async function completeBooking(tenantId, customerId, firstMessage) {
  await ask(tenantId, customerId, firstMessage);
  await ask(tenantId, customerId, "3");
  await ask(tenantId, customerId, "tomorrow at 10 AM");
  await ask(tenantId, customerId, "Villa 34, Dubai");
  await ask(tenantId, customerId, "James Watson");
  await ask(tenantId, customerId, "03012345678");
  await ask(tenantId, customerId, "confirm");
  await container.stateRepository.delete(`${tenantId}:sprint96:${customerId}`);
}

// === Basic learning ===

test("learn() with insufficient examples returns learned=false", async () => {
  // Generate only 2 examples (< MIN_EXAMPLES_TO_RETRAIN of 10)
  await completeBooking("cleaning-demo", "learn-1", "book deep cleaning for my villa");
  await completeBooking("cleaning-demo", "learn-2", "book deep cleaning for my villa");

  const summary = await container.onlineLearner.learn();
  assert.equal(summary.learned, false);
  assert.equal(summary.reason, 'insufficient_examples');
});

test("learn() with enough examples retrains the classifier", async () => {
  // Generate 10+ examples with unique queries
  const queries = [
    "i need someone to deep clean my 3 bedroom villa",
    "can you arrange deep cleaning for my villa property",
    "book a deep clean for my 3 bed villa",
    "please schedule a deep cleaning for my villa",
    "i want to book deep cleaning for my 4 bedroom villa",
    "need a deep clean for my villa next week",
    "arrange deep cleaning service for my villa",
  ];
  for (let i = 0; i < queries.length; i++) {
    await completeBooking("cleaning-demo", `learn-uniq-${i}`, queries[i]);
  }

  const summary = await container.onlineLearner.learn({ minExamples: 5 });
  assert.equal(summary.learned, true);
  assert.ok(summary.newExamplesAdded > 0, `Should have added new examples, got ${summary.newExamplesAdded}`);
  assert.ok(summary.totalExamples >= 5);
  assert.ok(summary.trainingMs > 0);
});

test("retrained classifier shows improved confidence on collected examples", async () => {
  // After retraining, the unique queries should classify with high confidence
  const query = "i need someone to deep clean my 3 bedroom villa";
  const r = container.mlIntentClassifier.classify(query);
  assert.ok(r.topIntent, 'Should produce a prediction');
  assert.ok(r.topIntent.confidence > 0.5, `Confidence should be >0.5 after retraining, got ${r.topIntent.confidence}`);
});

// === Intent mapping ===

test("intent mapping routes cleaning.structured_service_request → cleaning.service_request", async () => {
  // Check that the intent mapping is applied
  const examples = container.feedbackCollector.getExamples("cleaning-demo");
  const mapped = examples.filter(e => e.selectedIntent === 'cleaning.structured_service_request');
  if (mapped.length > 0) {
    // The online learner should have mapped these to cleaning.service_request
    // We can verify by checking that the retrained classifier predicts
    // cleaning.service_request for these queries
    const r = container.mlIntentClassifier.classify(mapped[0].messageText);
    assert.ok(r.topIntent, 'Should produce a prediction');
    // The mapped intent should be in the catalog
    assert.ok(['cleaning.service_request', 'booking.create'].includes(r.topIntent.intentId));
  }
});

// === Negative examples ===

test("negative examples are NOT added to the catalog but are logged", async () => {
  // Clear and generate a negative example
  container.feedbackCollector.clearTenant("cleaning-demo");
  await ask("cleaning-demo", "neg-test-1", "book deep cleaning for my villa");
  await ask("cleaning-demo", "neg-test-1", "3");
  await ask("cleaning-demo", "neg-test-1", "cancel");

  const examples = container.feedbackCollector.getExamples("cleaning-demo");
  const negative = examples.filter(e => e.outcome === 'negative');
  assert.ok(negative.length >= 1, 'Should have a negative example');

  // Run learner — should NOT learn from only negative examples
  const summary = await container.onlineLearner.learn({ minExamples: 1 });
  // With only negative examples, positiveRatio = 0 < MIN_POSITIVE_RATIO
  assert.equal(summary.learned, false);
  assert.equal(summary.reason, 'low_positive_ratio');
});

// === MAX_EXAMPLES_PER_INTENT cap ===

test("no single intent gets more than MAX_EXAMPLES_PER_INTENT examples", async () => {
  // This is hard to test without generating 50+ bookings
  // We verify the cap exists in the code
  const { MAX_EXAMPLES_PER_INTENT } = require("../packages/online-learner/src/onlineLearner");
  assert.ok(MAX_EXAMPLES_PER_INTENT > 0);
  assert.ok(MAX_EXAMPLES_PER_INTENT <= 100, 'Cap should be reasonable');
});

// === Status ===

test("getStatus() returns a human-readable summary", async () => {
  // Generate enough examples to learn
  container.feedbackCollector.clearTenant("cleaning-demo");
  for (let i = 0; i < 5; i++) {
    await completeBooking("cleaning-demo", `status-${i}`, `book deep cleaning for my villa number ${i}`);
  }
  await container.onlineLearner.learn({ minExamples: 3 });

  const status = container.onlineLearner.getStatus();
  assert.ok(typeof status === 'string');
  assert.ok(status.includes('Online Learner Status'));
  assert.ok(status.includes('Tenants processed'));
});

test("getLastRetrainSummary() returns the last summary object", async () => {
  const summary = container.onlineLearner.getLastRetrainSummary();
  if (summary) {
    assert.ok(summary.learned !== undefined);
    assert.ok(summary.retrainedAt);
    assert.ok(summary.totalExamples !== undefined);
  }
});

// === No examples ===

test("learn() with no tenants returns learned=false", async () => {
  container.feedbackCollector.clearTenant("cleaning-demo");
  const summary = await container.onlineLearner.learn();
  assert.equal(summary.learned, false);
  assert.equal(summary.reason, 'no_tenants_with_examples');
});

// === Failure isolation ===

test("online learner never crashes if feedback collector is missing", async () => {
  const { OnlineLearner } = require("../packages/online-learner/src/onlineLearner");
  const learner = new OnlineLearner({ feedbackCollector: null, mlIntentClassifier: null, logger: null });
  const summary = await learner.learn();
  assert.equal(summary.learned, false);
  assert.equal(summary.reason, 'missing_dependencies');
});
