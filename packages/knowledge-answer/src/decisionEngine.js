/**
 * v57.0 — Decision Engine
 *
 * Maps an evidence-validation result to one of four explicit outcomes:
 *   - answer     — evidence is complete, current, authorized, consistent
 *   - clarify    — a required customer detail is missing or request is ambiguous
 *   - escalate   — needs human authority, or evidence is unresolved/unavailable
 *   - refuse     — request is unsafe, unauthorized, or outside permitted behaviour
 *
 * Spec reference: §4 Step 8, §2.3 (principles 6, 7)
 *
 * Architecture rule (spec §2.3.6): "Abstention is a feature: preserve safe
 * abstention when evidence is insufficient." (spec §2.3.7): "Clarification is
 * different from abstention: ask for missing customer details when that can
 * resolve the request."
 */

const OUTCOMES = {
  ANSWER: 'answer',
  CLARIFY: 'clarify',
  ESCALATE: 'escalate',
  REFUSE: 'refuse',
};

class DecisionEngine {
  constructor({ refusePatterns = null, logger = null } = {}) {
    this.logger = logger;
    // Patterns that trigger a refuse outcome (unsafe/unauthorized).
    this.refusePatterns = refusePatterns || [
      /\b(password|credential|api key|secret|token|private key)\b/i,
      /\b(employee|staff|user|admin)\s*(database|table|record|list)\b/i,
      /\b(hack|exploit|bypass|inject)\b/i,
      /\b(other tenant|other customer)\b/i,
    ];
  }

  /**
   * Decide the outcome.
   *
   * @param {object} params
   *   - question: original customer question
   *   - intent: classified intent
   *   - missingFields: from IntentRouter (triggers clarify)
   *   - evidenceValidation: { status, checks } from EvidenceValidator
   * @returns {{ outcome, reason, clarifyField? }}
   */
  decide({ question, intent, missingFields = [], evidenceValidation = null } = {}) {
    const q = String(question || '');

    // 1. Refuse: unsafe or unauthorized.
    for (const pattern of this.refusePatterns) {
      if (pattern.test(q)) {
        return { outcome: OUTCOMES.REFUSE, reason: 'request_unsafe_or_unauthorized' };
      }
    }

    // 2. Clarify: a required customer detail is missing.
    if (missingFields && missingFields.length > 0) {
      return {
        outcome: OUTCOMES.CLARIFY,
        reason: 'missing_required_field',
        clarifyField: missingFields[0],
        missingFields,
      };
    }

    // 3. Use the evidence-validation status to decide.
    const status = evidenceValidation?.status || 'none';
    const checks = evidenceValidation?.checks || {};

    if (status === 'verified') {
      return { outcome: OUTCOMES.ANSWER, reason: 'evidence_verified' };
    }
    if (status === 'conflicting') {
      // Two authoritative sources disagree → escalate to a human.
      return { outcome: OUTCOMES.ESCALATE, reason: 'evidence_conflict_unresolved' };
    }
    if (status === 'none' || status === 'incomplete') {
      // Evidence is insufficient. If the intent is structured (pricing/availability),
      // the structured system may still answer. If knowledge, abstain → escalate.
      if (intent === 'pricing_inquiry' || intent === 'availability_inquiry' || intent === 'order_inquiry') {
        return { outcome: OUTCOMES.ESCALATE, reason: 'structured_system_required' };
      }
      return { outcome: OUTCOMES.ESCALATE, reason: `evidence_${status}` };
    }
    if (status === 'stale') {
      return { outcome: OUTCOMES.ESCALATE, reason: 'evidence_stale_or_expired' };
    }
    if (status === 'unauthorized') {
      return { outcome: OUTCOMES.REFUSE, reason: 'evidence_not_customer_safe' };
    }

    // Default: escalate (safe).
    return { outcome: OUTCOMES.ESCALATE, reason: 'unresolved' };
  }
}

module.exports = { DecisionEngine, OUTCOMES };
