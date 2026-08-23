const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer();});
async function msg(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v33',customerId:u,text});}

test('bare number words fill active catalog quantity',async()=>{
 const u='v33-qty';
 await msg('default',u,'i want polo shirt');
 await msg('default',u,'white small');
 const r=await msg('default',u,'five');
 assert.equal(r.state.capabilityState.catalog.selectedAttributes.quantity,5);
 assert.match(r.reply,/Quantity: 5|Quantity.*5/i);
});

test('other shirts stays in shirt family, not all clothing',async()=>{
 const u='v33-shirts';
 await msg('default',u,'mujhy shirt lyni thi');
 const r=await msg('default',u,'koi aur shirts nhn hain kia');
 assert.match(r.reply,/Cotton T-Shirt/i);
 assert.match(r.reply,/Polo Shirt/i);
 assert.doesNotMatch(r.reply,/Denim Jeans/i);
});

test('Roman Urdu add-to-order preserves first cart item and browses generic shoes',async()=>{
 const u='v33-cart';
 await msg('default',u,'i want polo shirt white small');
 await msg('default',u,'5');
 const add=await msg('default',u,'is mi aik shoes bhi add kr do');
 assert.equal(add.capabilityId,'commerce');
 assert.match(add.reply,/Running Shoes/i);
 assert.match(add.reply,/Comfort Slides/i);
 await msg('default',u,'running shoes');
 await msg('default',u,'black 42');
 await msg('default',u,'10');
 const checkout=await msg('default',u,'confirm order');
 assert.match(checkout.reply,/Polo Shirt/i);
 assert.match(checkout.reply,/Running Shoes/i);
});

test('cleaning understands Roman Urdu hour variants and preserves duration',async()=>{
 const u='v33-clean';
 const a=await msg('cleaning-demo',u,'mujhy aik cleaner chahiy aik ghanty k liyy');
 assert.match(a.reply,/1.*hour|1 ghant|duration/i);
 const b=await msg('cleaning-demo',u,'2 hours k liyy home cleaning');
 assert.equal(b.state.capabilityState.cleaning.durationHours,2);
 assert.match(b.reply,/2.*hour|duration/i);
});

test('education fuzzy followups, fee intent, campus location and Roman self intro work',async()=>{
 const u='v33-edu';
 const hello=await msg('education-demo',u,'hello main zeeshan hn');
 assert.match(hello.reply,/Zeeshan|education/i);
 const a=await msg('education-demo',u,'ok show me dmissions');
 assert.match(a.reply,/Admission Inquiry/i);
 const fee=await msg('education-demo',u,'i want fee information for grade primary');
 assert.match(fee.reply,/Primary Program|Fee information/i);
 const loc=await msg('education-demo',u,'ok where t visit campus');
 assert.match(loc.reply,/Model Town|Location/i);
});

test('generic offering order engine can order restaurant menu items',async()=>{
 const u='v33-food';
 await msg('restaurant-demo',u,'can i see menu food');
 await msg('restaurant-demo',u,'i want chicken biryani');
 const direct=await msg('restaurant-demo',u,'ok confirm this item');
 assert.match(direct.reply,/Order confirmed|Reference/i);

 const u2='v33-food2';
 const start=await msg('restaurant-demo',u2,'i want to order chicken biryani');
 assert.match(start.reply,/Order Summary|confirm/i);
 const done=await msg('restaurant-demo',u2,'ok confirm');
 assert.match(done.reply,/Order confirmed|Reference/i);
});

test('active salon booking accepts wrapped and combined date/time values',async()=>{
 const u='v33-salon';
 await msg('salon-demo',u,'can i book an appointment for hair cut');
 const d=await msg('salon-demo',u,'i want on 23/3/2027');
 assert.match(d.reply,/time/i);
 const u2='v33-salon2';
 await msg('salon-demo',u2,'can i book an appointment for hair cut');
 const both=await msg('salon-demo',u2,'date 24/02/2027 and time 9 pm');
 assert.match(both.reply,/name/i);
 assert.equal(both.state.capabilityState.booking.slots.date,'24/02/2027');
 assert.equal(both.state.capabilityState.booking.slots.time,'9 pm');
});
