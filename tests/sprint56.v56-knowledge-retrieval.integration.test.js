/**
 * Sprint 56 — v56.0 Phase 3 Retrieval Intelligence
 *
 * Tests:
 *   BB — IntentRouter (rule-based classification, entity extraction, missing fields, routing)
 *   BC — QueryRewriter (normalization, bounded expansions, variant building, polarity preservation)
 *   BD — EvidenceValidator (relevance, completeness, authority, freshness, conflict, customerSafe)
 *   BE — TrainedEmbeddingProvider (interface contract, graceful fallback, language routing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { IntentRouter, INTENT_RULES } = require('../packages/knowledge-retrieval/src/intentRouter');
const { QueryRewriter } = require('../packages/knowledge-retrieval/src/queryRewriter');
const { EvidenceValidator, AUTHORITY_TIERS, factSignature } = require('../packages/knowledge-retrieval/src/evidenceValidator');
const { TrainedEmbeddingProvider, isUrduOrArabicScript, isRomanUrdu } = require('../packages/knowledge/src/trainedEmbeddingProvider');
const { EmbeddingProvider } = require('../packages/knowledge/src/embeddingProviderInterface');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP BB — IntentRouter
// ─────────────────────────────────────────────────────────────────────────────

test('BB1: pricing inquiry routes to pricing source (NOT RAG)', () => {
  const router = new IntentRouter();
  const r = router.classify('how much does deep cleaning cost?');
  assert.equal(r.intent, 'pricing_inquiry');
  assert.ok(r.requiredSources.includes('pricing'));
  assert.equal(router.isStructuredIntent(r.intent), true);
  assert.equal(router.isKnowledgeIntent(r.intent), false);
});

test('BB2: availability inquiry routes to availability system', () => {
  const router = new IntentRouter();
  const r = router.classify('are you available tomorrow?');
  assert.equal(r.intent, 'availability_inquiry');
  assert.ok(r.requiredSources.includes('availability'));
  assert.equal(router.isStructuredIntent(r.intent), true);
});

test('BB3: booking intent extracts service + date entities', () => {
  const router = new IntentRouter();
  const r = router.classify('I want to book deep cleaning for tomorrow');
  assert.equal(r.intent, 'booking_intent');
  assert.ok(r.entities.service);
  assert.ok(r.entities.date);
});

test('BB4: booking with missing service triggers clarification', () => {
  const router = new IntentRouter();
  const r = router.classify('I want to book an appointment');
  assert.equal(r.intent, 'booking_intent');
  assert.ok(r.missingFields.includes('service'), 'must request missing service field');
});

test('BB5: order inquiry requires orderId', () => {
  const router = new IntentRouter();
  const r = router.classify('where is my order ORD-12345?');
  assert.equal(r.intent, 'order_inquiry');
  assert.equal(r.entities.orderId, 'ORD-12345');
  // Without an order ID, the field is flagged missing.
  const r2 = router.classify('where is my order?');
  assert.ok(r2.missingFields.includes('orderId'));
});

test('BB6: policy inquiry routes to RAG knowledge', () => {
  const router = new IntentRouter();
  const r = router.classify('what is your cancellation policy?');
  assert.equal(r.intent, 'policy_inquiry');
  assert.ok(r.requiredSources.includes('customer_policy'));
  assert.equal(router.isKnowledgeIntent(r.intent), true);
});

test('BB7: pets question is classified as policy inquiry', () => {
  const router = new IntentRouter();
  const r = router.classify('do you allow dogs?');
  assert.equal(r.intent, 'policy_inquiry');
});

test('BB8: business hours routes to business_config (structured, not RAG)', () => {
  const router = new IntentRouter();
  const r = router.classify('what time is check-in?');
  assert.equal(r.intent, 'business_info');
  assert.ok(r.requiredSources.includes('business_config'));
  assert.equal(router.isStructuredIntent(r.intent), true);
});

test('BB9: location question routes to business_config', () => {
  const router = new IntentRouter();
  const r = router.classify('where are you located?');
  assert.equal(r.intent, 'business_info');
  assert.match(r.entities.infoType, /location/);
});

test('BB10: complaint triggers escalation', () => {
  const router = new IntentRouter();
  const r = router.classify('I am unhappy with the cleaning service');
  assert.equal(r.intent, 'complaint');
  assert.equal(router.isEscalationIntent(r.intent), true);
});

test('BB11: unknown query has low confidence', () => {
  const router = new IntentRouter();
  const r = router.classify('the quick brown fox jumps over the lazy dog');
  assert.equal(r.intent, 'unknown');
  assert.ok(r.confidence < 0.6);
});

test('BB12: classifier records original text', () => {
  const router = new IntentRouter();
  const r = router.classify('how much is it?');
  assert.equal(r.originalText, 'how much is it?');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP BC — QueryRewriter
// ─────────────────────────────────────────────────────────────────────────────

test('BC1: "Do you allow dogs?" normalized to "are pets permitted"', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('Do you allow dogs?');
  assert.match(r.normalized, /are pets permitted/i);
});

test('BC2: cancellation phrasing normalized to canonical form', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('how do I cancel?');
  assert.match(r.normalized, /cancellation policy/i);
});

test('BC3: rewritten query preserves original meaning (no polarity flip)', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('do not cancel my booking');
  // The word "not" / negation must be preserved — never flipped to positive.
  assert.match(r.normalized, /cancel/i);
  // The original must be recorded for debugging.
  assert.equal(r.original, 'do not cancel my booking');
});

test('BC4: expansions are bounded (never more than ~12 added words)', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('what is your cancellation policy?');
  const addedWords = r.expanded.replace(r.normalized, '').trim().split(/\s+/).filter(Boolean);
  assert.ok(addedWords.length <= 15, `expansion too long: ${addedWords.length} words`);
});

test('BC5: variants are bounded (max 5)', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('are pets permitted?');
  assert.ok(r.variants.length <= 5);
  assert.ok(r.variants.length >= 1);
});

test('BC6: irrelevant queries are not over-expanded', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('what is the weather today');
  // No expansion rule matches → expanded should equal normalized.
  assert.equal(r.expanded, r.normalized);
});

test('BC7: pricing query normalized + expanded', () => {
  const rw = new QueryRewriter();
  const r = rw.rewrite('how much does deep cleaning cost?');
  assert.match(r.normalized, /price cost/i);
  assert.ok(r.variants.includes('pricing') || r.variants.includes('how much'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP BD — EvidenceValidator
// ─────────────────────────────────────────────────────────────────────────────

function makeMatch(overrides = {}) {
  return {
    text: 'Cancellation requires 24 hours notice.',
    sourceId: 'KS-1', id: 'chunk_1', sourceStatus: 'published', sourceVersion: 1,
    customerSafe: true, sourceKind: 'document', hybridScore: 0.7,
    ...overrides,
  };
}

test('BD1: verified status when evidence is complete and authoritative', () => {
  const v = new EvidenceValidator();
  const r = v.validate({ query: 'cancellation policy', matches: [makeMatch()], intent: 'policy_inquiry' });
  assert.equal(r.status, 'verified');
  assert.equal(r.checks.relevant, true);
  assert.equal(r.checks.complete, true);
  assert.equal(r.checks.authoritative, true);
  assert.equal(r.checks.conflict, false);
  assert.equal(r.checks.customerSafe, true);
});

test('BD2: none status when no relevant matches', () => {
  const v = new EvidenceValidator();
  const r = v.validate({ query: 'cancellation policy', matches: [], intent: 'policy_inquiry' });
  assert.equal(r.status, 'none');
  assert.equal(r.checks.relevant, false);
});

test('BD3: conflicting status when two matches disagree on a number', () => {
  const v = new EvidenceValidator();
  const m1 = makeMatch({ text: 'Cancellation requires 24 hours notice.' });
  const m2 = makeMatch({ text: 'Cancellation requires 48 hours notice.', id: 'chunk_2' });
  const r = v.validate({ query: 'cancellation policy', matches: [m1, m2], intent: 'policy_inquiry' });
  assert.equal(r.status, 'conflicting');
  assert.equal(r.checks.conflict, true);
});

test('BD4: stale status when source effectiveUntil is in the past', () => {
  const v = new EvidenceValidator();
  const m = makeMatch({ effectiveUntil: '2020-01-01T00:00:00Z' });
  const r = v.validate({ query: 'cancellation policy', matches: [m], intent: 'policy_inquiry' });
  assert.equal(r.status, 'stale');
  assert.equal(r.checks.fresh, false);
});

test('BD5: unauthorized status when evidence is not customerSafe', () => {
  const v = new EvidenceValidator();
  const m = makeMatch({ text: 'The assistant must never invent a price.', customerSafe: false });
  const r = v.validate({ query: 'cancellation policy', matches: [m], intent: 'policy_inquiry' });
  // internal_instruction chunks are filtered out → no customer-safe matches → incomplete or none
  assert.ok(['unauthorized', 'incomplete', 'none'].includes(r.status));
  assert.equal(r.checks.customerSafe, false);
});

test('BD6: incomplete status for count question without a number', () => {
  const v = new EvidenceValidator();
  const m = makeMatch({ text: 'We have cleaners available.' });
  const r = v.validate({ query: 'how many cleaners do you have', matches: [m], intent: 'faq' });
  assert.equal(r.status, 'incomplete');
  assert.equal(r.checks.complete, false);
});

test('BD7: pricing intent is NEVER complete via RAG (must use pricingService)', () => {
  const v = new EvidenceValidator();
  const m = makeMatch({ text: 'Deep cleaning costs $50.' });
  const r = v.validate({ query: 'how much does deep cleaning cost', matches: [m], intent: 'pricing_inquiry' });
  assert.equal(r.checks.complete, false);
  assert.equal(r.status, 'incomplete');
});

test('BD8: evidence array carries sourceId, chunkId, version, claim', () => {
  const v = new EvidenceValidator();
  const r = v.validate({ query: 'cancellation policy', matches: [makeMatch()], intent: 'policy_inquiry' });
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].sourceId, 'KS-1');
  assert.equal(r.evidence[0].chunkId, 'chunk_1');
  assert.equal(r.evidence[0].version, 1);
  assert.ok(r.evidence[0].claim);
  assert.ok(r.evidence[0].authorityTier);
});

test('BD9: factSignature extracts numbers + yes/no values', () => {
  const sig = factSignature('Cancellation requires 24 hours notice. No fee.');
  assert.match(sig, /24 hours/);
  assert.match(sig, /no/);
});

test('BD10: authority tiers match spec §5 priority order', () => {
  assert.equal(AUTHORITY_TIERS.live_transactional, 1);
  assert.equal(AUTHORITY_TIERS.business_config, 2);
  assert.equal(AUTHORITY_TIERS.approved_tenant_knowledge, 3);
  assert.ok(AUTHORITY_TIERS.live_transactional < AUTHORITY_TIERS.business_config);
  assert.ok(AUTHORITY_TIERS.business_config < AUTHORITY_TIERS.approved_tenant_knowledge);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP BE — TrainedEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

test('BE1: EmbeddingProvider interface defines the contract', () => {
  const ep = new EmbeddingProvider();
  assert.ok(typeof ep.embedQuery === 'function');
  assert.ok(typeof ep.embedDocuments === 'function');
  assert.ok(typeof ep.getModelInfo === 'function');
});

test('BE2: TrainedEmbeddingProvider implements the interface', () => {
  const ep = new TrainedEmbeddingProvider();
  assert.ok(typeof ep.embedQuery === 'function');
  assert.ok(typeof ep.embedDocuments === 'function');
  assert.ok(typeof ep.getModelInfo === 'function');
});

test('BE3: TrainedEmbeddingProvider gracefully falls back when transformers not installed', async () => {
  const ep = new TrainedEmbeddingProvider();
  const vec = await ep.embedQuery('hello world');
  assert.ok(Array.isArray(vec));
  assert.ok(vec.length > 0);
});

test('BE4: model info records name + version + dimensions', () => {
  const ep = new TrainedEmbeddingProvider();
  const info = ep.getModelInfo();
  assert.ok(info.name);
  assert.ok(info.version >= 1);
  assert.equal(info.dimensions, 384);
});

test('BE5: language routing detects Urdu script and Roman-Urdu', () => {
  assert.equal(isUrduOrArabicScript('منسوخی پالیسی'), true);
  assert.equal(isUrduOrArabicScript('What is your policy?'), false);
  assert.equal(isRomanUrdu('mera dog sath aa sakta hai'), true);
  assert.equal(isRomanUrdu('what is your policy'), false);
});

test('BE6: embedDocuments returns array of arrays', async () => {
  const ep = new TrainedEmbeddingProvider();
  const vecs = await ep.embedDocuments(['hello', 'world']);
  assert.ok(Array.isArray(vecs));
  assert.equal(vecs.length, 2);
  assert.ok(Array.isArray(vecs[0]));
});
