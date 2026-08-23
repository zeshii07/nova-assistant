const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v896-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';
fs.cpSync(path.join(__dirname,'..','tenants'),process.env.TENANTS_DIR,{recursive:true});

const {buildContainer}=require('../apps/api/src/container');
const {UniversalEngagementEngine}=require('../packages/universal-engagement-engine/src/universalEngagementEngine');
let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v896',customerId,text});

test.before(async()=>{container=await buildContainer();container.engagementService.now=()=>new Date('2026-08-20T12:00:00Z');container.llmRouter.providers=[];});
test.after(async()=>{await container.registry.shutdownAll();});

test('an explicit service price interrupt uses that service and a later service switch clears stale scope',async()=>{
  const customer='cleaning-service-price-switch';
  let response=await ask('cleaning-demo',customer,'hello i want 1 bedroom house deep cleaning');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN002');
  assert.match(response.state.capabilityState.cleaning.scopeText,/1 bedroom house deep cleaning/i);

  response=await ask('cleaning-demo',customer,'ok how much for a sofa cleaning');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.entities.serviceId,'CLN003');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN002');
  assert.match(response.reply,/Sofa Cleaning/i);
  assert.match(response.reply,/From AED 50/i);
  assert.doesNotMatch(response.reply,/configured price for Deep Home Cleaning/i);

  response=await ask('cleaning-demo',customer,'not deep cleaning i want sofa cleaning');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN003');
  assert.equal(response.state.capabilityState.cleaning.scopeText,undefined);
  assert.equal(response.state.capabilityState.cleaning.customQuotePending,undefined);

  response=await ask('cleaning-demo',customer,'what are charges');
  assert.match(response.reply,/Sofa Cleaning/i);
  assert.match(response.reply,/From AED 50/i);
  assert.doesNotMatch(response.reply,/1 bedroom house deep cleaning/i);
});

test('a standalone deep-cleaning price question never becomes an hourly-cleaner quote',async()=>{
  const response=await ask('cleaning-demo','deep-cleaning-price','how much for a full house deep cleaning');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.standalone_service_quote');
  assert.match(response.reply,/Deep Home Cleaning/i);
  assert.match(response.reply,/From AED 350|size\/scope/i);
  assert.doesNotMatch(response.reply,/General cleaner hire|per hour per cleaner/i);
  assert.equal(response.state.capabilityState.cleaning?.step,undefined);
});

test('an exact product request replaces a stale family-browse goal',async()=>{
  const customer='catalog-subject-switch';
  let response=await ask('default',customer,'what types of shirts do you have');
  assert.equal(response.intelligence.selected.intent,'catalog.family_browse');
  assert.match(response.reply,/Cotton T-Shirt/i);

  response=await ask('default',customer,'i want to buy a bottle do you have one ?');
  assert.equal(response.capabilityId,'catalog');
  assert.equal(response.intelligence.selected.intent,'catalog.product_interest');
  assert.equal(response.state.capabilityState.catalog.selectedProductId,'P014');
  assert.match(response.reply,/Steel Water Bottle/i);
  assert.doesNotMatch(response.reply,/which product would you like[\s\S]*Cotton T-Shirt/i);
});

test('location-only availability wording is answered as a tenant service-area question',async()=>{
  const response=await ask('cleaning-demo','service-area','are you available in sharja');
  assert.equal(response.capabilityId,'assistant');
  assert.equal(response.intelligence.selected.intent,'assistant.knowledge_question');
  assert.match(response.reply,/Sharja/i);
  assert.match(response.reply,/Dubai and nearby supported UAE areas/i);
  assert.doesNotMatch(response.reply,/specific service|offer a slot/i);
});

test('numeric noise plus one gibberish word is not accepted as a full address',async()=>{
  const engagement=new UniversalEngagementEngine({now:()=>new Date('2026-08-20T12:00:00Z')});
  assert.equal(engagement.parseField('address','563 7 ygfdh').valid,false);
  assert.equal(engagement.parseField('address','House 563, Block 7, Sharjah').valid,true);

  const customer='bad-address';
  let response=await ask('cleaning-demo',customer,'hello i want 2 cleaners tomorrow at 11 am for 5 hours');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  response=await ask('cleaning-demo',customer,'563 7 ygfdh');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  assert.equal(response.state.capabilityState.cleaning.address,null);
  assert.match(response.reply,/complete|full (?:service )?address/i);
});
