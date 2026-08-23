/**
 * Official CRM application service. System methods support customer lifecycle;
 * capability-scoped facades expose only tenant-approved operations.
 */
class CrmService {
  constructor({ repository, permissionService, eventBus, logger }) { Object.assign(this, { repository, permissionService, eventBus, logger }); }

  async ensureCustomer({ tenantId, customerId, channel = "unknown", preferredLanguage = null }) {
    let customer = await this.repository.getCustomer(tenantId, customerId);
    if (!customer) {
      customer = await this.repository.upsertCustomer({ tenantId, customerId, source: channel, preferredLanguage });
      await this.emit("crm.customer.created.v1", { tenantId, customerId });
    }
    return customer;
  }
  async getCustomer(tenantId, customerId) { return this.repository.getCustomer(tenantId, customerId); }
  async updateCustomerProfile({ tenantId, customerId, ...patch }) {
    const current=await this.ensureCustomer({tenantId,customerId});
    const updated=await this.repository.upsertCustomer({...current,...patch,tenantId,customerId});
    await this.emit("crm.customer.updated.v1",{tenantId,customerId,fields:Object.keys(patch||{})},"system");
    return updated;
  }
  async listActivities(tenantId, customerId, options) { return this.repository.listActivities(tenantId, customerId, options); }

  scope({ tenant, capabilityId, customerId }) {
    const assert = (action) => this.permissionService.assert(tenant, capabilityId, action);
    const ids = { tenantId: tenant.id, customerId };
    return Object.freeze({
      getCustomer: async () => { assert("customer.read"); return this.repository.getCustomer(ids.tenantId, ids.customerId); },
      updateCustomer: async (patch) => {
        assert("customer.write"); const current = await this.ensureCustomer({ ...ids });
        const updated = await this.repository.upsertCustomer({ ...current, ...patch, ...ids });
        await this.emit("crm.customer.updated.v1", { ...ids, fields: Object.keys(patch || {}) }, capabilityId); return updated;
      },
      addNote: async (text, author = capabilityId) => {
        assert("note.write"); await this.ensureCustomer({ ...ids });
        const updated = await this.repository.addNote(ids.tenantId, ids.customerId, { text, author });
        await this.emit("crm.note.added.v1", { ...ids }, capabilityId); return updated;
      },
      addTag: async (tag) => {
        assert("tag.write"); await this.ensureCustomer({ ...ids });
        const updated = await this.repository.addTag(ids.tenantId, ids.customerId, tag);
        await this.emit("crm.tag.added.v1", { ...ids, tag: String(tag).toLowerCase() }, capabilityId); return updated;
      },
      removeTag: async (tag) => {
        assert("tag.write"); const updated = await this.repository.removeTag(ids.tenantId, ids.customerId, tag);
        await this.emit("crm.tag.removed.v1", { ...ids, tag: String(tag).toLowerCase() }, capabilityId); return updated;
      },
      recordActivity: async (type, data = {}) => {
        assert("activity.write"); await this.ensureCustomer({ ...ids });
        const activity = await this.repository.recordActivity({ ...ids, type, data, capabilityId });
        await this.emit("crm.activity.recorded.v1", { ...ids, activityId: activity.id, type }, capabilityId); return activity;
      },
      listActivities: async (options) => { assert("activity.read"); return this.repository.listActivities(ids.tenantId, ids.customerId, options); }
    });
  }
  async emit(name, payload, capabilityId = "system") { await this.eventBus?.publish(name, payload, { source: "crm-engine", capabilityId }); }
}
module.exports = { CrmService };
