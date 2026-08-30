/** Chooses one winning capability per message. Now with intent trace logging
 *  AND optional ML hybrid routing (v16.0).
 *
 *  When an MlIntentClassifier is injected via the constructor, the router
 *  runs the ML classifier alongside the regex-based canHandle() loop and
 *  combines the two signals via the HybridRouter:
 *
 *    - If regex confidence is high (>=0.85), regex wins (ML is informational only).
 *    - If regex and ML agree on the same capability, regex confidence is boosted.
 *    - If regex and ML disagree AND ML confidence >0.7, regex is demoted.
 *    - If regex returns no candidates and ML predicts a capability >0.6,
 *      the ML prediction is logged for the execution engine to use as a hint.
 *
 *  The ML classifier NEVER replaces the regex router — it only modulates
 *  the existing candidate ranking. This preserves all v13.0+ deterministic
 *  routing behavior while adding ML as a tie-breaker / sanity check.
 */
class CapabilityRouter {
  constructor({ registry, permissionService, logger, mlClassifier = null, hybridRouter = null } = {}) {
    this.registry = registry;
    this.permissionService = permissionService;
    this.logger = logger;
    this.mlClassifier = mlClassifier || null;
    this.hybridRouter = hybridRouter || null;
  }

  async resolve(context) {
    // === Run ML classifier upfront (parallel to regex loop) ===
    // The result is stored on context.intelligence.mlPrediction so adapters
    // and the execution engine can read it later.
    let mlPrediction = null;
    if (this.mlClassifier) {
      try {
        mlPrediction = this.mlClassifier.classify(context.message?.text || '', {
          tenant: context.tenant,
          recentTurns: context.state?.context?.recentTurns || [],
          tenantMatches: context.intelligence?.semanticRouter?.tenantMatches || [],
        });
        // Attach to intelligence for downstream consumers
        if (context.intelligence) {
          context.intelligence.mlPrediction = mlPrediction;
        }
        if (this.logger) {
          this.logger.debug('ml_intent_classifier.predicted', {
            text: context.message?.text?.substring(0, 80),
            topIntent: mlPrediction.topIntent?.intentId || null,
            confidence: mlPrediction.topIntent?.confidence || 0,
            margin: mlPrediction.topIntent?.margin || 0,
            capabilityId: mlPrediction.topIntent?.capabilityId || null,
            timingMs: mlPrediction.timingMs,
          });
        }
      } catch (error) {
        this.logger?.error('ml_intent_classifier.failed', { error: error.message });
        mlPrediction = null;
      }
    }

    const forcedId = context.intelligence?.forcedCapabilityId;
    if (forcedId) {
      const forced = this.registry.get(forcedId);
      if (forced && this.permissionService.canUse(context.tenant, forced.manifest)) {
        // Log forced routing decision
        if (this.logger) {
          this.logger.info("capability.routing_trace", {
            text: context.message?.text?.substring(0, 80),
            winner: forcedId,
            forced: true,
            confidence: Number(context.intelligence.selected?.confidence || 1),
            reason: context.intelligence.selected?.reason || "conversation_intelligence",
            mlTopIntent: mlPrediction?.topIntent?.intentId || null,
            mlConfidence: mlPrediction?.topIntent?.confidence || 0,
            mlCapabilityId: mlPrediction?.topIntent?.capabilityId || null,
          });
        }
        return { capability: forced, confidence: Number(context.intelligence.selected?.confidence || 1), priority: Number(forced.manifest.priority || 0), reason: context.intelligence.selected?.reason || "conversation_intelligence" };
      }
    }
    const candidates = [];
    for (const capability of this.registry.list()) {
      if (!this.permissionService.canUse(context.tenant, capability.manifest)) continue;
      try {
        const score = await capability.canHandle(context);
        const confidence = Number(score?.confidence || 0); const priority = Number(capability.manifest.priority || 0);
        if (confidence > 0) candidates.push({ capability, confidence, priority, reason: score?.reason });
      } catch (error) { this.logger?.error("capability.can_handle_failed", { capabilityId: capability.id, error: error.message }); }
    }

    // === ML Hybrid Routing (v16.0) ===
    // Apply boost/demote to regex candidates based on ML prediction.
    let hybridAdjustments = [];
    let finalCandidates = candidates;
    if (this.hybridRouter && mlPrediction?.used) {
      const hybridResult = this.hybridRouter.combine(candidates, mlPrediction, {
        tenant: context.tenant,
        message: context.message,
        state: context.state,
      });
      finalCandidates = hybridResult.candidates;
      hybridAdjustments = hybridResult.adjustments;
    } else {
      finalCandidates.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority || a.capability.id.localeCompare(b.capability.id));
    }

    // Intent trace: log the full candidate list so developers can see WHY
    // a particular capability won. This eliminates the need for manual
    // curl debugging when routing goes wrong.
    if (finalCandidates.length > 0 && this.logger) {
      const trace = finalCandidates.slice(0, 5).map((c, i) => ({
        rank: i + 1,
        capabilityId: c.capability.id,
        confidence: Number(c.confidence.toFixed(4)),
        priority: c.priority,
        reason: c.reason,
        winner: i === 0,
        mlAdjusted: Boolean(c.mlAdjusted),
        mlAdjustment: c.mlAdjustment ? Number(c.mlAdjustment.toFixed(4)) : 0,
      }));
      this.logger.info("capability.routing_trace", {
        text: context.message?.text?.substring(0, 80),
        winner: finalCandidates[0].capability.id,
        candidates: trace,
        mlTopIntent: mlPrediction?.topIntent?.intentId || null,
        mlConfidence: mlPrediction?.topIntent?.confidence ? Number(mlPrediction.topIntent.confidence.toFixed(4)) : 0,
        mlCapabilityId: mlPrediction?.topIntent?.capabilityId || null,
        hybridAdjustments: hybridAdjustments.length,
      });
    }

    return finalCandidates[0] || null;
  }
}
module.exports = { CapabilityRouter };
