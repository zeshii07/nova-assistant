const fs=require('fs'); const path=require('path');
const {hydrateRuntimeServices}=require('../../service-pricing/src/unifiedServiceCatalog');
class FileOfferingRepository{
 constructor({tenantsDir,controlPlaneRepository=null}){this.tenantsDir=tenantsDir;this.controlPlaneRepository=controlPlaneRepository;this.cache=new Map();}
 load(tenantId){if(this.cache.has(tenantId))return structuredClone(this.cache.get(tenantId)); const root=path.join(this.tenantsDir,tenantId,'offerings'); const configPath=path.join(root,'config.json'); const itemsPath=path.join(root,'items.json'); const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{}; const published=this.controlPlaneRepository?.getPublished(tenantId,'services')?.document; let items=published?.kind==='offering'?hydrateRuntimeServices(published):fs.existsSync(itemsPath)?JSON.parse(fs.readFileSync(itemsPath,'utf8')):[]; if(!items.length){const businessPath=path.join(this.tenantsDir,tenantId,'knowledge','business.json');if(fs.existsSync(businessPath)){const business=JSON.parse(fs.readFileSync(businessPath,'utf8'));items=[...(business.services||[]),...(business.highlights||[])].map((name,index)=>({id:`knowledge-${index+1}`,name:String(name),aliases:[],type:'informational',description:'',bookable:false,source:'knowledge'}));}} const out={config,items};this.cache.set(tenantId,out);return structuredClone(out);}
 clear(tenantId){tenantId?this.cache.delete(tenantId):this.cache.clear();}
}
module.exports={FileOfferingRepository};
