const test=require('node:test');const assert=require('node:assert/strict');const {buildContainer}=require('../apps/api/src/container');
let c;async function q(u,text){return c.executionEngine.process({tenantId:'cleaning-demo',channel:'v410',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});
test('unspecified apartment quotation asks standard or deep before choosing a pricing model',async()=>{const r=await q('p1','how much for cleaning a 2 bedroom apartment');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/standard cleaning or deep cleaning/i);});
test('unspecified villa quotation asks standard or deep before choosing a pricing model',async()=>{const r=await q('p2','quote for cleaning a 2 bhk villa');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/standard cleaning or deep cleaning/i);});
test('3-seat sofa quotation uses the configured linear seat price',async()=>{const r=await q('p3','how much for a 3 seater sofa cleaning');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/AED 110/);});
test('unit quotation handles chair quantity',async()=>{const r=await q('p4','price for cleaning 10 chairs');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/AED 315/);});
test('hourly quotation is central',async()=>{const r=await q('p5','how much for a cleaner for 2 hours');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/AED 80/);});
test('already-reduced catalog prices do not receive a second automatic discount',async()=>{const r=await q('p6','can i get discount for 2 bedroom apartment cleaning');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/isn’t a configured discount/i);});

test('unseen consultation business uses the same central hourly quotation engine',async()=>{
 const fs=require('fs'),path=require('path');const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
 const id='v410-consulting';const dir=path.join(__dirname,'..','tenants',id);fs.rmSync(dir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({id,name:'Northstar Consulting',currency:'USD',offerings:[{name:'Strategy Meeting',type:'service',aliases:['meeting','consultation'],bookable:true,pricing:{model:'hourly',rate:150}}],discounts:[{id:'d5',type:'percent',value:5,enabled:true}]});
 c.tenantRepository.clearCache?.(id);
 let r=await c.executionEngine.process({tenantId:id,channel:'v410',customerId:'consult',text:'how much for a 2 hours strategy meeting'});
 assert.equal(r.capabilityId,'pricing');assert.match(r.reply,/\$300/);
 r=await c.executionEngine.process({tenantId:id,channel:'v410',customerId:'consult2',text:'can i get discount for a 2 hours strategy meeting'});
 assert.equal(r.capabilityId,'pricing');assert.match(r.reply,/5%/);assert.match(r.reply,/\$285/);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('human request creates a real handoff record',async()=>{const r=await q('p7','i want to talk to a human agent');assert.equal(r.capabilityId,'system');assert.match(r.reply,/HND-/);assert.equal(c.handoffService.list({tenantId:'cleaning-demo'}).length,1);});
