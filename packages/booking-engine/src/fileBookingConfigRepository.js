const fs=require('fs');const path=require('path');
class FileBookingConfigRepository{constructor({tenantsDir}){this.tenantsDir=tenantsDir;this.cache=new Map();}load(tenantId){if(this.cache.has(tenantId))return structuredClone(this.cache.get(tenantId));const file=path.join(this.tenantsDir,tenantId,'booking','config.json');const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};this.cache.set(tenantId,value);return structuredClone(value);}}
module.exports={FileBookingConfigRepository};
