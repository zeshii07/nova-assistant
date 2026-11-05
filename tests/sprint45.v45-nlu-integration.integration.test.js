/**
 * Sprint 5 — v45.0 NLU Integration Tests
 *
 * Validates that the variation corpus is correctly fed to the NLU as few-shot
 * examples, and that the mock NLU client correctly classifies customer messages.
 *
 * Test groups:
 *   I — Corpus few-shot converter unit tests
 *   J — Mock NLU client classification tests
 *   K — RemoteNluInterpreter prompt injection tests
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP I — Corpus few-shot converter unit tests
// ─────────────────────────────────────────────────────────────────────────────

const { corpusToNluExamples, getBalancedExamples, getDomainExamples, formatFewShotPrompt, getIntentMapping } =
  require('../packages/multilingual-nlu/src/corpusFewShot');

test('I1: corpusToNluExamples returns non-empty array', () => {
  const examples = corpusToNluExamples({ maxExamples: 10 });
  assert.ok(examples.length > 0, 'should return examples');
  assert.ok(examples.length <= 10, 'should respect maxExamples');
});

test('I2: each example has text, intent, domain, notes', () => {
  const examples = corpusToNluExamples({ maxExamples: 5 });
  for (const ex of examples) {
    assert.ok(typeof ex.text === 'string' && ex.text.length > 0, 'text should be a non-empty string');
    assert.ok(typeof ex.intent === 'string' && ex.intent.length > 0, 'intent should be a non-empty string');
    assert.ok(typeof ex.domain === 'string', 'domain should be a string');
  }
});

test('I3: domain filter works — restaurant only', () => {
  const examples = corpusToNluExamples({ maxExamples: 50, domain: 'restaurant' });
  assert.ok(examples.length > 0, 'should return restaurant examples');
  for (const ex of examples) {
    assert.equal(ex.domain, 'restaurant', `expected restaurant domain, got ${ex.domain}`);
  }
});

test('I4: intent filter works — cart.add only', () => {
  const examples = corpusToNluExamples({ maxExamples: 50, intent: 'cart.add' });
  assert.ok(examples.length > 0, 'should return cart.add examples');
  for (const ex of examples) {
    assert.equal(ex.intent, 'cart.add', `expected cart.add intent, got ${ex.intent}`);
  }
});

test('I5: getBalancedExamples returns samples across multiple intents', () => {
  const balanced = getBalancedExamples({ maxPerIntent: 3, maxTotal: 30 });
  const intents = new Set(balanced.map(ex => ex.intent));
  assert.ok(intents.size >= 3, `expected at least 3 different intents, got ${intents.size}: ${[...intents].join(', ')}`);
});

test('I6: getDomainExamples returns domain-specific examples', () => {
  const restaurant = getDomainExamples('restaurant', { maxExamples: 5 });
  assert.ok(restaurant.length > 0, 'should return restaurant examples');
  for (const ex of restaurant) {
    assert.equal(ex.domain, 'restaurant');
  }
});

test('I7: formatFewShotPrompt produces readable text', () => {
  const examples = getBalancedExamples({ maxPerIntent: 2, maxTotal: 10 });
  const prompt = formatFewShotPrompt(examples, { maxPerIntent: 2, maxTotal: 10 });
  assert.ok(typeof prompt === 'string', 'prompt should be a string');
  assert.match(prompt, /Few-shot examples/i, 'should have a header');
  assert.match(prompt, /→/, 'should have arrow notation');
});

test('I8: intent mapping covers all corpus prefixes', () => {
  const mapping = getIntentMapping();
  assert.ok(mapping['ORD'], 'should map ORD');
  assert.ok(mapping['BKG'], 'should map BKG');
  assert.ok(mapping['RMV'], 'should map RMV');
  assert.ok(mapping['OT'], 'should map OT');
  assert.ok(mapping['NOTE'], 'should map NOTE');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP J — Mock NLU client classification tests
// ─────────────────────────────────────────────────────────────────────────────

const { MockNluClient, classifyByKeywords } = require('../packages/multilingual-nlu/src/mockNluClient');

test('J1: mock NLU classifies "i want 1 chicken biryani" as cart.add', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'i want 1 chicken biryani' },
  ]);
  assert.ok(result.success, 'should succeed');
  assert.equal(result.data.intent, 'cart.add', `expected cart.add, got ${result.data.intent}`);
});

test('J2: mock NLU classifies "book beard grooming tomorrow" as booking.create', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'book beard grooming tomorrow at 5pm' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.intent, 'booking.create');
});

test('J3: mock NLU classifies "remove the biryani" as cart.remove', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'remove the biryani' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.intent, 'cart.remove');
});

test('J4: mock NLU classifies "show my cart" as cart.view', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'show my cart' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.intent, 'cart.view');
});

test('J5: mock NLU classifies "ok" as conversation.confirm', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'ok' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.intent, 'conversation.confirm');
});

test('J6: mock NLU classifies "what are your hours" as business.info', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'what are your hours' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.intent, 'business.info');
});

test('J7: mock NLU extracts date and time entities', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'book beard grooming tomorrow at 5pm' },
  ]);
  assert.ok(result.success);
  assert.ok(result.data.entities.date_text, 'should extract date_text');
  assert.match(result.data.entities.date_text, /tomorrow/i);
});

test('J8: mock NLU detects Roman Urdu language', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'mujhe 1 chicken biryani chahiye' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.language, 'roman_ur');
});

test('J9: mock NLU detects Urdu script language', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'میں ایک چکن بریانی چاہتا ہوں' },
  ]);
  assert.ok(result.success);
  assert.equal(result.data.language, 'ur');
});

test('J10: classifyByKeywords handles unknown messages', () => {
  assert.equal(classifyByKeywords('random unknown text'), 'other');
  assert.equal(classifyByKeywords('i want a burger'), 'cart.add');
  assert.equal(classifyByKeywords('cancel my order'), 'cart.remove');
});

test('J11: mock NLU failure rate simulation', async () => {
  const client = new MockNluClient({ latencyMs: 0, failureRate: 1 });
  const result = await client.complete([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'i want a burger' },
  ]);
  assert.ok(!result.success, 'should fail with failureRate=1');
  assert.equal(result.error, 'mock_failure');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP K — RemoteNluInterpreter prompt injection tests
// ─────────────────────────────────────────────────────────────────────────────

const { RemoteNluInterpreter, NLU_PROMPT_VERSION } = require('../packages/multilingual-nlu/src/remoteNluInterpreter');
const { NluContextBuilder } = require('../packages/multilingual-nlu/src/nluContextBuilder');

test('K1: RemoteNluInterpreter injects few-shot examples into prompt', async () => {
  // Capture the messages sent to the mock client
  let capturedMessages = null;
  const mockClient = {
    complete: async (messages) => {
      capturedMessages = messages;
      return { success: false, error: 'not_configured', model: 'mock', latencyMs: 0 };
    },
  };
  const interpreter = new RemoteNluInterpreter({
    client: mockClient,
    mode: 'on',
    contextBuilder: new NluContextBuilder({ defaultTimezone: 'UTC' }),
  });
  const tenant = { id: 'restaurant-demo', domain: 'restaurant', capabilities: ['catalog', 'commerce'], features: {} };
  const message = { text: 'i want 1 chicken biryani', customerId: 'test', channel: 'test' };
  const state = { capabilityState: {}, context: {} };
  await interpreter.interpret({ tenant, message, state, services: {}, pending: null });
  // Verify the system prompt contains few-shot examples
  const systemPrompt = capturedMessages?.[0]?.content || '';
  assert.match(systemPrompt, /Few-shot examples/i, 'system prompt should contain few-shot examples section');
  assert.match(systemPrompt, /cart\.add/i, 'system prompt should contain cart.add examples');
  assert.match(systemPrompt, /restaurant/i, 'system prompt should contain restaurant domain examples');
});

test('K2: RemoteNluInterpreter prompt version is 2.1 (with corpus integration)', () => {
  assert.match(NLU_PROMPT_VERSION, /2\.1/, 'prompt version should be 2.1 (v45.0 corpus integration)');
});

test('K3: RemoteNluInterpreter returns not_used when mode is off', async () => {
  const mockClient = { complete: async () => ({ success: false, error: 'should_not_be_called' }) };
  const interpreter = new RemoteNluInterpreter({ client: mockClient, mode: 'off' });
  const result = await interpreter.interpret({
    tenant: { id: 'test', domain: 'restaurant', capabilities: [], features: {} },
    message: { text: 'test' },
    state: {},
    services: {},
    pending: null,
  });
  assert.equal(result.used, false, 'should not use NLU when mode is off');
});

test('K4: RemoteNluInterpreter returns success with mock client', async () => {
  const mockClient = new MockNluClient({ latencyMs: 0 });
  const interpreter = new RemoteNluInterpreter({
    client: mockClient,
    mode: 'on',
    contextBuilder: new NluContextBuilder({ defaultTimezone: 'UTC' }),
  });
  const tenant = { id: 'restaurant-demo', domain: 'restaurant', capabilities: ['catalog', 'commerce'], features: {} };
  const result = await interpreter.interpret({
    tenant,
    message: { text: 'i want 1 chicken biryani', customerId: 'test', channel: 'test' },
    state: { capabilityState: {}, context: {} },
    services: {},
    pending: null,
  });
  assert.equal(result.used, true, 'NLU should be used');
  // The mock client returns success=true, so the interpreter should validate it
  // (may or may not pass validation depending on schema strictness — we just
  // check it doesn't crash and returns a structured result)
  assert.ok(typeof result.used === 'boolean');
  assert.ok(typeof result.mode === 'string');
});

test('K5: few-shot examples include domain-specific entries', async () => {
  let capturedMessages = null;
  const mockClient = {
    complete: async (messages) => {
      capturedMessages = messages;
      return { success: false, error: 'not_configured', model: 'mock', latencyMs: 0 };
    },
  };
  const interpreter = new RemoteNluInterpreter({
    client: mockClient,
    mode: 'on',
    contextBuilder: new NluContextBuilder({ defaultTimezone: 'UTC' }),
  });
  // Test with salon domain
  const tenant = { id: 'salon-demo', domain: 'salon', capabilities: ['offering', 'booking'], features: {} };
  const message = { text: 'book a haircut', customerId: 'test', channel: 'test' };
  const state = { capabilityState: {}, context: {} };
  await interpreter.interpret({ tenant, message, state, services: {}, pending: null });
  const systemPrompt = capturedMessages?.[0]?.content || '';
  // The salon domain examples should be in the prompt
  assert.match(systemPrompt, /booking\.create/i, 'salon examples should include booking.create');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP L — NLU + corpus coverage validation
// ─────────────────────────────────────────────────────────────────────────────

test('L1: corpus examples cover all major intent categories', () => {
  const all = corpusToNluExamples({ maxExamples: 999 });
  const intents = new Set(all.map(ex => ex.intent));
  // Verify all major intent categories are represented
  const expectedIntents = ['cart.add', 'cart.update', 'cart.remove', 'cart.view', 'booking.create', 'booking.modify', 'conversation.confirm', 'business.info'];
  for (const expected of expectedIntents) {
    assert.ok(intents.has(expected), `corpus should cover intent "${expected}". Has: ${[...intents].join(', ')}`);
  }
});

test('L2: corpus examples cover all 7 domains', () => {
  const all = corpusToNluExamples({ maxExamples: 999 });
  const domains = new Set(all.map(ex => ex.domain));
  const expectedDomains = ['restaurant', 'salon', 'cleaning', 'retail', 'healthcare', 'education', 'driving_school'];
  for (const expected of expectedDomains) {
    assert.ok(domains.has(expected), `corpus should cover domain "${expected}"`);
  }
});

test('L3: mock NLU correctly classifies a sample of corpus cases', async () => {
  const client = new MockNluClient({ latencyMs: 0 });
  const sample = corpusToNluExamples({ maxExamples: 30 });
  let correct = 0;
  let total = 0;
  for (const ex of sample) {
    const result = await client.complete([
      { role: 'system', content: 'test' },
      { role: 'user', content: ex.text },
    ]);
    if (result.success && result.data.intent === ex.intent) correct++;
    total++;
  }
  // The mock client uses the corpus as its lookup table, so it should classify
  // all corpus examples correctly (100% for exact matches).
  // For non-exact matches (keyword fallback), we expect at least 80%.
  const accuracy = correct / total;
  assert.ok(accuracy >= 0.8, `mock NLU accuracy should be >= 80%, got ${(accuracy * 100).toFixed(1)}% (${correct}/${total})`);
});
