const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');
const tenantId='v415-edit-test';const tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(u,text){return c.executionEngine.process({tenantId,channel:'v415',customerId:u,text});}

test.before(async()=>{
  fs.rmSync(tenantDir,{recursive:true,force:true});
  new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({
    id:tenantId,name:'Edit Test Store',offerings:[
      {name:'Rice (1kg)',type:'product',price:340,aliases:['rice','chawal'],inStock:true}
    ]
  });
  c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('declared Roman Urdu name stores only the actual name',()=>{
  const parsed=c.engagementService.parseField('name','mera name zeeshan hai');
  assert.equal(parsed.valid,true);
  assert.equal(parsed.value,'Zeeshan');
});

test('editing one review field preserves all other checkout details and returns directly to review',async()=>{
  const u='edit1';
  await q(u,'i want 2 kg rice');
  let r=await q(u,'confirm');
  assert.match(r.reply,/name|naam/i);

  await q(u,'mera name zeeshan hai');
  await q(u,'03019299608');
  await q(u,'lahore');
  await q(u,'thokar niaz baig lahore');
  await q(u,'skip');
  r=await q(u,'jazzcash');
  assert.equal(r.state.capabilityState.commerce.mode,'review');
  assert.match(r.reply,/Zeeshan/);
  assert.match(r.reply,/03019299608/);
  assert.match(r.reply,/lahore/i);
  assert.match(r.reply,/JazzCash/);

  r=await q(u,'name change kr do');
  assert.equal(r.state.capabilityState.commerce.pendingField,'name');
  assert.equal(r.state.capabilityState.commerce.returnToReview,true);

  r=await q(u,'zeeshan ahmad');
  assert.equal(r.state.capabilityState.commerce.mode,'review');
  assert.equal(r.state.capabilityState.commerce.pendingField,'confirmation');
  assert.match(r.reply,/Zeeshan Ahmad/);
  assert.match(r.reply,/03019299608/);
  assert.match(r.reply,/lahore/i);
  assert.match(r.reply,/thokar niaz baig lahore/i);
  assert.match(r.reply,/JazzCash/);
  assert.doesNotMatch(r.reply,/phone number bata|contact phone number|Which city|Kis city/i);

  const cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:u}).getCart();
  assert.equal(cart.checkout.name,'Zeeshan Ahmad');
  assert.equal(cart.checkout.phone,'03019299608');
  assert.equal(cart.checkout.city,'lahore');
  assert.equal(cart.checkout.address,'thokar niaz baig lahore');
  assert.equal(cart.checkout.paymentMethod,'JazzCash');
});
