const {LocalJsonFile}=require("../../storage/src/localJsonFile");
class InMemoryOfferingOrderRepository{
  constructor({snapshotFile=null}={}){this.snapshot=new LocalJsonFile(snapshotFile,{orders:{}});const d=this.snapshot.read();this.orders=new Map(Object.entries(d.orders||{}));}
  persist(){this.snapshot.write({orders:Object.fromEntries(this.orders)});}
  async create(record){this.orders.set(record.id,JSON.parse(JSON.stringify(record)));this.persist();return JSON.parse(JSON.stringify(record));}
  async list(tenantId,customerId){return [...this.orders.values()].filter(x=>x.tenantId===tenantId&&x.customerId===customerId).map(x=>JSON.parse(JSON.stringify(x)));}
}
module.exports={InMemoryOfferingOrderRepository};
