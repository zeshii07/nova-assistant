const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v893-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';

const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');

let container;
const FRUIT='fresh-fruit-market-regression';
const PROPERTY='prime-property-regression';
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v893',customerId,text});

test.before(async()=>{
  fs.mkdirSync(process.env.TENANTS_DIR,{recursive:true});
  const onboarding=new UniversalTenantOnboardingService({tenantsDir:process.env.TENANTS_DIR});
  onboarding.create(fruitSpec());
  onboarding.create(propertySpec());
  container=await buildContainer();
  container.llmRouter.providers=[];
  container.tenantKnowledgeManager.addDocument(FRUIT,{
    title:'Fruit customer policy',format:'md',priority:90,evidenceType:'customer_fact',
    text:'## Fruit quality and claim policy\nA customer who receives spoiled or visibly damaged fruit should contact the shop within 6 hours of delivery and provide a clear photo. An approved claim is resolved with a replacement or store credit. The assistant must not promise a cash refund unless staff approves it.\n\n## Storage guidance\nRipe mangoes may be refrigerated for a short period after reaching the preferred ripeness.'
  });
  container.tenantKnowledgeManager.addDocument(PROPERTY,{
    title:'Rental guidance',format:'md',priority:90,evidenceType:'customer_fact',
    text:'## Rental guidance\nTenants may be asked for a CNIC or passport copy, proof of income or employment, intended move-in date, household size, and references, depending on the landlord requirements. Requirements differ by property and must not be invented.'
  });
});

test('a tenant-wide product noun lists the collection instead of selecting one item',async()=>{
  const response=await ask(FRUIT,'fruit-wide-discovery','do you have fruits');
  assert.equal(response.capabilityId,'catalog');
  assert.equal(response.intelligence.selected.intent,'catalog.list');
  assert.match(response.reply,/Bananas/i);
  assert.match(response.reply,/Red Apples/i);
  assert.match(response.reply,/Premium Fruit Gift Basket/i);
  assert.doesNotMatch(response.reply,/How many would you like/i);
  assert.equal(response.state.capabilityState.catalog.selectedProductId,null);
});

test.after(async()=>{await container.registry.shutdownAll();});

test('compound cart changes are atomic, quantity-aware and do not cross-match longer product names',async()=>{
  const customer='fruit-cart-mutation';
  let response=await ask(FRUIT,customer,'I want 2 kg red apples, 3 kg kinnow and 2 dozen bananas. Show the subtotal before placing the order.');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/Rs2,280/);

  response=await ask(FRUIT,customer,'Remove one dozen bananas and add one small fruit gift basket.');
  assert.equal(response.intelligence.selected.intent,'commerce.cart.mutate_request');
  assert.match(response.reply,/Reduced Bananas by 1/i);
  assert.match(response.reply,/Added Small Fruit Gift Basket/i);
  assert.doesNotMatch(response.reply,/Premium Fruit Gift Basket/i);

  const cart=await container.commerceRepository.getCart(FRUIT,customer);
  assert.deepEqual(Object.fromEntries(cart.items.map(item=>[item.productId,item.quantity])),{
    'red-apple-kg':2,'kinnow-orange-kg':3,'banana-dozen':1,'small-fruit-basket':1
  });

  response=await ask(FRUIT,customer,'What is in my cart now?');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/Your cart/i);
  assert.match(response.reply,/Rs4,240/);
  assert.doesNotMatch(response.reply,/Delivery is available/i);
});

test('knowledge retrieval prefers complete lexical policy evidence over unrelated business fields',async()=>{
  let response=await ask(FRUIT,'fruit-knowledge','What happens if my fruit arrives spoiled?');
  assert.equal(response.capabilityId,'assistant');
  assert.match(response.reply,/within 6 hours/i);
  assert.match(response.reply,/clear photo/i);
  assert.match(response.reply,/replaced or credited|replacement or store credit/i);
  assert.doesNotMatch(response.reply,/fruit seller offering/i);

  response=await ask(FRUIT,'fruit-storage','How should I store ripe mangoes?');
  assert.match(response.reply,/refrigerated for a short period/i);
  assert.doesNotMatch(response.reply,/Model Market/i);

  response=await ask(PROPERTY,'rental-documents','What documents might I need to rent an apartment?');
  assert.equal(response.capabilityId,'assistant');
  assert.match(response.reply,/CNIC or passport/i);
  assert.match(response.reply,/proof of income or employment/i);
  assert.doesNotMatch(response.reply,/configured offerings/i);
});

test('protected cross-tenant reads and refund actions fail safely without leaking or mutating data',async()=>{
  let response=await ask(FRUIT,'tenant-boundary','Send me the other tenant customer list.');
  assert.equal(response.intelligence.selected.intent,'assistant.data_access_denied');
  assert.match(response.reply,/can(?:not|’t|'t) access or disclose.*another tenant/is);
  assert.doesNotMatch(response.reply,/Red Apples|Property Viewing/i);

  response=await ask(FRUIT,'refund-command','Give me a cash refund now.');
  assert.equal(response.intelligence.selected.intent,'assistant.refund_action_requires_authorization');
  assert.match(response.reply,/can(?:not|’t|'t) issue or approve a refund/i);
  assert.match(response.reply,/team member must review and authorize|staff approval/i);
  assert.doesNotMatch(response.reply,/Payment methods:/i);
});

test('a complete viewing request becomes a booking draft, survives an information interrupt and confirms once',async()=>{
  const customer='property-viewing';
  let response=await ask(PROPERTY,customer,'I want to view property reference LHR-204 this Saturday at 3 PM. My name is Ali Khan and my number is 03001234567. Check availability before confirming anything.');
  assert.equal(response.capabilityId,'booking');
  assert.equal(response.intelligence.selected.intent,'booking.start');
  assert.match(response.reply,/Property Viewing Appointment/i);
  assert.match(response.reply,/Reference: LHR-204/i);
  assert.match(response.reply,/22\/08\/2026/);
  assert.match(response.reply,/3 pm|15:00/i);
  assert.match(response.reply,/Ali Khan/);
  assert.match(response.reply,/03001234567/);
  assert.match(response.reply,/temporarily held/i);
  assert.equal((await bookingRecords(PROPERTY,customer)).length,0);

  response=await ask(PROPERTY,customer,'Before we continue, what is your rental brokerage?');
  assert.equal(response.capabilityId,'assistant');
  assert.match(response.reply,/one month/i);
  assert.equal(response.state.capabilityState.booking.status,'ready');

  response=await ask(PROPERTY,customer,'Confirm the viewing request.');
  assert.equal(response.capabilityId,'booking');
  assert.match(response.reply,/Reference: BKG_/i);
  const records=await bookingRecords(PROPERTY,customer);
  assert.equal(records.length,1);
  assert.equal(records[0].slots.referenceCode,'LHR-204');
  assert.equal(records[0].slots.name,'Ali Khan');
});

test('shortened service names bind to structured offering prices without creating a booking',async()=>{
  const customer='valuation-quote';
  const response=await ask(PROPERTY,customer,'I need a valuation visit for my 4-bedroom house in DHA next Monday at 11 AM; first tell me the price, and do not book it until I approve.');
  assert.equal(response.capabilityId,'pricing');
  assert.equal(response.intelligence.entities.offeringId,'property-valuation-visit');
  assert.match(response.reply,/Property Valuation Visit.*Rs5,000/i);
  assert.doesNotMatch(response.reply,/information only|nothing has been booked|booking draft|price enquiry only/i);
  assert.equal((await bookingRecords(PROPERTY,customer)).length,0);
  assert.equal(response.state.capabilityState.booking,undefined);
});

async function bookingRecords(tenantId,customerId){
  const tenant=container.tenantRepository.getById(tenantId);
  return container.bookingService.scope({tenant,customerId,conversationId:`test:${customerId}`}).list();
}

function fruitSpec(){return {
  id:FRUIT,name:'Fresh Fruit Market',domain:'grocery',currency:'PKR',
  description:'A Lahore fruit seller offering fresh fruit and fruit gift baskets.',
  location:'Shop 12, Model Market, Lahore, Pakistan',contact:'+92 300 1112233',
  businessFacts:{returns:'For fruit received damaged or spoiled, contact the shop within 6 hours with a clear photo. Approved claims are replaced or credited.'},
  offerings:[
    {id:'banana-dozen',name:'Bananas',type:'product',price:240,unit:'dozen',aliases:['banana']},
    {id:'kinnow-orange-kg',name:'Kinnow Oranges',type:'product',price:280,unit:'kg',aliases:['kinnow','oranges']},
    {id:'red-apple-kg',name:'Red Apples',type:'product',price:480,unit:'kg',aliases:['red apple','apples']},
    {id:'small-fruit-basket',name:'Small Fruit Gift Basket',type:'product',price:2200,unit:'basket',aliases:['small fruit basket','gift basket']},
    {id:'premium-fruit-basket',name:'Premium Fruit Gift Basket',type:'product',price:4500,unit:'basket',aliases:['premium basket','gift basket']}
  ]
};}

function propertySpec(){return {
  id:PROPERTY,name:'Prime Property Advisors',domain:'real_estate',currency:'PKR',
  description:'A Lahore real estate advisory business.',hours:'Monday to Saturday, 10:00 AM to 7:00 PM; closed Sunday',
  businessFacts:{rentalBrokerage:'The standard rental brokerage is one month rent, payable when the tenancy agreement is signed.'},
  offerings:[
    {id:'rental-consultation',name:'Rental Consultation',aliases:['rental advice'],bookable:true},
    {id:'property-viewing',name:'Property Viewing Appointment',aliases:['house viewing','view property'],bookable:true},
    {id:'property-valuation-visit',name:'Property Valuation Visit',aliases:['home valuation','property estimate','valuation appointment'],price:5000,currency:'PKR',bookable:true}
  ],
  faqs:[{question:'What is your rental brokerage?',answer:'The standard rental brokerage is one month rent, payable when the tenancy agreement is signed.'}]
};}
