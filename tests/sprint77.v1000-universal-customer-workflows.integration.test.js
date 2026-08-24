const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {AttributeExtractor}=require('../packages/catalog-engine/src/attributeExtractor');

let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v1000',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v1000-data-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

test('saved-value acceptance understands short contextual replies and common misspellings',()=>{
  const engagement=container.engagementService;
  for(const phrase of ['use','use it','use previous','use previuos','use old address','same one']){
    assert.equal(engagement.referencesStoredField('address',phrase),true,phrase);
  }
  assert.equal(engagement.referencesStoredDetails('use my configured name and details'),true);
});

test('catalog auto-selects sole options and collects remaining size and quantity together',async()=>{
  const id='compact-product-options';
  let response=await ask('default',id,'i want a non stick frying pan');
  assert.equal(response.state.capabilityState.catalog.selectedAttributes.color,'Black');
  assert.doesNotMatch(response.reply,/what color would you like/i);
  assert.match(response.reply,/size/i);
  assert.match(response.reply,/quantity|how many/i);

  response=await ask('default',id,'2 pieces 24 cm');
  assert.equal(response.state.capabilityState.catalog.selectedAttributes.size,'24cm');
  assert.equal(response.state.capabilityState.catalog.selectedAttributes.quantity,2);
});

test('numeric dimensions are never promoted to quantity when explicit quantity grammar is present',()=>{
  const product={sizes:['24cm','28cm'],colors:['Black']};
  assert.deepEqual(new AttributeExtractor().extract('2 pieces 24 cm',product),{color:null,size:'24cm',quantity:2});
});

test('sofa typo resolves to sofa and generic furniture asks for a configured furniture type',async()=>{
  let response=await ask('cleaning-demo','sofa-typo','i want a booking for my furniture sof cleaning');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN003');
  assert.match(response.reply,/Sofa Cleaning/i);
  assert.equal(response.state.capabilityState.cleaning.step,'units');

  response=await ask('cleaning-demo','furniture-choice','i want furniture cleaning');
  assert.equal(response.state.capabilityState.cleaning.step,'serviceChoice');
  assert.match(response.reply,/sofa|office chair/i);
  response=await ask('cleaning-demo','furniture-choice','office chairs');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN032');
  assert.equal(response.state.capabilityState.cleaning.step,'units');
  assert.match(response.reply,/AED 35/i);
});

test('cleaning cancellation reports none, cancels one, and asks for an ID when several are active',async()=>{
  let response=await ask('cleaning-demo','cancel-none','cancel my cleaning booking');
  assert.match(response.reply,/do not have|don.t have|no active|no confirmed/i);

  const tenant=container.tenantRepository.getById('cleaning-demo');
  const customerId='cancel-many';
  const cleaning=container.cleaningService.scope({tenant,capabilityId:'cleaning',customerId,conversationId:`cleaning-demo:v1000:${customerId}`});
  const first=await cleaning.createRequest({serviceId:'CLN003',serviceName:'Sofa Cleaning',preferredDate:'29/08/2026',preferredTime:'11:00',address:'Villa 34, JVC Phase 2, Dubai',name:'James Odin',phone:'03019299608',units:3,total:110,currency:'AED'});
  const second=await cleaning.createRequest({serviceId:'CLN020',serviceName:'Mattress Cleaning',preferredDate:'30/08/2026',preferredTime:'14:00',address:'Villa 34, JVC Phase 2, Dubai',name:'James Odin',phone:'03019299608',serviceVariant:'queen',total:160,currency:'AED'});
  response=await ask('cleaning-demo',customerId,'cancel my service request');
  assert.equal(response.state.capabilityState.cleaning.step,'cancelSelection');
  assert.match(response.reply,new RegExp(first.id));
  assert.match(response.reply,new RegExp(second.id));
  response=await ask('cleaning-demo',customerId,first.id);
  assert.match(response.reply,/cancelled/i);
  const records=await cleaning.listRequests();
  assert.equal(records.find(item=>item.id===first.id).status,'cancelled');
  assert.notEqual(records.find(item=>item.id===second.id).status,'cancelled');
});

test('generic config-driven bookings use the same zero, one, or many cancellation policy',async()=>{
  let response=await ask('restaurant-demo','booking-cancel-none','cancel my reservation');
  assert.match(response.reply,/do not have|don.t have|no active|no confirmed/i);

  const tenant=container.tenantRepository.getById('restaurant-demo');
  const customerId='booking-cancel-many';
  const booking=container.bookingService.scope({tenant,capabilityId:'booking',customerId,conversationId:`restaurant-demo:v1000:${customerId}`});
  const first=await booking.create({subject:'Table Reservation',date:'29/08/2026',time:'18:00',partySize:2,name:'James Odin',phone:'03019299608'});
  const second=await booking.create({subject:'Table Reservation',date:'30/08/2026',time:'20:00',partySize:4,name:'James Odin',phone:'03019299608'});
  response=await ask('restaurant-demo',customerId,'cancel my reservation');
  assert.equal(response.state.capabilityState.booking.status,'cancel_selection');
  assert.match(response.reply,new RegExp(first.id));
  assert.match(response.reply,new RegExp(second.id));
  response=await ask('restaurant-demo',customerId,second.id);
  assert.match(response.reply,/cancelled/i);
  const records=await booking.list();
  assert.equal(records.find(record=>record.id===second.id).status,'cancelled');
  assert.notEqual(records.find(record=>record.id===first.id).status,'cancelled');
});

test('commerce can reuse all saved checkout details in one contextual reply',async()=>{
  const customerId='saved-commerce-details';
  await container.crmService.updateCustomerProfile({
    tenantId:'default',customerId,name:'Zeeshan Ahmad',phone:'03019299608',
    customFields:{lastDelivery:{city:'Lahore',address:'House 12, Model Town, Lahore',landmark:'Near Park',paymentMethod:'Cash on Delivery'}}
  });
  await ask('default',customerId,'i want black wireless earbuds');
  await ask('default',customerId,'1');
  let response=await ask('default',customerId,'confirm order');
  assert.match(response.reply,/Zeeshan Ahmad|saved details/i);
  response=await ask('default',customerId,'use my configured name and details');
  assert.equal(response.state.capabilityState.commerce.mode,'review');
  const cart=await container.commerceRepository.getCart('default',customerId);
  assert.equal(cart.checkout.name,'Zeeshan Ahmad');
  assert.equal(cart.checkout.phone,'03019299608');
  assert.equal(cart.checkout.address,'House 12, Model Town, Lahore');
});

test('public assistant surface and opt-in demo calendar are configured for v10',()=>{
  for(const file of ['index.html','app.js','style.css'])assert.equal(fs.existsSync(path.join(__dirname,'../apps/public-chat/public',file)),true,file);
  const server=fs.readFileSync(path.join(__dirname,'../apps/api/src/server.js'),'utf8');
  assert.match(server,/\/assistant/);
  assert.match(server,/servePublicChatAsset/);
  const calendar=JSON.parse(fs.readFileSync(path.join(__dirname,'../tenants/cleaning-demo/calendar/config.json'),'utf8'));
  assert.equal(calendar.enabled,false);
});
