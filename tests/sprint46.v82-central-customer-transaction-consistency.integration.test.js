
const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
const {CustomerDataBridge}=require('../packages/customer-data/src/customerDataBridge');
let c;
async function q(tenant,u,text){return c.executionEngine.process({tenantId:tenant,channel:'v82test',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('central customer bridge works for an unseen capability state contract',async()=>{
 let saved=null;
 const crmService={
  ensureCustomer:async()=>({tenantId:'future',customerId:'u',customFields:{}}),
  updateCustomerProfile:async p=>(saved=p)
 };
 const bridge=new CustomerDataBridge({crmService});
 await bridge.sync({
  tenantId:'future',customerId:'u',channel:'future-channel',language:'english',
  result:{statePatch:{capabilityState:{futureCapability:{fields:{name:'Future User',phone:'03012345678',address:'Future Street'}}}}}
 });
 assert.equal(saved.name,'Future User');
 assert.equal(saved.phone,'03012345678');
 assert.equal(saved.customFields.lastKnownLocation.address,'Future Street');
});

test('generic Salon booking writes validated identity to CRM without Salon-specific CRM code',async()=>{
 const u='salon-crm';
 await q('salon-demo',u,'i want a haircut');
 await q('salon-demo',u,'24 august');
 await q('salon-demo',u,'5 pm');
 await q('salon-demo',u,'zeeshan ali');
 await q('salon-demo',u,'03019299808');
 const crm=await c.crmService.getCustomer('salon-demo',u);
 assert.equal(crm.name,'Zeeshan Ali');
 assert.equal(crm.phone,'03019299808');
});

test('generic Driving School booking inherits the same CRM persistence',async()=>{
 const u='drive-crm';
 await q('driving-school-demo',u,'i want an automatic car lesson');
 await q('driving-school-demo',u,'25 august');
 await q('driving-school-demo',u,'3 pm');
 await q('driving-school-demo',u,'ali raza');
 await q('driving-school-demo',u,'03011112222');
 const crm=await c.crmService.getCustomer('driving-school-demo',u);
 assert.equal(crm.name,'Ali Raza');
 assert.equal(crm.phone,'03011112222');
});

test('cleaning keeps explicit Deep Apartment Cleaning identity and writes CRM/request consistently',async()=>{
 const u='clean-central';
 let r=await q('cleaning-demo',u,'i want deep cleaning for 2 bedroom apartment');
 assert.match(r.reply,/Deep Apartment Cleaning/);
 assert.doesNotMatch(r.reply,/\$300/);
 await q('cleaning-demo',u,'26 august');
 await q('cleaning-demo',u,'11 am');
 await q('cleaning-demo',u,'dubai plaza dubai');
 await q('cleaning-demo',u,'haji bilal');
 await q('cleaning-demo',u,'03019299608');
 r=await q('cleaning-demo',u,'confirm');
 assert.match(r.reply,/Deep Apartment Cleaning/);
 const crm=await c.crmService.getCustomer('cleaning-demo',u);
 assert.equal(crm.name,'Haji Bilal');
 assert.equal(crm.phone,'03019299608');
 assert.equal(crm.customFields.lastKnownLocation.address,'dubai plaza dubai');
 const requests=await c.cleaningRequestRepository.listByCustomer('cleaning-demo',u);
 assert.equal(requests.length,1);
 assert.equal(requests[0].serviceName,'Deep Apartment Cleaning');
});

test('social gratitude prefix cannot swallow embedded product request',async()=>{
 const r=await q('default','mixed-social','ok thanks but i want a pair of shoes in black color');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/Running Shoes/);
 assert.match(r.reply,/Black/);
});

test('booking summary contains Subject only once',async()=>{
 const u='subject-once';
 await q('salon-demo',u,'i want a haircut');
 await q('salon-demo',u,'24 august');
 await q('salon-demo',u,'5 pm');
 await q('salon-demo',u,'zeeshan ali');
 const r=await q('salon-demo',u,'03019299808');
 assert.equal((r.reply.match(/Subject:/g)||[]).length,1);
});
