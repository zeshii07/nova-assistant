/**
 * Builds the immutable context provided to every capability.
 * Capabilities receive only approved services through this object.
 */
function createCapabilityContext(input) {
  if (!input || !input.tenant || !input.message || !input.state) {
    throw new TypeError("Capability context requires tenant, message, and state.");
  }
  return Object.freeze({
    tenant: input.tenant,
    message: input.message,
    state: input.state,
    conversationId: input.conversationId,
    customer: input.customer || { id: input.message.customerId },
    channel: input.message.channel,
    language: input.state.language,
    services: Object.freeze({ ...(input.services || {}) }),
    logger: input.logger,
    intelligence: input.intelligence || null
  });
}
module.exports = { createCapabilityContext };
