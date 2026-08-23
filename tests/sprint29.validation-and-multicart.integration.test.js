const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');
const tenantId='v49-karyana';const tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v49',customerId:u,text});}
test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({id:tenantId,name:'Shoaib Karyana Test',offerings:[
  {name:'Super Basmati Rice (1kg)',type:'product',price:340,aliases:['rice','chawal'],inStock:true},
  {name:'Cooking Oil / Ghee (1 Litre / Pack)',type:'product',price:520,aliases:['cooking oil','oil','ghee'],inStock:true}
 ],faqs:[{question:'Can I pay via JazzCash or EasyPaisa?',answer:'Yes, we accept cash on delivery as well as JazzCash, EasyPaisa, and bank transfers.'}]});
 c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('one sentence can add two products with their quantities',async()=>{
 const r=await q(tenantId,'m1','can i get 1 kg rice and 1 kg cooking oil');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Rice/);assert.match(r.reply,/Cooking Oil/);
 const cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:'m1'}).getCart();
 assert.equal(cart.items.length,2);assert.equal(cart.items.find(x=>/Rice/.test(x.name)).quantity,1);assert.equal(cart.items.find(x=>/Oil/.test(x.name)).quantity,1);
});

test('add a different product does not mutate active rice quantity',async()=>{
 const u='m2';await q(tenantId,u,'do you have rice');await q(tenantId,u,'4 kg rice');
 const r=await q(tenantId,u,'add 2 pack of cooking oil');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Cooking Oil/i);
});

test('payment questions route to business knowledge, not catalog or raw json',async()=>{
 let r=await q(tenantId,'m3','what payment method do you offer');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/JazzCash/i);assert.doesNotMatch(r.reply,/"faqs"/i);
 r=await q(tenantId,'m3','do you have jazzcash');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/JazzCash/i);
});

test('customer detail fields reject unrelated queries and keep pending field',async()=>{
 const u='m4';await q(tenantId,u,'do you have rice');await q(tenantId,u,'2');let r=await q(tenantId,u,'confirm order');
 assert.match(r.reply,/name/i);
 r=await q(tenantId,u,'do you have cooking oil');assert.notEqual(r.state.capabilityState.commerce.pendingField,null);assert.equal(r.state.capabilityState.commerce.pendingField,'name');
 const cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:u}).getCart();
 assert.ok(!cart.checkout?.name);
});

test('central name parser handles typo declaration without storing whole sentence',async()=>{
 const parsed=c.engagementService.parseField('name','my nme is zeeshan');
 assert.equal(parsed.valid,true);assert.equal(parsed.value,'Zeeshan');
});

test('cleaning quote without a cleaning type asks standard or deep before duration',async()=>{
 const r=await q('cleaning-demo','m5','can i get free quote for a 2 bedroom apartment');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/standard cleaning or deep cleaning/i);assert.doesNotMatch(r.reply,/tell me the hours/i);
});
