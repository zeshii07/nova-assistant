class ConversationAdapterRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) { if (!adapter?.capabilityId || typeof adapter.analyze !== 'function') throw new TypeError('Invalid conversation adapter.'); this.adapters.set(adapter.capabilityId, adapter); return this; }
  get(id) { return this.adapters.get(id) || null; }
  list() { return [...this.adapters.values()]; }
}
module.exports = { ConversationAdapterRegistry };
