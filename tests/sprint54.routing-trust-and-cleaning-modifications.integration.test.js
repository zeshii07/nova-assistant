const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContainer } = require('../apps/api/src/container');
const { NluInvocationPolicy } = require('../packages/multilingual-nlu/src');

async function withNluMode(mode, work) {
  const previous = process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE = mode;
  let container;
  try {
    container = await buildContainer();
    return await work(container);
  } finally {
    await container?.registry?.shutdownAll?.();
    if (previous === undefined) delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE = previous;
  }
}

function request(container, customerId, text) {
  return container.executionEngine.process({
    tenantId:'cleaning-demo', channel:'routing-trust', customerId, text
  });
}

function ask(container, tenantId, customerId, text) {
  return container.executionEngine.process({
    tenantId, channel:'routing-trust', customerId, text
  });
}

test('bounded typos and a greeting prefix still produce one complete cleaning request', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => ({success:false,error:(groqCalls+=1,'request_failed'),model:'mock-groq',latencyMs:1});
    const response = await request(
      container,
      `typo-compound-${Date.now()}`,
      'hello i wnt standard clening for a 2 bedroom apartment with 1 cleaner for 3 hours on monday at 11 am'
    );
    const state = response.state.capabilityState.cleaning;

    assert.equal(groqCalls, 0);
    assert.equal(response.intelligence.nlu.deterministicFallback,false);
    assert.equal(response.capabilityId, 'cleaning');
    assert.equal(response.intelligence.selected.intent, 'cleaning.pricing_request');
    assert.equal(state.propertyType, 'apartment');
    assert.equal(state.bedrooms, 2);
    assert.ok(state.preferredDate);
    assert.equal(state.preferredTime, '11:00');
    assert.equal(state.step, 'address');
    assert.match(response.reply, /address/i);
    assert.doesNotMatch(response.reply, /^Sofa Cleaning$/i);
  });
});

test('a detailed property-cleaning request outranks a generic availability answer', async () => {
  await withNluMode('off', async (container) => {
    const response = await request(
      container,
      `booking-over-availability-${Date.now()}`,
      'i want standard cleaning for a 2 bedroom apartment with 1 cleaner for 3 hours on monday around 11 am'
    );
    const state = response.state.capabilityState.cleaning;

    assert.equal(response.capabilityId, 'cleaning');
    assert.equal(response.intelligence.selected.intent, 'cleaning.pricing_request');
    assert.equal(state.bedrooms, 2);
    assert.equal(state.preferredTime, '11:00');
    assert.equal(state.step, 'address');
    assert.doesNotMatch(response.reply, /exact staff\/provider availability/i);
  });
});

test('two two-bedroom apartments retains both property count and bedroom size', async () => {
  await withNluMode('off', async (container) => {
    const response = await request(
      container,
      `property-count-${Date.now()}`,
      'i want standard cleaning for 2 two bedroom apartments with 1 cleaner for 3 hours on monday 1 pm'
    );
    const state = response.state.capabilityState.cleaning;

    assert.equal(response.capabilityId, 'cleaning');
    assert.equal(state.propertyCount, 2);
    assert.equal(state.bedrooms, 2);
    assert.equal(state.preferredTime, '13:00');
    assert.equal(state.serviceId,'CLN-HOURLY');
    assert.equal(state.quotedService,undefined);
    assert.match(response.reply,/AED 40 per hour/i);
  });
});

test('a second property cleaning can be added at review and is not silently ignored', async () => {
  await withNluMode('off', async (container) => {
    const customerId = `additional-cleaning-${Date.now()}`;
    await request(container, customerId, 'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment.');
    await request(container, customerId, 'Jumeirah Village Circle Dubai UAE');
    await request(container, customerId, 'My name is Zeeshan Ahmad');
    await request(container, customerId, '03019299608');

    const added = await request(container, customerId, 'can i add a 2 bedroom villa cleaning to this service');
    assert.equal(added.capabilityId, 'cleaning');
    assert.equal(added.intelligence.selected.intent, 'cleaning.additional_service_add');
    assert.equal(added.state.capabilityState.cleaning.additionalServices.length, 1);
    assert.equal(added.state.capabilityState.cleaning.additionalServices[0].propertyType, 'villa');
    assert.equal(added.state.capabilityState.cleaning.additionalServices[0].bedrooms, 2);
    assert.match(added.reply, /additional service/i);
    assert.match(added.reply, /AED 240/);
    assert.match(added.reply, /AED 480/);

    const duplicate = await request(container, customerId, 'add 2 bedroom villa cleaning');
    assert.equal(duplicate.state.capabilityState.cleaning.additionalServices.length, 1);
    assert.match(duplicate.reply, /already included/i);

    const confirmed = await request(container, customerId, 'confirm');
    assert.match(confirmed.reply, /2 cleaning requests/i);
    assert.match(confirmed.reply, /Hourly Cleaner Hire/i);
    assert.match(confirmed.reply, /2-bedroom villa/i);
    const tenant = container.tenantRepository.getById('cleaning-demo');
    const records = await container.cleaningService.scope({
      tenant, capabilityId:'cleaning', customerId
    }).listRequests();
    assert.equal(records.length, 2);
  });
});

test('high-confidence cross-capability disagreement invokes Groq instead of trusting the larger decimal', () => {
  const policy = new NluInvocationPolicy({ ambiguityMargin:0.01 });
  const availability = { capabilityId:'availability', intent:'availability.day_service_question', confidence:0.999995 };
  const cleaning = { capabilityId:'cleaning', intent:'cleaning.structured_service_request', confidence:0.99996 };
  const decision = policy.evaluate({
    choice:{ winner:availability, ordered:[availability, cleaning] },
    message:{ text:'i want 2 bedroom apartment cleaning on monday at 11 am' }
  });
  assert.deepEqual(decision, { invoke:true, reason:'competing_deterministic_routes' });
});

test('an unresolved Groq fallback asks for clarification instead of returning unrelated knowledge', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => {
      groqCalls += 1;
      return { success:false, error:'timeout', model:'mock-groq', latencyMs:5 };
    };
    const response = await request(
      container,
      `unresolved-${Date.now()}`,
      'hello i need this arrangement sorted for monday somehow'
    );

    assert.equal(groqCalls, 1);
    assert.equal(response.capabilityId, 'system');
    assert.equal(response.intelligence.requiresClarification, true);
    assert.match(response.reply, /not fully sure|rephrase|clarify/i);
    assert.doesNotMatch(response.reply, /Sofa Cleaning|our services/i);
  });
});

test('one salon sentence captures greeting, CRM fields, booking fields, and a price question', async () => {
  await withNluMode('off', async (container) => {
    const customerId=`universal-salon-${Date.now()}`;
    const response=await ask(
      container,
      'salon-demo',
      customerId,
      'Hello, my name is Ahmed Khan, my phone is 03001234567, I want a Haircut on Monday at 4 PM and how much does it cost?'
    );
    const state=response.state.capabilityState.booking;
    const frameIntents=new Set(response.intelligence.messageFrame.intents.map((item)=>item.intent));
    const customer=await container.crmService.getCustomer('salon-demo',customerId);

    assert.equal(response.capabilityId,'booking');
    assert.equal(state.status,'ready');
    assert.equal(state.slots.subject,'Haircut');
    assert.ok(state.slots.date);
    assert.equal(state.slots.time,'4 pm');
    assert.equal(state.slots.name,'Ahmed Khan');
    assert.equal(state.slots.phone,'03001234567');
    assert.equal(state.metadata.priceRequested,true);
    assert.match(response.reply,/Estimated price: Rs1,500/i);
    assert.deepEqual({name:customer.name,phone:customer.phone},{name:'Ahmed Khan',phone:'03001234567'});
    for(const intent of ['conversation.social.greeting','customer.update','booking.create','information.price'])assert.ok(frameIntents.has(intent),intent);
    assert.equal(response.intelligence.messageFrame.hasMultipleIntents,true);
  });
});

test('one retail sentence persists CRM fields while catalog and price intents stay visible', async () => {
  await withNluMode('off', async (container) => {
    const customerId=`universal-retail-${Date.now()}`;
    const response=await ask(
      container,
      'default',
      customerId,
      'Hello, my name is Ahmed Khan, phone 03001234567, show me running shoes and tell me the price.'
    );
    const resolved=new Set(response.intelligence.messageFrame.resolvedIntents.map((item)=>item.intent));
    const customer=await container.crmService.getCustomer('default',customerId);

    assert.equal(response.capabilityId,'catalog');
    assert.match(response.reply,/Running Shoes.*Rs6,500/is);
    assert.deepEqual({name:customer.name,phone:customer.phone},{name:'Ahmed Khan',phone:'03001234567'});
    for(const intent of ['conversation.social.greeting','customer.update','information.price'])assert.ok(resolved.has(intent),intent);
    assert.ok([...resolved].some((intent)=>/^catalog\./.test(intent)));
  });
});

test('a contact-and-CRM interruption is answered without consuming the pending booking field', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls=0;
    container.groqNluClient.complete=async()=>({success:false,error:(groqCalls+=1,'request_failed'),model:'mock-groq',latencyMs:1});
    const customerId=`universal-interrupt-${Date.now()}`;
    await ask(container,'salon-demo',customerId,'I want a haircut tomorrow');
    const response=await ask(
      container,
      'salon-demo',
      customerId,
      'Before we continue, what are your business contact details? Also update my phone to 03001234567.'
    );
    const booking=response.state.capabilityState.booking;
    const customer=await container.crmService.getCustomer('salon-demo',customerId);

    assert.equal(groqCalls,0);
    assert.equal(response.capabilityId,'assistant');
    assert.match(response.reply,/Nova Style Salon/i);
    assert.match(response.reply,/\+92 300 7770004/i);
    assert.match(response.reply,/continue your request, what time/i);
    assert.equal(booking.pendingField,'time');
    assert.equal(booking.slots.time,undefined);
    assert.equal(booking.slots.phone,undefined);
    assert.equal(customer.phone,'03001234567');
  });
});
