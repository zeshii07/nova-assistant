/**
 * v57.0 — Response Validator
 *
 * Verifies that every factual claim in a composed answer is supported by
 * the cited evidence. Rejects unsupported additions. Ensures internal-only
 * evidence is not exposed.
 *
 * Spec reference: §12, §4 Step 9
 *
 * Validation steps (spec §12):
 *   1. Split or identify factual claims.
 *   2. Check each business-specific claim against approved evidence.
 *   3. Check amounts, dates, quantities, and conditions exactly.
 *   4. Reject unsupported additions.
 *   5. Ensure internal-only evidence is not exposed.
 *   6. Return a validation result and reason.
 */

/**
 * Sensitive value patterns: numbers, money, dates, durations. These MUST
 * appear verbatim in the cited evidence; an LLM that invents them is rejected.
 */
const VALUE_PATTERNS = [
  // Money: $50, $50.00, 50 USD, 50 pkr, Rs 50, Rs. 50. The \$ branch has no
  // leading \b because $ is not a word character.
  { kind: 'money', regex: /(?:\$|rs\.?)\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:usd|pkr|rs)\b/i },
  { kind: 'percent', regex: /\b\d+(?:\.\d+)?\s?%/ },
  { kind: 'duration', regex: /\b\d+\s?(?:hour|hours|hr|day|days|minute|minutes|min|mins)\b/i },
  { kind: 'count', regex: /\b\d+\s?(?:cleaners?|rooms?|staff|guests?|people)\b/i },
  { kind: 'date', regex: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i },
];

class ResponseValidator {
  constructor({ valuePatterns = VALUE_PATTERNS, logger = null } = {}) {
    this.valuePatterns = valuePatterns;
    this.logger = logger;
  }

  /**
   * Validate a composed answer against its cited evidence.
   *
   * @param {object} params
   *   - answer: the composed answer text
   *   - claims: array of { text, evidenceIds } from the composer
   *   - evidence: array of { sourceId, chunkId, version, claim, customerSafe }
   * @returns {object} { valid, violations[], reason }
   */
  validate({ answer, claims = [], evidence = [] } = {}) {
    const violations = [];
    const evidenceByChunkId = new Map();
    for (const e of evidence) {
      if (e.chunkId) evidenceByChunkId.set(e.chunkId, e);
    }

    // 1. Every claim must cite at least one evidenceId.
    for (const claim of claims) {
      if (!claim.evidenceIds || claim.evidenceIds.length === 0) {
        violations.push({ type: 'uncited_claim', claim: claim.text, reason: 'Claim has no evidence citation.' });
        continue;
      }
      // 2. The cited evidence must exist.
      const cited = claim.evidenceIds.map(id => evidenceByChunkId.get(id)).filter(Boolean);
      if (cited.length === 0) {
        violations.push({ type: 'missing_evidence', claim: claim.text, evidenceIds: claim.evidenceIds, reason: 'Cited evidence not found in approved set.' });
        continue;
      }
      // 3. Sensitive values in the claim must appear verbatim in cited evidence.
      for (const { kind, regex } of this.valuePatterns) {
        const claimValues = String(claim.text || '').match(new RegExp(regex.source, 'gi')) || [];
        for (const cv of claimValues) {
          const supported = cited.some(e => regex.test(String(e.claim || '')) &&
            String(e.claim || '').toLowerCase().includes(cv.toLowerCase()));
          if (!supported) {
            violations.push({ type: 'unsupported_value', kind, value: cv, claim: claim.text, reason: `${kind} '${cv}' not found in cited evidence.` });
          }
        }
      }
      // 4. Internal-only evidence must not be exposed.
      for (const e of cited) {
        if (e.customerSafe === false) {
          violations.push({ type: 'internal_evidence_exposed', chunkId: e.chunkId, reason: 'Internal-instruction evidence was exposed in the answer.' });
        }
      }
    }

    // 5. Check for values in the raw answer that are not in any claim (LLM added facts).
    if (answer) {
      for (const { kind, regex } of this.valuePatterns) {
        const answerValues = String(answer).match(new RegExp(regex.source, 'gi')) || [];
        const claimValues = new Set(
          claims.flatMap(c => (String(c.text || '').match(new RegExp(regex.source, 'gi')) || []).map(v => v.toLowerCase()))
        );
        for (const av of answerValues) {
          if (!claimValues.has(av.toLowerCase())) {
            // This value is in the answer but not in any cited claim → unsupported addition.
            violations.push({ type: 'unsupported_addition', kind, value: av, reason: `${kind} '${av}' appears in answer but is not in any cited claim.` });
          }
        }
      }
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      reason: valid ? 'ok' : violations[0].reason,
    };
  }
}

module.exports = { ResponseValidator, VALUE_PATTERNS };
