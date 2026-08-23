const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v8912-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';
fs.cpSync(path.join(__dirname,'..','tenants'),process.env.TENANTS_DIR,{recursive:true});

const {buildContainer}=require('../apps/api/src/container');
let container;
const ask=(customerId,text)=>container.executionEngine.process({tenantId:'cleaning-demo',channel:'v8912',customerId,text});

test.before(async()=>{
  container=await buildContainer();
  container.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');
  container.llmRouter.providers=[];
});
test.after(async()=>{await container.registry.shutdownAll();});

test('an ambiguous property quote asks cleaning type while pricing every unambiguous service',async()=>{
  const customer='ambiguous-multi-price';
  let response=await ask(customer,'what are charges for 2 bedroom villa cleaning and a 3 seater sofa');
  let state=response.state.capabilityState.cleaning;

  assert.equal(response.intelligence.selected.intent,'cleaning.price_type_clarification');
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/standard cleaning.*AED 40 per hour per cleaner/is);
  assert.match(response.reply,/deep cleaning.*AED 370/is);
  assert.match(response.reply,/standard cleaning or deep cleaning/i);
  assert.equal(state.step,null);
  assert.equal(state.serviceId,undefined);
  assert.equal(state.pendingPriceClarification.otherServiceItems[0].serviceId,'CLN003');

  response=await ask(customer,'2 bedroom villa deep cleaning nd 3 seater sofa cleaning');
  state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.multi_service_quote_request');
  assert.match(response.reply,/Deep cleaning.*AED 370/is);
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/Total: AED 480/i);
  assert.doesNotMatch(response.reply,/information only|nothing has been booked|booking draft|price enquiry only/i);
  assert.equal(state.step,null);
  assert.deepEqual(state.quotedServices.map(quote=>[quote.operationalServiceId,quote.total]),[['CLN011',370],['CLN003',110]]);
});

test('a combined quotation can start one composed request without losing either service',async()=>{
  const customer='accept-multi-price';
  await ask(customer,'what are charges for 2 bedroom villa deep cleaning and a 3 seater sofa cleaning');
  const response=await ask(customer,'book these services');
  const state=response.state.capabilityState.cleaning;

  assert.equal(response.intelligence.selected.intent,'cleaning.quote_bundle_accept');
  assert.match(response.reply,/combined estimate of AED 480/i);
  assert.equal(state.serviceId,'CLN011');
  assert.equal(state.quotedService.total,370);
  assert.deepEqual(state.additionalServices.map(item=>[item.serviceId,item.total]),[['CLN003',110]]);
  assert.equal(state.step,'date');
});

test('the latest exact interrupt quote is used by book-this and remains contextual',async()=>{
  const customer='active-interrupt-price';
  let response=await ask(customer,'hello i want deep cleaning for my 3 bedroom villa');
  let state=response.state.capabilityState.cleaning;
  assert.equal(state.serviceId,'CLN011');
  assert.equal(state.step,'date');
  assert.equal(state.quotedService.total,440);

  response=await ask(customer,'what are charges for 5 seater sofa cleaning');
  state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.active_quote_question');
  assert.match(response.reply,/5-seater sofa.*AED 170/is);
  assert.equal(state.serviceId,'CLN011');
  assert.equal(state.step,'date');
  assert.equal(state.priceEnquiry.quote.total,170);
  assert.doesNotMatch(response.reply,/information only|booking draft/i);

  response=await ask(customer,'WHAT ARE CHARGES');
  assert.match(response.reply,/5-seater sofa.*AED 170/is);
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN011');

  response=await ask(customer,'ok make booking for this quotation');
  state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.quote_accept');
  assert.equal(state.serviceId,'CLN003');
  assert.equal(state.units,5);
  assert.equal(state.quotedService.total,170);
  assert.equal(state.step,'date');
  assert.match(response.reply,/Sofa Cleaning is selected at AED 170/i);

  response=await ask(customer,'ok confirm my booking for this service');
  assert.equal(response.intelligence.selected.intent,'cleaning.incomplete_confirmation');
  assert.match(response.reply,/what date would you (?:like|prefer)/i);
  assert.doesNotMatch(response.reply,/please enter a date/i);
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN003');
});

test('a single unspecified property price asks standard or deep before duration',async()=>{
  const customer='single-price-type';
  let response=await ask(customer,'what are charges for 2 bedroom villa cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.price_type_clarification');
  assert.match(response.reply,/standard cleaning or deep cleaning/i);
  assert.doesNotMatch(response.reply,/please tell me the hours/i);

  response=await ask(customer,'standard cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.standard_price_details');
  assert.match(response.reply,/AED 40 per hour per cleaner/i);
  assert.match(response.reply,/how many cleaners and how many hours/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);
});

test('standard-cleaning clarification resumes the compound quote after workforce details',async()=>{
  const customer='standard-compound-price';
  await ask(customer,'what are charges for 2 bedroom villa cleaning and a 3 seater sofa');
  let response=await ask(customer,'standard cleaning');
  assert.match(response.reply,/how many cleaners and how many hours/i);

  response=await ask(customer,'2 cleaners for 3 hours');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.standard_multi_service_quote');
  assert.match(response.reply,/2 cleaners × 3 hours.*AED 240/is);
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/Total: AED 350/i);
  assert.deepEqual(state.quotedServices.map(quote=>[quote.operationalServiceId,quote.total]),[['CLN009',240],['CLN003',110]]);
  assert.equal(state.step,null);
});

test('single exact quotes use natural customer language and retain deterministic metadata',async()=>{
  const response=await ask('natural-single-price','what are charges for 5 seater sofa cleaning');
  const state=response.state.capabilityState.cleaning;
  assert.match(response.reply,/Cleaning a 5-seater sofa costs AED 170\./i);
  assert.doesNotMatch(response.reply,/Quotation:|Calculation:|information only|nothing has been booked|price enquiry only/i);
  assert.equal(state.step,null);
  assert.equal(state.priceEnquiry.quote.total,170);
  assert.equal(state.serviceId,undefined);
});
