const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {buildContainer}=require('../apps/api/src/container');const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const cleanId='v52-cleaning',cleanDir=path.join(__dirname,'..','tenants',cleanId),storeId='v52-store',storeDir=path.join(__dirname,'..','tenants',storeId);let c;
async function q(tenantId,user,text){return c.executionEngine.process({tenantId,channel:'v52',customerId:user,text});}
test.before(async()=>{
 fs.rmSync(cleanDir,{recursive:true,force:true});fs.cpSync(path.join(__dirname,'..','tenants','cleaning-demo'),cleanDir,{recursive:true});
 const pp=path.join(cleanDir,'profile.json'),profile=JSON.parse(fs.readFileSync(pp,'utf8'));profile.id=cleanId;profile.name='V52 SparkleCare';fs.writeFileSync(pp,JSON.stringify(profile,null,2)+'\n');
 fs.rmSync(storeDir,{recursive:true,force:true});fs.cpSync(path.join(__dirname,'..','tenants','default'),storeDir,{recursive:true});const spp=path.join(storeDir,'profile.json'),sp=JSON.parse(fs.readFileSync(spp,'utf8'));sp.id=storeId;sp.name='V52 Store';fs.writeFileSync(spp,JSON.stringify(sp,null,2)+'\n');
 c=await buildContainer();c.llmRouter.providers=[];
 c.tenantKnowledgeManager.addDocument(cleanId,{title:'Extra Cleaning Knowledge',format:'md',priority:80,text:`
## Pets in the Home
Yes, our cleaners can work in homes with cats, dogs, and other household pets. Customers should tell us about pets before the cleaner arrives.

## Customer Presence
Customers do not have to remain at home during the entire cleaning appointment. Someone must provide safe access to the property unless another access arrangement has been agreed beforehand.

## Same-Day Cleaning
Same-day cleaning requests are allowed. Same-day service is subject to cleaner availability and cannot be guaranteed until the scheduling system confirms an available cleaner.

## Weekend Service
SparkleCare normally operates Monday through Saturday. Sunday service is not part of the normal operating schedule. Special Sunday cleaning may occasionally be arranged manually, but Nova must not promise Sunday availability unless a scheduling system confirms it.

## Window Cleaning
Interior window cleaning may be requested. Exterior high-rise window cleaning is not part of the standard home cleaning service. Customers requiring specialized exterior or high-access window cleaning should request a custom quotation.

## Balcony Cleaning
Balcony cleaning can be requested as part of a home cleaning job. Large balconies, terraces, or heavily soiled outdoor areas may require a custom quotation.

## Payment
Customers may ask about available payment methods before making a booking. The assistant should answer using the payment methods configured for the SparkleCare tenant. The assistant must never invent an unsupported payment method.

## Recurring Cleaning
Customers may request recurring cleaning such as twice per week, weekly, every two weeks, or monthly. Recurring service pricing and cleaner availability must be confirmed before the recurring schedule is finalized.
`});
 c.tenantKnowledgeManager.addDocument(storeId,{title:'Store Returns',format:'md',text:'## Returns Policy\nUnused products can be returned within 7 days with the receipt.'});
});
test.after(()=>{fs.rmSync(cleanDir,{recursive:true,force:true});fs.rmSync(storeDir,{recursive:true,force:true});});

test('pet and presence questions use customer-safe knowledge rather than Availability',async()=>{
 let r=await q(cleanId,'p1','can you come to home having pet dog for cleaning');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/cats, dogs|pets/i);
 r=await q(cleanId,'p2','should i be at home during cleaning ?');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/do not have to remain at home/i);
});
test('same-day is an availability constraint, not a service name',async()=>{
 for(const text of ['do you offer same day booking ?','do you provide same day cleaning service ?']){const r=await q(cleanId,'same-'+text,text);assert.equal(r.capabilityId,'availability');assert.match(r.reply,/same-day cleaning requests are allowed/i);assert.doesNotMatch(r.reply,/specific service/i);}
});
test('Sunday and weekend constraints answer hours instead of service lookup',async()=>{
 let r=await q(cleanId,'sun1','do you provide service on sunday weekend');assert.equal(r.capabilityId,'availability');assert.match(r.reply,/closed on Sunday/i);
 r=await q(cleanId,'sun2','can i get services on sunday');assert.equal(r.capabilityId,'availability');assert.match(r.reply,/closed on Sunday/i);
 r=await q(cleanId,'week','are you open on weeekend');assert.equal(r.capabilityId,'availability');assert.match(r.reply,/Saturday: open/i);assert.match(r.reply,/Sunday: closed/i);
});
test('newly configured specialised services are handled as standalone cleaning requests',async()=>{
 let r=await q(cleanId,'window','can i book window cleaning service');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Interior Window Cleaning/i);assert.match(r.reply,/date/i);
 r=await q(cleanId,'balcony','can i book balcony cleaning service');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Balcony Cleaning/i);
});
test('internal assistant instructions are not customer-facing evidence',async()=>{
 const r=await q(cleanId,'pay','what payment methods do you accept');assert.equal(r.capabilityId,'assistant');assert.doesNotMatch(r.reply,/assistant should|assistant must|never invent/i);assert.match(r.reply,/don.t have|not have|confirm/i);
});
test('already-reduced prices do not expose a second configured discount',async()=>{
 const r=await q(cleanId,'discount','tell me about discounts');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/isn’t a configured cleaning discount/i);
});
test('recurrence is first-class booking state',async()=>{
 let r=await q(cleanId,'rec1','can i book cleaner twice a week');assert.equal(r.capabilityId,'cleaning');assert.equal(r.state.capabilityState.cleaning.recurrence.frequency,'weekly');assert.equal(r.state.capabilityState.cleaning.recurrence.occurrencesPerWeek,2);assert.equal(r.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');assert.equal(r.state.capabilityState.cleaning.step,'duration');assert.match(r.reply,/hours.*each visit/i);
 r=await q(cleanId,'rec1','3 hours');assert.equal(r.capabilityId,'cleaning');assert.equal(r.state.capabilityState.cleaning.durationHours,3);assert.equal(r.state.capabilityState.cleaning.step,'recurring_days');assert.match(r.reply,/day or days/i);
 r=await q(cleanId,'rec1','monday and thursday');assert.equal(r.state.capabilityState.cleaning.step,'time');assert.deepEqual(r.state.capabilityState.cleaning.recurringDays,['monday','thursday']);
});
test('generic monthly recurring request asks for the service instead of guessing Standard Cleaning',async()=>{
 const r=await q(cleanId,'recmonth','can i book recurring cleaning for month');assert.equal(r.capabilityId,'cleaning');assert.equal(r.state.capabilityState.cleaning.step,'recurring_service');assert.equal(r.state.capabilityState.cleaning.recurrence.frequency,'monthly');assert.match(r.reply,/Which service should repeat/i);
});
test('recurring quote asks for missing service details instead of dumping service list',async()=>{
 const r=await q(cleanId,'recquote','i want your services weekly what are charges');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/weekly cleaning/i);assert.match(r.reply,/depends on the service/i);assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
});
test('product-store actions remain deterministic while store policy uses RAG',async()=>{
 let r=await q(storeId,'store1','do you have shoes');assert.equal(r.capabilityId,'catalog');assert.match(r.reply,/Running Shoes/i);
 r=await q(storeId,'store2','what is your returns policy');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/7 days/i);
});
