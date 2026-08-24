const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');

let container;
const ask=(customerId,text,tenantId='cleaning-demo')=>container.executionEngine.process({tenantId,channel:'v950',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v950-data-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

test('returning cleaning customers can review and reuse saved address and contact details',async()=>{
  const customerId='returning-cleaning-customer';
  await container.crmService.updateCustomerProfile({tenantId:'cleaning-demo',customerId,name:'James Watson',phone:'03016754577',email:'james@example.com'});
  const tenant=container.tenantRepository.getById('cleaning-demo');
  const cleaning=container.cleaningService.scope({tenant,capabilityId:'cleaning',customerId,conversationId:`cleaning-demo:v950:${customerId}`});
  await cleaning.createRequest({serviceId:'CLN010',preferredDate:'25/08/2026',preferredTime:'11:00',address:'Bur Dubai near Dubai Tower',name:'James Watson',phone:'03016754577',email:'james@example.com',propertyType:'apartment',bedrooms:0,total:200,currency:'AED'});

  await ask(customerId,'i want my 3 seat sofa cleaned');
  let response=await ask(customerId,'today at 5 pm');
  assert.equal(response.state.capabilityState.cleaning.step,'confirm');
  assert.match(response.reply,/Bur Dubai near Dubai Tower/i);
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.step,'confirm');
  assert.equal(state.address,'Bur Dubai near Dubai Tower');
  assert.equal(state.name,'James Watson');
  assert.equal(state.phone,'03016754577');
  assert.match(response.reply,/saved (?:customer|contact) details/i);
  assert.match(response.reply,/keep all details/i);
  assert.match(response.reply,/change (?:the )?(?:name|phone|email|address)/i);

  response=await ask(customerId,'keep all details the same');
  const requestId=response.state.capabilityState.cleaning.lastRequestId;
  assert.match(requestId,/^CLN-[A-Z0-9]{8}$/);
});

test('profile, duration, and identity interruptions never become a pending phone value',async()=>{
  const customerId='pending-phone-interruptions';
  await container.crmService.updateCustomerProfile({tenantId:'cleaning-demo',customerId,name:'James Watson'});
  await ask(customerId,'i want my 3 seat sofa cleaned today at 5 pm');
  let response=await ask(customerId,'Al Barsha near Jumeirah Village Circle');
  assert.equal(response.state.capabilityState.cleaning.step,'phone');

  response=await ask(customerId,'show my profile');
  assert.equal(response.capabilityId,'crm');
  assert.match(response.reply,/James Watson/);
  assert.equal(response.state.capabilityState.cleaning.step,'phone');

  response=await ask(customerId,'for how much time will cleaner work');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.duration_info');
  assert.equal(response.state.capabilityState.cleaning.step,'phone');
  assert.match(response.reply,/duration|how long|scope/i);

  response=await ask(customerId,'actually my name is Zeeshan Ahmad');
  assert.equal(response.state.capabilityState.cleaning.step,'phone');
  assert.equal(response.state.capabilityState.cleaning.name,'Zeeshan Ahmad');
  assert.doesNotMatch(response.reply,/send only the contact number/i);
});

test('stored-field language includes existing, configured, and misspelled previous details',()=>{
  const engagement=container.engagementService;
  assert.equal(engagement.referencesStoredField('phone','use existing phone number'),true);
  assert.equal(engagement.referencesStoredField('phone','use previuos phone number'),true);
  assert.equal(engagement.referencesStoredField('name','use my configured name'),true);
  assert.equal(engagement.referencesStoredField('name','no new name, use the old name'),true);
});

test('price and service answers are friendly in English, Roman Urdu, and Urdu',async()=>{
  let response=await ask('friendly-price-en','what are the charges for 2 bedroom apartment deep cleaning');
  assert.match(response.reply,/Sure|happy to help|😊/i);
  assert.match(response.reply,/AED 300/);

  response=await ask('friendly-price-roman','2 bedroom apartment deep cleaning ke charges kya hain');
  assert.equal(response.state.language,'roman_urdu');
  assert.match(response.reply,/Ji bilkul|AED 300/i);

  response=await ask('friendly-services-urdu','آپ کون سی cleaning services provide کرتے ہیں');
  assert.equal(response.state.language,'urdu');
  assert.match(response.reply,/ہماری صفائی کی خدمات|سروس/);

  response=await ask('friendly-price-urdu','2 bedroom apartment deep cleaning کی قیمت کیا ہے');
  assert.equal(response.state.language,'urdu');
  assert.match(response.reply,/2 بیڈ روم اپارٹمنٹ/);
  assert.match(response.reply,/AED 300/);
});

test('multiple requested weekdays are clarified while retaining the supplied time',async()=>{
  const customerId='multiple-date-options';
  await ask(customerId,'hello i want cleaning service for my studio');
  await ask(customerId,'i want deep cleaning');
  let response=await ask(customerId,'i want it on anyday maybe on friday or satureday at 11 am');
  assert.equal(response.intelligence.selected.intent,'cleaning.date_choice_clarification');
  assert.equal(response.state.capabilityState.cleaning.step,'date');
  assert.match(response.reply,/Friday or Saturday/i);
  response=await ask(customerId,'Friday');
  assert.equal(response.state.capabilityState.cleaning.preferredTime,'11:00');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
});

test('unavailable products get a natural catalog overview and the demo store has broader data',async()=>{
  const response=await ask('larger-catalog','i am looking for an oil for my falling hairs do you have one ?','default');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/don.?t (?:currently )?(?:have|carry)|not available/i);
  assert.match(response.reply,/categories|browse|available products/i);
  assert.doesNotMatch(response.reply,/Sorry 😊 i am looking for an oil for my falling hairs do you have one is not available/i);
  const products=await container.catalogService.listProducts('default');
  const categories=await container.catalogRepository.listCategories('default');
  assert.ok(products.length>=30);
  assert.ok(categories.length>=12);
});

test('generic booking references are short customer-facing codes',async()=>{
  const id=require('../packages/shared/src/ids').createId('BKG');
  assert.match(id,/^BKG_[A-Z0-9]{8}$/);
});
