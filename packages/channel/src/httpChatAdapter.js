const { ValidationError } = require("../../shared/src/errors");
class HttpChatAdapter {
  constructor() { this.id = "http"; }
  normalizeIncoming(payload) {
    if (!payload || !payload.customerId || !payload.text) throw new ValidationError("customerId and text are required");
    return {
      channel: this.id,
      customerId: String(payload.customerId),
      tenantId: payload.tenantId ? String(payload.tenantId) : null,
      messageId: payload.messageId ? String(payload.messageId) : null,
      text: String(payload.text),
      metadata: payload.metadata || {}
    };
  }
  formatOutgoing(result) { return { ok: true, conversationId: result.conversationId, reply: result.reply }; }
}
module.exports = { HttpChatAdapter };
