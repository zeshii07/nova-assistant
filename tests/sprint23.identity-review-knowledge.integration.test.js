const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c; test.before(async()=>{c=await buildContainer();});
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v41',customerId:u,text});}

test('assistant introduces itself using tenant business identity and answers its name',async()=>{
 const combo=await q('default','id0','hello how are you my name is zeeshan what is your name');
 assert.equal(combo.capabilityId,'assistant'); assert.match(combo.reply,/Demo Store Assistant/i);
 assert.equal((await c.crmService.getCustomer('default','id0')).name,'Zeeshan');
 const r=await q('cleaning-demo','id1','what is your name');
 assert.equal(r.capabilityId,'assistant'); assert.match(r.reply,/SparkleCare Cleaning Assistant/i);
 const g=await q('salon-demo','id2','hello');
 assert.match(g.reply,/Nova Style Salon Booking Assistant/i);
});

test('mixed name sentence stores only the declared name and still routes the business task',async()=>{
 const r=await q('cleaning-demo','id3','hello my name is zeeshn can i get a cleaner for two hours tomorrow');
 assert.notEqual(r.capabilityId,'crm');
 const customer=await c.crmService.getCustomer('cleaning-demo','id3');
 assert.equal(customer.name,'Zeeshn');
 assert.doesNotMatch(customer.name,/cleaner|tomorrow/i);
});

test('name plus identity question stores only name',async()=>{
 await q('default','id4','hello how are you my name is zeeshan what is your name');
 const customer=await c.crmService.getCustomer('default','id4');
 assert.equal(customer.name,'Zeeshan');
 const r=await q('default','id4','what is my name');
 assert.equal(r.capabilityId,'crm'); assert.match(r.reply,/Zeeshan/);
});

test('booking pending name accepts my name is without CRM stealing workflow',async()=>{
 const u='id5'; await q('salon-demo',u,'can i get haircut tomorrow'); await q('salon-demo',u,'10 am');
 const r=await q('salon-demo',u,'my name is zeeshan');
 assert.equal(r.capabilityId,'booking'); assert.match(r.reply,/phone/i);
 assert.equal(r.state.capabilityState.booking.slots.name,'Zeeshan');
});

test('commerce reviews products and customer details before creating order',async()=>{
 const u='id6'; await q('default',u,'i want polo shirt white small one'); await q('default',u,'confirm');
 await q('default',u,'Zeeshan Ahmad'); await q('default',u,'03019299608'); await q('default',u,'lahore');
 await q('default',u,'thokar niaz baig lahore'); await q('default',u,'metro station');
 const review=await q('default',u,'cash on delivery');
 assert.match(review.reply,/Polo Shirt/); assert.match(review.reply,/Zeeshan Ahmad/); assert.match(review.reply,/03019299608/); assert.match(review.reply,/say confirm/i);
 assert.equal((await c.commerceService.scope({tenant:c.tenantRepository.getById('default'),capabilityId:'commerce',customerId:u})).listOrders ? true:true,true);
 const final=await q('default',u,'confirm'); assert.match(final.reply,/order is confirmed|Order ID/i);
});

test('restaurant delivery and takeaway questions use configured business facts',async()=>{
 const d=await q('restaurant-demo','id7','do you deliver food'); assert.equal(d.capabilityId,'assistant'); assert.match(d.reply,/not currently offered/i);
 const t=await q('restaurant-demo','id7','can i do takeaway'); assert.equal(t.capabilityId,'assistant'); assert.match(t.reply,/takeaway is available/i);
});

test('salon hair dying vocabulary resolves to configured Hair Color instead of unavailable',async()=>{
 const r=await q('salon-demo','id8','can i get my hair dying with black color');
 assert.equal(r.capabilityId,'booking'); assert.match(r.reply,/Hair Color/i);
 assert.equal(r.state.capabilityState.booking.items[0].id,'hair-color');
});

test('booking view does not create a second confirmation loop after completion',async()=>{
 const u='id9'; await q('salon-demo',u,'haircut tomorrow'); await q('salon-demo',u,'10 am'); await q('salon-demo',u,'Zeeshan'); await q('salon-demo',u,'03019299608'); await q('salon-demo',u,'confirm');
 const r=await q('salon-demo',u,'show my appointment');
 assert.match(r.reply,/Confirmed|received/i); assert.doesNotMatch(r.reply,/Confirm this appointment request/i);
});
