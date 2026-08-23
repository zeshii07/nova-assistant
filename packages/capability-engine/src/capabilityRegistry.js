/** Stores validated capability instances and manages their lifecycle. */
class CapabilityRegistry {
  constructor({ logger } = {}) { this.logger = logger; this.capabilities = new Map(); }
  async register(capability) {
    if (!capability?.id || typeof capability.canHandle !== "function" || typeof capability.execute !== "function") throw new TypeError("Invalid capability instance.");
    if (this.capabilities.has(capability.id)) throw new Error(`Capability already registered: ${capability.id}`);
    await capability.initialize(); this.capabilities.set(capability.id, capability); this.logger?.info("capability.registered", { capabilityId: capability.id }); return this;
  }
  get(id) { return this.capabilities.get(id) || null; }
  list() { return [...this.capabilities.values()]; }
  async unregister(id) { const item = this.get(id); if (!item) return false; await item.shutdown(); this.capabilities.delete(id); return true; }
  async shutdownAll() { for (const capability of this.list()) await this.unregister(capability.id); }
}
module.exports = { CapabilityRegistry };
