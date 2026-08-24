const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');
const tenantId='v412-karyana';const tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v412',customerId:u,text});}
test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({id:tenantId,name:'Karyana 412',offerings:[
  {name:'Super Basmati Rice (1kg)',type:'product',price:340,aliases:['rice','chawal'],inStock:true},
  {name:'Cooking Oil / Ghee (1 Litre / Pack)',type:'product',price:520,aliases:['cooking oil','oil','ghee'],inStock:true},
  {name:'Dal Chana / Gram Pulse (1kg)',type:'product',price:280,aliases:['chana dal','daal chana'],inStock:true},
  {name:'Dal Moong / Mung Bean (1kg)',type:'product',price:310,aliases:['moong dal','daal moong'],inStock:true}
 ]});
 c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('2 kg rice and 4 liters cooking oil shows both cart items',async()=>{
 const r=await q(tenantId,'m1','i want buy 2 kg rice and 4 liter cooking oil');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Rice/);assert.match(r.reply,/× 2/);assert.match(r.reply,/Cooking Oil/);assert.match(r.reply,/× 4/);
});
test('generic daal in multi request is clarified instead of guessed',async()=>{
 const r=await q(tenantId,'m2','add 5 kg rice and 5 kg daal');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Rice/);assert.match(r.reply,/which one do you mean/i);assert.match(r.reply,/Dal Chana/);assert.match(r.reply,/Dal Moong/);
});
test('configured curtain cleaning starts a cleaning request',async()=>{
 const r=await q('cleaning-demo','s1','cn i book curtain cleaning service');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Curtain Cleaning/i);assert.match(r.reply,/date/i);assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
});
test('quoted property service can be accepted into cleaning workflow',async()=>{
 const u='s2';let r=await q('cleaning-demo',u,'can i get quote for move out cleaning for a 2 bedroom villa what is estimate price');
 assert.match(r.reply,/AED 1,979\.10/);assert.equal(r.state.capabilityState.cleaning.quotedService.total,1979.1);
 r=await q('cleaning-demo',u,'ok add this service');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/selected|quoted/i);assert.match(r.reply,/date/i);assert.equal(r.state.capabilityState.cleaning.step,'date');
});
test('direct property cleaning request asks Standard or Deep without listing every service',async()=>{
 const r=await q('cleaning-demo','s3','i want 2 bedroom villa cleaning');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Standard Cleaning/i);assert.match(r.reply,/Deep Cleaning/i);
 assert.equal(r.state.capabilityState.cleaning.step,'cleaningType');assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
});
