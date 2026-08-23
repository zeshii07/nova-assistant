const fs=require('fs');const path=require('path');
function now(){return new Date().toISOString();}
function slug(v){return String(v||'source').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'source';}
class KnowledgeSourceRepository{
 constructor({tenantsDir,knowledgeDataDir=null}){this.tenantsDir=tenantsDir;this.knowledgeDataDir=knowledgeDataDir||tenantsDir;}
 file(tenantId){return path.join(this.knowledgeDataDir,tenantId,'knowledge','sources.json');}
 baselineFile(tenantId){return path.join(this.tenantsDir,tenantId,'knowledge','sources.json');}
 read(p){if(!fs.existsSync(p))return [];try{return JSON.parse(fs.readFileSync(p,'utf8'))||[];}catch{return [];}}
 baseline(tenantId){return this.read(this.baselineFile(tenantId));}
 overlay(tenantId){return this.knowledgeDataDir===this.tenantsDir?this.baseline(tenantId):this.read(this.file(tenantId));}
 list(tenantId){
   if(this.knowledgeDataDir===this.tenantsDir)return this.baseline(tenantId);
   const merged=new Map(this.baseline(tenantId).map(x=>[x.id,x]));
   for(const row of this.overlay(tenantId)){
     if(row?.metadata?.tombstone)merged.delete(row.id);
     else merged.set(row.id,row);
   }
   return [...merged.values()];
 }
 save(tenantId,items){const p=this.file(tenantId);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(items,null,2)+'\n');return items;}
 upsert(tenantId,input){
   const visible=this.list(tenantId),items=this.overlay(tenantId),id=input.id||`KS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
   const i=items.findIndex(x=>x.id===id),prev=visible.find(x=>x.id===id)||null;
   const materiallyChanged=Boolean(prev)&&['kind','title','file','status','priority'].some(k=>input[k]!==undefined&&input[k]!==prev[k])
     || Boolean(prev&&input.metadata&&JSON.stringify(input.metadata)!==JSON.stringify(prev.metadata||{}));
   const row={id,kind:input.kind||prev?.kind||'document',title:input.title||prev?.title||id,file:input.file||prev?.file||null,
     status:input.status||prev?.status||'active',priority:Number(input.priority??prev?.priority??50),
     revision:Number(input.revision??(prev?(prev.revision||1)+(materiallyChanged?1:0):1)),
     tags:Array.isArray(input.tags)?input.tags:(prev?.tags||[]),metadata:{...(prev?.metadata||{}),...(input.metadata||{})},
     createdAt:prev?.createdAt||now(),updatedAt:now()};
   if(i>=0)items[i]=row;else items.push(row);this.save(tenantId,items);return row;
 }

 setStatus(tenantId,id,status){
   if(!['active','disabled','draft','archived'].includes(status))throw new Error(`Invalid knowledge source status '${status}'`);
   const prev=this.list(tenantId).find(x=>x.id===id);if(!prev)return null;
   return this.upsert(tenantId,{id,status});
 }
 get(tenantId,id){return this.list(tenantId).find(x=>x.id===id)||null;}

 remove(tenantId,id){
   const before=this.list(tenantId);if(!before.some(x=>x.id===id))return false;
   if(this.knowledgeDataDir===this.tenantsDir){this.save(tenantId,before.filter(x=>x.id!==id));return true;}
   const items=this.overlay(tenantId).filter(x=>x.id!==id);
   if(this.baseline(tenantId).some(x=>x.id===id))items.push({id,metadata:{tombstone:true},updatedAt:now()});
   this.save(tenantId,items);return true;
 }
}
module.exports={KnowledgeSourceRepository,slug};
