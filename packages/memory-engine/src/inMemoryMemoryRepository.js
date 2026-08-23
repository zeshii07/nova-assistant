const { MemoryPort } = require("../../memory-sdk/src/memoryPort");
const { createMemoryRecord, isExpired } = require("../../memory-sdk/src/memoryRecord");
const {LocalJsonFile}=require("../../storage/src/localJsonFile");

/** Development repository. Replace through MemoryPort in production. */
class InMemoryMemoryRepository extends MemoryPort {
  constructor({snapshotFile=null}={}) { super(); this.snapshot=new LocalJsonFile(snapshotFile,{records:{}});const d=this.snapshot.read();this.records=new Map(Object.entries(d.records||{})); }
  persist(){this.snapshot.write({records:Object.fromEntries(this.records)});}
  async upsert(input) {
    const existing = this.records.get(input.id);
    const record = createMemoryRecord({ ...existing, ...input, createdAt: existing?.createdAt });
    this.records.set(record.id, record);this.persist();
    return structuredClone(record);
  }
  async get(id) {
    const record = this.records.get(id);
    if (!record || isExpired(record)) { if (record){this.records.delete(id);this.persist();} return null; }
    return structuredClone(record);
  }
  async query(filter = {}) {
    const values = [];
    for (const record of this.records.values()) {
      if (isExpired(record)) { this.records.delete(record.id);this.persist(); continue; }
      if (filter.tenantId && record.tenantId !== filter.tenantId) continue;
      if (filter.customerId && record.customerId !== filter.customerId) continue;
      if (filter.conversationId && record.conversationId !== filter.conversationId) continue;
      if (filter.scope && record.scope !== filter.scope) continue;
      if (filter.namespace && record.namespace !== filter.namespace) continue;
      if (filter.key && record.key !== filter.key) continue;
      if (filter.tags?.length && !filter.tags.every((tag) => record.tags.includes(tag))) continue;
      values.push(structuredClone(record));
    }
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async delete(id) { const ok=this.records.delete(id);this.persist();return ok; }
  async purgeExpired(now = Date.now()) {
    let count = 0;
    for (const [id, record] of this.records) if (isExpired(record, now)) { this.records.delete(id); count += 1; }
    if(count)this.persist();return count;
  }
  async clear() { this.records.clear();this.persist(); }
}
module.exports = { InMemoryMemoryRepository };
