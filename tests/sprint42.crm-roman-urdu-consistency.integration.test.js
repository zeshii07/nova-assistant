const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
async function q(u,text){return c.executionEngine.process({tenantId:'default',channel:'v74',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('soft workflow acceptance ok confirms a ready catalog item',async()=>{
 const u='soft-ok';
 let r=await q(u,'i want a school bag');
 r=await q(u,'black 2 pieces');
 assert.equal(r.capabilityId,'catalog');
 r=await q(u,'ok');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/Urban Backpack/i);
 assert.match(r.reply,/name/i);
});

test('Roman Urdu add kro confirms a completed product draft',async()=>{
 const u='add-kro';
 let r=await q(u,'mujhy shoes chahiyy');
 r=await q(u,'black 42');
 r=await q(u,'3');
 r=await q(u,'ok add kro');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/Running Shoes/i);
 assert.match(r.reply,/naam|name/i);
});

test('validated checkout identity writes through to CRM immediately',async()=>{
 const u='crm-sync';
 let r=await q(u,'i want a school bag');
 r=await q(u,'black 1 piece');
 r=await q(u,'confirm');
 r=await q(u,'zeeshan ahmad');
 r=await q(u,'03019299608');
 const crm=await c.crmService.getCustomer('default',u);
 assert.equal(crm.name,'Zeeshan Ahmad');
 assert.equal(crm.phone,'03019299608');
});

test('completed checkout persists CRM profile and show my details routes to CRM',async()=>{
 const u='crm-details';
 let r=await q(u,'i want a school bag');
 r=await q(u,'black 1 piece');
 r=await q(u,'confirm');
 r=await q(u,'zeeshan ahmad');
 r=await q(u,'03019299608');
 r=await q(u,'lahore');
 r=await q(u,'thokar niaz baig lahore');
 r=await q(u,'skip');
 r=await q(u,'cash on delivery');
 r=await q(u,'confirm');
 assert.equal(r.capabilityId,'commerce');
 r=await q(u,'show my details');
 assert.equal(r.capabilityId,'crm');
 assert.match(r.reply,/Zeeshan Ahmad/);
 assert.match(r.reply,/03019299608/);
 assert.match(r.reply,/lahore/i);
 const state=await c.stateRepository.get('default','default:v74:'+u);
 assert.equal(state?.capabilityState?.catalog?.selectedProductId??null,null);
});

test('CRM profile remains tenant-scoped',async()=>{
 const u='same-person';
 await c.crmService.updateCustomerProfile({tenantId:'default',customerId:u,name:'Retail Zeeshan',phone:'03019299608'});
 const other=await c.crmService.getCustomer('cleaning-demo',u);
 assert.equal(other,null);
});
