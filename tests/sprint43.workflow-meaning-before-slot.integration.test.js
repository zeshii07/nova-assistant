const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
async function q(tenant,u,text){return c.executionEngine.process({tenantId:tenant,channel:'v73',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('active school-bag draft consumes black + quantity instead of reopening Bags category',async()=>{
 const u='bag-draft';
 let r=await q('default',u,'mujhy aik school bag lyna hai');
 assert.equal(r.capabilityId,'catalog');assert.match(r.reply,/Urban Backpack/);
 r=await q('default',u,'mujhy black color 5 bags chhiy');
 assert.equal(r.capabilityId,'catalog');assert.match(r.reply,/Urban Backpack/);assert.match(r.reply,/Color: Black/i);assert.match(r.reply,/Quantity: 5/i);assert.doesNotMatch(r.reply,/Bags mein ye options/i);
});

test('Roman Urdu shopping interruption cannot become checkout name or address',async()=>{
 const u='checkout-urdu';
 let r=await q('default',u,'school bag');r=await q('default',u,'black 2 pieces');r=await q('default',u,'confirm');
 assert.equal(r.state.capabilityState.commerce.pendingField,'name');
 r=await q('default',u,'mujhy aik bottle bhi lyni hai');
 assert.notEqual(r.state.capabilityState.commerce?.checkout?.name,'Mujhy Aik Bottle Bhi Lyni Hai');
 assert.match(r.reply,/Steel Water Bottle|bottle/i);
 // Finish bottle then make sure checkout returns to name, not phone.
 if(r.capabilityId==='commerce'||r.capabilityId==='catalog'){
   r=await q('default',u,'black 1l');r=await q('default',u,'1');r=await q('default',u,'confirm');
 }
 assert.equal(r.state.capabilityState.commerce.pendingField,'name');
 r=await q('default',u,'Zeeshan Ahmad');assert.equal(r.state.capabilityState.commerce.pendingField,'phone');
 r=await q('default',u,'03019299608');r=await q('default',u,'lahore');assert.equal(r.state.capabilityState.commerce.pendingField,'address');
 r=await q('default',u,'aik sunglasses bhi chahiyy');
 assert.match(r.reply,/Sunglasses/i);assert.equal(r.state.capabilityState.commerce.mode,'paused_add_item');assert.equal(r.state.capabilityState.commerce.resumeCheckout.pendingField,'address');
 r=await q('default',u,'black 1 piece');r=await q('default',u,'confirm');assert.equal(r.state.capabilityState.commerce.pendingField,'address');
});

test('singular sunglass resolves to configured Sunglasses product',async()=>{
 const r=await q('default','sunglass','i want a sunglass also');
 assert.ok(['catalog','commerce'].includes(r.capabilityId));assert.match(r.reply,/Sunglasses/);assert.doesNotMatch(r.reply,/don.t have a sunglass/i);
});

test('cleaner arrival question is informational and does not become a service-list request',async()=>{
 const u='arrival';let r=await q('cleaning-demo',u,'i want a cleaner for 3 hours');assert.equal(r.state.capabilityState.cleaning.step,'date');
 r=await q('cleaning-demo',u,'when will cleaner arrive for a service');assert.equal(r.capabilityId,'availability');assert.match(r.reply,/confirmed booking time/i);assert.doesNotMatch(r.reply,/Our services:/i);assert.equal(r.state.capabilityState.cleaning.step,'date');
});

test('hourly cleaning cleaner-count change beats pending date validation',async()=>{
 const u='cleaner-count';
 let r=await q('cleaning-demo',u,'hello i want to book a cleaner for 7 hours');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/AED 280/);assert.equal(r.state.capabilityState.cleaning.step,'date');
 r=await q('cleaning-demo',u,'actually i want 3 cleaners');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/3 cleaners × 7 hours/i);assert.match(r.reply,/AED 840/);assert.equal(r.state.capabilityState.cleaning.cleanerCount,3);assert.equal(r.state.capabilityState.cleaning.step,'date');assert.doesNotMatch(r.reply,/Please enter a date/i);
});
