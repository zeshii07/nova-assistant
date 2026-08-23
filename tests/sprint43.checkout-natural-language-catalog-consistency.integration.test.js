const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
async function q(u,text){return c.executionEngine.process({tenantId:'default',channel:'v75',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('unavailable product cleanup removes greeting/article and typo hve still reaches Catalog',async()=>{
 let r=await q('cap1','hello i want to purchase a cap');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/\bcap\b/i);
 assert.doesNotMatch(r.reply,/hello a cap/i);
 r=await q('cap2','do you hve caps');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/caps/i);
 assert.match(r.reply,/not available|don.t have/i);
});

test('multi-product extraction keeps Smart Watch, Polo Shirt and Gel Pen Pack',async()=>{
 const r=await q('multi','ok i want a smart watch a polo shirt and gel pen pack');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/Smart Watch/);
 assert.match(r.reply,/Polo Shirt/);
 assert.match(r.reply,/Gel Pen Pack/);
});

test('other watches is related browsing, not an unavailable fake product',async()=>{
 const u='watch';
 let r=await q(u,'i want a polo shirt');r=await q(u,'black');r=await q(u,'s');r=await q(u,'1');r=await q(u,'ok');
 assert.match(r.reply,/name/i);
 r=await q(u,'i want to check other watches you have');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/Smart Watch/i);
 assert.doesNotMatch(r.reply,/check other watches you have.*not available/is);
 assert.equal(r.state.capabilityState.commerce.pendingField,'name');
});

test('confirm before missing checkout detail asks for missing detail instead of validating it as name',async()=>{
 const u='continue';
 let r=await q(u,'i want a school bag');r=await q(u,'black 1 piece');r=await q(u,'ok');
 assert.match(r.reply,/name/i);
 r=await q(u,'ok then confirm my order');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/still need your full name|name/i);
 assert.doesNotMatch(r.reply,/not your name/i);
});

test('natural checkout phrases parse name, phone and city without Catalog stealing them',async()=>{
 const u='natural';
 let r=await q(u,'i want a school bag');r=await q(u,'black 1 piece');r=await q(u,'ok');
 r=await q(u,'yeah offcourse my name is zeeshan');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/phone/i);
 r=await q(u,'it is 03019299608');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/city/i);
 r=await q(u,'i want it in lahore');assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/address/i);
 const crm=await c.crmService.getCustomer('default',u);
 assert.equal(crm.name,'Zeeshan');
 assert.equal(crm.phone,'03019299608');
 assert.equal(crm.customFields.lastDelivery.city,'lahore');
});
