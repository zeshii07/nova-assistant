const { ValidationError, NotFoundError } = require("../../shared/src/errors");
class ChannelRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) {
    if (!adapter || !adapter.id || typeof adapter.normalizeIncoming !== "function" || typeof adapter.formatOutgoing !== "function") {
      throw new ValidationError("Channel adapter requires id, normalizeIncoming(), and formatOutgoing()");
    }
    this.adapters.set(adapter.id, adapter);
    return this;
  }
  get(channelId) { const adapter = this.adapters.get(channelId); if (!adapter) throw new NotFoundError(`Channel '${channelId}' is not registered`); return adapter; }
}
module.exports = { ChannelRegistry };
