const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');

let container;
async function ask(customerId,text,tenantId='cleaning-demo'){
  return container.executionEngine.process({tenantId,channel:'v85',customerId,text});
}

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v85-data-'));
  container=await buildContainer();
  container.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');
  container.llmRouter.providers=[];
});

test('cleaning products stay grounded in the cleaning tenant and explicit staffing controls the quote',async()=>{
  const response=await ask('apartment',`Hello,
I am looking for 2 cleaners for Saturday, 24 July, from 9:00 AM to 12:00 PM, to clean a 3-bedroom apartment, including 2 balconies and the windows.
You will need to bring your own cleaning products, vacuum cleaner, and mop.
Could you please let me know your price?
I live in Marina Vista Tower 1.
Thank you!`);
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.pricing_request');
  assert.doesNotMatch(response.reply,/retail|different type of business/i);
  assert.match(response.reply,/AED 240/);
  assert.match(response.reply,/availability still needs confirmation/i);
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.cleanerCount,2);
  assert.equal(state.durationHours,3);
  assert.equal(state.startTime,'09:00');
  assert.equal(state.endTime,'12:00');
  assert.equal(state.address,'Marina Vista Tower 1');
  assert.deepEqual(state.requiredEquipment,['vacuum cleaner','mop']);
  assert.equal(state.businessProvidesSupplies,true);
});

test('weekly quote preserves supplies and customer-history claims without inventing a discount',async()=>{
  const response=await ask('compound',`Hi,
I'd like to arrange a weekly cleaning service: 2 hours every week with 2 cleaners, including all cleaning supplies and equipment.
What price can you offer for this service? I've already booked several cleaning sessions with your company before.
Thank you!`);
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.recurring_quote');
  assert.match(response.reply,/AED 160/);
  assert.match(response.reply,/supplies\/products/i);
  assert.match(response.reply,/verified.*tenant.*CRM history/i);
  assert.doesNotMatch(response.reply,/discounted total|discount applies/i);
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.recurrence.frequency,'weekly');
  assert.equal(state.businessProvidesSupplies,true);
  assert.equal(state.businessProvidesEquipment,true);
  assert.equal(state.returningCustomerClaim,true);
});

test('future recurring consideration cannot hijack the asserted one-time booking',async()=>{
  const response=await ask('compound',`Hello,
I would like to book a 3-hour cleaning service with one person for Tuesday, August 10, from 9:00 a.m. to 12:00 p.m.
I would prefer someone efficient, as I am considering setting up a weekly cleaning service on a regular basis.
Could you please confirm availability and the total price?
Thank you!`);
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.pricing_request');
  assert.match(response.reply,/AED 120/);
  assert.equal(response.intelligence.clauseSemantics.secondaryIntents[0].type,'future_consideration');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.recurrence,null);
  assert.equal(state.cleanerCount,1);
  assert.equal(state.durationHours,3);
  assert.equal(state.startTime,'09:00');
  assert.equal(state.endTime,'12:00');
  assert.equal(state.dateText,'August 10');
  assert.equal(state.staffPreference,'efficient');
});

test('active cleaning time edits ask for the missing time, apply it, and resume the workflow',async()=>{
  let response=await ask('compound',`Good evening
Sorry but can i change the hours for tomorrow please`);
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.schedule_edit');
  assert.match(response.reply,/what new start time/i);
  assert.equal(response.state.capabilityState.cleaning.step,'reschedule_time');
  assert.equal(response.state.capabilityState.cleaning.preferredDate,'22/08/2026');

  response=await ask('compound',`Perfect
Better to start at 9am…`);
  assert.equal(response.intelligence.selected.intent,'cleaning.schedule_edit');
  assert.match(response.reply,/09:00–12:00/);
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.startTime,'09:00');
  assert.equal(state.endTime,'12:00');
  assert.equal(state.durationHours,3);
  assert.equal(state.step,'address');
});

test('post-renovation villa keeps the complete scope through custom-quote handoff',async()=>{
  const original=`Yes, I posted because I need cleaning for a villa that has just been renovated. I need complete cleaning for the upper floor.

The upper floor has:

- 4 bedrooms, each with an attached washroom
- 1 hall

I need complete post-renovation deep cleaning, including floors, washrooms, doors, windows, and construction dust.

Location: Hoshi, Sharjah.`;
  let response=await ask('villa',original);
  assert.equal(response.capabilityId,'cleaning');
  assert.match(response.reply,/custom quotation/i);
  const pending=response.state.capabilityState.cleaning.customQuotePending;
  assert.equal(pending.propertyType,'villa');
  assert.equal(pending.propertyFloor,'upper');
  assert.equal(pending.bedrooms,4);
  assert.equal(pending.washrooms,4);
  assert.equal(pending.halls,1);
  assert.equal(pending.address,'Hoshi, Sharjah');
  assert.equal(pending.cleaningType,'post_renovation_deep_clean');
  assert.deepEqual(pending.requestedTasks,['floors','washrooms','doors','windows','constructionDust']);
  assert.equal(pending.originalMessage,original);

  response=await ask('villa','Yes, please arrange it');
  assert.match(response.reply,/created a custom quotation request/i);
  const handoff=container.handoffService.list({tenantId:'cleaning-demo'}).find((item)=>item.customerId==='villa');
  assert.ok(handoff);
  assert.equal(handoff.context.quoteRequest.originalMessage,original);
  assert.equal(handoff.context.quoteRequest.address,'Hoshi, Sharjah');
  assert.equal(handoff.context.quoteRequest.confirmationMessage,'Yes, please arrange it');
});

test('tenant, customer, state, CRM, and knowledge boundaries remain standalone',async()=>{
  const sharedCustomer='same-external-id';
  const cleaning=await ask(sharedCustomer,'Do you bring cleaning supplies?','cleaning-demo');
  assert.match(cleaning.reply,/standard cleaning supplies are included/i);

  const retail=await ask(sharedCustomer,'do you have running shoes','default');
  assert.equal(retail.capabilityId,'catalog');
  assert.match(retail.reply,/Running Shoes/);
  assert.doesNotMatch(retail.reply,/standard cleaning supplies/i);

  await container.crmService.updateCustomerProfile({tenantId:'cleaning-demo',customerId:sharedCustomer,name:'Cleaning Customer'});
  await container.crmService.updateCustomerProfile({tenantId:'default',customerId:sharedCustomer,name:'Retail Customer'});
  const cleaningCustomer=await container.crmRepository.getCustomer('cleaning-demo',sharedCustomer);
  const retailCustomer=await container.crmRepository.getCustomer('default',sharedCustomer);
  assert.equal(cleaningCustomer.name,'Cleaning Customer');
  assert.equal(retailCustomer.name,'Retail Customer');

  const cleaningState=await container.stateRepository.get(`cleaning-demo:v85:${sharedCustomer}`);
  const retailState=await container.stateRepository.get(`default:v85:${sharedCustomer}`);
  assert.equal(cleaningState.tenantId,'cleaning-demo');
  assert.equal(retailState.tenantId,'default');
  assert.notDeepEqual(cleaningState.capabilityState,retailState.capabilityState);

  const first=await ask('isolated-a','I need one cleaner for 2 hours. What is the price?');
  const second=await ask('isolated-b','hello');
  assert.equal(first.state.capabilityState.cleaning.durationHours,2);
  assert.equal(second.state.capabilityState.cleaning,undefined);
});

test('an unmistakable retail request is still rejected by the cleaning tenant boundary',async()=>{
  const response=await ask('wrong-domain','do you sell running shoes?');
  assert.equal(response.capabilityId,'assistant');
  assert.equal(response.intelligence.selected.intent,'assistant.domain_mismatch');
  assert.doesNotMatch(response.reply,/Running Shoes.*\$/i);
});
