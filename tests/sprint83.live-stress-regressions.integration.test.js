const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {UniversalEngagementEngine}=require('../packages/universal-engagement-engine/src/universalEngagementEngine');

let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'live-stress-regression',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-live-stress-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

test('saved-detail acceptance language cannot become a checkout field value',()=>{
  const engagement=new UniversalEngagementEngine();
  for(const phrase of ['keep all details same','keep all the details the same','sab details same rakho']){
    assert.equal(engagement.referencesStoredDetails(phrase),true,phrase);
    assert.equal(engagement.parseField('name',phrase).valid,false,phrase);
  }
});

test('commerce reuses saved name and phone for keep-all-details wording',async()=>{
  const customerId='stress-saved-commerce';
  await container.crmService.updateCustomerProfile({tenantId:'default',customerId,name:'Cart Tester',phone:'03022222222'});
  await ask('default',customerId,'I want one black electric kettle');
  let response=await ask('default',customerId,'confirm');
  assert.match(response.reply,/saved customer details/i);

  response=await ask('default',customerId,'keep all details same');
  assert.equal(response.state.capabilityState.commerce.pendingField,'city');
  assert.match(response.reply,/Cart Tester/);
  assert.match(response.reply,/03022222222/);
  assert.doesNotMatch(response.reply,/best contact phone/i);
  const customer=await container.crmService.getCustomer('default',customerId);
  assert.equal(customer.name,'Cart Tester');
});

test('bounded Roman Urdu shirt typo still reaches configured shirt products',async()=>{
  const response=await ask('default','stress-shirt-typo','mujhy aik kaali sgirt chahiyy');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/Cotton T-Shirt|Polo Shirt/i);
  assert.doesNotMatch(response.reply,/not available/i);
});

test('cleaning extracts an embedded address from a complete sofa request',async()=>{
  const response=await ask('cleaning-demo','stress-cleaning-address','I need my 2 seater sofa cleaned today at 5 pm at Villa 44 JVC Dubai');
  assert.equal(response.state.capabilityState.cleaning.address,'Villa 44 JVC Dubai');
  assert.match(response.reply,/full name|poora naam/i);
  assert.doesNotMatch(response.reply,/share the full service address/i);
});

test('a generic deep-cleaning price interruption keeps the active apartment service',async()=>{
  const customerId='stress-active-cleaning-service';
  await ask('cleaning-demo',customerId,'I need cleaning for my apartment');
  await ask('cleaning-demo',customerId,'deep cleaning');
  await ask('cleaning-demo',customerId,'3 bedrooms');
  const response=await ask('cleaning-demo',customerId,'pehly batao 3 bedroom deep cleaning kitny ki hai');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN010');
  assert.match(response.reply,/Deep Apartment Cleaning|AED 350/i);
});

test('restaurant booking extracts party size from table-for-number phrasing',async()=>{
  const response=await ask('restaurant-demo','stress-party-size','book a table for 4 this Friday at 8 pm');
  assert.equal(response.state.capabilityState.booking.slots.partySize,4);
  assert.doesNotMatch(response.reply,/how many guests/i);
});

test('configured tutoring aliases resolve algebra without tenant-specific code',async()=>{
  const response=await ask('tutor-demo','stress-algebra','mujhy Saturday ko algebra ki tutoring chahiye');
  assert.match(response.reply,/Math Tutoring/i);
  assert.doesNotMatch(response.reply,/don.t see|not available/i);
});
