/**
 * Sprint 10 — v50.0 Phase 3 Reply Intelligence Tests
 *
 * Tests:
 *   X — Reply Engine (grounding, planning, composing, validation)
 *   Y — Knowledge Engine (FAQ matching, business info retrieval)
 *   Z — Business Personality (tone, length, emoji control)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ReplyEngine, BusinessPersonality, InformationGrounding, ResponsePlanner, ResponseComposer,
} = require('../packages/reply-engine/src');
const { KnowledgeEngine } = require('../packages/knowledge-engine/src');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP X — Reply Engine
// ─────────────────────────────────────────────────────────────────────────────

test('X1: InformationGrounding extracts booking facts from result', () => {
  const grounding = new InformationGrounding();
  const context = {
    result: {
      responseModel: {
        payload: {
          record: { id: 'BKG-123', status: 'confirmed', slots: { date: '2026-12-01', time: '14:00' } },
        },
      },
    },
  };
  const facts = grounding.ground(context);
  assert.equal(facts.bookingId, 'BKG-123');
  assert.equal(facts.bookingStatus, 'confirmed');
  assert.equal(facts.bookingDate, '2026-12-01');
  assert.equal(facts.bookingTime, '14:00');
});

test('X2: InformationGrounding extracts order facts from result', () => {
  const grounding = new InformationGrounding();
  const context = {
    result: {
      responseModel: {
        payload: { orderId: 'ORD-456', order: { status: 'confirmed', total: 4500 } },
      },
    },
  };
  const facts = grounding.ground(context);
  assert.equal(facts.orderId, 'ORD-456');
  assert.equal(facts.orderStatus, 'confirmed');
  assert.equal(facts.orderTotal, 4500);
});

test('X3: InformationGrounding detects ungrounded confirmation', () => {
  const grounding = new InformationGrounding();
  const violations = grounding.validateClaims(
    'Your booking is confirmed! Reference: BKG-999',
    {} // no grounded facts
  );
  assert.ok(violations.some(v => v.type === 'ungrounded_confirmation'));
});

test('X4: InformationGrounding passes when confirmation is grounded', () => {
  const grounding = new InformationGrounding();
  const violations = grounding.validateClaims(
    'Your booking is confirmed! Reference: BKG-123',
    { bookingId: 'BKG-123' }
  );
  assert.equal(violations.filter(v => v.type === 'ungrounded_confirmation').length, 0);
});

test('X5: InformationGrounding detects price mismatch', () => {
  const grounding = new InformationGrounding();
  const violations = grounding.validateClaims(
    'The price is Rs1,000',
    { price: 2000 }
  );
  assert.ok(violations.some(v => v.type === 'price_mismatch'));
});

test('X6: ResponsePlanner plans error response for failed result', () => {
  const planner = new ResponsePlanner();
  const plan = planner.plan({
    result: { reply: 'Network error', metadata: { error: 'transient_failure', retryable: true } },
    intelligence: {},
  });
  assert.equal(plan.responseType, 'error');
  assert.equal(plan.pendingAction, 'retry');
});

test('X7: ResponsePlanner plans clarification for active workflow', () => {
  const planner = new ResponsePlanner();
  const plan = planner.plan({
    result: { reply: 'What is your name?' },
    intelligence: { workflow: { current: { pendingField: 'name' } } },
  });
  assert.equal(plan.responseType, 'clarification');
  assert.ok(plan.missingInfo.includes('name'));
  assert.equal(plan.pendingAction, 'provide_name');
});

test('X8: ResponsePlanner plans confirmation for ready workflow', () => {
  const planner = new ResponsePlanner();
  const plan = planner.plan({
    result: { reply: 'Everything is ready.', responseModel: { intent: 'GENERIC_BOOKING_READY' } },
    intelligence: { workflow: { current: { pendingField: 'confirmation' } } },
  });
  assert.equal(plan.responseType, 'confirmation');
  assert.equal(plan.shouldAskForConfirmation, true);
});

test('X9: ResponsePlanner plans direct response for completed action', () => {
  const planner = new ResponsePlanner();
  const plan = planner.plan({
    result: {
      reply: 'Booking confirmed! BKG-123',
      responseModel: { intent: 'GENERIC_BOOKING_CREATED', payload: {} },
    },
    intelligence: {},
  });
  assert.equal(plan.responseType, 'direct');
});

test('X10: ResponsePlanner plans knowledge response for FAQ', () => {
  const planner = new ResponsePlanner();
  const plan = planner.plan({
    result: {},
    intelligence: {},
    knowledge: { answer: 'We are open from 9am to 10pm.', source: 'business_info' },
  });
  assert.equal(plan.responseType, 'direct');
  assert.ok(plan.content.some(c => c.type === 'knowledge_answer'));
});

test('X11: ResponseComposer joins content blocks', () => {
  const composer = new ResponseComposer();
  const plan = {
    responseType: 'direct',
    content: [
      { type: 'capability_reply', text: 'Booking confirmed!' },
    ],
  };
  const text = composer.compose(plan, {}, null);
  assert.match(text, /Booking confirmed/);
});

test('X12: ReplyEngine full pipeline — grounding + planning + composing', async () => {
  const engine = new ReplyEngine();
  const result = await engine.build({
    message: { text: 'confirm' },
    intelligence: { selected: { intent: 'booking.confirm' }, workflow: { current: { pendingField: 'confirmation' } } },
    state: {},
    result: {
      reply: '✅ Booking confirmed! Reference: BKG-123',
      responseModel: { intent: 'GENERIC_BOOKING_CREATED', payload: { record: { id: 'BKG-123', status: 'confirmed' } } },
    },
    tenant: { id: 'test' },
    customer: null,
    workflow: null,
    knowledge: null,
    personality: null,
  });
  assert.ok(result.text);
  // pendingField='confirmation' → the planner routes to 'confirmation' (ready to confirm)
  assert.ok(['direct', 'confirmation'].includes(result.plan.responseType),
    `expected direct or confirmation, got ${result.plan.responseType}`);
  assert.equal(result.groundedFacts.bookingId, 'BKG-123');
});

test('X13: ReplyEngine detects validation errors in ungrounded response', async () => {
  const engine = new ReplyEngine();
  const result = await engine.build({
    message: { text: 'test' },
    intelligence: {},
    state: {},
    result: {
      reply: 'Your booking is confirmed! BKG-FAKE',
      responseModel: { intent: 'OTHER', payload: {} },
    },
    tenant: { id: 'test' },
    customer: null,
    knowledge: null,
    personality: null,
  });
  // No grounded bookingId → should have validation error
  assert.ok(result.validationErrors.some(e => e.type === 'ungrounded_confirmation'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP Y — Knowledge Engine
// ─────────────────────────────────────────────────────────────────────────────

test('Y1: KnowledgeEngine loads tenant FAQs', () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const knowledge = engine._loadTenantKnowledge('restaurant-demo');
  assert.ok(knowledge);
  // May or may not have FAQs depending on tenant config
  assert.ok(typeof knowledge.faqs === 'object' || Array.isArray(knowledge.faqs));
});

test('Y2: KnowledgeEngine loads tenant business info', () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const knowledge = engine._loadTenantKnowledge('hotel-demo');
  assert.ok(knowledge.business);
  assert.ok(knowledge.business.name);
});

test('Y3: KnowledgeEngine matches business hours query', async () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const result = await engine.retrieve({
    tenant: { id: 'hotel-demo' },
    message: { text: 'what time is check in' },
    state: {},
  });
  assert.ok(result.answer);
  assert.match(result.answer, /check.?in/i);
  assert.equal(result.source, 'business_info');
});

test('Y4: KnowledgeEngine matches business location query', async () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const result = await engine.retrieve({
    tenant: { id: 'hotel-demo' },
    message: { text: 'where are you located' },
    state: {},
  });
  assert.ok(result.answer);
  assert.match(result.answer, /located at/i);
});

test('Y5: KnowledgeEngine matches business contact query', async () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const result = await engine.retrieve({
    tenant: { id: 'hotel-demo' },
    message: { text: 'what is your phone number' },
    state: {},
  });
  assert.ok(result.answer);
  assert.match(result.answer, /reach us at/i);
});

test('Y6: KnowledgeEngine returns null for unknown query', async () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const result = await engine.retrieve({
    tenant: { id: 'hotel-demo' },
    message: { text: 'what is the weather today' },
    state: {},
  });
  assert.equal(result.answer, null);
  assert.equal(result.confidence, 0);
});

test('Y7: KnowledgeEngine matches check-out query for hotel', async () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const result = await engine.retrieve({
    tenant: { id: 'hotel-demo' },
    message: { text: 'what time is checkout' },
    state: {},
  });
  assert.ok(result.answer);
  assert.match(result.answer, /check.?out/i);
});

test('Y8: KnowledgeEngine FAQ matching with keywords', () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  const faqs = [
    { question: 'Do you have WiFi?', keywords: 'wifi,internet', answer: 'Yes, free WiFi is available.' },
    { question: 'Do you have parking?', keywords: 'parking,car', answer: 'Yes, free parking is available.' },
  ];
  const result = engine._matchFAQ('do you have wifi', faqs);
  assert.ok(result);
  assert.match(result.answer, /free WiFi/i);
});

test('Y9: KnowledgeEngine caches tenant knowledge', () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  engine._loadTenantKnowledge('hotel-demo');
  assert.ok(engine.cache.has('hotel-demo'));
  // Second call should use cache
  const k2 = engine._loadTenantKnowledge('hotel-demo');
  assert.ok(k2.business);
});

test('Y10: KnowledgeEngine clearCache removes entry', () => {
  const engine = new KnowledgeEngine({ tenantsDir: './tenants' });
  engine._loadTenantKnowledge('hotel-demo');
  assert.ok(engine.cache.has('hotel-demo'));
  engine.clearCache('hotel-demo');
  assert.ok(!engine.cache.has('hotel-demo'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP Z — Business Personality
// ─────────────────────────────────────────────────────────────────────────────

test('Z1: BusinessPersonality removes emojis when emojiUsage is none', () => {
  const personality = new BusinessPersonality({ emojiUsage: 'none' });
  const text = personality.apply('Hello 👍😊 How are you?');
  assert.doesNotMatch(text, /👍|😊/);
});

test('Z2: BusinessPersonality keeps emojis when emojiUsage is minimal', () => {
  const personality = new BusinessPersonality({ emojiUsage: 'minimal' });
  const text = personality.apply('Hello 👍😊 How are you?');
  assert.match(text, /👍|😊/);
});

test('Z3: BusinessPersonality shortens response when responseLength is short', () => {
  const personality = new BusinessPersonality({ responseLength: 'short' });
  const longText = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four.';
  const result = personality.apply(longText, {});
  // Short mode should limit to ~3 sentences for non-confirmation responses
  const sentenceCount = result.split(/(?<=[.!?])\s+/).length;
  assert.ok(sentenceCount <= 3, `expected <= 3 sentences, got ${sentenceCount}`);
});

test('Z4: BusinessPersonality keeps full response for confirmations even in short mode', () => {
  const personality = new BusinessPersonality({ responseLength: 'short' });
  const longText = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
  const result = personality.apply(longText, { isConfirmation: true });
  // Confirmations should NOT be truncated
  assert.match(result, /Sentence five/);
});

test('Z5: BusinessPersonality removes casual markers for professional tone', () => {
  const personality = new BusinessPersonality({ tone: 'professional' });
  const text = personality.apply('Done 👍😊 See you soon!');
  assert.doesNotMatch(text, /👍|😊/);
});

test('Z6: BusinessPersonality defaults are sensible', () => {
  const personality = new BusinessPersonality();
  assert.equal(personality.tone, 'friendly');
  assert.equal(personality.responseLength, 'balanced');
  assert.equal(personality.emojiUsage, 'minimal');
  assert.equal(personality.greetingStyle, 'casual');
});

test('Z7: BusinessPersonality can be configured for premium brand', () => {
  const personality = new BusinessPersonality({
    tone: 'professional',
    responseLength: 'detailed',
    emojiUsage: 'none',
    brandPersonality: 'premium',
    greetingStyle: 'formal',
  });
  assert.equal(personality.tone, 'professional');
  assert.equal(personality.brandPersonality, 'premium');
});

test('Z8: BusinessPersonality apply handles empty text', () => {
  const personality = new BusinessPersonality({ emojiUsage: 'none' });
  const result = personality.apply('');
  assert.equal(result, '');
});

test('Z9: ReplyEngine uses personality in composition', async () => {
  const engine = new ReplyEngine();
  const personality = new BusinessPersonality({ emojiUsage: 'none' });
  const result = await engine.build({
    message: { text: 'confirm' },
    intelligence: {},
    state: {},
    result: { reply: '✅ Booking confirmed! 👍', responseModel: { intent: 'OTHER', payload: {} } },
    tenant: { id: 'test' },
    knowledge: null,
    personality,
  });
  // Emojis should be removed by personality
  assert.doesNotMatch(result.text, /✅|👍/);
});
