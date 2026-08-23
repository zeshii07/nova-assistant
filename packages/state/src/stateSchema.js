function createInitialState({ tenantId, conversationId, channel, customerId, language = "english" }) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    tenantId,
    conversationId,
    channel,
    customerId,
    language,
    mode: "chatting",
    activePlugin: null,
    pendingQuestion: null,
    context: {},
    capabilityState: {},
    lastIntent: null,
    createdAt: now,
    updatedAt: now
  };
}
function applyStatePatch(state, patch = {}) { return { ...state, ...patch, updatedAt: new Date().toISOString() }; }
module.exports = { createInitialState, applyStatePatch };
