const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');let c;
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v7-mem-reg',customerId:u,text});}
test.before(async()=>{c=await buildContainer();if(c.llmRouter)c.llmRouter.providers=[];});

test('checkout profile/name question interrupts phone collection instead of becoming invalid phone',async()=>{
 // Supply required product variants so this test exercises checkout/profile
 // interruption behavior rather than the multi-item missing-options guard.
 const u='name-side';let r=await q('default',u,'i want a black notebook and black school bag');
 r=await q('default',u,'confirm order');
 if(!/name/i.test(r.reply)) r=await q('default',u,'confirm');
 r=await q('default',u,'mera name zeeshan hai');
 assert.match(r.reply,/phone/i);
 r=await q('default',u,'mera name kia hai');
 assert.equal(r.capabilityId,'crm');assert.match(r.reply,/Zeeshan/i);assert.doesNotMatch(r.reply,/phone number is not valid/i);
});

test('Roman Urdu product request interrupts checkout pending field',async()=>{
 const u='roman-add';let r=await q('default',u,'i want a notebook');r=await q('default',u,'1');r=await q('default',u,'confirm');r=await q('default',u,'Zeeshan Ahmad');
 assert.match(r.reply,/phone/i);
 r=await q('default',u,'mujhy aik jota bhi chahiyy');
 assert.ok(['catalog','commerce'].includes(r.capabilityId));assert.match(r.reply,/Running Shoes|Footwear/i);assert.doesNotMatch(r.reply,/phone number is not valid/i);
 if(r.capabilityId==='commerce'){assert.equal(r.state.capabilityState.commerce.mode,'paused_add_item');assert.equal(r.state.capabilityState.commerce.resumeCheckout.pendingField,'phone');}
});

test('cleaning scope clarification while waiting for date is stored, not validated as date',async()=>{
 const u='scope';let r=await q('cleaning-demo',u,'hello i want a cleaning service for my office');assert.match(r.reply,/date/i);
 r=await q('cleaning-demo',u,'i want my office with two rooms should be cleaned');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/2 rooms/i);assert.match(r.reply,/date/i);assert.doesNotMatch(r.reply,/date.*not|enter a date/i);
 assert.match(r.state.capabilityState.cleaning.scopeText,/two rooms/i);
 r=await q('cleaning-demo',u,'what will be price for this service');
 assert.match(r.reply,/custom quotation/i);assert.doesNotMatch(r.reply,/Please enter a date/i);
});

test('greeting plus opening-hours question answers the business task',async()=>{
 const r=await q('default','hours','hello what are your opening hours');
 assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/Monday to Saturday|9:00 AM/i);assert.doesNotMatch(r.reply,/find products, compare options/i);
});

test('placeholder structured return fact falls through to uploaded tenant policy',async()=>{
 const r=await q('default','returns','what is your return policy');
 assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/7 days/i);assert.match(r.reply,/unused|undamaged/i);
});
