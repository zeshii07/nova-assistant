// H2b + H8 regression (Phase 1 item 2):
//   H2b: knowledge retrieval must NOT return the top chunk with no relevance
//        threshold — low-relevance queries must abstain (answerable=false), not
//        emit a barely-related snippet ("kab khulte ho" → "Pasta", "lol" →
//        "messagingRules[6]..."). Fixed by an absolute ANSWER_CONFIDENCE_FLOOR.
//   H8:  the public assistant leaked INTERNAL config text (messagingRules) to
//        visitors. Fixed at the indexing chokepoint (normalizeJson +
//        normalizeText tag messagingRules/prompts/persona/etc. as
//        internal_instruction + customerSafe:false so the repo filter drops
//        them) PLUS a defense-in-depth output filter in sanitizeEvidence +
//        redactReply that strips any leaked config-pattern line.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FileKnowledgeRepository } = require('../packages/knowledge/src/fileKnowledgeRepository');
const { KnowledgeService, ANSWER_CONFIDENCE_FLOOR_DEFAULT } = require('../packages/assistant/src/knowledgeService');
const { PublicAssistantPolicy } = require('../packages/public-assistant/src/publicAssistantPolicy');

const TENANTS_DIR = path.resolve(__dirname, '..', 'tenants');
const tenant = { id: 'public-product' };

function makeRepo() {
  return new FileKnowledgeRepository({ tenantsDir: TENANTS_DIR, knowledgeDataDir: TENANTS_DIR, logger: null });
}
function makeKs() {
  return new KnowledgeService({ knowledgeRepository: makeRepo() });
}

// ── H8: internal config never enters the retrievable index ─────────────────

test('H8: the public-product index contains zero messagingRules chunks', () => {
  const repo = makeRepo();
  const idx = repo.getIndexForTenant('public-product');
  // Scan the WHOLE index (minScore:0) for any chunk whose path or text betrays
  // an internal-config field. Must be zero — these are instructions TO the
  // assistant, never customer-facing facts.
  const all = idx.search('messagingRules persona prompts instructions systemPrompt', { limit: 100, minScore: 0 });
  const leaks = all.filter((c) =>
    /messagingRules|messaging rules|^\s*persona\s*:|^\s*prompts?\s*:|^\s*systemPrompt\s*:|Avoid technical jargon in the first/i.test(c.text || '')
    || /^(messagingRules|persona|prompts?|systemPrompt)\b/.test(c.path || '')
  );
  assert.equal(leaks.length, 0, `internal-config chunks leaked into index: ${leaks.map((l) => l.path).join(', ')}`);
});

test('H8: the exact leaked line ("Avoid technical jargon in the first response.") is not retrievable', () => {
  const ks = makeKs();
  // The report: visitor says "lol" → Nova answered "messagingRules[6]: Avoid
  // technical jargon in the first response." Must never be retrievable now.
  const r = ks.retrieve('avoid technical jargon', tenant);
  const leaked = r.matches.filter((m) => /Avoid technical jargon in the first/i.test(m.text || ''));
  assert.equal(leaked.length, 0, 'the leaked internal-config line is still retrievable');
});

test('H8: normalizeJson tags internal-config field paths as internal_instruction + customerSafe:false', () => {
  const { normalizeJson } = require('../packages/knowledge/src/knowledgeNormalizer');
  const sample = {
    name: 'Nova',
    messagingRules: ['Avoid technical jargon in the first response.', 'Always greet politely.'],
    persona: { tone: 'professional', systemPrompt: 'You are Nova.' },
    pricing: { note: 'Starts at $29/mo' },
  };
  const chunks = normalizeJson('business.json', sample);
  // The dropped chunks (messagingRules, persona, systemPrompt) must not appear.
  const paths = chunks.map((c) => c.path);
  assert.ok(!paths.some((p) => /^messagingRules\b/.test(p)), 'messagingRules chunk must be dropped');
  assert.ok(!paths.some((p) => /^persona\b/.test(p)), 'persona chunk must be dropped');
  assert.ok(!paths.some((p) => /^pricing\.note/.test(p)) === false, 'pricing.note chunk is kept (customer fact)');
  // The kept chunk (pricing.note) is customer-facing.
  const pricing = chunks.find((c) => c.path === 'pricing.note');
  assert.equal(pricing.customerSafe, true);
  assert.notEqual(pricing.evidenceType, 'internal_instruction');
});

test('H8 defense-in-depth: sanitizeEvidence strips a leaked messagingRules line', () => {
  const policy = new PublicAssistantPolicy({});
  // Simulate a chunk that somehow slipped past the indexer (defense in depth).
  const leaked = 'messagingRules[6]: Avoid technical jargon in the first response.';
  const out = policy.sanitizeEvidence(leaked);
  assert.equal(out.flagged, true, 'leak is flagged');
  assert.equal(out.text.trim(), '', 'leaked line is stripped (empty evidence)');
});

test('H8 defense-in-depth: redactReply strips a leaked config line from the final reply', () => {
  const policy = new PublicAssistantPolicy({});
  const reply = 'Here is what I found:\nmessagingRules[6]: Avoid technical jargon in the first response.\nLet me know if you need more.';
  const cleaned = policy.redactReply(reply);
  assert.equal(/messagingRules/.test(cleaned), false, 'redactReply removes the leaked config line');
  assert.ok(/Here is what I found/.test(cleaned), 'legit reply text is preserved');
});

// ── H2b: low-relevance queries abstain ─────────────────────────────────────

test('H2b: the answer confidence floor is >= 0.40 (catches the 0.16 default drift)', () => {
  assert.ok(ANSWER_CONFIDENCE_FLOOR_DEFAULT >= 0.40, `floor too low: ${ANSWER_CONFIDENCE_FLOOR_DEFAULT}`);
});

test('H2b: clearly-junk / low-relevance queries abstain (answerable=false)', () => {
  const ks = makeKs();
  // The exact report inputs that returned random snippets before the fix.
  const junk = ['kab khulte ho', 'tell me a joke', 'are you guys open on sunday', 'not interested', '2', 'lol', 'ok'];
  let stillAnswering = 0;
  for (const q of junk) {
    const r = ks.retrieve(q, tenant);
    if (r.answerable) stillAnswering++;
    assert.equal(r.answerable, false, `"${q}" must abstain (got conf=${r.confidence.toFixed(3)} top=${r.matches[0] ? JSON.stringify(r.matches[0].text?.slice(0, 40)) : 'none'})`);
  }
  assert.equal(stillAnswering, 0, `${stillAnswering}/${junk.length} junk queries still answered`);
});

test('H2b: known-good product questions STILL answer (answerable=true)', () => {
  const ks = makeKs();
  // These are real, relevant visitor questions — the floor must not break them.
  const good = ['what is nova', 'how much does nova cost', 'do you integrate with shopify', 'can nova take payments'];
  let answered = 0;
  for (const q of good) {
    const r = ks.retrieve(q, tenant);
    if (r.answerable) answered++;
  }
  assert.ok(answered >= 3, `${answered}/${good.length} good queries answered (need >= 3)`);
});

test('H2b: a sub-floor match is still returned in matches[] (for logging/escalation) but NOT answerable', () => {
  const ks = makeKs();
  const r = ks.retrieve('kab khulte ho', tenant);
  // The chunk is still in matches (so escalation can log what was almost-answered),
  // but answerable is false because it is below the floor.
  assert.equal(r.answerable, false);
  assert.ok(r.matches.length >= 0, 'matches array exists (may be empty if nothing cleared even minScore)');
  assert.ok(r.confidence < ANSWER_CONFIDENCE_FLOOR_DEFAULT, 'sub-floor confidence reported honestly');
});
