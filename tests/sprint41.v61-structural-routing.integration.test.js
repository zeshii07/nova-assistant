const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const sourceId='cleaning-demo',tenantId='v61-structural-cleaning';
const sourceDir=path.join(__dirname,'..','tenants',sourceId),tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(u,text){return c.executionEngine.process({tenantId,channel:'v61',customerId:u,text});}
test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});fs.cpSync(sourceDir,tenantDir,{recursive:true});
 const pp=path.join(tenantDir,'profile.json'),p=JSON.parse(fs.readFileSync(pp,'utf8'));p.id=tenantId;p.name='V61 SparkleCare';p.business={...(p.business||{}),name:'V61 SparkleCare'};fs.writeFileSync(pp,JSON.stringify(p,null,2)+'\n');
 c=await buildContainer();c.llmRouter.providers=[];
 c.tenantKnowledgeManager.addDocument(tenantId,{title:'V61 cleaning policies',format:'md',priority:80,text:`
## Service Area
SparkleCare currently serves Johar Town, Model Town, Wapda Town, DHA Lahore, Gulberg, Faisal Town, Garden Town, and Thokar Niaz Baig.

## Cancellation Policy
Customers can cancel or reschedule a standard cleaning appointment up to 12 hours before the scheduled appointment without a cancellation charge.

## Same-Day Cleaning
Same-day cleaning requests are allowed. Same-day service is subject to cleaner availability and cannot be guaranteed until scheduling confirms an available cleaner.

## Payment
Customers may ask about available payment methods before making a booking. The assistant should answer using the payment methods configured for the tenant. The assistant must never invent an unsupported payment method.
`});
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('coverage question returns the configured Dubai service area',async()=>{
 const r=await q('area','hello what areas do you serve in dubai');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/serves Dubai/i);
});

test('recurring hourly cleaner accepts typo twice a weak and hidden operational service',async()=>{
 const u='recurring';let r=await q(u,'do you offer recurring cleaning services');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Which service should repeat/i);
 r=await q(u,'i want a hourly cleaner twice a weak');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Hourly Cleaner Hire/i);assert.match(r.reply,/hours should each/i);assert.equal(r.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');assert.equal(r.state.capabilityState.cleaning.recurrence.occurrencesPerWeek,2);
});

test('hourly cleaner phrase can select hidden operational service from recurring selector',async()=>{
 const u='recurring2';await q(u,'do you offer recurring cleaning services');const r=await q(u,'hourly cleaner');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Hourly Cleaner Hire selected/i);assert.equal(r.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');
});

test('cancellation-policy question does not execute global cancellation',async()=>{
 const u='cancel-policy';let r=await q(u,'do you offer recurring cleaning services');assert.equal(r.state.capabilityState.cleaning.step,'recurring_service');
 r=await q(u,'can i cancel a booked service');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/12 hours/i);assert.equal(r.state.capabilityState.cleaning.step,'recurring_service');
});

test('deep-villa linear pricing continues beyond a fixed lookup table',async()=>{
 const u='linear-villa';const r=await q(u,'i want my 9 bedroom villa deep cleaned');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/AED 860/i);assert.equal(r.state.capabilityState.cleaning.quotedService.total,860);assert.equal(r.state.capabilityState.cleaning.step,'date');
});

test('same-day typo normalization drives availability constraint',async()=>{
 const r=await q('same-day','do you offer same dy bookigs ?');assert.equal(r.capabilityId,'availability');assert.match(r.reply,/Same-day cleaning requests are allowed/i);
});

test('payment + discount is answered as two facets and internal instructions never leak',async()=>{
 const r=await q('multi','what is your payment method and do you offer discounts on your services');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/Payment(?: methods)?:/i);assert.match(r.reply,/approved information|team.*confirm/i);assert.match(r.reply,/Discounts:/i);assert.match(r.reply,/no configured discount/i);assert.doesNotMatch(r.reply,/assistant should|assistant must|customers may ask/i);
});

test('card payment question abstains when no actual payment method is configured',async()=>{
 const r=await q('card','do you accept card for payments');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/don.t have approved information|team.*confirm/i);assert.doesNotMatch(r.reply,/Customers may ask|assistant/i);
});
