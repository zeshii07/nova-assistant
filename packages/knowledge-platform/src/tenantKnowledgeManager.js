const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {slug}=require('./knowledgeSourceRepository');
class TenantKnowledgeManager{
 constructor({tenantsDir,knowledgeDataDir=null,sourceRepository,knowledgeRepository,documentIngestor}){Object.assign(this,{tenantsDir,knowledgeDataDir:knowledgeDataDir||tenantsDir,sourceRepository,knowledgeRepository,documentIngestor});}
 overview(tenantId){
   const base=path.join(this.tenantsDir,tenantId),knowledge=path.join(base,'knowledge');
   if(!fs.existsSync(base))throw new Error(`Unknown tenant '${tenantId}'`);
   const sources=this.ensureRegistry(tenantId);
   const operational={
     products:this.count(path.join(base,'catalog','products.json')),
     services:this.count(path.join(base,'offerings','items.json')),
     pricing:this.countPricing(path.join(base,'pricing','services.json')),
     availabilityRules:this.countRules(path.join(base,'availability','services.json'))
   };
   const indexed=this.knowledgeRepository.getForTenant(tenantId);
   return {tenantId,business:indexed.business||{},faqs:indexed.faqs||[],sources,operational,index:{chunks:indexed.documentCount||0},storage:{mode:this.knowledgeDataDir===this.tenantsDir?'tenant-tree':'durable-overlay'}};
 }
 async addFile(tenantId,{filePath,title=null,tags=[],priority=50,evidenceType='customer_fact'}){
   if(!filePath)throw new Error('filePath is required');
   this.assertTenant(tenantId);
   const result=await this.documentIngestor.ingestFile({tenantId,filePath,tenantsDir:this.knowledgeDataDir,destinationName:title||path.basename(filePath,path.extname(filePath))});
   const rel=path.relative(path.join(this.knowledgeDataDir,tenantId),result.path).replace(/\\/g,'/');
   const originalFile=result.originalPath?path.relative(path.join(this.knowledgeDataDir,tenantId),result.originalPath).replace(/\\/g,'/'):null;
   const contentHash=hash(fs.readFileSync(result.path));
   const existing=this.sourceRepository.list(tenantId).find(x=>x.kind==='document'&&(x.metadata?.contentHash===contentHash||x.file===rel));
   const source=this.sourceRepository.upsert(tenantId,{...(existing?{id:existing.id}:{}),kind:'document',title:title||path.basename(filePath),file:rel,tags,priority,
     metadata:{format:result.format,sourceFormat:result.sourceFormat||result.format,originalFile,evidenceType,contentHash}});
   this.knowledgeRepository.clearCache(tenantId);return {source,...result,alreadyRegistered:Boolean(existing)};
 }
 addDocument(tenantId,{title,text,format='txt',tags=[],priority=50,evidenceType='auto'}){
   if(!String(text||'').trim())throw new Error('Knowledge text is required');
   const safe=slug(title||'knowledge');const ext=format==='md'?'md':'txt';
   this.assertTenant(tenantId);
   const result=this.documentIngestor.ingestContent({tenantId,text,tenantsDir:this.knowledgeDataDir,name:safe,format:ext});
   const rel=path.relative(path.join(this.knowledgeDataDir,tenantId),result.path).replace(/\\/g,'/');
   const contentHash=hash(text);
   const existing=this.sourceRepository.list(tenantId).find(x=>x.kind==='document'&&(x.metadata?.contentHash===contentHash||x.file===rel));
   const source=this.sourceRepository.upsert(tenantId,{...(existing?{id:existing.id}:{}),kind:'document',title:title||safe,file:rel,tags,priority,metadata:{format:result.format,evidenceType,contentHash}});
   this.knowledgeRepository.clearCache(tenantId);return {source,...result,alreadyRegistered:Boolean(existing)};
 }
 addFaq(tenantId,{question,answer,tags=[]}){
   if(!question||!answer)throw new Error('Question and answer are required');
   this.assertTenant(tenantId);
   const p=path.join(this.knowledgeDataDir,tenantId,'knowledge','faqs.json'),faqs=this.readJson(p,[]);
   const id=`FAQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
   faqs.push({id,question:String(question).trim(),answer:String(answer).trim(),tags});this.writeJson(p,faqs);
   this.sourceRepository.upsert(tenantId,{id:`SRC-${id}`,kind:'faq',title:String(question).trim(),file:'knowledge/faqs.json',tags,priority:80,metadata:{faqId:id}});
   this.knowledgeRepository.clearCache(tenantId);return faqs.at(-1);
 }
 setFact(tenantId,{key,value}){
   if(!key)throw new Error('Fact key is required');
   this.assertTenant(tenantId);
   const p=path.join(this.knowledgeDataDir,tenantId,'knowledge','business.json'),business=this.readJson(p,{});
   setPath(business,String(key),value);this.writeJson(p,business);
   this.sourceRepository.upsert(tenantId,{id:`FACT-${slug(key)}`,kind:'business_fact',title:key,file:'knowledge/business.json',priority:90,metadata:{path:key}});
   this.knowledgeRepository.clearCache(tenantId);return {key,value};
 }

 updateDocument(tenantId,id,{title=null,text=null,format='txt',tags=null,priority=null,evidenceType=null,status=null}={}){
   const src=this.sourceRepository.get(tenantId,id);if(!src)throw new Error(`Unknown knowledge source '${id}'`);
   let file=src.file,metadata={...(src.metadata||{})};
   if(text!==null){
     const result=this.documentIngestor.ingestContent({tenantId,text,tenantsDir:this.knowledgeDataDir,name:slug(title||src.title||id),format});
     file=path.relative(path.join(this.knowledgeDataDir,tenantId),result.path).replace(/\\/g,'/');
     metadata={...metadata,format:result.format,evidenceType:evidenceType||metadata.evidenceType||'customer_fact',contentHash:hash(text)};
   }
   const updated=this.sourceRepository.upsert(tenantId,{id,title:title||src.title,file,status:status||src.status,
     tags:tags===null?src.tags:tags,priority:priority===null?src.priority:priority,metadata});
   this.knowledgeRepository.clearCache(tenantId);return updated;
 }
 setSourceStatus(tenantId,id,status){const row=this.sourceRepository.setStatus(tenantId,id,status);this.knowledgeRepository.clearCache(tenantId);return row;}

 removeSource(tenantId,id){
   const src=this.sourceRepository.list(tenantId).find(x=>x.id===id);if(!src)return false;
   if(src.kind==='document'&&src.file){
     const root=path.resolve(this.knowledgeDataDir,tenantId,'knowledge','documents'),f=path.resolve(this.knowledgeDataDir,tenantId,src.file);
     if(f.startsWith(root+path.sep)&&fs.existsSync(f))fs.rmSync(f,{force:true});
   }
   if(src.kind==='faq'&&src.metadata?.faqId){
     const p=path.join(this.knowledgeDataDir,tenantId,'knowledge','faqs.json'),faqs=this.readJson(p,[]).filter(x=>x.id!==src.metadata.faqId);this.writeJson(p,faqs);
   }
   this.sourceRepository.remove(tenantId,id);this.knowledgeRepository.clearCache(tenantId);return true;
 }
 reindex(tenantId){this.knowledgeRepository.clearCache(tenantId);const index=this.knowledgeRepository.getForTenant(tenantId);return {tenantId,chunks:index.documentCount||0,sources:this.ensureRegistry(tenantId).length};}
 ensureRegistry(tenantId){
   this.assertTenant(tenantId);
   const base=path.join(this.tenantsDir,tenantId,'knowledge'),overlay=path.join(this.knowledgeDataDir,tenantId,'knowledge'),docsRoots=[path.join(base,'documents')];
   if(this.knowledgeDataDir!==this.tenantsDir)docsRoots.push(path.join(overlay,'documents'));
   const existing=()=>this.sourceRepository.list(tenantId);
   if(fs.existsSync(path.join(base,'business.json'))&&!existing().some(x=>x.id==='SRC-BUSINESS'))
     this.sourceRepository.upsert(tenantId,{id:'SRC-BUSINESS',kind:'business_profile',title:'Business profile',file:'knowledge/business.json',priority:100});
   if(fs.existsSync(path.join(base,'faqs.json'))&&!existing().some(x=>x.id==='SRC-FAQS'))
     this.sourceRepository.upsert(tenantId,{id:'SRC-FAQS',kind:'faq_collection',title:'FAQs',file:'knowledge/faqs.json',priority:80});
   for(const docs of docsRoots)if(fs.existsSync(docs))for(const name of fs.readdirSync(docs)){
    const f=path.join(docs,name),id=`SRC-DOC-${slug(name)}`;
    if(fs.statSync(f).isFile()&&!existing().some(x=>x.id===id)&&!existing().some(x=>x.file===`knowledge/documents/${name}`))
      this.sourceRepository.upsert(tenantId,{id,kind:'document',title:name,file:`knowledge/documents/${name}`,priority:50});
   }
   return this.sourceRepository.list(tenantId);
 }
 assertTenant(tenantId){if(!fs.existsSync(path.join(this.tenantsDir,tenantId)))throw new Error(`Unknown tenant '${tenantId}'`);}
 readJson(p,fallback){if(!fs.existsSync(p))return fallback;return JSON.parse(fs.readFileSync(p,'utf8'));}
 writeJson(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');}
 count(p){const x=this.readJson(p,[]);return Array.isArray(x)?x.length:0;}
 countPricing(p){const x=this.readJson(p,{services:[]});return x.services?.length||0;}
 countRules(p){const x=this.readJson(p,{rules:[]});return x.rules?.length||0;}
}
function hash(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:String(value??'')).digest('hex');}
function setPath(obj,key,value){const parts=key.split('.').filter(Boolean);let cur=obj;for(let i=0;i<parts.length-1;i++){if(!cur[parts[i]]||typeof cur[parts[i]]!=='object')cur[parts[i]]={};cur=cur[parts[i]];}cur[parts.at(-1)]=value;}
module.exports={TenantKnowledgeManager,setPath};
