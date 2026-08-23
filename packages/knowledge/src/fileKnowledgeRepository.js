
const fs=require("fs"); const path=require("path");
const {ValidationError}=require("../../shared/src/errors");
const {normalizeJson,normalizeText,normalizeFaqs}=require("./knowledgeNormalizer");
const {KnowledgeIndex}=require("./knowledgeIndex");
class FileKnowledgeRepository{
 constructor({tenantsDir,knowledgeDataDir=null,logger}){this.tenantsDir=tenantsDir;this.knowledgeDataDir=knowledgeDataDir||tenantsDir;this.logger=logger;this.cache=new Map();}
 getForTenant(tenantId){
  if(this.cache.has(tenantId))return structuredClone(this.cache.get(tenantId).public);
  return structuredClone(this.#load(tenantId).public);
 }
 getIndexForTenant(tenantId){return this.#load(tenantId).index;}
 search(tenantId,query,options){return this.getIndexForTenant(tenantId).search(query,options);}
 #load(tenantId){
  if(this.cache.has(tenantId))return this.cache.get(tenantId);
  const base=path.join(this.tenantsDir,tenantId,"knowledge");
  const overlay=path.join(this.knowledgeDataDir,tenantId,"knowledge");
  const hasOverlay=this.knowledgeDataDir!==this.tenantsDir;
  const business=hasOverlay?deepMerge(this.readJson(path.join(base,"business.json"),{}),this.readJson(path.join(overlay,"business.json"),{})):this.readJson(path.join(base,"business.json"),{});
  const faqs=hasOverlay?mergeFaqs(this.readJson(path.join(base,"faqs.json"),[]),this.readJson(path.join(overlay,"faqs.json"),[])):this.readJson(path.join(base,"faqs.json"),[]);
  const registry=hasOverlay?mergeSources(this.readJson(path.join(base,"sources.json"),[]),this.readJson(path.join(overlay,"sources.json"),[])):this.readJson(path.join(base,"sources.json"),[]);
  const disabledFiles=new Set((registry||[]).filter(x=>x.status==="disabled"&&x.file).map(x=>String(x.file).replace(/^knowledge\//,'')));
  const byFile=new Map((registry||[]).filter(x=>x.status!=="disabled"&&x.file).map(x=>[String(x.file).replace(/^knowledge\//,''),x]));
  const enrich=(rows,file,defaults={})=>{
    const source=byFile.get(file)||defaults;
    return rows.map(row=>({...row,sourceId:source.id||null,sourceKind:source.kind||defaults.kind||'document',sourceRevision:Number(source.revision||1),sourceStatus:source.status||'active',evidenceType:row.evidenceType||source.metadata?.evidenceType||defaults.evidenceType||'customer_fact',customerSafe:row.customerSafe!==false,priority:Number(source.priority??defaults.priority??50),sourceTitle:source.title||file}));
  };
  const docs=[];
  docs.push(...enrich(normalizeJson("business.json",business).filter(x=>!/\b(not enabled|not configured|assistant-only tenant|placeholder|todo|unknown)\b/i.test(x.text)),"business.json",{id:"SRC-BUSINESS",kind:"business_profile",priority:100,title:"Business profile"}));
  docs.push(...enrich(normalizeFaqs("faqs.json",faqs),"faqs.json",{id:"SRC-FAQS",kind:"faq_collection",priority:80,title:"FAQs"}));
  const documentFiles=new Map();
  for(const docsDir of [path.join(base,"documents"),...(hasOverlay?[path.join(overlay,"documents")]:[])]){
   if(!fs.existsSync(docsDir))continue;
   for(const name of fs.readdirSync(docsDir).sort()){
    const full=path.join(docsDir,name);if(fs.statSync(full).isFile())documentFiles.set(name,full);
   }
  }
  for(const [name,full] of documentFiles){
    if(disabledFiles.has(`documents/${name}`))continue;
    const ext=path.extname(name).toLowerCase();
    try{
      if(ext===".json")docs.push(...enrich(normalizeJson(name,JSON.parse(fs.readFileSync(full,"utf8"))),`documents/${name}`,{kind:"document",priority:50,title:name}));
      else if([".txt",".md",".csv"].includes(ext))docs.push(...enrich(normalizeText(name,fs.readFileSync(full,"utf8")),`documents/${name}`,{kind:"document",priority:50,title:name}));
    }catch(error){throw new ValidationError(`Invalid knowledge document: ${full}`,{cause:error.message});}
  }
  const publicData={business,faqs,sources:registry,documentCount:docs.length,storage:{baseline:base,durableOverlay:hasOverlay?overlay:null}};
  const loaded={public:publicData,index:new KnowledgeIndex(docs.filter(x=>x.customerSafe!==false&&x.evidenceType!=="internal_instruction"))};
  this.cache.set(tenantId,loaded); this.logger?.info("knowledge.indexed",{tenantId,documents:docs.length}); return loaded;
 }
 readJson(filePath,fallback){if(!fs.existsSync(filePath))return fallback;try{return JSON.parse(fs.readFileSync(filePath,"utf8"));}catch(error){throw new ValidationError(`Invalid knowledge JSON: ${filePath}`,{cause:error.message});}}
 clearCache(tenantId){tenantId?this.cache.delete(tenantId):this.cache.clear();}
}
function deepMerge(base,overlay){
 if(Array.isArray(overlay))return structuredClone(overlay);
 if(!overlay||typeof overlay!=="object")return overlay===undefined?structuredClone(base):overlay;
 const out=base&&typeof base==="object"&&!Array.isArray(base)?structuredClone(base):{};
 for(const [key,value] of Object.entries(overlay))out[key]=value&&typeof value==="object"&&!Array.isArray(value)?deepMerge(out[key],value):structuredClone(value);
 return out;
}
function mergeFaqs(base,overlay){
 const rows=[];const positions=new Map();
 for(const item of [...(Array.isArray(base)?base:[]),...(Array.isArray(overlay)?overlay:[])]){
  const key=String(item?.id||item?.question||JSON.stringify(item));
  if(positions.has(key))rows[positions.get(key)]=item;else{positions.set(key,rows.length);rows.push(item);}
 }
 return rows;
}
function mergeSources(base,overlay){
 const rows=new Map((Array.isArray(base)?base:[]).map(x=>[x.id,x]));
 for(const item of Array.isArray(overlay)?overlay:[]){if(item?.metadata?.tombstone)rows.delete(item.id);else rows.set(item.id,item);}
 return [...rows.values()];
}
module.exports={FileKnowledgeRepository};
