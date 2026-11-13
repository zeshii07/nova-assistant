/**
 * Sprint 57 — v57.0 Phase 4 Answer Intelligence
 *
 * Tests:
 *   CC — AnswerComposer (structured fact injection, extractive fallback, LLM path, claims)
 *   CD — ResponseValidator (uncited claim, missing evidence, unsupported value, internal leak, addition)
 *   CE — DecisionEngine (answer/clarify/escalate/refuse outcomes)
 *   CF — CitationBuilder (attach, summarize)
 *   CG — AbstentionHandler (clarify templates, abstain replies, multilingual)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { AnswerComposer } = require('../packages/knowledge-answer/src/answerComposer');
const { ResponseValidator } = require('../packages/knowledge-answer/src/responseValidator');
const { DecisionEngine, OUTCOMES } = require('../packages/knowledge-answer/src/decisionEngine');
const { CitationBuilder } = require('../packages/knowledge-answer/src/citationBuilder');
const { AbstentionHandler } = require('../packages/knowledge-answer/src/abstentionHandler');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CC — AnswerComposer
// ─────────────────────────────────────────────────────────────────────────────

test('CC1: structured fact is injected verbatim (never generated)', async () => {
  const composer = new AnswerComposer();
  const result = await composer.compose({
    question: 'how much does deep cleaning cost?',
    intent: 'pricing_inquiry',
    evidence: [],
    structuredFact: { label: 'Price', value: '$50', evidenceIds: ['chunk_price'] },
  });
  assert.match(result.answer, /\$50/);
  assert.equal(result.status, 'grounded');
  assert.equal(result.claims[0].evidenceIds[0], 'chunk_price');
});

test('CC2: no evidence → abstain (caller decides clarify/escalate)', async () => {
  const composer = new AnswerComposer();
  const result = await composer.compose({ question: 'what?', intent: 'faq', evidence: [] });
  assert.equal(result.answer, null);
  assert.equal(result.status, 'abstain');
});

test('CC3: extractive fallback returns top chunk text when no LLM available', async () => {
  const composer = new AnswerComposer();
  const result = await composer.compose({
    question: 'what is your cancellation policy?',
    intent: 'policy_inquiry',
    evidence: [{ sourceId: 'KS-1', chunkId: 'chunk_1', version: 4, claim: 'Cancellation requires 24 hours notice.' }],
  });
  assert.match(result.answer, /24 hours notice/);
  assert.equal(result.status, 'grounded');
  assert.equal(result.claims[0].evidenceIds[0], 'chunk_1');
});

test('CC4: LLM path composes with citations when llmRouter provided', async () => {
  const fakeLlm = {
    complete: async ({ prompt }) => ({ text: 'Our cancellation policy requires 24 hours notice. [E1]' }),
  };
  const composer = new AnswerComposer({ llmRouter: fakeLlm });
  const result = await composer.compose({
    question: 'what is your cancellation policy?',
    intent: 'policy_inquiry',
    evidence: [{ sourceId: 'KS-1', chunkId: 'chunk_1', version: 4, claim: 'Cancellation requires 24 hours notice.' }],
  });
  assert.match(result.answer, /24 hours notice/);
  assert.ok(result.claims.length >= 1);
  assert.equal(result.claims[0].evidenceIds[0], 'chunk_1');
});

test('CC5: LLM failure falls back to extractive answer', async () => {
  const failingLlm = { complete: async () => { throw new Error('LLM down'); } };
  const composer = new AnswerComposer({ llmRouter: failingLlm });
  const result = await composer.compose({
    question: 'what is your cancellation policy?',
    intent: 'policy_inquiry',
    evidence: [{ sourceId: 'KS-1', chunkId: 'chunk_1', version: 1, claim: '24 hours notice required.' }],
  });
  assert.match(result.answer, /24 hours/);
  assert.equal(result.status, 'grounded');
});

test('CC6: business tone is applied to structured fact', async () => {
  const composer = new AnswerComposer();
  const formal = await composer.compose({
    question: 'how much?', intent: 'pricing_inquiry', evidence: [],
    businessTone: 'formal', structuredFact: { label: 'price', value: '$50' },
  });
  assert.match(formal.answer, /Price: \$50/);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CD — ResponseValidator
// ─────────────────────────────────────────────────────────────────────────────

test('CD1: valid claim with cited evidence passes', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'Cancellation requires 24 hours notice.',
    claims: [{ text: 'Cancellation requires 24 hours notice.', evidenceIds: ['chunk_1'] }],
    evidence: [{ chunkId: 'chunk_1', claim: 'Cancellation requires 24 hours notice.', customerSafe: true }],
  });
  assert.equal(result.valid, true);
});

test('CD2: uncited claim is rejected', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'We are open 9am to 5pm.',
    claims: [{ text: 'We are open 9am to 5pm.', evidenceIds: [] }],
    evidence: [],
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(vi => vi.type === 'uncited_claim'));
});

test('CD3: claim citing missing evidence is rejected', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'x',
    claims: [{ text: 'Cancellation requires 48 hours notice.', evidenceIds: ['nonexistent_chunk'] }],
    evidence: [{ chunkId: 'chunk_1', claim: 'Cancellation requires 24 hours notice.' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(vi => vi.type === 'missing_evidence'));
});

test('CD4: invented money value is rejected', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'Deep cleaning costs $99.',
    claims: [{ text: 'Deep cleaning costs $99.', evidenceIds: ['chunk_1'] }],
    evidence: [{ chunkId: 'chunk_1', claim: 'Deep cleaning is available.', customerSafe: true }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(vi => vi.type === 'unsupported_value' && vi.kind === 'money'));
});

test('CD5: internal-instruction evidence leak is rejected', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'The assistant must never invent a price.',
    claims: [{ text: 'The assistant must never invent a price.', evidenceIds: ['chunk_internal'] }],
    evidence: [{ chunkId: 'chunk_internal', claim: 'The assistant must never invent a price.', customerSafe: false }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(vi => vi.type === 'internal_evidence_exposed'));
});

test('CD6: value in answer but not in any claim is an unsupported addition', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'The price is $50.',
    claims: [],  // no claims, but answer contains a money value
    evidence: [],
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(vi => vi.type === 'unsupported_addition'));
});

test('CD7: supported duration value passes', () => {
  const v = new ResponseValidator();
  const result = v.validate({
    answer: 'Cancellation requires 24 hours notice.',
    claims: [{ text: 'Cancellation requires 24 hours notice.', evidenceIds: ['chunk_1'] }],
    evidence: [{ chunkId: 'chunk_1', claim: 'Cancellation requires 24 hours notice.', customerSafe: true }],
  });
  assert.equal(result.valid, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CE — DecisionEngine
// ─────────────────────────────────────────────────────────────────────────────

test('CE1: verified evidence → answer', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what is your cancellation policy?',
    intent: 'policy_inquiry',
    missingFields: [],
    evidenceValidation: { status: 'verified', checks: {} },
  });
  assert.equal(r.outcome, OUTCOMES.ANSWER);
});

test('CE2: missing field → clarify', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'how much is cleaning?',
    intent: 'pricing_inquiry',
    missingFields: ['service'],
    evidenceValidation: { status: 'verified', checks: {} },
  });
  assert.equal(r.outcome, OUTCOMES.CLARIFY);
  assert.equal(r.clarifyField, 'service');
});

test('CE3: conflicting evidence → escalate', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what is your cancellation policy?',
    intent: 'policy_inquiry',
    missingFields: [],
    evidenceValidation: { status: 'conflicting', checks: { conflict: true } },
  });
  assert.equal(r.outcome, OUTCOMES.ESCALATE);
});

test('CE4: no evidence for knowledge question → escalate', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what is the CEO home address?',
    intent: 'faq',
    missingFields: [],
    evidenceValidation: { status: 'none', checks: {} },
  });
  assert.equal(r.outcome, OUTCOMES.ESCALATE);
});

test('CE5: unsafe request → refuse', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what is your employee database password?',
    intent: 'unknown',
    missingFields: [],
    evidenceValidation: null,
  });
  assert.equal(r.outcome, OUTCOMES.REFUSE);
});

test('CE6: unauthorized evidence → refuse', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what are your internal escalation rules?',
    intent: 'faq',
    missingFields: [],
    evidenceValidation: { status: 'unauthorized', checks: { customerSafe: false } },
  });
  assert.equal(r.outcome, OUTCOMES.REFUSE);
});

test('CE7: stale evidence → escalate', () => {
  const d = new DecisionEngine();
  const r = d.decide({
    question: 'what was your 2020 policy?',
    intent: 'policy_inquiry',
    missingFields: [],
    evidenceValidation: { status: 'stale', checks: { fresh: false } },
  });
  assert.equal(r.outcome, OUTCOMES.ESCALATE);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CF — CitationBuilder
// ─────────────────────────────────────────────────────────────────────────────

test('CF1: attach citations to claims', () => {
  const cb = new CitationBuilder();
  const claims = [{ text: '24 hours notice.', evidenceIds: ['chunk_1'] }];
  const evidence = [{ sourceId: 'KS-1', chunkId: 'chunk_1', version: 4 }];
  const result = cb.attach(claims, evidence);
  assert.equal(result[0].sourceIds[0], 'KS-1');
  assert.equal(result[0].versions[0], 4);
});

test('CF2: summarize for audit logging (no customer text)', () => {
  const cb = new CitationBuilder();
  const claims = [{ text: 'secret', evidenceIds: ['c1'], sourceIds: ['s1'], versions: [2] }];
  const summary = cb.summarize(claims);
  assert.equal(summary[0].claimIndex, 0);
  assert.deepEqual(summary[0].evidenceIds, ['c1']);
  assert.deepEqual(summary[0].sourceIds, ['s1']);
  // Summary must NOT include the claim text (audit-safe).
  assert.equal(summary[0].text, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CG — AbstentionHandler
// ─────────────────────────────────────────────────────────────────────────────

test('CG1: clarify asks for missing service field', () => {
  const h = new AbstentionHandler();
  const q = h.clarify('service', { tenant: { domain: 'cleaning' } });
  assert.match(q, /standard cleaning or deep cleaning/i);
});

test('CG2: clarify asks for missing orderId', () => {
  const h = new AbstentionHandler();
  const q = h.clarify('orderId');
  assert.match(q, /order or booking ID/i);
});

test('CG3: clarify returns null for unknown field', () => {
  const h = new AbstentionHandler();
  assert.equal(h.clarify('unknown_field'), null);
});

test('CG4: abstain reply in English', () => {
  const h = new AbstentionHandler();
  const reply = h.abstain('missing', 'en');
  assert.match(reply, /approved business knowledge/i);
});

test('CG5: abstain reply in Urdu', () => {
  const h = new AbstentionHandler();
  const reply = h.abstain('missing', 'ur');
  assert.ok(/[\u0600-\u06FF]/.test(reply), 'Urdu reply must contain Urdu script');
});

test('CG6: abstain reply in Roman-Urdu', () => {
  const h = new AbstentionHandler();
  const reply = h.abstain('missing', 'roman-urdu');
  assert.match(reply, /approved business knowledge/i);
});

test('CG7: missingKnowledge() preserves the existing contract', () => {
  const h = new AbstentionHandler();
  const reply = h.missingKnowledge('en');
  assert.match(reply, /approved business knowledge/i);
});
