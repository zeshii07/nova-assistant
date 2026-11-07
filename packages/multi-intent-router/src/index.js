/**
 * v48.0 — Multi-Intent Router
 *
 * Handles complex customer messages that contain multiple independent intents.
 * Instead of forcing a single "winning adapter", this router decomposes
 * multi-intent messages into parallel execution plans.
 *
 * Example:
 *   "I want to order two pizzas, check whether delivery is available,
 *    and tell me about your current offers."
 *
 * This message contains 3 independent intents:
 *   1. commerce.cart.add (order pizzas)
 *   2. availability.check (check delivery)
 *   3. service.info / business.info (current offers)
 *
 * The Multi-Intent Router:
 *   1. Detects multiple intents from the conversation intelligence output
 *   2. Analyzes dependencies between intents
 *   3. Groups independent intents for parallel execution
 *   4. Sequences dependent intents
 *   5. Returns a unified execution plan
 *
 * Architecture rule: consequential actions always require customer confirmation.
 * The router plans but does not execute — the execution engine does.
 */

/**
 * Multi-Intent Router
 *
 * Takes the conversation intelligence output (which may contain multiple
 * candidate intents) and produces an execution plan.
 */
class MultiIntentRouter {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Analyze the conversation intelligence output and produce an execution plan.
   *
   * @param {object} params - { intelligence, state, tenant }
   * @returns {object} execution plan:
   *   {
   *     primaryIntent: { capabilityId, intent, confidence, entities },
   *     secondaryIntents: [{ capabilityId, intent, confidence, entities }],
   *     executionMode: 'single' | 'sequential' | 'parallel',
   *     plan: [{ step, action, dependsOn, requiresConfirmation }],
   *     combinedReply: boolean,  // should the reply combine all results?
   *   }
   */
  plan({ intelligence, state, tenant }) {
    const candidates = intelligence?.candidates || [];
    const selected = intelligence?.selected;

    if (!candidates.length && !selected) {
      return this._emptyPlan();
    }

    // Separate the primary (winning) intent from secondary candidates
    const primaryIntent = selected
      ? { capabilityId: selected.capabilityId, intent: selected.intent, confidence: selected.confidence, entities: selected.entities || {} }
      : null;

    // Find secondary intents — candidates from DIFFERENT capabilities
    // with reasonable confidence that aren't just the same intent
    const secondaryIntents = [];
    const seenCapabilities = new Set();
    if (primaryIntent) seenCapabilities.add(primaryIntent.capabilityId);

    for (const candidate of candidates) {
      if (!candidate.capabilityId || seenCapabilities.has(candidate.capabilityId)) continue;
      if (candidate.capabilityId === 'assistant') continue; // skip fallback
      if (Number(candidate.confidence || 0) < 0.7) continue;

      // Skip compatible/supporting candidates (e.g., offering.details alongside booking.start)
      if (this._isSupportingCandidate(primaryIntent, candidate)) continue;

      secondaryIntents.push({
        capabilityId: candidate.capabilityId,
        intent: candidate.intent,
        confidence: candidate.confidence,
        entities: candidate.entities || {},
      });
      seenCapabilities.add(candidate.capabilityId);
    }

    // Determine execution mode
    let executionMode = 'single';
    if (secondaryIntents.length === 1) executionMode = 'sequential';
    else if (secondaryIntents.length > 1) executionMode = 'parallel';

    // Build the execution plan
    const plan = this._buildPlan(primaryIntent, secondaryIntents, intelligence);

    // Should the reply combine all results?
    const combinedReply = secondaryIntents.length > 0;

    return {
      primaryIntent,
      secondaryIntents,
      executionMode,
      plan,
      combinedReply,
      hasMultipleIntents: secondaryIntents.length > 0,
    };
  }

  /**
   * Build the execution plan — a sequence of steps with dependencies.
   */
  _buildPlan(primaryIntent, secondaryIntents, intelligence) {
    const steps = [];

    // Step 1: Execute the primary intent
    if (primaryIntent) {
      steps.push({
        step: 1,
        capabilityId: primaryIntent.capabilityId,
        intent: primaryIntent.intent,
        action: this._intentToAction(primaryIntent),
        dependsOn: [],
        requiresConfirmation: this._requiresConfirmation(primaryIntent),
        isConsequential: this._isConsequential(primaryIntent),
      });
    }

    // Steps 2+: Execute secondary intents
    for (let i = 0; i < secondaryIntents.length; i++) {
      const intent = secondaryIntents[i];
      const dependsOn = this._getDependencies(primaryIntent, intent);

      steps.push({
        step: i + 2,
        capabilityId: intent.capabilityId,
        intent: intent.intent,
        action: this._intentToAction(intent),
        dependsOn,
        requiresConfirmation: this._requiresConfirmation(intent),
        isConsequential: this._isConsequential(intent),
      });
    }

    return steps;
  }

  /**
   * Map an intent to an action ID in the Action Registry.
   */
  _intentToAction(intent) {
    const intentToAction = {
      'booking.start': 'booking.create',
      'booking.confirm': 'booking.create',
      'booking.cancel': 'booking.cancel',
      'booking.reschedule': 'booking.reschedule',
      'commerce.confirm': 'commerce.create_order',
      'commerce.cart.clear': null, // not a registered action
      'crm.ask_name': 'crm.create_customer',
    };
    return intentToAction[intent?.intent] || null;
  }

  /**
   * Check if an intent requires customer confirmation before execution.
   * Architecture rule: consequential actions always require confirmation.
   */
  _requiresConfirmation(intent) {
    if (!intent) return false;
    const consequentialIntents = [
      'booking.confirm', 'booking.cancel', 'booking.reschedule',
      'commerce.confirm', 'commerce.cart.clear',
    ];
    return consequentialIntents.includes(intent.intent);
  }

  /**
   * Check if an intent is consequential (has side effects).
   */
  _isConsequential(intent) {
    if (!intent) return false;
    const consequentialCapabilities = ['booking', 'commerce', 'cleaning'];
    const consequentialIntents = ['booking.confirm', 'booking.cancel', 'commerce.confirm', 'commerce.cart.clear'];
    return consequentialCapabilities.includes(intent.capabilityId)
      || consequentialIntents.includes(intent.intent);
  }

  /**
   * Get dependencies — which steps must complete before this one.
   */
  _getDependencies(primaryIntent, secondaryIntent) {
    // If the secondary intent references the primary's output, it depends on it
    // Example: "book a haircut and tell me the price" — the price lookup
    // depends on knowing which service was selected
    if (!primaryIntent) return [];

    const dependentPairs = [
      // If primary is booking.start and secondary is pricing, secondary depends on primary
      { primary: 'booking.start', secondary: 'service.quote', depends: true },
      // If primary is commerce.cart.add and secondary is commerce.cart.view, secondary depends on primary
      { primary: 'commerce.cart.add_request', secondary: 'commerce.cart.view', depends: true },
    ];

    for (const pair of dependentPairs) {
      if (primaryIntent.intent === pair.primary && secondaryIntent.intent === pair.secondary) {
        return [1]; // depends on step 1 (primary)
      }
    }

    // Default: independent — can run in parallel
    return [];
  }

  /**
   * Check if a candidate is a "supporting" candidate that should not be
   * treated as a separate intent (e.g., offering.details alongside booking.start).
   */
  _isSupportingCandidate(primary, candidate) {
    if (!primary || !candidate) return false;
    // Offering details are evidence used by a booking request, not a competing intent
    if (primary.capabilityId === 'booking' && candidate.capabilityId === 'offering') {
      if (/^(?:offering\.(?:details|list|browse))$/.test(candidate.intent || '')) return true;
    }
    // Catalog product interest is evidence for commerce cart add
    if (primary.capabilityId === 'commerce' && candidate.capabilityId === 'catalog') {
      if (/^catalog\.product_interest$/.test(candidate.intent || '')) return true;
    }
    return false;
  }

  _emptyPlan() {
    return {
      primaryIntent: null,
      secondaryIntents: [],
      executionMode: 'single',
      plan: [],
      combinedReply: false,
      hasMultipleIntents: false,
    };
  }
}

module.exports = { MultiIntentRouter };
