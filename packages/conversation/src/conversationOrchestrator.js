const { createConversationId } = require("../../shared/src/ids");
const { createInitialState, applyStatePatch } = require("../../state/src/stateSchema");

/**
 * Compatibility facade.
 * Sprint 3 production code injects ExecutionEngine. The legacy constructor is
 * retained so Sprint 1 integration behavior remains verifiable during migration.
 */
class ConversationOrchestrator {
  constructor(options) {
    if (options.executionEngine) {
      this.executionEngine = options.executionEngine;
      return;
    }
    Object.assign(this, options);
  }

  async process(message) {
    if (this.executionEngine) return this.executionEngine.process(message);
    const tenantId = message.tenantId || this.defaultTenantId;
    const tenant = this.tenantRepository.getById(tenantId);
    const conversationId = createConversationId(tenantId, message.channel, message.customerId);
    let state = await this.stateRepository.get(conversationId);
    if (!state) state = createInitialState({ tenantId, conversationId, channel: message.channel, customerId: message.customerId, language: tenant.defaultLanguage });
    const context = { tenant, message, state, conversationId, logger: this.logger.child({ tenantId, conversationId }) };
    const plugin = await this.pluginManager.resolve(context);
    if (!plugin) return { conversationId, reply: "No enabled capability could handle this message." };
    const result = await plugin.execute(context);
    state = applyStatePatch(state, { ...(result.statePatch || {}), context: { ...state.context, ...(result.statePatch?.context || {}), lastMessage: message.text } });
    await this.stateRepository.save(state);
    return { conversationId, reply: result.reply, state };
  }
}
module.exports = { ConversationOrchestrator };
