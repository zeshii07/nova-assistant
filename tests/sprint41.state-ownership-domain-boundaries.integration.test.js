const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
async function q(tenant,u,text){return c.executionEngine.process({tenantId:tenant,channel:'v62',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('cleaning price question interrupts pending date and offers custom quote for non-standard scope',async()=>{
 const u='clean-quote';
 let r=await q('cleaning-demo',u,'i want my full ground floor of office to be cleaned');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/date/i);
 r=await q('cleaning-demo',u,'what is price for cleaning complete floor containing 8 shops');
 assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Office Cleaning/i);assert.match(r.reply,/custom quotation/i);assert.doesNotMatch(r.reply,/Please enter a date/i);
});

test('unrelated business-domain queries do not return arbitrary cleaning offerings',async()=>{
 for(const text of ['What doctors and services do you have?','Tell me about admissions and class programs','I want white running shoes size 42']){
   const r=await q('cleaning-demo','cross-'+text,text);assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/configured as a cleaning business/i);assert.doesNotMatch(r.reply,/Standard Home Cleaning.*Deep Home Cleaning/s);
 }
});

test('healthcare doctor query reports configured services and refuses invented provider names',async()=>{
 let r=await q('healthcare-demo','clinic','What doctors and services do you have?');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/General Consultation/);assert.match(r.reply,/doctor\/provider profiles/i);
 r=await q('healthcare-demo','clinic2','dont you have any doctor on board');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/doctor\/provider profiles/i);
});

test('configured school-bag alias resolves to Urban Backpack exactly',async()=>{
 const r=await q('default','schoolbag','ohh i want a school bag do you have');
 assert.equal(r.capabilityId,'catalog');assert.match(r.reply,/Urban Backpack/);
 assert.equal(r.state.capabilityState.catalog?.selectedProductId,'P015');
});

test('single suggested alternative can be explicitly accepted with attributes and added during checkout',async()=>{
 const u='side-add';
 let r=await q('default',u,'I want white running shoes size 42');r=await q('default',u,'3');r=await q('default',u,'confirm');
 r=await q('default',u,'my name is zeeshan ahmad');r=await q('default',u,'03019299608');assert.equal(r.state.capabilityState.commerce.pendingField,'city');

 r=await q('default',u,'ohh i want a school bag do you have');assert.match(r.reply,/Urban Backpack/);assert.equal(r.state.capabilityState.commerce.pendingField,'city');
 r=await q('default',u,'black one 5 pieces add this to order please');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Urban Backpack has been added/i);assert.match(r.reply,/Urban Backpack \(Black\) × 5/i);assert.match(r.reply,/Which city/i);
 assert.equal(r.state.capabilityState.commerce.pendingField,'city');

 r=await q('default',u,'show my full cart');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Running Shoes/);assert.match(r.reply,/Urban Backpack/);assert.match(r.reply,/Which city/i);
 r=await q('default',u,'black');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/not a delivery city/i);assert.equal(r.state.capabilityState.commerce.pendingField,'city');
});

test('show my order during active checkout means current cart, not a product draft',async()=>{
 const u='show-order';let r=await q('default',u,'I want white running shoes size 42');r=await q('default',u,'1');r=await q('default',u,'confirm');
 r=await q('default',u,'show my order');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Your cart|Order Summary/i);assert.match(r.reply,/Running Shoes/);
});
