const { createMemoryRecord } = require("../../memory-sdk/src/memoryRecord");

/**
 * Tenant-safe memory API. Capabilities use a scoped facade and cannot choose
 * another tenant or capability namespace.
 */
class MemoryService {
  constructor({ repository, permissionService, eventBus, logger }) {
    Object.assign(this, { repository, permissionService, eventBus, logger });
  }

  scope({ tenant, capabilityId, customerId, conversationId }) {
    const base = { tenantId: tenant.id, namespace: capabilityId, customerId, conversationId };
    const requirePermission = (action) => {
      const method = action === "read" ? "canRead" : action === "write" ? "canWrite" : "canDelete";
      if (!this.permissionService[method](tenant, capabilityId)) throw new Error(`Memory ${action} permission denied for ${capabilityId}.`);
    };
    const makeId = (scope, key) => `${tenant.id}:${scope}:${capabilityId}:${key}:${scope === "customer" ? customerId : scope === "conversation" ? conversationId : "tenant"}`;
    return Object.freeze({
      put: async (key, value, options = {}) => {
        requirePermission("write");
        const scope = options.scope || "customer";
        const record = createMemoryRecord({ ...base, id: makeId(scope, key), key, value, scope, ...options });
        const saved = await this.repository.upsert(record);
        await this.eventBus?.publish("memory.written.v1", { tenantId: tenant.id, capabilityId, scope, key }, { source: "memory-engine" });
        return saved;
      },
      get: async (key, options = {}) => {
        requirePermission("read");
        return this.repository.get(makeId(options.scope || "customer", key));
      },
      value: async (key, options = {}) => {
        requirePermission("read");
        return (await this.repository.get(makeId(options.scope || "customer", key)))?.value ?? null;
      },
      list: async (options = {}) => {
        requirePermission("read");
        return this.repository.query({ ...base, ...options });
      },
      remove: async (key, options = {}) => {
        requirePermission("delete");
        const deleted = await this.repository.delete(makeId(options.scope || "customer", key));
        if (deleted) await this.eventBus?.publish("memory.deleted.v1", { tenantId: tenant.id, capabilityId, key }, { source: "memory-engine" });
        return deleted;
      },
      setPreference: async (name, value) => {
        requirePermission("write");
        const key = `preference.${name}`;
        const saved = await this.repository.upsert(createMemoryRecord({ ...base, id: makeId("customer", key), key, value, scope: "customer", tags: ["preference"] }));
        await this.eventBus?.publish("memory.written.v1", { tenantId: tenant.id, capabilityId, scope: "customer", key }, { source: "memory-engine" });
        return saved;
      },
      getPreference: async (name) => {
        requirePermission("read");
        return (await this.repository.get(makeId("customer", `preference.${name}`)))?.value ?? null;
      },
      appendHistory: async (event, data = {}) => {
        requirePermission("write");
        const key = `history.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
        const saved = await this.repository.upsert(createMemoryRecord({ ...base, id: makeId("customer", key), key, value: { event, data, occurredAt: new Date().toISOString() }, scope: "customer", tags: ["history", event] }));
        await this.eventBus?.publish("memory.written.v1", { tenantId: tenant.id, capabilityId, scope: "customer", key }, { source: "memory-engine" });
        return saved;
      }
    });
  }
}
module.exports = { MemoryService };
