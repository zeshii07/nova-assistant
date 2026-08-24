const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');

let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v892',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v892-data-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});
test.after(async()=>{await container.registry.shutdownAll();});

test('availability and price before confirming remains quote-only',async()=>{
  const response=await ask('cleaning-demo','quote-before-confirming','Hi, I need 2 cleaners this Saturday from 9:00 AM to 12:00 PM for a 3-bedroom apartment. Please check availability and price before confirming anything.');
  assert.equal(response.capabilityId,'cleaning');
  assert.match(response.reply,/AED 240/);
  assert.match(response.reply,/No booking has been created/i);
  assert.doesNotMatch(response.reply,/share the full service address/i);
  assert.equal(response.state.capabilityState.cleaning.step,undefined);
});

test('explicit cleaner count and duration outrank bedroom-based property pricing',async()=>{
  const response=await ask('cleaning-demo','hourly-work-model','Hello, I need two cleaners for 3 hours to clean my apartment. Can you book them for me?');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.pricing_request');
  assert.match(response.reply,/2 cleaners.*3 hours.*AED 40.*AED 240/is);
  assert.doesNotMatch(response.reply,/need the bedrooms/i);
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');
});

test('a submitted cleaning request is amended in place after confirmation',async()=>{
  const customer='submitted-cleaning-amendment';
  await ask('cleaning-demo',customer,'I need 2 cleaners this Saturday from 9 AM to 12 PM for my 3-bedroom apartment');
  await ask('cleaning-demo',customer,'Al Barsha apartment 23 building 78');
  await ask('cleaning-demo',customer,'Zeeshan Ahmad');
  await ask('cleaning-demo',customer,'03027865456');
  const confirmed=await ask('cleaning-demo',customer,'confirm');
  const requestId=confirmed.state.capabilityState.cleaning.lastRequestId;

  let response=await ask('cleaning-demo',customer,'can you please change starting time from 9 to 10 am');
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_schedule_edit');
  assert.match(response.reply,new RegExp(requestId));
  assert.match(response.reply,/10:00/);
  let requests=await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer);
  assert.equal(requests.length,1);
  assert.equal(requests[0].id,requestId);
  assert.equal(requests[0].preferredTime,'10:00');
  assert.equal(requests[0].revision,2);

  response=await ask('cleaning-demo',customer,'change my service time to monday 11 am');
  assert.match(response.reply,/11:00/);
  requests=await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer);
  assert.equal(requests.length,1);
  assert.equal(requests[0].revision,3);
  assert.equal(requests[0].preferredTime,'11:00');

  response=await ask('cleaning-demo',customer,'change my service to deep cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_service_change');
  requests=await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer);
  assert.equal(requests.length,1);
  assert.equal(requests[0].id,requestId);
  assert.equal(requests[0].serviceId,'CLN002');
  assert.equal(requests[0].address,'Al Barsha apartment 23 building 78');
  assert.equal(requests[0].revision,4);
  assert.equal(requests[0].timeline.length,4);

  response=await ask('cleaning-demo',customer,'cancel my cleaning booking');
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_cancel_request');
  assert.match(response.reply,/has been cancelled/i);
  requests=await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer);
  assert.equal(requests[0].status,'cancelled');
  const events=container.calendarService.listEvents({tenantId:'cleaning-demo',customerId:customer,includeCancelled:true});
  assert.equal(events.length,0);
  assert.equal(requests[0].calendarEventId??null,null);
});

test('submitted cleaning date, time, address, and contact edits persist independently',async()=>{
  const customer='submitted-cleaning-detail-edits';
  await ask('cleaning-demo',customer,'i want cleaning of my apartment on tusedy');
  await ask('cleaning-demo',customer,'deep cleaning');
  await ask('cleaning-demo',customer,'1 bedroom');
  await ask('cleaning-demo',customer,'10 am');
  await ask('cleaning-demo',customer,'Dubai Plaza Al Barsha building 24 apartment 001');
  await ask('cleaning-demo',customer,'James Smith');
  await ask('cleaning-demo',customer,'03016754577 james@example.com');
  const confirmed=await ask('cleaning-demo',customer,'confirm');
  const requestId=confirmed.state.capabilityState.cleaning.lastRequestId;
  assert.ok(requestId);
  const original=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer)).find(row=>row.id===requestId);
  const originalTime=original.preferredTime;

  let response=await ask('cleaning-demo',customer,`can you please change date to 27 for the booking ${requestId}`);
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_schedule_edit');
  let request=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer)).find(row=>row.id===requestId);
  assert.equal(request.preferredDate,'27/08/2026');
  assert.equal(request.preferredTime,originalTime);

  response=await ask('cleaning-demo',customer,'please change the service date');
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_schedule_edit');
  assert.equal(response.state.capabilityState.cleaning.step,'submitted_reschedule_date');
  assert.match(response.reply,/what new (?:service )?date/i);
  response=await ask('cleaning-demo',customer,'29 August 2026');
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_schedule_edit');
  request=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer)).find(row=>row.id===requestId);
  assert.equal(request.preferredDate,'29/08/2026');
  assert.equal(request.preferredTime,originalTime);

  response=await ask('cleaning-demo',customer,`change time to 2 pm for booking ${requestId}`);
  assert.equal(response.intelligence.selected.intent,'cleaning.submitted_schedule_edit');
  request=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer)).find(row=>row.id===requestId);
  assert.equal(request.preferredDate,'29/08/2026');
  assert.equal(request.preferredTime,'14:00');

  await ask('cleaning-demo',customer,'change my address to Office 55 Marina Plaza Dubai UAE');
  await ask('cleaning-demo',customer,'change my name to James Khan');
  await ask('cleaning-demo',customer,'change my phone to 03001234567');
  await ask('cleaning-demo',customer,'change my email to james.khan@example.com');
  request=(await container.cleaningRequestRepository.listByCustomer('cleaning-demo',customer)).find(row=>row.id===requestId);
  assert.equal(request.address,'Office 55 Marina Plaza Dubai UAE');
  assert.equal(request.name,'James Khan');
  assert.equal(request.phone,'03001234567');
  assert.equal(request.email,'james.khan@example.com');

  response=await ask('cleaning-demo',customer,'show my booking history');
  assert.match(response.reply,/Date: 29\/08\/2026/);
  assert.match(response.reply,/Time: 14:00/);
  assert.match(response.reply,/Office 55 Marina Plaza Dubai UAE/);
});

test('multi-item attributes remain bound to their named products and show provisional subtotal',async()=>{
  const customer='product-scoped-attributes';
  let response=await ask('default',customer,'I want 2 Fleece Hoodies, 3 Cotton T-Shirts, 1 Urban Backpack, and 2 Steel Water Bottles. Assuming my requested sizes and colors are available, tell me the subtotal and then ask me for any missing size or color information before placing the order.');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/Provisional merchandise subtotal.*Rs20,900/i);
  assert.equal(response.state.capabilityState.commerce.pendingMultiItemDraft.length,4);

  response=await ask('default',customer,'hoodie black shirt white backpack blck water bottle blue');
  const colors=Object.fromEntries(response.state.capabilityState.commerce.pendingMultiItemDraft.map(item=>[item.productId,item.color]));
  assert.deepEqual(colors,{P007:'Black',P001:'White',P015:'Black',P014:'Blue'});

  response=await ask('default',customer,'fleece hoodie small cotton t shirt small steel bottle 1l');
  assert.match(response.reply,/Added to your cart/i);
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.deepEqual(Object.fromEntries(cart.items.map(item=>[item.productId,{color:item.color,size:item.size,quantity:item.quantity}])),{
    P007:{color:'Black',size:'S',quantity:2},
    P001:{color:'White',size:'S',quantity:3},
    P015:{color:'Black',size:null,quantity:1},
    P014:{color:'Blue',size:'1L',quantity:2}
  });
});

test('multiple items can be removed from an active cart without losing checkout state',async()=>{
  const customer='cart-multi-remove';
  await ask('default',customer,'I want 2 black small Fleece Hoodies and 1 black Urban Backpack');
  let response=await ask('default',customer,'remove fleece hoodie and urban backpack');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/Removed Fleece Hoodie, Urban Backpack|Removed Urban Backpack, Fleece Hoodie/i);
  assert.equal(await container.commerceRepository.getCart('default',customer),null);
});

test('confirmed order removal and addition preserve the order id and history',async()=>{
  const customer='confirmed-order-amendments';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  const catalog=container.catalogService.scope({tenant,capabilityId:'commerce',customerId:customer});
  const products=await catalog.listProducts();
  const line=(id,color,size,quantity)=>{const product=products.find(entry=>entry.id===id);return {productId:id,name:product.name,color,size,quantity,variantSelectionRequired:Boolean(product.colors?.length||product.sizes?.length)};};
  await commerce.startCart(line('P012','Black','40',1));
  await commerce.addItem(line('P008','Black','M',1));
  await commerce.addItem(line('P015','Black',null,1));
  await commerce.updateCheckout({name:'Akbar',phone:'03024567876',city:'Lahore',address:'House 1 Ali Town Lahore',landmark:'Station',paymentMethod:'Cash on Delivery'});
  const created=await commerce.createOrder({catalog});

  let response=await ask('default',customer,'remove comfort slides and polo shirt from my order');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,new RegExp(created.id));
  let stored=await container.commerceRepository.getOrder('default',created.id);
  assert.equal(stored.id,created.id);
  assert.equal(stored.revision,2);
  assert.deepEqual(stored.items.map(item=>item.productId),['P015']);

  response=await ask('default',customer,'add Fleece Hoodie black small quantity 2 to my order');
  assert.match(response.reply,/Updated order/i);
  stored=await container.commerceRepository.getOrder('default',created.id);
  assert.equal(stored.revision,3);
  assert.equal(stored.items.find(item=>item.productId==='P007').quantity,2);

  response=await ask('default',customer,'show my order history');
  assert.match(response.reply,new RegExp(created.id));
  assert.match(response.reply,/revision 3/i);
  assert.match(response.reply,/Urban Backpack/);
  assert.match(response.reply,/Fleece Hoodie/);
});

test('generic booking tenants persist proposed post-booking schedule changes without replacing the original slot',async()=>{
  const tenant=container.tenantRepository.getById('salon-demo');
  const booking=container.bookingService.scope({tenant,customerId:'salon-amendment',conversationId:'salon-amendment-conversation'});
  const record=await booking.create({subject:'Haircut',date:'21/08/2026',time:'10:00',name:'Sara',phone:'03001234567'});
  const updated=await booking.proposeAmendment(record.id,{date:'22/08/2026',time:'11:00',requestedAt:new Date().toISOString()});
  assert.equal(updated.id,record.id);
  assert.equal(updated.slots.date,'21/08/2026');
  assert.equal(updated.slots.time,'10:00');
  assert.equal(updated.proposedChanges[0].date,'22/08/2026');
  assert.equal(updated.proposedChanges[0].status,'pending_availability');
  assert.equal(updated.revision,2);
  assert.equal((await booking.list()).length,1);
  const itemChange=await booking.proposeAmendment(record.id,{type:'items_amendment',action:'replace',items:[{id:'hair-color',name:'Hair Color'}]});
  assert.equal(itemChange.id,record.id);
  assert.equal(itemChange.revision,3);
  assert.equal(itemChange.proposedChanges[1].action,'replace');
  assert.equal(itemChange.slots.subject,'Haircut');
});
