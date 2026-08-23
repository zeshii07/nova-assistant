const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v894-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';
fs.cpSync(path.join(__dirname,'..','tenants'),process.env.TENANTS_DIR,{recursive:true});

const {buildContainer}=require('../apps/api/src/container');
let container;
const ask=(customerId,text)=>container.executionEngine.process({tenantId:'cleaning-demo',channel:'v894',customerId,text});

test.before(async()=>{container=await buildContainer();container.llmRouter.providers=[];});
test.after(async()=>{await container.registry.shutdownAll();});

test('the upgraded cleaning tenant exposes broad AED services and scope-based prices',async()=>{
  const tenant=container.tenantRepository.getById('cleaning-demo');
  const cleaning=container.cleaningService.scope({tenant,capabilityId:'cleaning',customerId:'catalog-audit'});
  const services=await cleaning.listServices();
  assert.ok(services.length>=31);
  assert.equal(services.find((service)=>service.id==='CLN001').price,40);
  assert.equal(services.find((service)=>service.id==='CLN003').price,50);
  assert.equal(services.find((service)=>service.id==='CLN021').price,31.5);
  assert.equal(services.find((service)=>service.id==='CLN022').price,95);
  assert.equal(services.find((service)=>service.id==='CLN011').priceType,'scope_based');
  assert.ok(services.find((service)=>service.id==='CLN003').supportedTypes.includes('7-seater sofa'));
  assert.ok(services.find((service)=>service.id==='CLN020').supportedTypes.includes('king mattress'));
  const pricing=container.pricingService.getConfig('cleaning-demo');
  assert.equal(pricing.currency,'AED');
  assert.equal(pricing.discounts.length,0);
  const moveOut=container.pricingService.quote('cleaning-demo',{serviceName:'move out cleaning',text:'move out cleaning',propertyType:'villa',bedrooms:2});
  assert.equal(moveOut.total,1979.1);
});

test('a broad cleaning-services question lists categories instead of selecting one service',async()=>{
  const response=await ask('service-discovery','what cleaning services do you have?');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.service_list');
  assert.match(response.reply,/Home cleaning:/i);
  assert.match(response.reply,/Deep Villa Cleaning/i);
  assert.match(response.reply,/Furniture cleaning:/i);
  assert.match(response.reply,/Laundry Wash & Iron/i);
  assert.equal(response.state.capabilityState.cleaning.serviceId,undefined);
});

test('sofa cleaning is added to an active office request without replacing or duplicating it',async()=>{
  const customer='office-sofa';
  let response=await ask(customer,'HELLO i want my office cleaning tomorrow 9 am are you available');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN005');
  assert.equal(response.state.capabilityState.cleaning.preferredTime,'09:00');
  assert.equal(response.state.capabilityState.cleaning.step,'address');

  response=await ask(customer,'i want my sofa cleaning also 3 seater sofa');
  let state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.additional_service_add');
  assert.equal(state.serviceId,'CLN005');
  assert.equal(state.step,'address');
  assert.equal(state.additionalServices.length,1);
  assert.equal(state.additionalServices[0].serviceId,'CLN003');
  assert.equal(state.additionalServices[0].units,3);
  assert.equal(state.additionalServices[0].total,110);
  assert.match(response.reply,/AED 110/i);

  response=await ask(customer,'add both office and sofa cleaning');
  state=response.state.capabilityState.cleaning;
  assert.equal(state.serviceId,'CLN005');
  assert.equal(state.additionalServices.length,1);
  assert.match(response.reply,/already included/i);

  await ask(customer,'Dubai Marina office tower 4');
  await ask(customer,'Zeeshan Ahmad');
  response=await ask(customer,'03019299608');
  assert.match(response.reply,/Additional services:/i);
  assert.match(response.reply,/Sofa Cleaning/i);
  response=await ask(customer,'confirm');
  assert.match(response.reply,/2 cleaning requests/i);
  const stored=await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer);
  assert.deepEqual(new Set(stored.map((request)=>request.serviceId)),new Set(['CLN005','CLN003']));
});

test('two explicit services in the first message start one composed workflow',async()=>{
  const response=await ask('first-turn-multi','I need office cleaning and 3 seater sofa cleaning tomorrow at 9 am');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.multi_service_request');
  assert.equal(state.serviceId,'CLN005');
  assert.equal(state.additionalServices.length,1);
  assert.equal(state.additionalServices[0].serviceId,'CLN003');
  assert.equal(state.preferredTime,'09:00');
  assert.equal(state.step,'address');
});
