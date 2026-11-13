/**
 * Sprint 59 — v59.0 Phase 6 Admin Tools & Quality Evaluation
 *
 * Tests:
 *   EE — AnalyticsEngine.getKnowledgeDashboard (knowledge.* events aggregation)
 *   EF — Evaluation corpus (shape, multilingual coverage, outcome categories)
 *   EG — runEvaluationCorpus (pass/fail metrics, latency, accuracy rates)
 *   EH — Admin endpoint contracts (chunks, playground, test, analytics, evaluate, publish)
 *       (exercised via the underlying package APIs the endpoints delegate to)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { AnalyticsEngine } = require('../packages/analytics-engine/src');
const { KNOWLEDGE_EVALUATION_CORPUS, EVALUATION_METRICS, runEvaluationCorpus } = require('../tests/fixtures/knowledge-evaluation-corpus');
const { IntentRouter } = require('../packages/knowledge-retrieval/src/intentRouter');
const { QueryRewriter } = require('../packages/knowledge-retrieval/src/queryRewriter');
const { EvidenceValidator } = require('../packages/knowledge-retrieval/src/evidenceValidator');
const { AnswerComposer } = require('../packages/knowledge-answer/src/answerComposer');
const { DecisionEngine, OUTCOMES } = require('../packages/knowledge-answer/src/decisionEngine');
const { AbstentionHandler } = require('../packages/knowledge-answer/src/abstentionHandler');
const { KnowledgeSourceRepository } = require('../packages/knowledge-platform/src/knowledgeSourceRepository');
const { FileKnowledgeRepository } = require('../packages/knowledge/src/fileKnowledgeRepository');

const TENANTS_DIR = path.resolve(__dirname, '..', 'tenants');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP EE — AnalyticsEngine.getKnowledgeDashboard
// ─────────────────────────────────────────────────────────────────────────────

test('EE1: empty dashboard returns zero rates', () => {
  const engine = new AnalyticsEngine();
  const d = engine.getKnowledgeDashboard('t1');
  assert.equal(d.retrievalVolume, 0);
  assert.equal(d.answerableRate, 0);
  assert.equal(d.abstainRate, 0);
  assert.equal(d.conflictRate, 0);
});

test('EE2: knowledge.retrieve events aggregate into retrieval volume + answerable rate', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.retrieve', intent: 'policy_inquiry', matchCount: 3, bestScore: 0.7, answerable: true, conflict: false, latencyMs: 50 });
  engine.record('t1', { type: 'knowledge.retrieve', intent: 'faq', matchCount: 0, bestScore: 0, answerable: false, conflict: false, latencyMs: 30 });
  const d = engine.getKnowledgeDashboard('t1');
  assert.equal(d.retrievalVolume, 2);
  assert.equal(d.answerableRate, 0.5);
  assert.equal(d.abstainRate, 0.5);
});

test('EE3: knowledge.conflict events drive conflict rate', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.retrieve', answerable: true, latencyMs: 50 });
  engine.record('t1', { type: 'knowledge.conflict' });
  const d = engine.getKnowledgeDashboard('t1');
  assert.equal(d.conflictRate, 1);
});

test('EE4: top retrieved sources ranked by frequency', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.retrieve', answerable: true, matches: [{ sourceId: 's1' }, { sourceId: 's1' }, { sourceId: 's2' }] });
  const d = engine.getKnowledgeDashboard('t1');
  assert.ok(d.topSources.length >= 2);
  assert.equal(d.topSources[0][0], 's1');
  assert.ok(d.topSources[0][1] >= d.topSources[1][1]);
});

test('EE5: failed ingestion jobs counted', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.ingestion.started' });
  engine.record('t1', { type: 'knowledge.ingestion.failed' });
  engine.record('t1', { type: 'knowledge.ingestion.failed' });
  const d = engine.getKnowledgeDashboard('t1');
  assert.equal(d.failedIngestionJobs, 2);
  assert.equal(d.ingestionStarted, 1);
});

test('EE6: p95 latency computed from retrieve events', () => {
  const engine = new AnalyticsEngine();
  for (let i = 1; i <= 20; i++) {
    engine.record('t1', { type: 'knowledge.retrieve', answerable: true, latencyMs: i * 10 });
  }
  const d = engine.getKnowledgeDashboard('t1');
  assert.ok(d.p95LatencyMs >= 100, `p95 should be ~190ms, got ${d.p95LatencyMs}`);
});

test('EE7: dashboard is tenant-isolated', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.retrieve', answerable: true, latencyMs: 50 });
  engine.record('t2', { type: 'knowledge.retrieve', answerable: false, latencyMs: 50 });
  const d1 = engine.getKnowledgeDashboard('t1');
  const d2 = engine.getKnowledgeDashboard('t2');
  assert.equal(d1.retrievalVolume, 1);
  assert.equal(d2.retrievalVolume, 1);
  assert.equal(d1.answerableRate, 1);
  assert.equal(d2.answerableRate, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP EF — Evaluation corpus
// ─────────────────────────────────────────────────────────────────────────────

test('EF1: corpus has cases for every expected outcome', () => {
  const outcomes = new Set(KNOWLEDGE_EVALUATION_CORPUS.map(c => c.expectedOutcome));
  assert.ok(outcomes.has('answer'));
  assert.ok(outcomes.has('clarify'));
  assert.ok(outcomes.has('escalate'));
  assert.ok(outcomes.has('refuse'));
});

test('EF2: corpus has multilingual coverage (en + roman-urdu + ur)', () => {
  const langs = new Set(KNOWLEDGE_EVALUATION_CORPUS.map(c => c.language || 'en'));
  assert.ok(langs.has('en'));
  assert.ok(langs.has('roman-urdu'));
  assert.ok(langs.has('ur'));
});

test('EF3: corpus has security cases (prompt injection, cross-tenant)', () => {
  const security = KNOWLEDGE_EVALUATION_CORPUS.filter(c => c.id.startsWith('sec-'));
  assert.ok(security.length >= 3);
  assert.ok(security.every(c => c.expectedOutcome === 'refuse'));
});

test('EF4: corpus has conflict detection case', () => {
  const conflict = KNOWLEDGE_EVALUATION_CORPUS.find(c => c.conflictScenario);
  assert.ok(conflict);
  assert.equal(conflict.expectedOutcome, 'escalate');
});

test('EF5: corpus has clarify cases with missingField', () => {
  const clarify = KNOWLEDGE_EVALUATION_CORPUS.filter(c => c.expectedOutcome === 'clarify');
  assert.ok(clarify.length >= 2);
  assert.ok(clarify.every(c => c.missingField));
});

test('EF6: EVALUATION_METRICS includes all spec §14 metrics', () => {
  const required = ['recallAt5', 'mrr', 'ndcg', 'answerCorrectness', 'groundedness', 'abstentionAccuracy', 'clarificationAccuracy', 'conflictDetection', 'p95LatencyMs', 'tenantIsolation'];
  for (const m of required) {
    assert.ok(EVALUATION_METRICS.includes(m), `missing metric: ${m}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP EG — runEvaluationCorpus
// ─────────────────────────────────────────────────────────────────────────────

test('EG1: runEvaluationCorpus produces metrics with pass/fail counts', async () => {
  const evaluator = async (tc) => ({ outcome: tc.expectedOutcome, intent: tc.expectedIntent, matches: [], tenantIsolationOk: true });
  const report = await runEvaluationCorpus(evaluator);
  assert.equal(report.metrics.total, KNOWLEDGE_EVALUATION_CORPUS.length);
  assert.equal(report.metrics.passed, report.metrics.total);
  assert.equal(report.metrics.failed, 0);
  assert.equal(report.metrics.passRate, 1);
});

test('EG2: runEvaluationCorpus detects failures (wrong outcome)', async () => {
  const evaluator = async (tc) => ({ outcome: 'escalate', intent: tc.expectedIntent, matches: [] }); // always escalate
  const report = await runEvaluationCorpus(evaluator);
  assert.ok(report.metrics.failed > 0, 'must detect outcome mismatches');
  assert.ok(report.metrics.passRate < 1);
});

test('EG3: runEvaluationCorpus records latency per case', async () => {
  const evaluator = async (tc) => { await new Promise(r => setTimeout(r, 5)); return { outcome: tc.expectedOutcome, matches: [] }; };
  const report = await runEvaluationCorpus(evaluator);
  assert.ok(report.metrics.p95LatencyMs >= 5);
  assert.ok(report.cases.every(c => c.latencyMs >= 0));
});

test('EG4: runEvaluationCorpus computes accuracy rates by outcome', async () => {
  const evaluator = async (tc) => ({ outcome: tc.expectedOutcome, matches: [] });
  const report = await runEvaluationCorpus(evaluator);
  assert.equal(report.metrics.abstentionAccuracy, 1); // all escalate cases correct
  assert.equal(report.metrics.clarificationAccuracy, 1);
  assert.equal(report.metrics.refuseAccuracy, 1);
});

test('EG5: runEvaluationCorpus supports domain filter', async () => {
  const evaluator = async (tc) => ({ outcome: tc.expectedOutcome, matches: [] });
  const report = await runEvaluationCorpus(evaluator, { filterDomain: 'cleaning' });
  assert.ok(report.metrics.total < KNOWLEDGE_EVALUATION_CORPUS.length);
  assert.ok(report.cases.every(c => c.domain === 'cleaning' || c.domain === 'any'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP EH — Admin endpoint contracts (via underlying packages)
// ─────────────────────────────────────────────────────────────────────────────
// The endpoints delegate to these packages, so we exercise the same logic
// directly to verify the contracts the endpoints expose.

test('EH1: Chunk Explorer contract — list chunks per source', () => {
  const repo = new FileKnowledgeRepository({ tenantsDir: TENANTS_DIR });
  const index = repo.getIndexForTenant('hotel-demo');
  const docs = index.docs || [];
  // Group by sourceId (the contract the /chunks endpoint returns).
  const bySource = new Map();
  for (const d of docs) {
    const sid = d.sourceId || 'unknown';
    if (!bySource.has(sid)) bySource.set(sid, []);
    bySource.get(sid).push({
      chunkId: d.id, sourceId: d.sourceId, text: d.text, heading: d.path,
      knowledgeType: d.evidenceType, customerSafe: d.customerSafe,
    });
  }
  assert.ok(bySource.size > 0, 'hotel-demo must have at least one source with chunks');
  for (const [sid, chunks] of bySource) {
    assert.ok(chunks.every(c => c.chunkId));
    assert.ok(chunks.every(c => typeof c.text === 'string'));
  }
});

test('EH2: Retrieval Playground contract — full trace shape', () => {
  const router = new IntentRouter();
  const rewriter = new QueryRewriter();
  const repo = new FileKnowledgeRepository({ tenantsDir: TENANTS_DIR });
  const query = 'what is your cancellation policy?';
  const classified = router.classify(query);
  const rewritten = rewriter.rewrite(query);
  const matches = repo.search('hotel-demo', rewritten.expanded, { limit: 6, minScore: 0.05, minSemantic: 0.05 });
  const validator = new EvidenceValidator();
  const validation = validator.validate({ query: rewritten.normalized, matches, intent: classified.intent });
  // The /playground endpoint returns this trace shape.
  assert.ok(classified.intent);
  assert.ok(rewritten.original && rewritten.normalized && rewritten.expanded);
  assert.ok(Array.isArray(matches));
  assert.ok(validation.status);
  assert.ok(validation.checks);
});

test('EH3: Answer Testing contract — verdict + answer + abstentionReason', async () => {
  const router = new IntentRouter();
  const rewriter = new QueryRewriter();
  const validator = new EvidenceValidator();
  const composer = new AnswerComposer();
  const decision = new DecisionEngine();
  const abstain = new AbstentionHandler();
  const repo = new FileKnowledgeRepository({ tenantsDir: TENANTS_DIR });
  const query = 'what is your cancellation policy?';
  const classified = router.classify(query);
  const rewritten = rewriter.rewrite(query);
  const matches = repo.search('hotel-demo', rewritten.expanded, { limit: 6, minScore: 0.05, minSemantic: 0.05 });
  const validation = validator.validate({ query: rewritten.normalized, matches, intent: classified.intent });
  const d = decision.decide({ question: query, intent: classified.intent, missingFields: classified.missingFields, evidenceValidation: validation });
  let answer = null, abstentionReason = null;
  if (d.outcome === OUTCOMES.ANSWER) {
    const composed = await composer.compose({ question: query, intent: classified.intent, evidence: validation.evidence, language: 'en' });
    answer = composed.answer;
  } else if (d.outcome === OUTCOMES.CLARIFY) {
    answer = abstain.clarify(d.clarifyField);
    abstentionReason = 'clarification_required';
  } else if (d.outcome === OUTCOMES.ESCALATE) {
    answer = abstain.abstain('escalate', 'en');
    abstentionReason = d.reason;
  } else if (d.outcome === OUTCOMES.REFUSE) {
    answer = abstain.abstain('refuse', 'en');
    abstentionReason = d.reason;
  }
  // The /test endpoint returns this shape.
  assert.ok(['answer', 'clarify', 'escalate', 'refuse'].includes(d.outcome));
  assert.ok(typeof answer === 'string' || answer === null);
  if (d.outcome !== OUTCOMES.ANSWER) assert.ok(abstentionReason);
});

test('EH4: Publish endpoint contract — promote draft to published', () => {
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pub-test-'));
  const tenantsDir = path.join(tmp, 'tenants');
  fs.mkdirSync(path.join(tenantsDir, 't1', 'knowledge'), { recursive: true });
  const repo = new KnowledgeSourceRepository({ tenantsDir });
  const src = repo.upsert('t1', { kind: 'document', title: 'Doc', file: 'documents/doc.txt', status: 'draft' });
  const result = repo.publish('t1', src.id, { approvedBy: 'admin@test' });
  assert.equal(result.source.status, 'published');
  assert.equal(result.source.approvedBy, 'admin@test');
  assert.ok(result.source.effectiveFrom);
});

test('EH5: Analytics endpoint contract — dashboard shape', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'knowledge.retrieve', answerable: true, latencyMs: 50, matches: [{ sourceId: 's1' }] });
  const d = engine.getKnowledgeDashboard('t1');
  // The /analytics endpoint wraps this in { ok: true, analytics: d }.
  assert.equal(d.tenantId, 't1');
  assert.ok(typeof d.retrievalVolume === 'number');
  assert.ok(typeof d.answerableRate === 'number');
  assert.ok(typeof d.p95LatencyMs === 'number');
  assert.ok(Array.isArray(d.topSources));
  assert.ok(d.generatedAt);
});
