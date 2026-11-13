const fs=require('fs');const path=require('path');
function now(){return new Date().toISOString();}
function slug(v){return String(v||'source').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'source';}
// v55.0 spec §8 source lifecycle states.
const VALID_STATUSES=['active','disabled','draft','processing','published','archived','failed'];
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
 // v55.0: only 'published' and 'active' sources are loaded by the retriever.
 // 'draft', 'processing', 'disabled', 'archived', 'failed' are excluded.
 listPublished(tenantId){
   return this.list(tenantId).filter(s=>s.status==='published'||s.status==='active');
 }
 // v55.0: list all versions of a source (for audit/rollback). The registry
 // stores one row per source id with a revision counter; previous versions are
 // recoverable via the supersedes chain if a versioning repository is wired.
 listVersions(tenantId,sourceId){
   const all=this.list(tenantId);
   const target=all.find(x=>x.id===sourceId);
   if(!target)return [];
   // Walk the supersedes chain backwards.
   const out=[target];
   let cur=target;
   while(cur&&cur.supersedes){
     const prev=all.find(x=>x.id===cur.supersedes);
     if(!prev)break;
     out.push(prev);
     cur=prev;
   }
   return out;
 }
 save(tenantId,items){const p=this.file(tenantId);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(items,null,2)+'\n');return items;}
 upsert(tenantId,input){
   const visible=this.list(tenantId),items=this.overlay(tenantId),id=input.id||`KS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
   const i=items.findIndex(x=>x.id===id),prev=visible.find(x=>x.id===id)||null;
   const materiallyChanged=Boolean(prev)&&['kind','title','file','status','priority'].some(k=>input[k]!==undefined&&input[k]!==prev[k])
     || Boolean(prev&&input.metadata&&JSON.stringify(input.metadata)!==JSON.stringify(prev.metadata||{}));
   // v55.0 spec §8: version + supersedes + effectiveFrom/Until + approvedBy + contentHash
   const row={id,kind:input.kind||prev?.kind||'document',title:input.title||prev?.title||id,file:input.file||prev?.file||null,
     status:input.status||prev?.status||'active',priority:Number(input.priority??prev?.priority??50),
     revision:Number(input.revision??(prev?(prev.revision||1)+(materiallyChanged?1:0):1)),
     version:Number(input.version??prev?.version??(prev?.revision||1)),
     supersedes:input.supersedes||prev?.supersedes||null,
     effectiveFrom:input.effectiveFrom||prev?.effectiveFrom||null,
     effectiveUntil:input.effectiveUntil||prev?.effectiveUntil||null,
     approvedBy:input.approvedBy||prev?.approvedBy||null,
     tags:Array.isArray(input.tags)?input.tags:(prev?.tags||[]),metadata:{...(prev?.metadata||{}),...(input.metadata||{})},
     createdAt:prev?.createdAt||now(),updatedAt:now()};
   if(i>=0)items[i]=row;else items.push(row);this.save(tenantId,items);return row;
 }

 setStatus(tenantId,id,status){
   if(!VALID_STATUSES.includes(status))throw new Error(`Invalid knowledge source status '${status}'. Valid: ${VALID_STATUSES.join(', ')}`);
   const prev=this.list(tenantId).find(x=>x.id===id);if(!prev)return null;
   return this.upsert(tenantId,{id,status});
 }
 // v55.0 spec §8: promote a draft to published. Records who approved it and
 // when it became effective. The previous published version (if any) is
 // superseded — its status flips to 'archived' so it stops being retrieved.
 publish(tenantId,id,{approvedBy=null}={}){
   const all=this.list(tenantId);
   const target=all.find(x=>x.id===id);
   if(!target)return null;
   // Find any other published source with the same file/kind and archive it.
   const superseded=[];
   for(const s of all){
     if(s.id===id)continue;
     if((s.status==='published'||s.status==='active')&&s.kind===target.kind&&s.file===target.file){
       this.upsert(tenantId,{id:s.id,status:'archived'});
       superseded.push(s.id);
     }
   }
   const updated=this.upsert(tenantId,{id,status:'published',approvedBy,effectiveFrom:now(),
     supersedes:superseded.length?superseded[0]:(target.supersedes||null)});
   return {source:updated,superseded};
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
module.exports={KnowledgeSourceRepository,slug,VALID_STATUSES};
