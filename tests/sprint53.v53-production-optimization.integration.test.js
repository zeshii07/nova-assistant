/**
 * Sprint 13 — v53.0 Phase 6 Production Optimization Tests
 *
 * Tests:
 *   FF — Conversation Replay (recording, redaction, replay, comparison, regression detection)
 *   GG — Regression Evaluator (corpus evaluation, baseline comparison, diff reporting)
 *   HH — Cost Optimizer (cost tracking, rate limiting, caching, summary)
 *   II — Load Tester (concurrent conversations, stress testing, fault injection, throughput)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationReplayEngine } = require('../packages/conversation-replay/src');
const { RegressionEvaluator } = require('../packages/regression-evaluator/src');
const { CostOptimizer } = require('../packages/cost-optimizer/src');
const { LoadTester } = require('../packages/load-tester/src');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP FF — Conversation Replay
// ─────────────────────────────────────────────────────────────────────────────

test('FF1: ConversationReplayEngine records a turn', () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', {
    message: { text: 'i want a haircut', customerId: 'c1', channel: 'website' },
    reply: 'What time would you prefer?',
    capabilityId: 'booking',
    intent: 'booking.start',
    stateBefore: {},
    stateAfter: {},
  });
  const recording = engine.getRecording('conv1');
  assert.equal(recording.length, 1);
  assert.equal(recording[0].capabilityId, 'booking');
});

test('FF2: ConversationReplayEngine redacts PII from messages', () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', {
    message: { text: 'my name is Ahmed Ali and my phone is 03001234567', customerId: 'c1' },
    reply: 'Got it',
    capabilityId: 'booking',
    intent: 'booking.continue',
    stateBefore: {},
    stateAfter: {},
  });
  const recording = engine.getRecording('conv1')[0];
  // Phone should be redacted
  assert.doesNotMatch(recording.message.text, /03001234567/);
  assert.match(recording.message.text, /PHONE_REDACTED/);
});

test('FF3: ConversationReplayEngine redacts email', () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', {
    message: { text: 'email me at ahmed@example.com', customerId: 'c1' },
    reply: 'Got it',
    capabilityId: 'commerce',
    intent: 'commerce.checkout_input',
    stateBefore: {},
    stateAfter: {},
  });
  const recording = engine.getRecording('conv1')[0];
  assert.doesNotMatch(recording.message.text, /ahmed@example.com/);
  assert.match(recording.message.text, /EMAIL_REDACTED/);
});

test('FF4: ConversationReplayEngine replays and compares', async () => {
  const engine = new ConversationReplayEngine();
  // Record original
  engine.record('conv1', {
    message: { text: 'i want a haircut', customerId: 'c1' },
    reply: 'What time would you prefer?',
    capabilityId: 'booking',
    intent: 'booking.start',
    stateBefore: {},
    stateAfter: {},
  });

  // Replay with same result → should match
  const result = await engine.replay('conv1', async (message) => ({
    reply: 'What time would you prefer?',
    capabilityId: 'booking',
    intent: 'booking.start',
  }));
  assert.equal(result.matches, 1);
  assert.equal(result.diffs, 0);
  assert.equal(result.matchRate, 100);
});

test('FF5: ConversationReplayEngine detects regression (different capability)', async () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', {
    message: { text: 'i want a haircut', customerId: 'c1' },
    reply: 'What time?',
    capabilityId: 'booking',
    intent: 'booking.start',
    stateBefore: {},
    stateAfter: {},
  });

  // Replay with DIFFERENT capability → should be a diff (regression)
  const result = await engine.replay('conv1', async () => ({
    reply: 'What time?',
    capabilityId: 'assistant', // Changed! This is a regression
    intent: 'business.info',
  }));
  assert.equal(result.diffs, 1);
  assert.equal(result.matchRate, 0);
  assert.ok(result.diffDetails[0].differences.some(d => d.field === 'capabilityId'));
});

test('FF6: ConversationReplayEngine export/import', () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', {
    message: { text: 'hello', customerId: 'c1' },
    reply: 'Hi!',
    capabilityId: 'assistant',
    intent: 'greeting',
    stateBefore: {},
    stateAfter: {},
  });
  const exported = engine.exportRecording('conv1');
  assert.ok(exported);
  assert.equal(exported.conversationId, 'conv1');

  // Import into new engine
  const engine2 = new ConversationReplayEngine();
  const ok = engine2.importRecording(exported);
  assert.ok(ok);
  assert.equal(engine2.getRecording('conv1').length, 1);
});

test('FF7: ConversationReplayEngine replayAll generates report', async () => {
  const engine = new ConversationReplayEngine();
  engine.record('conv1', { message: { text: 'hi' }, reply: 'Hello', capabilityId: 'assistant', intent: 'greeting', stateBefore: {}, stateAfter: {} });
  engine.record('conv2', { message: { text: 'bye' }, reply: 'Goodbye', capabilityId: 'assistant', intent: 'greeting', stateBefore: {}, stateAfter: {} });

  const report = await engine.replayAll(async () => ({
    reply: 'Hello', capabilityId: 'assistant', intent: 'greeting',
  }));
  assert.equal(report.conversations, 2);
  assert.equal(report.totalMatches + report.totalDiffs, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP GG — Regression Evaluator
// ─────────────────────────────────────────────────────────────────────────────

test('GG1: RegressionEvaluator evaluates corpus', async () => {
  const evaluator = new RegressionEvaluator();
  const corpus = [
    { id: 'T1', tenant: 'restaurant-demo', message: 'i want 1 chicken biryani', expect: { replyMatches: [/biryani/i] } },
    { id: 'T2', tenant: 'restaurant-demo', message: 'show my cart', expect: { replyMatches: [/cart|order/i] } },
  ];
  const result = await evaluator.evaluate(corpus, async (tenant, cid, text) => ({
    capabilityId: 'commerce',
    reply: text.includes('biryani') ? 'Added chicken biryani' : 'Your cart is empty',
  }));
  assert.equal(result.total, 2);
  assert.equal(result.pass, 2);
  assert.equal(result.fail, 0);
  assert.equal(result.passRate, 100);
});

test('GG2: RegressionEvaluator detects failures', async () => {
  const evaluator = new RegressionEvaluator();
  const corpus = [
    { id: 'T1', tenant: 't1', message: 'test1', expect: { capabilityId: 'booking' } },
  { id: 'T2', tenant: 't1', message: 'test2', expect: { capabilityId: 'booking' } },
  ];
  const result = await evaluator.evaluate(corpus, async () => ({
    capabilityId: 'assistant', // Wrong! Should be 'booking'
    reply: 'I don\'t understand',
  }));
  assert.equal(result.fail, 2);
  assert.equal(result.passRate, 0);
});

test('GG3: RegressionEvaluator saves and compares baselines', async () => {
  const evaluator = new RegressionEvaluator();
  // Save baseline (all pass)
  const baseline = await evaluator.evaluate(
    [{ id: 'T1', tenant: 't1', message: 'test', expect: { replyMatches: [/ok/i] } }],
    async () => ({ reply: 'ok', capabilityId: 'booking' }),
  );
  evaluator.saveBaseline('v1.0', baseline);

  // Run new evaluation (one regression)
  const newEval = await evaluator.evaluate(
    [{ id: 'T1', tenant: 't1', message: 'test', expect: { replyMatches: [/ok/i] } }],
    async () => ({ reply: 'different', capabilityId: 'booking' }), // Reply changed
  );

  const diff = evaluator.compare('v1.0', newEval);
  assert.equal(diff.regressions, 1);
  assert.equal(diff.improvements, 0);
});

test('GG4: RegressionEvaluator detects improvements', async () => {
  const evaluator = new RegressionEvaluator();
  // Baseline: one failure
  const baseline = await evaluator.evaluate(
    [{ id: 'T1', tenant: 't1', message: 'test', expect: { capabilityId: 'booking' } }],
    async () => ({ capabilityId: 'assistant', reply: 'wrong' }), // Failed
  );
  evaluator.saveBaseline('v1.0', baseline);

  // New evaluation: now passes (improvement!)
  const newEval = await evaluator.evaluate(
    [{ id: 'T1', tenant: 't1', message: 'test', expect: { capabilityId: 'booking' } }],
    async () => ({ capabilityId: 'booking', reply: 'correct' }),
  );

  const diff = evaluator.compare('v1.0', newEval);
  assert.equal(diff.improvements, 1);
  assert.equal(diff.regressions, 0);
  assert.ok(diff.delta > 0, 'pass rate should have improved');
});

test('GG5: RegressionEvaluator listBaselines', async () => {
  const evaluator = new RegressionEvaluator();
  const eval1 = { passRate: 95, total: 100, results: [], evaluatedAt: new Date().toISOString() };
  evaluator.saveBaseline('v1.0', eval1);
  evaluator.saveBaseline('v2.0', { ...eval1, passRate: 98 });
  const baselines = evaluator.listBaselines();
  assert.equal(baselines.length, 2);
  assert.ok(baselines.some(b => b.version === 'v1.0' && b.passRate === 95));
  assert.ok(baselines.some(b => b.version === 'v2.0' && b.passRate === 98));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP HH — Cost Optimizer
// ─────────────────────────────────────────────────────────────────────────────

test('HH1: CostOptimizer records costs', () => {
  const co = new CostOptimizer();
  co.recordCost('t1', 'nluPerCall', 1, { customerId: 'c1' });
  co.recordCost('t1', 'nluPerCall', 1, { customerId: 'c2' });
  const summary = co.getCostSummary('t1');
  assert.equal(summary.totalCalls, 2);
  assert.ok(summary.totalCost > 0);
  assert.ok(summary.byType.nluPerCall.count === 2);
});

test('HH2: CostOptimizer rate limiting allows within limit', () => {
  const co = new CostOptimizer();
  for (let i = 0; i < 10; i++) {
    const result = co.checkRateLimit('t1');
    assert.ok(result.allowed, `request ${i} should be allowed`);
  }
  const remaining = co.checkRateLimit('t1');
  assert.ok(remaining.remaining < 50, 'should have limited remaining after 10 requests');
});

test('HH3: CostOptimizer rate limiting blocks over limit', () => {
  const co = new CostOptimizer();
  co.maxRequestsPerMinute = 5; // Very low for testing
  for (let i = 0; i < 5; i++) co.checkRateLimit('t1');
  const blocked = co.checkRateLimit('t1');
  assert.ok(!blocked.allowed, '6th request should be blocked');
});

test('HH4: CostOptimizer rate limiting is per-tenant', () => {
  const co = new CostOptimizer();
  co.maxRequestsPerMinute = 3;
  for (let i = 0; i < 3; i++) co.checkRateLimit('t1');
  const t1Result = co.checkRateLimit('t1');
  const t2Result = co.checkRateLimit('t2');
  assert.ok(!t1Result.allowed, 't1 should be rate limited');
  assert.ok(t2Result.allowed, 't2 should NOT be rate limited (different tenant)');
});

test('HH5: CostOptimizer cache works', async () => {
  const co = new CostOptimizer();
  let callCount = 0;
  const result1 = await co.cached('key1', 5000, async () => { callCount++; return 'value1'; });
  const result2 = await co.cached('key1', 5000, async () => { callCount++; return 'value2'; });
  assert.equal(result1.value, 'value1');
  assert.equal(result2.value, 'value1'); // Cached!
  assert.equal(result2.fromCache, true);
  assert.equal(callCount, 1, 'compute function should only be called once');
});

test('HH6: CostOptimizer getSystemCostSummary aggregates across tenants', () => {
  const co = new CostOptimizer();
  co.recordCost('t1', 'nluPerCall', 5);
  co.recordCost('t2', 'nluPerCall', 3);
  co.recordCost('t1', 'llmPerCall', 1);
  const summary = co.getSystemCostSummary();
  assert.equal(summary.totalTenants, 2);
  assert.ok(summary.byTenant.t1);
  assert.ok(summary.byTenant.t2);
  assert.ok(summary.totalCost > 0);
});

test('HH7: CostOptimizer clearCache removes entries', async () => {
  const co = new CostOptimizer();
  await co.cached('key1', 5000, async () => 'value1');
  assert.equal(co.cache.size, 1);
  const cleared = co.clearCache();
  assert.equal(cleared, 1);
  assert.equal(co.cache.size, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP II — Load Tester
// ─────────────────────────────────────────────────────────────────────────────

test('II1: LoadTester runs concurrent conversations', async () => {
  const tester = new LoadTester();
  const conversations = [
    { tenantId: 't1', customerId: 'c1', messages: ['hello', 'i want a haircut'] },
    { tenantId: 't1', customerId: 'c2', messages: ['hi', 'book a table'] },
    { tenantId: 't1', customerId: 'c3', messages: ['hey', 'show menu'] },
  ];
  const result = await tester.runLoadTest({
    executeFn: async (msg) => ({ reply: 'ok', capabilityId: 'assistant' }),
    conversations,
    concurrency: 3,
  });
  assert.equal(result.totalConversations, 3);
  assert.equal(result.successfulConversations, 3);
  assert.equal(result.totalMessages, 6);
  assert.ok(result.throughput > 0);
  assert.ok(result.latency.avg >= 0);
});

test('II2: LoadTester measures latency', async () => {
  const tester = new LoadTester();
  const conversations = [
    { tenantId: 't1', customerId: 'c1', messages: ['msg1', 'msg2', 'msg3'] },
  ];
  const result = await tester.runLoadTest({
    executeFn: async () => {
      await new Promise(r => setTimeout(r, 10)); // 10ms delay
      return { reply: 'ok' };
    },
    conversations,
    concurrency: 1,
  });
  assert.ok(result.latency.avg >= 5, `avg latency should be >= 5ms, got ${result.latency.avg}`);
  assert.ok(result.latency.max >= result.latency.min);
});

test('II3: LoadTester tracks errors', async () => {
  const tester = new LoadTester();
  const conversations = [
    { tenantId: 't1', customerId: 'c1', messages: ['good', 'bad', 'good'] },
  ];
  const result = await tester.runLoadTest({
    executeFn: async (msg) => {
      if (msg.text === 'bad') throw new Error('test_error');
      return { reply: 'ok' };
    },
    conversations,
    concurrency: 1,
  });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].error, 'test_error');
  assert.equal(result.totalMessages, 2); // Only successful messages counted
});

test('II4: LoadTester fault injection', async () => {
  const tester = new LoadTester();
  tester.injectFault({ type: 'error', probability: 1.0 }); // 100% fault rate
  const conversations = [
    { tenantId: 't1', customerId: 'c1', messages: ['test'] },
  ];
  const result = await tester.runLoadTest({
    executeFn: async () => ({ reply: 'ok' }),
    conversations,
    concurrency: 1,
  });
  // With 100% fault injection, all messages should fail
  assert.ok(result.errors.length >= 1);
  tester.clearFaults();
});

test('II5: LoadTester stress test finds breaking point', async () => {
  const tester = new LoadTester();
  // Create many conversations
  const conversations = Array.from({ length: 20 }, (_, i) => ({
    tenantId: 't1',
    customerId: `c${i}`,
    messages: ['msg1', 'msg2'],
  }));

  const result = await tester.runStressTest({
    executeFn: async () => {
      await new Promise(r => setTimeout(r, 1));
      return { reply: 'ok' };
    },
    conversations,
    maxConcurrency: 10,
    errorThreshold: 0.5,
  });
  assert.ok(result.levels.length > 0);
  assert.ok(result.maxSupportedConcurrency > 0);
});

test('II6: LoadTester memory delta tracking', async () => {
  const tester = new LoadTester();
  const result = await tester.runLoadTest({
    executeFn: async () => ({ reply: 'ok' }),
    conversations: [{ tenantId: 't1', customerId: 'c1', messages: ['test'] }],
    concurrency: 1,
  });
  assert.ok(result.memoryDelta);
  assert.ok(typeof result.memoryDelta.rss === 'number');
  assert.ok(typeof result.memoryDelta.heapUsed === 'number');
});

test('II7: LoadTester throughput measurement', async () => {
  const tester = new LoadTester();
  const conversations = Array.from({ length: 5 }, (_, i) => ({
    tenantId: 't1', customerId: `c${i}`, messages: ['msg1', 'msg2', 'msg3'],
  }));
  const result = await tester.runLoadTest({
    executeFn: async () => ({ reply: 'ok' }),
    conversations,
    concurrency: 5,
  });
  assert.equal(result.totalMessages, 15);
  assert.ok(result.throughput > 0, `throughput should be > 0, got ${result.throughput}`);
});
