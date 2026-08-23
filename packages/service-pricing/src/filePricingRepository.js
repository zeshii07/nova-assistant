const fs=require('fs');const path=require('path');
const {unifyServiceDocument,pricingConfigFromServiceDocument}=require('./unifiedServiceCatalog');
class FilePricingRepository{
 constructor({tenantsDir,operationalDataDir=null,controlPlaneRepository=null}){this.tenantsDir=tenantsDir;this.operationalDataDir=operationalDataDir||tenantsDir;this.controlPlaneRepository=controlPlaneRepository;}
 load(tenantId){
  const published=path.join(this.operationalDataDir,tenantId,'pricing','services.json');
  const baseline=path.join(this.tenantsDir,tenantId,'pricing','services.json');
  const p=this.operationalDataDir!==this.tenantsDir&&fs.existsSync(published)?published:baseline;
  const legacy=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{currency:'USD',services:[],addOns:[],discounts:[]};
  const active=this.controlPlaneRepository?.getPublished(tenantId,'services')?.document;
  if(active)return pricingConfigFromServiceDocument(unifyServiceDocument(active,legacy));
  const cleaning=path.join(this.tenantsDir,tenantId,'cleaning','services.json');
  const offering=path.join(this.tenantsDir,tenantId,'offerings','items.json');
  const kind=fs.existsSync(cleaning)?'cleaning':'offering';
  const items=fs.existsSync(cleaning)?JSON.parse(fs.readFileSync(cleaning,'utf8')):fs.existsSync(offering)?JSON.parse(fs.readFileSync(offering,'utf8')):[];
  if(!items.length)return legacy;
  return pricingConfigFromServiceDocument(unifyServiceDocument({kind,items},legacy));
 }
}
module.exports={FilePricingRepository};
