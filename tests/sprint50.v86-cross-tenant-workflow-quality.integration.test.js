const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');

let container;
async function ask(tenantId,customerId,text){
  return container.executionEngine.process({tenantId,channel:'v86',customerId,text});
}

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v86-data-'));
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test('cleaning confirmation accepts a bounded common typo',async()=>{
  const customer='cleaning-typo-confirm';
  let response=await ask('cleaning-demo',customer,'I need one cleaner for 2 hours tomorrow at 9:00 AM');
  assert.equal(response.capabilityId,'cleaning');
  response=await ask('cleaning-demo',customer,'House 12, Marina Vista');
  response=await ask('cleaning-demo',customer,'James Khan');
  response=await ask('cleaning-demo',customer,'03012345678');
  assert.equal(response.state.capabilityState.cleaning.step,'confirm');

  response=await ask('cleaning-demo',customer,'ok confim booking');
  assert.equal(response.capabilityId,'cleaning');
  assert.match(response.reply,/request has been received/i);
});

test('salon compound request preserves services, explicit date, window, price, duration, and hair length',async()=>{
  const response=await ask('salon-demo','salon-compound',`Hi, I’d like to book a hair color, haircut, and blow-dry for Friday, 21 August, preferably between 2:00 PM and 5:00 PM. My hair is shoulder-length. Could you tell me the estimated price and how long the appointment will take?`);
  assert.equal(response.capabilityId,'booking');
  assert.equal(response.intelligence.selected.intent,'booking.start');
  const state=response.state.capabilityState.booking;
  assert.deepEqual(state.items.map(x=>x.id),['hair-color','haircut','hair-styling']);
  assert.equal(state.slots.date,'21/08/2026');
  assert.equal(state.slots.time,'2:00 pm');
  assert.equal(state.metadata.preferredEndTime,'17:00');
  assert.equal(state.metadata.hairLength,'shoulder-length');
  assert.match(response.reply,/From Rs8,500/i);
  assert.match(response.reply,/3 hours 45 minutes/i);
  assert.match(response.reply,/final hair color price.*hair length/i);
});

test('completed salon booking moves only after the connected calendar confirms capacity',async()=>{
  const customer='salon-reschedule';
  let response=await ask('salon-demo',customer,'Book a haircut for Saturday, 22 August at 2:00 PM. My name is James Khan and my phone is 03012345678.');
  assert.equal(response.state.capabilityState.booking.status,'ready');
  response=await ask('salon-demo',customer,'confirm');
  const original=response.state.capabilityState.booking;
  assert.equal(original.status,'completed');

  response=await ask('salon-demo',customer,'Can you move my appointment to the same day after 6:00 PM? If nothing is available, please keep my original booking.');
  assert.equal(response.intelligence.selected.intent,'booking.reschedule_request');
  assert.match(response.reply,/now confirmed.*6:00 pm/i);
  const current=response.state.capabilityState.booking;
  assert.equal(current.bookingId,original.bookingId);
  assert.equal(current.slots.date,original.slots.date);
  assert.equal(current.slots.time,'6:00 pm');
  assert.equal(current.metadata.calendarEventId,original.metadata.calendarEventId);
});

test('retail parses two variants of the same product as two quantity-one cart lines',async()=>{
  const customer='retail-same-product-variants';
  const response=await ask('default',customer,'I want to order 2 Cotton T-Shirts, one black in Medium and one white in Large. Please show me the total before placing the order.');
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.equal(cart.items.length,2);
  assert.deepEqual(cart.items.map(x=>({productId:x.productId,color:x.color,size:x.size,quantity:x.quantity})),[
    {productId:'P001',color:'Black',size:'M',quantity:1},
    {productId:'P001',color:'White',size:'L',quantity:1}
  ]);
  assert.match(response.reply,/Total: Rs3,000/);
  assert.equal((await container.commerceRepository.listOrders('default',customer)).length,0);
});

test('retail treats numeric shoe size as a variant and asks for missing colors transactionally',async()=>{
  const customer='retail-mixed-variants';
  const response=await ask('default',customer,'I want to order one black Cotton T-Shirt in Large, one Fleece Hoodie in Medium, and Running Shoes in size 42. Please show me the total before placing the order.');
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  assert.match(response.reply,/Fleece Hoodie.*color.*Black, Grey, Maroon/is);
  assert.match(response.reply,/Running Shoes.*color.*Black, White, Grey/is);
  assert.doesNotMatch(response.reply,/Running Shoes × 42/);
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.ok(!cart||cart.items.length===0);
});

test('retail cart commands outrank checkout fields and wrapped names are normalized',async()=>{
  const customer='retail-checkout-edit';
  let response=await ask('default',customer,'I want 7 black Running Shoes in size 42');
  assert.equal(response.capabilityId,'catalog');
  response=await ask('default',customer,'confirm order');
  assert.equal(response.state.capabilityState.commerce.pendingField,'name');

  response=await ask('default',customer,'decrease the quantity of Running Shoes to only 1, its size is 42');
  assert.equal(response.intelligence.selected.intent,'commerce.cart.update_quantity');
  assert.match(response.reply,/quantity is now 1/i);
  assert.match(response.reply,/full name/i);
  assert.equal(response.state.capabilityState.commerce.pendingField,'name');

  response=await ask('default',customer,'ok zeeshan ahmad');
  assert.equal(response.state.capabilityState.commerce.pendingField,'phone');
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.equal(cart.checkout.name,'Zeeshan Ahmad');
  assert.equal(cart.items[0].quantity,1);
});

test('retail final order preflight never exposes a generic capability error',async()=>{
  const customer='retail-order-complete';
  await ask('default',customer,'I want one black Running Shoes in size 42');
  await ask('default',customer,'confirm order');
  await ask('default',customer,'Zeeshan Ahmad');
  await ask('default',customer,'03012345678');
  await ask('default',customer,'Lahore');
  await ask('default',customer,'House 12 Model Town');
  await ask('default',customer,'skip');
  await ask('default',customer,'cod');
  const response=await ask('default',customer,'ok confirm');
  assert.match(response.reply,/order is confirmed/i);
  assert.doesNotMatch(response.reply,/could not complete/i);
  assert.equal((await container.commerceRepository.listOrders('default',customer)).length,1);
});

test('restaurant reservation questions stay in booking and make no live availability promise',async()=>{
  let response=await ask('restaurant-demo','restaurant-large-table','I need a table for 10 people this Friday at 7:30 PM. Do you have space? If not, what is the closest available time?');
  assert.equal(response.capabilityId,'booking');
  assert.equal(response.intelligence.selected.intent,'booking.start');
  assert.equal(response.state.capabilityState.booking.slots.partySize,10);
  assert.match(response.reply,/cannot confirm live table availability or the closest time/i);
  assert.doesNotMatch(response.reply,/Chicken Biryani.*Beef Burger/is);

  response=await ask('restaurant-demo','restaurant-evening','I would like to reserve a table tomorrow evening.');
  assert.equal(response.capabilityId,'booking');
  assert.equal(response.state.capabilityState.booking.slots.date,container.engagementService.parseField('date','tomorrow',{allowPast:false}).value);
  assert.equal(response.state.capabilityState.booking.pendingField,'time');
  assert.match(response.reply,/exact time/i);
});

test('restaurant menu-first conditional request browses matching dishes before reservation',async()=>{
  const customer='restaurant-menu-first';
  let response=await ask('restaurant-demo',customer,`I’m planning dinner for 4 people this Sunday at 7:00 PM. Could you first tell me what chicken and pasta dishes you have and their prices? If the menu looks good, I’d like to reserve a table.`);
  assert.equal(response.capabilityId,'offering');
  assert.equal(response.intelligence.selected.intent,'offering.browse');
  assert.match(response.reply,/Chicken Biryani/);
  assert.match(response.reply,/Grilled Chicken/);
  assert.match(response.reply,/Alfredo Pasta/);
  assert.doesNotMatch(response.reply,/Beef Burger/);
  assert.equal(response.state.capabilityState.booking,undefined);

  response=await ask('restaurant-demo',customer,'Reserve a table this Sunday at 7:00 PM for 4 people. My name is James Khan and my phone is 03012345678.');
  assert.equal(response.state.capabilityState.booking.status,'ready');
  response=await ask('restaurant-demo',customer,'add chicken to the order');
  assert.equal(response.intelligence.selected.intent,'booking.add_item_clarify');
  assert.match(response.reply,/Chicken Biryani/);
  assert.match(response.reply,/Grilled Chicken/);

  response=await ask('restaurant-demo',customer,'add grilled chicken');
  assert.equal(response.intelligence.selected.intent,'booking.add_item');
  assert.match(response.reply,/Grilled Chicken/);
  assert.equal(response.state.capabilityState.booking.status,'ready');
});
