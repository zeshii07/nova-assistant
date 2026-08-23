const {LocalJsonFile}=require("../../storage/src/localJsonFile");
class InMemoryBookingRepository{
 constructor({snapshotFile=null}={}){this.snapshot=new LocalJsonFile(snapshotFile,{records:{},keys:{}});const d=this.snapshot.read();this.records=new Map(Object.entries(d.records||{}));this.keys=new Map(Object.entries(d.keys||{}));}
 persist(){this.snapshot.write({records:Object.fromEntries(this.records),keys:Object.fromEntries(this.keys)});}
 async create(record){if(record.idempotencyKey){const k=`${record.tenantId}:${record.idempotencyKey}`;const existing=this.keys.get(k);if(existing)return structuredClone(this.records.get(existing));this.keys.set(k,record.id);}this.records.set(record.id,structuredClone(record));this.persist();return structuredClone(record);}
 async save(record){const existing=this.records.get(record.id);if(existing&&existing.tenantId!==record.tenantId)throw new Error('Booking tenant mismatch');this.records.set(record.id,structuredClone(record));this.persist();return structuredClone(record);}
 async get(tenantId,id){const x=this.records.get(id);return x&&x.tenantId===tenantId?structuredClone(x):null;}
 async findByIdempotencyKey(tenantId,key){const id=this.keys.get(`${tenantId}:${key}`);return id?structuredClone(this.records.get(id)):null;}
 async list(tenantId,customerId){return [...this.records.values()].filter(x=>x.tenantId===tenantId&&(!customerId||x.customerId===customerId)).map(x=>structuredClone(x));}
}
module.exports={InMemoryBookingRepository};
