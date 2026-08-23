const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');
const tenantId='v411-karyana';const tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v411',customerId:u,text});}
test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({
  id:tenantId,name:'Karyana 411',
  offerings:[
   {name:'Super Basmati Rice (1kg)',type:'product',price:340,aliases:['rice','chawal'],inStock:true},
   {name:'Cooking Oil / Ghee (1 Litre / Pack)',type:'product',price:520,aliases:['cooking oil','oil','ghee'],inStock:true}
  ]
 });
 c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('multi-product sentence returns cart-oriented summary with every item and correct quantities',async()=>{
 const r=await q(tenantId,'cart','i want to buy 2 kg rice and 4 packs of cooking oil');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/Rice/);assert.match(r.reply,/× 2/);
 assert.match(r.reply,/Cooking Oil/);assert.match(r.reply,/× 4/);
 assert.match(r.reply,/Total/i);
 const cart=await c.commerceService.scope({tenant:c.tenantRepository.getById(tenantId),capabilityId:'commerce',customerId:'cart'}).getCart();
 assert.equal(cart.items.find(x=>/Rice/.test(x.name)).quantity,2);
 assert.equal(cart.items.find(x=>/Oil/.test(x.name)).quantity,4);
});

test('day opening question answers yes or no directly',async()=>{
 let r=await q('cleaning-demo','a1','are you open on sunday');
 assert.equal(r.capabilityId,'availability');assert.match(r.reply,/closed on Sunday/i);assert.doesNotMatch(r.reply,/cleaning services/i);
 r=await q('cleaning-demo','a2','are you open on monday');
 assert.equal(r.capabilityId,'availability');assert.match(r.reply,/open on Monday/i);assert.match(r.reply,/9 AM to 7 PM/i);
});

test('service availability question distinguishes business hours from live slot availability',async()=>{
 const r=await q('cleaning-demo','a3','are you available on monday for cleaning');
 assert.equal(r.capabilityId,'availability');
 assert.match(r.reply,/open on Monday/i);assert.match(r.reply,/Standard Home Cleaning|cleaning/i);
 assert.match(r.reply,/live calendar|scheduling check/i);
 assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
});

test('specific supported service question answers directly instead of listing all services',async()=>{
 let r=await q('cleaning-demo','a4','can you clean my 1 bedroom apartment');
 assert.equal(r.capabilityId,'availability');assert.match(r.reply,/Yes/);assert.match(r.reply,/Apartment Cleaning/i);
 assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
 r=await q('cleaning-demo','a5','can i get my studio apartment cleaned');
 assert.equal(r.capabilityId,'availability');assert.match(r.reply,/Yes/);
});

test('unsupported specific service returns direct no instead of service list',async()=>{
 const r=await q('cleaning-demo','a6','do you provide swimming pool cleaning');
 assert.equal(r.capabilityId,'availability');assert.match(r.reply,/don.t see that specific service|No/i);
 assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
});

test('new generic service tenant automatically receives availability capability',()=>{
 const root=fs.mkdtempSync(path.join(require('os').tmpdir(),'v411-onboard-'));
 const r=new UniversalTenantOnboardingService({tenantsDir:root}).create({id:'consult',name:'Consult Co',offerings:[{name:'Strategy Session',type:'service',aliases:['strategy consultation'],bookable:true}]});
 assert.ok(r.profile.capabilities.includes('availability'));
 assert.ok(fs.existsSync(path.join(root,'consult','availability','services.json')));
});
