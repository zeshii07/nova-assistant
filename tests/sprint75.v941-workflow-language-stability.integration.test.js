const test=require('node:test');
const assert=require('node:assert/strict');

const {normalizeWeekdayTypos,closestKeywordToken}=require('../packages/conversation-intelligence/src/text');
const {TemporalSemanticExtractor}=require('../packages/conversation-intelligence/src/temporalSemanticExtractor');

test('bounded structural normalization understands weekday and cleaning-type typos',()=>{
  assert.equal(normalizeWeekdayTypos('on tuseday'),'on tuesday');
  assert.equal(closestKeywordToken('stndrad cleaning',['standard','regular','routine','hourly'])?.keyword,'standard');
  assert.deepEqual(new TemporalSemanticExtractor().extract('OK 10 AM on tuseday'),{
    version:'1.0',startTime:'10:00',weekday:'tuesday'
  });
});

test('a valid time answer advances the active workflow without changing its date or looping',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`v941-time-${Date.now()}`;
    await ask(container,customerId,'hello i want villa cleaning on friday');
    await ask(container,customerId,'i want deep cleaning');
    const scoped=await ask(container,customerId,'2 bedrooms');
    const requestedDate=scoped.state.capabilityState.cleaning.preferredDate;
    const invalid=await ask(container,customerId,'7 am');
    assert.equal(invalid.state.capabilityState.cleaning.step,'time');
    assert.match(invalid.reply,/outside our business hours/i);

    const valid=await ask(container,customerId,'OK 10 AM');
    assert.equal(valid.capabilityId,'cleaning');
    assert.equal(valid.state.capabilityState.cleaning.step,'address');
    assert.equal(valid.state.capabilityState.cleaning.preferredDate,requestedDate);
    assert.match(valid.state.capabilityState.cleaning.preferredTime,/10/i);
    assert.doesNotMatch(valid.reply,/What time would you prefer/i);
  }finally{await container.registry.shutdownAll();}
});

test('generic property cleaning asks Standard or Deep and pending numeric fields own short answers',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`v941-scalars-${Date.now()}`;
    const start=await ask(container,customerId,'i want clenening service for my apartment');
    assert.equal(start.state.capabilityState.cleaning.step,'cleaningType');
    assert.match(start.reply,/Standard Cleaning/i);
    assert.match(start.reply,/Deep Cleaning/i);

    const standard=await ask(container,customerId,'stndrad cleaning');
    assert.equal(standard.state.capabilityState.cleaning.step,'cleanerCount');

    const schedule=await ask(container,customerId,'friday 10 am');
    assert.equal(schedule.state.capabilityState.cleaning.step,'cleanerCount');
    assert.equal(schedule.state.capabilityState.cleaning.cleanerCount??null,null);
    assert.match(schedule.state.capabilityState.cleaning.preferredTime,/10/i);

    const cleaners=await ask(container,customerId,'2');
    assert.equal(cleaners.state.capabilityState.cleaning.step,'duration');
    const duration=await ask(container,customerId,'4');
    assert.equal(duration.state.capabilityState.cleaning.durationHours,4);
    assert.equal(duration.state.capabilityState.cleaning.total,320);
    assert.equal(duration.state.capabilityState.cleaning.step,'address');
    assert.doesNotMatch(duration.reply,/Here are our cleaning services/i);
  }finally{await container.registry.shutdownAll();}
});

test('one reply can fill cleaner count and duration while preserving deterministic pricing',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`v941-compound-${Date.now()}`;
    await ask(container,customerId,'i want cleaners for my villa cleaning');
    await ask(container,customerId,'standard cleaning');
    const result=await ask(container,customerId,'4 cleaners for 5 hours');
    const state=result.state.capabilityState.cleaning;
    assert.equal(state.cleanerCount,4);
    assert.equal(state.durationHours,5);
    assert.equal(state.total,800);
    assert.equal(state.step,'date');
    assert.doesNotMatch(result.reply,/How many hours/i);
  }finally{await container.registry.shutdownAll();}
});

test('weekday typo is captured and a contextual follow-up retains the discussed service',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const typoId=`v941-typo-${Date.now()}`;
    const start=await ask(container,typoId,'can you clean my apartment on tuseday');
    assert.equal(start.state.capabilityState.cleaning.step,'cleaningType');
    const selected=await ask(container,typoId,'stndrad cleaning');
    assert.ok(selected.state.capabilityState.cleaning.preferredDate);
    assert.equal(selected.state.capabilityState.cleaning.step,'cleanerCount');

    const contextId=`v941-context-${Date.now()}`;
    const availability=await ask(container,contextId,'are you available on monday or friday for move in cleaning my apartment');
    assert.equal(availability.state.capabilityState.availability.lastDiscussedServiceId,'CLN006');
    const followUp=await ask(container,contextId,'so can you come on monday nd clean my apartment');
    assert.equal(followUp.capabilityId,'cleaning');
    assert.equal(followUp.state.capabilityState.cleaning.serviceId,'CLN006');
    assert.match(followUp.reply,/Move-in \/ Move-out Cleaning/i);
    assert.doesNotMatch(followUp.reply,/which cleaning type/i);
  }finally{await container.registry.shutdownAll();}
});

test('adaptive mode keeps clear pending answers local and reserves Groq for unresolved language',async()=>{
  const previousMode=process.env.NOVA_NLU_MODE;
  const previousStrategy=process.env.NOVA_NLU_STRATEGY;
  process.env.NOVA_NLU_MODE='on';process.env.NOVA_NLU_STRATEGY='adaptive';
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  let calls=0;
  container.groqNluClient.complete=async()=>{calls+=1;return {success:false,error:'mock_offline',model:'mock',latencyMs:1};};
  try{
    const customerId=`v941-adaptive-${Date.now()}`;
    const turns=['i want apartment cleaning on tuseday','stndrad cleaning','2','3','10 am'];
    for(const text of turns){
      const response=await ask(container,customerId,text);
      assert.equal(response.intelligence.nlu.used,false,`unexpected remote NLU call for: ${text}`);
    }
    assert.equal(calls,0);

    const unclear=await ask(container,`v941-unclear-${Date.now()}`,'please sort the other one around then unless it shifts');
    assert.equal(unclear.intelligence.nlu.used,true);
    assert.equal(calls,1);
  }finally{
    await container.registry.shutdownAll();
    if(previousMode===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=previousMode;
    if(previousStrategy===undefined)delete process.env.NOVA_NLU_STRATEGY;else process.env.NOVA_NLU_STRATEGY=previousStrategy;
  }
});

test('cleaning customer fields can be amended with validation during and after submission',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`v941-cleaning-fields-${Date.now()}`;
    await ask(container,customerId,'I want deep cleaning for my 2 bedroom villa tomorrow at 10 am');
    await ask(container,customerId,'House 12 Model Town Dubai UAE');
    await ask(container,customerId,'Zeeshan Ahmad');

    const badName=await ask(container,customerId,'change my name to Monday 10 am');
    assert.equal(badName.state.capabilityState.cleaning.name,'Zeeshan Ahmad');
    assert.equal(badName.state.capabilityState.cleaning.step,'fieldEdit');
    assert.match(badName.reply,/has not been changed/i);

    const name=await ask(container,customerId,'change my name to Ali Khan');
    assert.equal(name.state.capabilityState.cleaning.name,'Ali Khan');
    assert.equal(name.state.capabilityState.cleaning.step,'phone');

    const badPhone=await ask(container,customerId,'update my phone to 123');
    assert.equal(badPhone.state.capabilityState.cleaning.phone,null);
    assert.match(badPhone.reply,/not valid/i);
    const phone=await ask(container,customerId,'update my phone to 03001234567');
    assert.equal(phone.state.capabilityState.cleaning.phone,'03001234567');
    const created=await ask(container,customerId,'confirm');
    const requestId=created.state.capabilityState.cleaning.lastRequestId;
    assert.ok(requestId);

    const rejectedAddress=await ask(container,customerId,'change my address to hello');
    assert.match(rejectedAddress.reply,/has not been changed/i);
    const requestBefore=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customerId)).find(row=>row.id===requestId);
    assert.equal(requestBefore.address,'House 12 Model Town Dubai UAE');

    const changedAddress=await ask(container,customerId,'change my address to House 44 Jumeirah Village Circle Dubai UAE');
    assert.equal(changedAddress.state.capabilityState.cleaning.step,undefined);
    const requestAfter=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customerId)).find(row=>row.id===requestId);
    assert.equal(requestAfter.address,'House 44 Jumeirah Village Circle Dubai UAE');
    assert.ok(requestAfter.revision>requestBefore.revision);
  }finally{await container.registry.shutdownAll();}
});

test('retail checkout field amendments validate before changing cart customer details',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`v941-retail-fields-${Date.now()}`;
    const retailAsk=text=>container.executionEngine.process({tenantId:'default',channel:'v941-retail',customerId,text});
    await retailAsk('i want a black polo shirt size small');
    await retailAsk('1');
    await retailAsk('confirm');

    const invalid=await retailAsk('change my name to Monday 10 am');
    assert.match(invalid.reply,/has not been changed/i);
    let cart=await container.commerceService.scope({tenant:container.tenantRepository.getById('default'),capabilityId:'commerce',customerId}).getCart();
    assert.equal(cart.checkout.name,null);

    const valid=await retailAsk('change my name to Ali Khan');
    assert.equal(valid.state.capabilityState.commerce.pendingField,'phone');
    await retailAsk('update my phone to 123');
    cart=await container.commerceService.scope({tenant:container.tenantRepository.getById('default'),capabilityId:'commerce',customerId}).getCart();
    assert.equal(cart.checkout.phone,null);
    await retailAsk('update my phone to 03001234567');
    cart=await container.commerceService.scope({tenant:container.tenantRepository.getById('default'),capabilityId:'commerce',customerId}).getCart();
    assert.equal(cart.checkout.name,'Ali Khan');
    assert.equal(cart.checkout.phone,'03001234567');
  }finally{await container.registry.shutdownAll();}
});

test('generic booking and standalone CRM field updates use the same validators',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const bookingCustomer=`v941-booking-fields-${Date.now()}`;
    const bookingAsk=text=>container.executionEngine.process({tenantId:'restaurant-demo',channel:'v941-booking',customerId:bookingCustomer,text});
    await bookingAsk('book a table tomorrow at 6 pm for 2 people');
    const bad=await bookingAsk('change my name to Monday 10 am');
    assert.equal(bad.state.capabilityState.booking.slots.name,undefined);
    assert.match(bad.reply,/has not been changed/i);
    const good=await bookingAsk('change my name to Ali Khan');
    assert.equal(good.state.capabilityState.booking.slots.name,'Ali Khan');
    assert.equal(good.state.capabilityState.booking.pendingField,'phone');

    const crmCustomer=`v941-crm-fields-${Date.now()}`;
    const crmAsk=text=>container.executionEngine.process({tenantId:'default',channel:'v941-crm',customerId:crmCustomer,text});
    const badEmail=await crmAsk('change my email to bad');
    assert.match(badEmail.reply,/has not been changed/i);
    let profile=await container.crmService.getCustomer('default',crmCustomer);
    assert.equal(profile.email,null);
    await crmAsk('change my email to ali@example.com');
    profile=await container.crmService.getCustomer('default',crmCustomer);
    assert.equal(profile.email,'ali@example.com');
  }finally{await container.registry.shutdownAll();}
});

function ask(container,customerId,text){
  return container.executionEngine.process({tenantId:'cleaning-demo',channel:'v941',customerId,text});
}
