const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer();});
async function msg(t,u,text){return c.executionEngine.process({tenantId:t,channel:'test',customerId:u,text});}

test('retail strict resolution never silently maps skinny jeans to Denim Jeans',async()=>{
 const a=await msg('default','v31-retail','hello can i get skinny jeans');
 assert.notEqual(a.intelligence?.selected?.intent,'catalog.product_interest');
 assert.match(a.reply,/don.t have|available|closest/i);
 const b=await msg('default','v31-retail','no i want skinny jeans');
 assert.notEqual(b.intelligence?.selected?.intent,'catalog.product_interest');
});

test('salon booking pending name is interrupted by a new unsupported service question',async()=>{
 await msg('salon-demo','v31-salon','i want haircut tomorrow');
 await msg('salon-demo','v31-salon','5 pm');
 const q=await msg('salon-demo','v31-salon','do you offer deep hair removal');
 assert.equal(q.capabilityId,'offering');
 assert.match(q.reply,/don.t see|available|configured/i);
 assert.doesNotMatch(q.reply,/phone number/i);
});

test('salon different-service request is not consumed as booking phone/name',async()=>{
 await msg('salon-demo','v31-salon2','i want haircut tomorrow');
 await msg('salon-demo','v31-salon2','5 pm');
 const q=await msg('salon-demo','v31-salon2','no i want different service');
 assert.notEqual(q.capabilityId,'booking');
});

test('commerce pending delivery name is interrupted by a new catalog request',async()=>{
 await msg('default','v31-commerce','i want black running shoes size 42 2 pieces');
 await msg('default','v31-commerce','confirm');
 const q=await msg('default','v31-commerce','do you offer maxi for girls');
 assert.notEqual(q.intelligence?.selected?.intent,'commerce.checkout_input');
 assert.doesNotMatch(q.reply,/won.t save that as your name/i);
});

test('clinic unknown treatment is explicitly unavailable, never silently substituted',async()=>{
 const q=await msg('healthcare-demo','v31-clinic','do you offer TB treatment');
 assert.equal(q.capabilityId,'offering');
 assert.equal(q.intelligence?.selected?.intent,'offering.unavailable');
 assert.match(q.reply,/don.t see|available options/i);
});

test('tenant greeting uses the selected tenant branding',async()=>{
 const q=await msg('salon-demo','v31-greeting','hello');
 assert.match(q.reply,/salon/i);
 assert.doesNotMatch(q.reply,/healthcare/i);
});
