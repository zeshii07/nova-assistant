/**
 * Creates a normalized capability result.
 * All capabilities must return this shape so the execution engine can process
 * responses without knowing capability-specific details.
 */
function createCapabilityResult(input = {}) {
  return {
    handled: input.handled !== false,
    confidence: Number.isFinite(input.confidence) ? input.confidence : 1,
    reply: typeof input.reply === "string" ? input.reply : "",
    actions: Array.isArray(input.actions) ? input.actions : [],
    events: Array.isArray(input.events) ? input.events : [],
    statePatch: input.statePatch && typeof input.statePatch === "object" ? input.statePatch : {},
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    responseModel: input.responseModel && typeof input.responseModel === "object" ? input.responseModel : null
  };
}
module.exports = { createCapabilityResult };
