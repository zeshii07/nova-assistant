/**
 * Creates Nova's universal semantic response model.
 * Capabilities provide meaning; the Humanization Platform provides wording.
 */
function createResponseModel(input = {}) {
  if (!input.intent || typeof input.intent !== "string") {
    throw new TypeError("ResponseModel.intent is required.");
  }
  return {
    version: input.version || "1.0",
    intent: input.intent.toUpperCase(),
    payload: isObject(input.payload) ? input.payload : {},
    actions: Array.isArray(input.actions) ? input.actions : [],
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    metadata: isObject(input.metadata) ? input.metadata : {},
    flags: isObject(input.flags) ? input.flags : {}
  };
}
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
module.exports = { createResponseModel };
