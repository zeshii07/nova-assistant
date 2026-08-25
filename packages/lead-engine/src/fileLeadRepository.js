const {LocalJsonFile}=require('../../storage/src/localJsonFile');

/** Durable tenant-partitioned lead store for local and single-node deployments. */
class FileLeadRepository{
  constructor({snapshotFile=null}={}){this.snapshot=new LocalJsonFile(snapshotFile,{leads:{}});}
  read(){return this.snapshot.read().leads||{};}
  write(leads){this.snapshot.write({leads});}
  async get(tenantId,leadId){const lead=this.read()[key(tenantId,leadId)];return clone(lead||null);}
  async findActiveByCustomer(tenantId,customerId){
    return clone(Object.values(this.read()).filter(lead=>lead.tenantId===tenantId&&lead.customerId===customerId&&!['converted','lost'].includes(lead.status)).sort(newest)[0]||null);
  }
  async upsert(record){const all=this.read();all[key(record.tenantId,record.id)]=clone(record);this.write(all);return clone(record);}
  async list(tenantId,{status=null,grade=null,limit=100}={}){
    return clone(Object.values(this.read()).filter(lead=>lead.tenantId===tenantId&&(!status||lead.status===status)&&(!grade||lead.grade===grade)).sort(newest).slice(0,Math.max(1,Math.min(500,Number(limit)||100))));
  }
  async summary(tenantId){
    const leads=await this.list(tenantId,{limit:500});
    const count=(field,value)=>leads.filter(item=>item[field]===value).length;
    return {total:leads.length,new:count('status','new'),engaged:count('status','engaged'),qualified:count('status','qualified'),converted:count('status','converted'),hot:count('grade','hot'),warm:count('grade','warm'),cold:count('grade','cold')};
  }
}
function key(tenantId,id){return `${tenantId}:${id}`;}
function newest(a,b){return String(b.updatedAt).localeCompare(String(a.updatedAt));}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
module.exports={FileLeadRepository};
