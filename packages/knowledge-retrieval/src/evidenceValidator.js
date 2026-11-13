/**
 * v56.0 — Evidence Validator
 *
 * Produces the explicit evidence-validation result required by spec §4 Step 7.
 * Replaces the implicit checks (answerable gate + detectConflict + evidenceComplete)
 * that currently live inside KnowledgeService.retrieve.
 *
 * Output schema (spec §4 Step 7):
 *   {
 *     status: 'verified' | 'incomplete' | 'conflicting' | 'unauthorized' | 'stale' | 'none',
 *     evidence: [{ sourceId, chunkId, version, claim }],
 *     checks: { relevant, complete, authoritative, fresh, conflict, customerSafe }
 *   }
 *
 * Architecture rule (spec §4 Step 7): "Do not rely on a single similarity score
 * to decide whether an answer is safe."
 */

/**
 * Authority tiers (spec §5). Lower number = higher authority.
 */
const AUTHORITY_TIERS = {
  live_transactional: 1,
  business_config: 2,
  approved_tenant_knowledge: 3,
  approved_platform_baseline: 4,
  general_model_knowledge: 5,
};

/**
 * Sensitive topics where contradictions matter most. If two top matches
 * disagree on a fact signature, the evidence is conflicting.
 */
const SENSITIVE_TOPICS = ['refund', 'cancel', 'cancellation', 'parking', 'payment', 'same-day', 'same_day', 'deposit'];

/**
 * Extract a "fact signature" from a chunk: the numbers + yes/no values it asserts.
 * Two chunks with different signatures on the same sensitive topic conflict.
 */
function factSignature(text) {
  const t = String(text || '');
  const numbers = (t.match(/\b\d+(?:\.\d+)?\s*(?:hour|hours|hr|day|days|%|percent|usd|pkr|rs|\$|minutes?|mins?)?\b/gi) || [])
    .map(s => s.toLowerCase().trim());
  const yesNo = (t.match(/\b(yes|no|allowed|not allowed|permitted|not permitted|free|paid)\b/gi) || [])
    .map(s => s.toLowerCase().trim());
  return [...numbers, ...yesNo].sort().join('|');
}

class EvidenceValidator {
  constructor({ authorityTiers = AUTHORITY_TIERS, sensitiveTopics = SENSITIVE_TOPICS, logger = null } = {}) {
    this.authorityTiers = authorityTiers;
    this.sensitiveTopics = sensitiveTopics;
    this.logger = logger;
  }

  /**
   * Validate a retrieval result.
   *
   * @param {object} params
   *   - query: the (rewritten) query
   *   - matches: array of retrieval matches (each with text, sourceId, sourceKind,
   *     sourceStatus, sourceVersion, customerSafe, priority, effectiveFrom/Until, hybridScore)
   *   - intent: the classified intent (drives which checks are strict)
   *   - now: override for current time (testing)
   * @returns {object} validation result
   */
  validate({ query, matches = [], intent = null, now = new Date() } = {}) {
    const q = String(query || '').toLowerCase();

    // Relevance: at least one match has non-trivial score.
    const relevantMatches = matches.filter(m => Number(m.hybridScore || m.score || 0) >= 0.1);
    const relevant = relevantMatches.length > 0;

    // Authority: matches come from approved sources (not disabled/archived/expired).
    const authoritativeMatches = relevantMatches.filter(m => {
      const status = m.sourceStatus || 'active';
      if (!['active', 'published'].includes(status)) return false;
      // Freshness: effectiveUntil not in the past.
      if (m.effectiveUntil) {
        const until = new Date(m.effectiveUntil);
        if (!isNaN(until.getTime()) && until < now) return false;
      }
      // effectiveFrom not in the future.
      if (m.effectiveFrom) {
        const from = new Date(m.effectiveFrom);
        if (!isNaN(from.getTime()) && from > now) return false;
      }
      return true;
    });
    const authoritative = authoritativeMatches.length > 0;

    // Freshness: all authoritative matches are current.
    const fresh = authoritative; // already enforced above

    // Customer-safe: at least one match is customerSafe.
    const customerSafeMatches = authoritativeMatches.filter(m => m.customerSafe !== false);
    const customerSafe = customerSafeMatches.length > 0;

    // Completeness: does the evidence actually contain the requested fact?
    // This is the 60-line rule set's essence — adapted from KnowledgeService.evidenceComplete.
    const complete = this._checkCompleteness(q, customerSafeMatches, intent);

    // Conflict: do two top matches on a sensitive topic disagree?
    const conflict = this._checkConflict(customerSafeMatches);

    // Determine status.
    let status;
    if (!relevant) status = 'none';
    else if (conflict) status = 'conflicting';
    else if (!authoritative || !fresh) status = 'stale';
    else if (!customerSafe) status = 'unauthorized';
    else if (!complete) status = 'incomplete';
    else status = 'verified';

    return {
      status,
      evidence: customerSafeMatches.slice(0, 5).map(m => ({
        sourceId: m.sourceId || null,
        chunkId: m.id || m.chunkId || null,
        version: m.sourceVersion || m.sourceRevision || 1,
        claim: String(m.text || '').slice(0, 200),
        authorityTier: this._authorityTierFor(m),
      })),
      checks: { relevant, complete, authoritative, fresh, conflict, customerSafe },
    };
  }

  _authorityTierFor(match) {
    const kind = match.sourceKind || 'document';
    if (kind === 'business_profile') return this.authorityTiers.business_config;
    if (kind === 'faq_collection') return this.authorityTiers.approved_tenant_knowledge;
    if (kind === 'document') return this.authorityTiers.approved_tenant_knowledge;
    return this.authorityTiers.approved_platform_baseline;
  }

  _checkCompleteness(query, matches, intent) {
    if (!matches.length) return false;
    // For count questions, the chunk must contain a literal number.
    if (/\bhow many\b/.test(query)) {
      return matches.some(m => /\b\d+\b/.test(m.text || ''));
    }
    // For cancellation/reschedule, the chunk must mention the topic + (notice/before/within/charge/fee).
    if (/\bcancel|reschedul/.test(query)) {
      return matches.some(m => /\b(notice|before|within|charge|fee|hour|day)\b/i.test(m.text || ''));
    }
    // For pricing, RAG evidence is NEVER complete — pricing must come from pricingService.
    if (intent === 'pricing_inquiry') return false;
    // For availability, RAG evidence is NEVER complete — availability must come from availabilityService.
    if (intent === 'availability_inquiry') return false;
    // Default: at least one match has non-trivial text length.
    return matches.some(m => (m.text || '').trim().length >= 12);
  }

  _checkConflict(matches) {
    if (matches.length < 2) return false;
    // Find matches that discuss a sensitive topic.
    const sensitive = matches.filter(m => {
      const t = String(m.text || '').toLowerCase();
      return this.sensitiveTopics.some(s => t.includes(s));
    });
    if (sensitive.length < 2) return false;
    // Compare fact signatures of the top 2 sensitive matches.
    const sigs = new Set();
    for (const m of sensitive.slice(0, 4)) {
      const sig = factSignature(m.text);
      if (sig) sigs.add(sig);
    }
    return sigs.size > 1;
  }
}

module.exports = { EvidenceValidator, AUTHORITY_TIERS, SENSITIVE_TOPICS, factSignature };
