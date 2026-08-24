const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {NluInvocationPolicy}=require('../packages/multilingual-nlu/src');

let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v89',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v89-data-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});
test.after(async()=>{await container.registry.shutdownAll();});

test('a direct multi-product purchase outranks stale category browsing and remembers variants across turns',async()=>{
  const customer='retail-multi-turn-variants';
  await ask('default',customer,'What kind of shoes do you have?');

  let response=await ask('default',customer,'ok can i buy comfort slides and denim jeans');
  assert.equal(response.capabilityId,'commerce');
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  assert.equal(response.state.capabilityState.commerce.pendingMultiItemDraft.length,2);
  assert.match(response.reply,/Comfort Slides.*color/is);
  assert.match(response.reply,/Denim Jeans.*color/is);

  response=await ask('default',customer,'comfort slides navy color and denim jeans blue');
  const colors=Object.fromEntries(response.state.capabilityState.commerce.pendingMultiItemDraft.map(x=>[x.productId,x.color]));
  assert.deepEqual(colors,{P012:'Navy',P002:'Blue'});
  assert.match(response.reply,/Comfort Slides.*size/is);
  assert.match(response.reply,/Denim Jeans.*size/is);

  response=await ask('default',customer,'slides size 40 and jeans size 36');
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.equal(response.state.capabilityState.commerce.pendingMultiItemDraft,undefined);
  assert.deepEqual(cart.items.map(x=>({productId:x.productId,color:x.color,size:x.size,quantity:x.quantity})),[
    {productId:'P012',color:'Navy',size:'40',quantity:1},
    {productId:'P002',color:'Blue',size:'36',quantity:1}
  ]);
});

test('checkout review owns final confirmation even when a catalog draft is stale',async()=>{
  const customer='retail-final-owner';
  await ask('default',customer,'I want 2 black LED Desk Lamps');
  await ask('default',customer,'confirm order');
  await ask('default',customer,'Akbar Khan');
  await ask('default',customer,'03024567876');
  await ask('default',customer,'Lahore');
  await ask('default',customer,'address is House 1 Ali Town');
  await ask('default',customer,'skip');
  let response=await ask('default',customer,'cod');
  assert.equal(response.state.capabilityState.commerce.mode,'review');

  // Simulate a stale product-selection draft left by a side browse.
  response.state.capabilityState.catalog={selectedProductId:'P002',selectedAttributes:{}};
  await container.stateRepository.save(response.state);
  response=await ask('default',customer,'ok final');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/order is confirmed/i);
  assert.equal((await container.commerceRepository.listOrders('default',customer)).length,1);
  const order=(await container.commerceRepository.listOrders('default',customer))[0];
  assert.equal(order.customer.address,'House 1 Ali Town');
});

test('unsupported product subtypes are not silently substituted by a nearby catalog item',async()=>{
  const response=await ask('default','retail-strict-led-bulb','hello can i get a led bulb');
  assert.equal(response.intelligence.selected.intent,'catalog.unavailable_request');
  assert.match(response.reply,/don't have led bulb|not available/i);
  assert.doesNotMatch(response.reply,/What color would you like/i);
});

test('cleaning add-on updates are retained while customer fields are pending',async()=>{
  const customer='cleaning-addon-memory';
  await ask('cleaning-demo',customer,'I want standard cleaning for my 2 bedroom apartment with 1 cleaner for 3 hours on Monday at 2 PM');
  await ask('cleaning-demo',customer,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  const response=await ask('cleaning-demo',customer,'can i add 4 blconies for cleaning');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.requirements_update');
  assert.equal(state.balconies,4);
  assert.equal(state.step,'name');
  assert.match(response.reply,/4 balconies/i);
  assert.match(response.reply,/full name/i);
});

test('service replacement at review preserves schedule, scope, identity, and confirmation state',async()=>{
  const customer='cleaning-service-replace';
  const initial=await ask('cleaning-demo',customer,'I want standard cleaning for my 2 bedroom apartment with 1 cleaner for 3 hours on Monday at 2 PM');
  const originalDate=initial.state.capabilityState.cleaning.preferredDate;
  await ask('cleaning-demo',customer,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  await ask('cleaning-demo',customer,'add 4 balconies to the cleaning');
  await ask('cleaning-demo',customer,'Malik Raheem Bux');
  await ask('cleaning-demo',customer,'03097865456');
  const response=await ask('cleaning-demo',customer,'not standard home cleaning, instead use deep cleaning for the same 2 bedroom apartment');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.service_change');
  assert.equal(state.serviceId,'CLN010');
  assert.equal(state.serviceName,'Deep Apartment Cleaning');
  assert.equal(state.preferredDate,originalDate);
  assert.equal(state.preferredTime,'14:00');
  assert.equal(state.address,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  assert.equal(state.name,'Malik Raheem Bux');
  assert.equal(state.phone,'03097865456');
  assert.equal(state.balconies,4);
  assert.equal(state.step,'confirm');
  assert.match(response.reply,/Deep Apartment Cleaning/i);
  assert.doesNotMatch(response.reply,/what date/i);
});

test('changing to another hourly property service reuses the existing request details instead of restarting',async()=>{
  const customer='cleaning-quote-resume';
  const initial=await ask('cleaning-demo',customer,'I want standard cleaning for my 2 bedroom apartment with 1 cleaner for 3 hours on Monday at 2 PM');
  const originalDate=initial.state.capabilityState.cleaning.preferredDate;
  await ask('cleaning-demo',customer,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  await ask('cleaning-demo',customer,'Malik Raheem Bux');
  await ask('cleaning-demo',customer,'03097865456');
  let response=await ask('cleaning-demo',customer,'what about a 3 bedroom villa instead');
  assert.match(response.reply,/Villa Cleaning/i);
  assert.match(response.reply,/AED 40 per hour/i);
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.propertyType,'villa');
  assert.equal(state.bedrooms,3);
  assert.equal(state.preferredDate,originalDate);
  assert.equal(state.preferredTime,'14:00');
  assert.equal(state.address,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  assert.equal(state.name,'Malik Raheem Bux');
  assert.equal(state.phone,'03097865456');
  assert.equal(state.step,'confirm');
  assert.doesNotMatch(response.reply,/what date|what time/i);
});

test('a combined date and time answer advances past both fields',async()=>{
  const customer='cleaning-combined-pending-fields';
  let response=await ask('cleaning-demo',customer,'I need a cleaner for 3 hours');
  assert.equal(response.state.capabilityState.cleaning.step,'date');
  response=await ask('cleaning-demo',customer,'Monday at 2 PM');
  const state=response.state.capabilityState.cleaning;
  assert.match(state.preferredDate,/^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(state.preferredTime,'14:00');
  assert.equal(state.step,'address');
  assert.match(response.reply,/address/i);
  assert.doesNotMatch(response.reply,/what time/i);
});

test('stored identity references and required-field refusals are handled without invalid-value loops',async()=>{
  const customer='cleaning-identity-refusal';
  await container.crmService.updateCustomerProfile({tenantId:'cleaning-demo',customerId:customer,name:'Malik Raheem Bux'});
  await ask('cleaning-demo',customer,'I want standard cleaning for my 2 bedroom apartment with 1 cleaner for 3 hours on Monday at 2 PM');
  await ask('cleaning-demo',customer,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  let response=await ask('cleaning-demo',customer,'I told you my name already');
  assert.equal(response.state.capabilityState.cleaning.name,'Malik Raheem Bux');
  assert.equal(response.state.capabilityState.cleaning.step,'phone');
  assert.match(response.reply,/contact phone/i);

  response=await ask('cleaning-demo',customer,"I don't want to share it with you");
  assert.equal(response.state.capabilityState.cleaning.step,'phone');
  assert.match(response.reply,/required|contact|human/i);
  assert.doesNotMatch(response.reply,/not valid/i);
});

test('social interruptions do not mutate cleaning review and explicitly resume confirmation',async()=>{
  const customer='cleaning-social-review';
  await ask('cleaning-demo',customer,'I want standard cleaning for my 2 bedroom apartment with 1 cleaner for 3 hours on Monday at 2 PM');
  await ask('cleaning-demo',customer,'Dubai Plaza near Clock Tower house 34 apartment 1105');
  await ask('cleaning-demo',customer,'Malik Raheem Bux');
  const before=await ask('cleaning-demo',customer,'03097865456');
  const snapshot=structuredClone(before.state.capabilityState.cleaning);
  const response=await ask('cleaning-demo',customer,'hello guys how are you doing today?');
  assert.equal(response.capabilityId,'assistant');
  assert.deepEqual(response.state.capabilityState.cleaning,snapshot);
  assert.match(response.reply,/confirm/i);
});

test('Groq invocation remains limited to ambiguous or multilingual fallback cases',()=>{
  const policy=new NluInvocationPolicy();
  assert.equal(policy.evaluate({choice:{winner:null,ordered:[]},message:{text:'move the other one later'}}).reason,'no_deterministic_route');
  const pending={capabilityId:'booking',pendingField:'time'};
  const winner={capabilityId:'booking',intent:'booking.continue',confidence:.99};
  assert.deepEqual(policy.evaluate({choice:{winner,ordered:[winner]},pending,pendingValidation:{valid:true},message:{text:'غداً الساعة الخامسة'}}),{invoke:true,reason:'multilingual_pending_utterance'});
  assert.deepEqual(policy.evaluate({choice:{winner,ordered:[winner]},pending,pendingValidation:{valid:true},message:{text:'tomorrow at 5 PM'}}),{invoke:false,reason:'deterministic_confident'});
});
