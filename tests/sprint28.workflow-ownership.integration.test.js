const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');

const tenantId='workflow-karyana-test';
const tenantDir=path.join(__dirname,'..','tenants',tenantId);
let c;
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v48',customerId:u,text});}

test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({
  id:tenantId,name:'Workflow Karyana',domain:'grocery',
  offerings:[
   {name:'Super Basmati Rice (1kg)',type:'product',category:'grains',price:340,unit:'kg',inStock:true,orderable:true,aliases:['rice','chawal','basmati rice']},
   {name:'Cooking Oil / Ghee (1 Litre / Pack)',type:'product',category:'cooking',price:520,unit:'pack',inStock:true,orderable:true,aliases:['cooking oil','oil','ghee']},
   {name:'Home Grocery Delivery',type:'service',category:'delivery',price:100,bookable:true,aliases:['home delivery']}
  ],
  faqs:[{question:'Can I pay via JazzCash?',answer:'Yes, we accept JazzCash, EasyPaisa, bank transfers, and cash on delivery.'}]
 });
 c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('add-item quantity reads the reply, not digits from the product name, and confirm belongs to Commerce',async()=>{
 const u='cart1';
 await q(tenantId,u,'do you have rice');
 let r=await q(tenantId,u,'2 kg');
 assert.equal(r.state.capabilityState.catalog.selectedAttributes.quantity,2);
 let cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:u}).getCart();
 assert.equal(cart.items.find(x=>/Rice/.test(x.name)).quantity,2);

 await q(tenantId,u,'what other products do you have');
 r=await q(tenantId,u,'add cooking oil to the order');
 assert.equal(r.capabilityId,'commerce');
 assert.equal(r.state.capabilityState.commerce.mode,'paused_add_item');

 r=await q(tenantId,u,'4');
 assert.equal(r.capabilityId,'catalog');
 assert.equal(r.state.capabilityState.catalog.selectedAttributes.quantity,4);
 assert.equal(r.state.capabilityState.commerce.mode,'paused_add_item');
 cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:u}).getCart();
 assert.equal(cart.items.find(x=>/Cooking Oil/.test(x.name)).quantity,4);

 const side=await q(tenantId,u,'do you offer jazz cash');
 assert.match(side.reply,/JazzCash/i);
 assert.equal(side.state.capabilityState.commerce.mode,'paused_add_item');

 const confirm=await q(tenantId,u,'confirm order');
 assert.equal(confirm.capabilityId,'commerce');
 assert.match(confirm.reply,/Rice/i);
 assert.match(confirm.reply,/Cooking Oil/i);
 assert.match(confirm.reply,/× 2/);
 assert.match(confirm.reply,/× 4/);
 assert.match(confirm.reply,/full name|name/i);
 assert.equal(confirm.state.capabilityState.commerce.mode,'checkout');
});

test('bare quantity updates current grocery item and add X also switches product instead of replaying old item',async()=>{
 const u='cart2';
 await q(tenantId,u,'hello i want to buy 1 kg cooking oil');
 let r=await q(tenantId,u,'3');
 assert.equal(r.state.capabilityState.catalog.selectedAttributes.quantity,3);
 let cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:u}).getCart();
 assert.equal(cart.items.find(x=>/Cooking Oil/.test(x.name)).quantity,3);

 r=await q(tenantId,u,'add 1 kg rice also');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/Rice/i);
 assert.equal(r.state.capabilityState.catalog.selectedProductId,'P001');
});

test('hourly cleaner quote starts a confirmable workflow and typo hurs is understood',async()=>{
 const u='clean1';
 let r=await q('cleaning-demo',u,'can i book a cleaner for two hurs tomorrow');
 assert.equal(r.capabilityId,'cleaning');
 assert.match(r.reply,/AED 80/);
 assert.match(r.reply,/time/i);
 assert.equal(r.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');
 assert.equal(r.state.capabilityState.cleaning.step,'time');
 assert.equal(r.state.capabilityState.cleaning.durationHours,2);

 r=await q('cleaning-demo',u,'ok confirm');
 assert.equal(r.capabilityId,'cleaning');
 assert.match(r.reply,/valid time|9:00 PM|21:00|time/i);
 assert.equal(r.state.capabilityState.cleaning.step,'time');
});

test('hourly cleaner request can complete through shared customer fields',async()=>{
 const u='clean2';
 let r=await q('cleaning-demo',u,'i want to book a cleaner for two hours');
 assert.match(r.reply,/AED 80/);
 assert.match(r.reply,/date/i);
 await q('cleaning-demo',u,'tomorrow');
 await q('cleaning-demo',u,'9 am');
 await q('cleaning-demo',u,'Model Town Lahore');
 await q('cleaning-demo',u,'Zeeshan Ahmad');
 r=await q('cleaning-demo',u,'03019299608');
 assert.match(r.reply,/Hourly Cleaner Hire|Cleaning request summary/i);
 assert.match(r.reply,/AED 80/);
 r=await q('cleaning-demo',u,'confirm');
 assert.equal(r.capabilityId,'cleaning');
 assert.match(r.reply,/request has been received|request receive/i);
 assert.match(r.reply,/CLN-/);
});
