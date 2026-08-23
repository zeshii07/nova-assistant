const fs=require('fs');
const path=require('path');

class TenantOperationalManager{
  constructor({tenantsDir,operationalDataDir}){this.tenantsDir=tenantsDir;this.operationalDataDir=operationalDataDir;}
  pricingFile(tenantId){return path.join(this.operationalDataDir,tenantId,'pricing','services.json');}
  baselinePricingFile(tenantId){return path.join(this.tenantsDir,tenantId,'pricing','services.json');}
  getPricing(tenantId){
    this.assertTenant(tenantId);
    const published=this.pricingFile(tenantId),baseline=this.baselinePricingFile(tenantId);
    const active=fs.existsSync(published)?published:baseline;
    return {tenantId,source:fs.existsSync(published)?'durable-published':'shipped-baseline',config:this.read(active,{currency:'USD',services:[],discounts:[]})};
  }
  publishPricing(tenantId,input){
    this.assertTenant(tenantId);const config=validatePricingConfig(input);
    const target=this.pricingFile(tenantId);fs.mkdirSync(path.dirname(target),{recursive:true});
    const temp=`${target}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n');fs.renameSync(temp,target);
    return this.getPricing(tenantId);
  }
  assertTenant(tenantId){if(!fs.existsSync(path.join(this.tenantsDir,tenantId,'profile.json')))throw new Error(`Unknown tenant '${tenantId}'`);}
  read(file,fallback){if(!fs.existsSync(file))return fallback;return JSON.parse(fs.readFileSync(file,'utf8'));}
}
function validatePricingConfig(input){
  const value=input&&typeof input==='object'?structuredClone(input):null;
  if(!value||!Array.isArray(value.services))throw new Error('Pricing configuration requires a services array.');
  value.currency=String(value.currency||'USD').trim().toUpperCase();
  const ids=new Set();
  value.services=value.services.map((service,index)=>{
    if(!service||typeof service!=='object')throw new Error(`Pricing service ${index+1} must be an object.`);
    const row={...service,id:String(service.id||'').trim(),name:String(service.name||'').trim(),model:String(service.model||'flat').trim().toLowerCase()};
    if(!row.id||!row.name)throw new Error(`Pricing service ${index+1} requires id and name.`);
    if(ids.has(row.id))throw new Error(`Duplicate pricing service id '${row.id}'.`);ids.add(row.id);
    if(!['flat','hourly','unit','matrix'].includes(row.model))throw new Error(`Unsupported pricing model '${row.model}' for '${row.id}'.`);
    if(row.model==='hourly'||row.model==='unit'){if(!Number.isFinite(Number(row.rate))||Number(row.rate)<0)throw new Error(`Pricing service '${row.id}' requires a non-negative rate.`);row.rate=Number(row.rate);}
    if(row.model==='flat'){if(!Number.isFinite(Number(row.price))||Number(row.price)<0)throw new Error(`Pricing service '${row.id}' requires a non-negative price.`);row.price=Number(row.price);}
    if(row.model==='matrix'&&(!row.prices||typeof row.prices!=='object'||Array.isArray(row.prices)))throw new Error(`Matrix pricing service '${row.id}' requires a prices object.`);
    return row;
  });
  value.addOns=(Array.isArray(value.addOns)?value.addOns:[]).map((addOn,index)=>{
    const row={...addOn,id:String(addOn?.id||'').trim(),name:String(addOn?.name||'').trim(),inputKey:String(addOn?.inputKey||'').trim(),rate:Number(addOn?.rate??addOn?.price)};
    if(!row.id||!row.name||!row.inputKey)throw new Error(`Pricing add-on ${index+1} requires id, name, and inputKey.`);
    if(!Number.isFinite(row.rate)||row.rate<0)throw new Error(`Pricing add-on '${row.id}' requires a non-negative rate.`);
    return row;
  });
  value.discounts=Array.isArray(value.discounts)?value.discounts:[];
  return value;
}
module.exports={TenantOperationalManager,validatePricingConfig};
