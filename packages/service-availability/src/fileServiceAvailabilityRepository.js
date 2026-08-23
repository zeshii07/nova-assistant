const fs=require('fs');const path=require('path');
class FileServiceAvailabilityRepository{
 constructor({tenantsDir}){this.tenantsDir=tenantsDir;}
 load(tenantId){const p=path.join(this.tenantsDir,tenantId,'availability','services.json');if(!fs.existsSync(p))return {rules:[]};return JSON.parse(fs.readFileSync(p,'utf8'));}
}
module.exports={FileServiceAvailabilityRepository};