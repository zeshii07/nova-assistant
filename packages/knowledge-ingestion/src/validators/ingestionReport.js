/**
 * v55.0 — Ingestion Validation Report
 *
 * After a document is ingested, this module produces a structured report
 * describing what happened during extraction and chunking. The report is
 * returned to the admin UI so the operator can verify quality before
 * publishing the source.
 *
 * Spec reference: §7.3 Content validation report
 *
 * Fields returned:
 *   fileName, extractionStatus, detectedLanguage, chunkCount,
 *   sanitizedCount, internalOnlyCount, shortChunkCount,
 *   duplicateDetected, contradictions, warnings, publicationStatus
 */

const { sanitizeCustomerEvidence, inferEvidenceType } = require('../../../knowledge/src/knowledgeNormalizer');

const MIN_USEFUL_CHUNK_CHARS = 40;

/**
 * Detect the dominant language of a text. Very lightweight: looks at script
 * ratios. Returns 'en', 'ur', 'roman-urdu', or 'mixed'.
 */
function detectLanguage(text) {
  const t = String(text || '');
  if (!t.trim()) return 'unknown';
  const urduScript = (t.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  if (urduScript > latin && urduScript >= 10) return 'ur';
  // Roman-Urdu heuristic: common Roman-Urdu words among Latin text.
  const romanUrduHits = (t.toLowerCase().match(/\b(hai|hain|nahi|nahin|kya|kia|aap|ap|ka|ki|ke|mujhe|mujhy|kar|karna|bhai|acha|theek|kaisa|kaisi|kyun|kyu)\b/g) || []).length;
  if (latin > 20 && romanUrduHits >= 3) return 'roman-urdu';
  if (latin > urduScript) return 'en';
  return 'mixed';
}

/**
 * Build a validation report from the chunks produced by the structure-aware
 * chunker (or the legacy normalizer).
 *
 * @param {object} params
 *   - fileName: original uploaded file name
 *   - chunks: array of { text, evidenceType, customerSafe, ... }
 *   - extractionStatus: 'ok' | 'partial' | 'failed'
 *   - extractionWarnings: array of strings (e.g., 'PDF had no extractable text in 3 pages')
 *   - contentHash: for duplicate detection against existing sources
 *   - existingHashes: array of hashes already registered for this tenant
 *   - publicationStatus: 'draft' | 'published' (default 'draft')
 */
function buildIngestionReport({
  fileName,
  chunks = [],
  extractionStatus = 'ok',
  extractionWarnings = [],
  contentHash = null,
  existingHashes = [],
  publicationStatus = 'draft',
} = {}) {
  const allText = chunks.map(c => c.text || '').join('\n');
  const detectedLanguage = detectLanguage(allText);

  let sanitizedCount = 0;
  let internalOnlyCount = 0;
  let shortChunkCount = 0;

  for (const chunk of chunks) {
    const raw = String(chunk.text || '');
    const evidenceType = chunk.evidenceType || inferEvidenceType(raw, chunk.heading || '');
    if (evidenceType === 'internal_instruction') internalOnlyCount += 1;
    // "Sanitized" = the customer-safe version differs from the raw (internal
    // instructions were stripped). We approximate by re-running sanitize.
    const sanitized = sanitizeCustomerEvidence(raw);
    if (sanitized && sanitized !== raw) sanitizedCount += 1;
    if (raw.trim().length < MIN_USEFUL_CHUNK_CHARS) shortChunkCount += 1;
  }

  const duplicateDetected = Boolean(contentHash) && existingHashes.includes(contentHash);

  // Contradiction detection is a Phase 3+ concern (KnowledgeService.detectConflict).
  // Here we surface only the most obvious case: two chunks with the same
  // sensitive keyword (cancellation, refund, parking) that disagree on a number.
  const contradictions = detectObviousContradictions(chunks);

  const warnings = [...extractionWarnings];
  if (shortChunkCount > chunks.length * 0.3) {
    warnings.push(`${shortChunkCount} of ${chunks.length} chunks are very short (< ${MIN_USEFUL_CHUNK_CHARS} chars); consider tightening the source document structure.`);
  }
  if (internalOnlyCount > 0) {
    warnings.push(`${internalOnlyCount} chunk(s) were classified as internal-instruction and will not be shown to customers.`);
  }
  if (duplicateDetected) {
    warnings.push('A source with the same content hash is already registered; the existing source will be reused.');
  }

  // Auto-fail publication if extraction failed or produced zero chunks.
  let effectivePublicationStatus = publicationStatus;
  const blockers = [];
  if (extractionStatus === 'failed') {
    blockers.push('extraction_failed');
    effectivePublicationStatus = 'failed';
  } else if (chunks.length === 0) {
    blockers.push('no_chunks_produced');
    effectivePublicationStatus = 'failed';
  } else if (duplicateDetected) {
    blockers.push('duplicate_source');
    effectivePublicationStatus = 'draft';
  }

  return {
    fileName,
    extractionStatus,
    detectedLanguage,
    chunkCount: chunks.length,
    sanitizedCount,
    internalOnlyCount,
    shortChunkCount,
    duplicateDetected,
    contradictions,
    warnings,
    publicationStatus: effectivePublicationStatus,
    blockers,
    contentHash,
  };
}

/**
 * Obvious contradiction detector: find pairs of chunks that mention a sensitive
 * keyword (cancellation/refund/parking) AND disagree on a number.
 * This is a heuristic; the real conflict detector is KnowledgeService.detectConflict.
 */
function detectObviousContradictions(chunks) {
  const sensitive = /\b(cancellation|cancel|refund|parking|deposit)\b/i;
  const numberPattern = /\b(\d+)\s*(hour|hours|hr|day|days|%|percent|usd|pkr|rs|\$)\b/i;
  const candidates = chunks.filter(c => sensitive.test(c.text || '') && numberPattern.test(c.text || ''));
  const contradictions = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i].text || '';
      const b = candidates[j].text || '';
      const na = (a.match(numberPattern) || [])[1];
      const nb = (b.match(numberPattern) || [])[1];
      if (na && nb && na !== nb) {
        contradictions.push({
          chunkA: candidates[i].chunkId || i,
          chunkB: candidates[j].chunkId || j,
          keyword: (a.match(sensitive) || [])[0],
          valueA: na,
          valueB: nb,
        });
      }
    }
  }
  return contradictions;
}

module.exports = { buildIngestionReport, detectLanguage, MIN_USEFUL_CHUNK_CHARS };
