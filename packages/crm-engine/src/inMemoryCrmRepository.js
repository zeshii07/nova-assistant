const { CrmPort } = require("../../crm-sdk/src/crmPort");
const { createCustomerRecord, normalizeNote } = require("../../crm-sdk/src/customerRecord");
const {LocalJsonFile}=require("../../storage/src/localJsonFile");

/** Development repository. Replace through CrmPort for production storage. */
class InMemoryCrmRepository extends CrmPort {
  constructor({snapshotFile=null}={}) { super(); this.snapshot=new LocalJsonFile(snapshotFile,{customers:{},activities:{}});const d=this.snapshot.read();this.customers=new Map(Object.entries(d.customers||{}));this.activities=new Map(Object.entries(d.activities||{})); }
  persist(){this.snapshot.write({customers:Object.fromEntries(this.customers),activities:Object.fromEntries(this.activities)});}
  key(tenantId, customerId) { return `${tenantId}:${customerId}`; }
  async getCustomer(tenantId, customerId) { return clone(this.customers.get(this.key(tenantId, customerId)) || null); }
  async upsertCustomer(input) {
    const key = this.key(input.tenantId, input.customerId);
    const current = this.customers.get(key);
    const record = createCustomerRecord({ ...(current || {}), ...input, tags: input.tags ?? current?.tags, notes: input.notes ?? current?.notes, customFields: { ...(current?.customFields || {}), ...(input.customFields || {}) }, createdAt: current?.createdAt || input.createdAt });
    this.customers.set(key, record); this.persist(); return clone(record);
  }
  async deleteCustomer(tenantId, customerId) { this.activities.delete(this.key(tenantId, customerId)); const ok=this.customers.delete(this.key(tenantId, customerId));this.persist();return ok; }
  async addNote(tenantId, customerId, note) {
    const customer = await this.getCustomer(tenantId, customerId); if (!customer) return null;
    customer.notes.push(normalizeNote(note)); return this.upsertCustomer(customer);
  }
  async addTag(tenantId, customerId, tag) {
    const customer = await this.getCustomer(tenantId, customerId); if (!customer) return null;
    customer.tags = [...new Set([...customer.tags, String(tag).trim().toLowerCase()].filter(Boolean))]; return this.upsertCustomer(customer);
  }
  async removeTag(tenantId, customerId, tag) {
    const customer = await this.getCustomer(tenantId, customerId); if (!customer) return null;
    customer.tags = customer.tags.filter((item) => item !== String(tag).trim().toLowerCase()); return this.upsertCustomer(customer);
  }
  async recordActivity(input) {
    const key = this.key(input.tenantId, input.customerId); const list = this.activities.get(key) || [];
    const activity = { id: input.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type: input.type, data: input.data || {}, capabilityId: input.capabilityId || "system", createdAt: input.createdAt || new Date().toISOString() };
    list.push(activity); this.activities.set(key, list); this.persist(); return clone(activity);
  }
  async listActivities(tenantId, customerId, { limit = 50 } = {}) { return clone((this.activities.get(this.key(tenantId, customerId)) || []).slice(-limit).reverse()); }
  async searchCustomers(tenantId, query = "") {
    const q = String(query).toLowerCase(); return [...this.customers.values()].filter((c) => c.tenantId === tenantId && (!q || [c.name, c.phone, c.email, ...c.tags].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))).map(clone);
  }
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
module.exports = { InMemoryCrmRepository };
