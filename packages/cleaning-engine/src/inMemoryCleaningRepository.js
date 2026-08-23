const {LocalJsonFile}=require("../../storage/src/localJsonFile");
/** Development repository for cleaning service requests with local restart durability. */
class InMemoryCleaningRepository {
  constructor({snapshotFile=null}={}) { this.snapshot=new LocalJsonFile(snapshotFile,{requests:{}});const d=this.snapshot.read();this.requests=new Map(Object.entries(d.requests||{})); }
  persist(){this.snapshot.write({requests:Object.fromEntries(this.requests)});}
  async save(request) { this.requests.set(request.id, structuredClone(request));this.persist(); return structuredClone(request); }
  async get(id) { const item = this.requests.get(id); return item ? structuredClone(item) : null; }
  async listByCustomer(tenantId, customerId) {
    return [...this.requests.values()].filter((item) => item.tenantId === tenantId && item.customerId === customerId).map((item)=>structuredClone(item));
  }
}
module.exports = { InMemoryCleaningRepository };
