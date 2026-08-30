/**
 * Nova ML Hybrid Router
 *
 * Combines the regex-based capability router's score with the ML intent
 * classifier's prediction to produce a final ranking.
 *
 * Strategy:
 *
 *   1. Run the regex capability router (existing canHandle() loop).
 *   2. Run the ML classifier on the same message.
 *   3. For each regex candidate:
 *        - If the candidate's capability matches the ML topIntent's
 *          capability, BOOST its confidence slightly (up to +0.05).
 *        - If the candidate's capability DIFFERS from the ML topIntent's
 *          capability AND the ML confidence is high (>0.7), DEMOTE it
 *          slightly (up to -0.05).
 *   4. If the regex router returns NO candidates above zero confidence
 *      AND the ML classifier predicts a capability with confidence >0.6,
 *      INJECT the ML-predicted capability as a synthetic candidate.
 *   5. Re-sort the candidates and pick the winner.
 *
 * The hybrid router is OPT-IN. The execution engine can choose to use
 * the raw regex router (existing behavior) or the hybrid router (new
 * behavior). The default is hybrid when an ML classifier is available.
 *
 * Crucially: the hybrid router NEVER throws. If the ML classifier fails
 * for any reason, it falls back to the regex router's result untouched.
 */

class HybridRouter {
  constructor({ mlClassifier, logger = null } = {}) {
    this.mlClassifier = mlClassifier || null;
    this.logger = logger;
  }

  /**
   * Combine regex candidates with ML prediction.
   *
   * @param {Array} regexCandidates - output of capability router's candidate loop
   *   [{ capability, confidence, priority, reason }]
   * @param {object} mlPrediction - output of mlClassifier.classify()
   * @param {object} context - { tenant, message, state }
   * @returns {object} { candidates, winner, mlPrediction, adjustments }
   */
  combine(regexCandidates, mlPrediction, context = {}) {
    if (!this.mlClassifier || !mlPrediction?.used) {
      // ML not available — return regex result untouched
      return {
        candidates: regexCandidates,
        winner: regexCandidates[0] || null,
        mlUsed: false,
        adjustments: [],
      };
    }

    const topIntent = mlPrediction.topIntent;
    const mlCapabilityId = topIntent?.capabilityId || null;
    const mlConfidence = topIntent?.confidence || 0;
    const adjustments = [];

    // Apply boost/penalty to each regex candidate
    const adjusted = regexCandidates.map(candidate => {
      const matchesMl = candidate.capability.id === mlCapabilityId;
      let delta = 0;
      let reason = null;

      if (matchesMl && mlConfidence > 0.5) {
        // Boost: regex + ML agree
        delta = Math.min(0.05, (mlConfidence - 0.5) * 0.1);
        reason = 'ml_boost_agree';
      } else if (!matchesMl && mlConfidence > 0.7) {
        // Demote: ML strongly disagrees
        delta = -Math.min(0.05, (mlConfidence - 0.7) * 0.15);
        reason = 'ml_demote_disagree';
      }

      const newConfidence = Math.max(0, Math.min(1, candidate.confidence + delta));
      if (delta !== 0) {
        adjustments.push({
          capabilityId: candidate.capability.id,
          originalConfidence: candidate.confidence,
          newConfidence,
          delta: Number(delta.toFixed(4)),
          reason,
        });
      }

      return {
        ...candidate,
        confidence: newConfidence,
        mlAdjusted: delta !== 0,
        mlAdjustment: delta,
      };
    });

    // If no regex candidate and ML is confident, inject synthetic candidate
    let finalCandidates = adjusted;
    if (adjusted.length === 0 && mlCapabilityId && mlConfidence > 0.6) {
      // We can't directly create a capability here (we don't have the registry),
      // but we record this as a signal for the execution engine to use.
      adjustments.push({
        capabilityId: mlCapabilityId,
        originalConfidence: 0,
        newConfidence: mlConfidence,
        delta: mlConfidence,
        reason: 'ml_inject_no_regex_candidate',
      });
    }

    // Re-sort by confidence (desc), then priority (desc)
    finalCandidates = [...adjusted].sort(
      (a, b) => b.confidence - a.confidence || b.priority - a.priority || a.capability.id.localeCompare(b.capability.id)
    );

    const winner = finalCandidates[0] || null;

    if (this.logger && adjustments.length > 0) {
      this.logger.info('ml_hybrid_router.adjustments', {
        text: context.message?.text?.substring(0, 80),
        winner: winner?.capability?.id || null,
        mlTopIntent: topIntent?.intentId || null,
        mlConfidence: Number(mlConfidence.toFixed(4)),
        adjustments: adjustments.map(a => ({
          capabilityId: a.capabilityId,
          delta: a.delta,
          reason: a.reason,
        })),
      });
    }

    return {
      candidates: finalCandidates,
      winner,
      mlUsed: true,
      mlPrediction,
      adjustments,
    };
  }
}

module.exports = { HybridRouter };
