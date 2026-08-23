const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c; test.before(async()=>{c=await buildContainer();});
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v42',customerId:u,text});}

test('generic cleaner duration quotes the configured hourly rate directly without service menu',async()=>{
 let r=await q('cleaning-demo','cl1','i want a cleaner for two hours');
 assert.equal(r.capabilityId,'cleaning'); assert.match(r.reply,/AED 80/); assert.doesNotMatch(r.reply,/Standard Home Cleaning/);
 r=await q('cleaning-demo','cl2','i need 3 cleaners for 4 hours');
 assert.match(r.reply,/AED 480/); assert.doesNotMatch(r.reply,/which service|Available options/i);
});

test('cleaning uses the same name then contact-number format',async()=>{
 const u='cl3';
 let r=await q('cleaning-demo',u,'i need sofa cleaning');
 r=await q('cleaning-demo',u,'24 august');
 r=await q('cleaning-demo',u,'9 am');
 r=await q('cleaning-demo',u,'House 12 Model Town Lahore');
 assert.match(r.reply,/full name/i);
 r=await q('cleaning-demo',u,'Zeeshan Ahmad');
 assert.match(r.reply,/best contact phone number to reach you/i);
});

test('salon compound appointment captures service and embedded name, then date+time continues',async()=>{
 const u='sal1';
 let r=await q('salon-demo',u,'can can i have a hair cut appoint for the name zeeshan');
 assert.equal(r.capabilityId,'booking'); assert.match(r.reply,/date/i);
 assert.equal(r.state.capabilityState.booking.slots.name,'Zeeshan');
 r=await q('salon-demo',u,'date is 24 august and time 10 am');
 assert.equal(r.capabilityId,'booking');
 assert.match(r.reply,/best contact phone number to reach you/i);
 assert.equal(r.state.capabilityState.booking.slots.time,'10 am');
});
