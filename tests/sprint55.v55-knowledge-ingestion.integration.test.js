/**
 * Sprint 55 — v55.0 Phase 2 Ingestion Improvements
 *
 * Tests:
 *   AA — Structure-aware chunker (heading+body, lists, tables, sentence split, merge tiny)
 *   AB — Ingestion validation report (fields, language detection, contradictions, blockers)
 *   AC — Source versioning (states, publish, supersedes, effectiveUntil, listVersions)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { structureAwareChunk, splitAtSentences, isListItem, isTableRow, headingLevel } = require('../packages/knowledge/src/structureAwareChunker');
const { buildIngestionReport, detectLanguage } = require('../packages/knowledge-ingestion/src/validators/ingestionReport');
const { KnowledgeSourceRepository, VALID_STATUSES } = require('../packages/knowledge-platform/src/knowledgeSourceRepository');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP AA — Structure-Aware Chunker
// ─────────────────────────────────────────────────────────────────────────────

test('AA1: heading + body stay together as one chunk', () => {
  const text = '# Cancellation Policy\nWe require 24 hours notice for cancellations.';
  const chunks = structureAwareChunk(text, { sourceName: 'policy.md' });
  assert.equal(chunks.length, 1, 'heading + short body = 1 chunk');
  assert.match(chunks[0].text, /Cancellation Policy/);
  assert.match(chunks[0].text, /24 hours notice/);
  assert.equal(chunks[0].heading, 'Cancellation Policy');
});

test('AA2: a 4-tier cancellation policy is NOT split mid-list', () => {
  const text = `# Cancellation Tiers

- More than 24 hours before: no charge
- 6 to 24 hours before: 50% charge
- Less than 6 hours before: full charge
- After team arrival: full charge plus call-out fee`;
  const chunks = structureAwareChunk(text, { sourceName: 'tiers.md', maxChars: 1500 });
  // The whole list must be in ONE chunk — this is the regression the spec calls out.
  assert.equal(chunks.length, 1, `expected 1 chunk, got ${chunks.length}`);
  assert.match(chunks[0].text, /More than 24 hours/);
  assert.match(chunks[0].text, /After team arrival/);
});

test('AA3: a very long list splits at item boundaries, never mid-item', () => {
  const items = Array.from({ length: 20 }, (_, i) => `- Item ${i + 1}: ${'x'.repeat(80)}`);
  const text = `# Big List\n\n${items.join('\n')}`;
  const chunks = structureAwareChunk(text, { sourceName: 'big.md', maxChars: 500 });
  assert.ok(chunks.length > 1, 'long list must split into multiple chunks');
  // No chunk should contain a partial item (text starting mid-line).
  for (const c of chunks) {
    const lines = c.text.split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of lines) {
      assert.match(line, /^- Item \d+/, `list item must be intact, got: ${line.slice(0, 40)}`);
    }
  }
});

test('AA4: markdown table stays together as one chunk', () => {
  const text = `# Pricing Table

| Service | Price |
|---------|-------|
| Standard | $50   |
| Deep     | $100  |`;
  const chunks = structureAwareChunk(text, { sourceName: 'price.md' });
  assert.equal(chunks.length, 1, 'table must be one chunk');
  assert.match(chunks[0].text, /Standard.*\$50/);
  assert.match(chunks[0].text, /Deep.*\$100/);
});

test('AA5: parent heading context carried into every chunk', () => {
  const text = `# Policies

## Cancellation

We require 24 hours notice.

## Refunds

Refunds processed within 5 business days.`;
  const chunks = structureAwareChunk(text, { sourceName: 'policies.md' });
  assert.ok(chunks.length >= 2);
  // Each chunk must carry its parent (## ) heading.
  const cancel = chunks.find(c => c.heading && c.heading.includes('Cancellation'));
  const refund = chunks.find(c => c.heading && c.heading.includes('Refunds'));
  assert.ok(cancel, 'cancellation chunk must exist');
  assert.ok(refund, 'refund chunk must exist');
  assert.match(cancel.text, /24 hours notice/);
  assert.match(refund.text, /5 business days/);
});

test('AA6: long paragraph splits at sentence boundaries, never mid-sentence', () => {
  const longPara = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} goes here.`).join(' ');
  const parts = splitAtSentences(longPara, 100);
  assert.ok(parts.length > 1, 'long paragraph must split');
  for (const p of parts) {
    // Every part must end with a sentence terminator (or be the last partial).
    assert.ok(/[.!?]$/.test(p.trim()), `part must end at sentence boundary: ${p.slice(-30)}`);
  }
});

test('AA7: tiny chunks merge into the previous chunk', () => {
  const text = `# Heading One\n\nLong body paragraph that is long enough to stand on its own as a chunk here.\n\nx`;
  const chunks = structureAwareChunk(text, { sourceName: 'merge.md' });
  // The trailing "x" is below MIN_CHUNK_CHARS (40) and must merge into the previous chunk.
  const lastChunk = chunks[chunks.length - 1];
  assert.match(lastChunk.text, /Long body paragraph/);
  assert.match(lastChunk.text, /x$/, 'tiny chunk merged into previous');
});

test('AA8: per-kind maxChars defaults are respected', () => {
  const text = Array.from({ length: 50 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
  const policyChunks = structureAwareChunk(text, { kind: 'customer_policy', sourceName: 'p' });
  const faqChunks = structureAwareChunk(text, { kind: 'faq', sourceName: 'f' });
  // FAQ chunks (max 500) should be smaller on average than policy chunks (max 1500).
  const policyMax = Math.max(...policyChunks.map(c => c.text.length));
  const faqMax = Math.max(...faqChunks.map(c => c.text.length));
  assert.ok(policyMax > faqMax, `policy chunks should be larger (policyMax=${policyMax}, faqMax=${faqMax})`);
});

test('AA9: sourceLocation line range is tracked', () => {
  const text = `# Heading\n\nFirst paragraph.\n\nSecond paragraph.`;
  const chunks = structureAwareChunk(text, { sourceName: 'loc.md' });
  assert.ok(chunks.length >= 1);
  for (const c of chunks) {
    assert.ok(c.sourceLocation, 'sourceLocation must be present');
    assert.ok(c.sourceLocation.lineStart >= 1, 'lineStart >= 1');
    assert.ok(c.sourceLocation.lineEnd >= c.sourceLocation.lineStart, 'lineEnd >= lineStart');
  }
});

test('AA10: helper functions classify correctly', () => {
  assert.equal(headingLevel('## Heading'), 2);
  assert.equal(headingLevel('Not a heading'), 0);
  assert.ok(isListItem('- bullet'));
  assert.ok(isListItem('1. numbered'));
  assert.ok(!isListItem('regular text'));
  assert.ok(isTableRow('| a | b |'));
  assert.ok(!isTableRow('not a table'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP AB — Ingestion Validation Report
// ─────────────────────────────────────────────────────────────────────────────

test('AB1: validation report has all required fields', () => {
  const report = buildIngestionReport({
    fileName: 'policy.pdf',
    chunks: [{ text: 'We require 24 hours notice for cancellations.' }],
    extractionStatus: 'ok',
  });
  assert.equal(report.fileName, 'policy.pdf');
  assert.equal(report.extractionStatus, 'ok');
  assert.equal(report.chunkCount, 1);
  assert.ok(typeof report.detectedLanguage === 'string');
  assert.ok(typeof report.sanitizedCount === 'number');
  assert.ok(typeof report.internalOnlyCount === 'number');
  assert.ok(typeof report.shortChunkCount === 'number');
  assert.equal(report.duplicateDetected, false);
  assert.ok(Array.isArray(report.contradictions));
  assert.ok(Array.isArray(report.warnings));
  assert.equal(report.publicationStatus, 'draft');
  assert.ok(Array.isArray(report.blockers));
});

test('AB2: language detection identifies English, Urdu, Roman-Urdu', () => {
  assert.equal(detectLanguage('What is your cancellation policy?'), 'en');
  assert.equal(detectLanguage('منسوخی پالیسی کیا ہے؟'), 'ur');
  assert.equal(detectLanguage('mera dog sath aa sakta hai? pets ki permission hai?'), 'roman-urdu');
});

test('AB3: empty extraction fails publication with blocker', () => {
  const report = buildIngestionReport({
    fileName: 'empty.pdf',
    chunks: [],
    extractionStatus: 'failed',
    extractionWarnings: ['PDF had no extractable text.'],
  });
  assert.equal(report.publicationStatus, 'failed');
  assert.ok(report.blockers.includes('extraction_failed'));
  assert.ok(report.warnings.some(w => w.includes('no extractable text')));
});

test('AB4: duplicate content hash detected and blocks auto-publish', () => {
  const report = buildIngestionReport({
    fileName: 'dup.txt',
    chunks: [{ text: 'Some content.' }],
    contentHash: 'abc123',
    existingHashes: ['abc123', 'def456'],
  });
  assert.equal(report.duplicateDetected, true);
  assert.ok(report.blockers.includes('duplicate_source'));
  assert.equal(report.publicationStatus, 'draft');
  assert.ok(report.warnings.some(w => w.includes('already registered')));
});

test('AB5: obvious contradiction detected between two chunks', () => {
  const report = buildIngestionReport({
    fileName: 'policy.md',
    chunks: [
      { text: 'Cancellation requires 24 hours notice.', chunkId: 'c1' },
      { text: 'Cancellation requires 48 hours notice.', chunkId: 'c2' },
    ],
  });
  assert.ok(report.contradictions.length >= 1, 'must detect contradiction');
  const c = report.contradictions[0];
  assert.ok(c.chunkA && c.chunkB);
  assert.notEqual(c.valueA, c.valueB);
});

test('AB6: internal-instruction chunks counted and warned', () => {
  const report = buildIngestionReport({
    fileName: 'notes.md',
    chunks: [
      { text: 'The assistant must never invent a price.', heading: 'Agent instructions' },
      { text: 'We are open 9am to 5pm.' },
    ],
  });
  // The first chunk should be classified as internal_instruction.
  assert.ok(report.internalOnlyCount >= 1, 'internal chunks must be counted');
  assert.ok(report.warnings.some(w => w.includes('internal-instruction')));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP AC — Source Versioning
// ─────────────────────────────────────────────────────────────────────────────

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-knowledge-test-'));
  const tenantsDir = path.join(tmp, 'tenants');
  const tenantId = 'test-tenant';
  fs.mkdirSync(path.join(tenantsDir, tenantId, 'knowledge'), { recursive: true });
  return new KnowledgeSourceRepository({ tenantsDir });
}

test('AC1: all spec lifecycle states are valid', () => {
  const expected = ['draft', 'processing', 'published', 'disabled', 'archived', 'failed'];
  for (const s of expected) {
    assert.ok(VALID_STATUSES.includes(s), `status '${s}' must be valid`);
  }
  // 'active' is the legacy default and remains valid for backward compatibility.
  assert.ok(VALID_STATUSES.includes('active'));
});

test('AC2: invalid status throws', () => {
  const repo = makeRepo();
  const src = repo.upsert('test-tenant', { kind: 'document', title: 'Doc', file: 'documents/doc.txt' });
  assert.throws(() => repo.setStatus('test-tenant', src.id, 'bogus'), /Invalid knowledge source status/);
});

test('AC3: publish promotes draft to published and records approver', () => {
  const repo = makeRepo();
  const src = repo.upsert('test-tenant', { kind: 'document', title: 'Policy', file: 'documents/policy.txt', status: 'draft' });
  const result = repo.publish('test-tenant', src.id, { approvedBy: 'admin@example.com' });
  assert.equal(result.source.status, 'published');
  assert.equal(result.source.approvedBy, 'admin@example.com');
  assert.ok(result.source.effectiveFrom);
});

test('AC4: publish supersedes the previous published version', () => {
  const repo = makeRepo();
  const v1 = repo.upsert('test-tenant', { kind: 'document', title: 'Policy v1', file: 'documents/policy.txt', status: 'published' });
  const v2 = repo.upsert('test-tenant', { kind: 'document', title: 'Policy v2', file: 'documents/policy.txt', status: 'draft' });
  const result = repo.publish('test-tenant', v2.id, { approvedBy: 'admin' });
  assert.ok(result.superseded.includes(v1.id), 'v1 must be superseded');
  const v1After = repo.get('test-tenant', v1.id);
  assert.equal(v1After.status, 'archived', 'previous published version must be archived');
  assert.ok(result.source.supersedes, 'new published source must record supersedes');
});

test('AC5: listPublished returns only published and active sources', () => {
  const repo = makeRepo();
  repo.upsert('test-tenant', { kind: 'document', title: 'Pub', file: 'documents/pub.txt', status: 'published' });
  repo.upsert('test-tenant', { kind: 'document', title: 'Active', file: 'documents/active.txt', status: 'active' });
  repo.upsert('test-tenant', { kind: 'document', title: 'Draft', file: 'documents/draft.txt', status: 'draft' });
  repo.upsert('test-tenant', { kind: 'document', title: 'Archived', file: 'documents/arch.txt', status: 'archived' });
  repo.upsert('test-tenant', { kind: 'document', title: 'Disabled', file: 'documents/dis.txt', status: 'disabled' });
  const pub = repo.listPublished('test-tenant');
  const titles = pub.map(s => s.title).sort();
  assert.deepEqual(titles, ['Active', 'Pub']);
});

test('AC6: version + supersedes + effectiveFrom/Until fields present', () => {
  const repo = makeRepo();
  const src = repo.upsert('test-tenant', {
    kind: 'document', title: 'Time-bound Policy', file: 'documents/tb.txt', status: 'published',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveUntil: '2026-12-31T23:59:59Z',
    approvedBy: 'admin', version: 2, supersedes: 'KS-OLD',
  });
  assert.equal(src.version, 2);
  assert.equal(src.supersedes, 'KS-OLD');
  assert.equal(src.effectiveFrom, '2026-01-01T00:00:00Z');
  assert.equal(src.effectiveUntil, '2026-12-31T23:59:59Z');
  assert.equal(src.approvedBy, 'admin');
});

test('AC7: listVersions walks the supersedes chain', () => {
  const repo = makeRepo();
  const v1 = repo.upsert('test-tenant', { kind: 'document', title: 'v1', file: 'documents/v.txt', status: 'published' });
  const v2 = repo.upsert('test-tenant', { kind: 'document', title: 'v2', file: 'documents/v.txt', status: 'draft', supersedes: v1.id });
  const versions = repo.listVersions('test-tenant', v2.id);
  assert.ok(versions.length >= 2, 'must include current + superseded');
  assert.equal(versions[0].id, v2.id);
  assert.equal(versions[1].id, v1.id);
});
