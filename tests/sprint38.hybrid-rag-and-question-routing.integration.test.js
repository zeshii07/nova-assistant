const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const sourceId='cleaning-demo',tenantId='v51-hybrid-cleaning';
const sourceDir=path.join(__dirname,'..','tenants',sourceId),tenantDir=path.join(__dirname,'..','tenants',tenantId);
let c;
async function q(u,text){return c.executionEngine.process({tenantId,channel:'v51-hybrid',customerId:u,text});}
test.before(async()=>{
  fs.rmSync(tenantDir,{recursive:true,force:true});fs.cpSync(sourceDir,tenantDir,{recursive:true});
  const profilePath=path.join(tenantDir,'profile.json'),profile=JSON.parse(fs.readFileSync(profilePath,'utf8'));profile.id=tenantId;profile.name='Hybrid SparkleCare';profile.business={...(profile.business||{}),name:'Hybrid SparkleCare'};fs.writeFileSync(profilePath,JSON.stringify(profile,null,2)+'\n');
  c=await buildContainer();c.llmRouter.providers=[];
  c.tenantKnowledgeManager.addDocument(tenantId,{title:'SparkleCare Additional Knowledge',format:'md',priority:125,text:`
# SparkleCare Additional Knowledge

## Service Area

SparkleCare currently serves the following areas:

- Johar Town
- Model Town
- Wapda Town
- DHA Lahore
- Gulberg
- Faisal Town
- Garden Town
- Thokar Niaz Baig

## Parking

If paid parking is required at the customer's property, the customer is responsible for providing parking access or paying the actual parking charge unless SparkleCare has agreed otherwise.

## Pets in the Home

Yes, our cleaners can work in homes with cats, dogs, and other household pets. Customers should tell us about pets before the cleaner arrives.

## Furniture Moving

Standard cleaners can move lightweight household items when it is safe to do so. Cleaners should not move very heavy furniture, large appliances, wardrobes, beds, or other items that may create a safety risk.
`});
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('hybrid retrieval resolves serving-area paraphrases to the complete section',async()=>{
 for(const text of ['what area do you serve','What are your serving areas?','what are you service areas']){
   const r=await q(`area-${text}`,text);assert.equal(r.capabilityId,'assistant',text);assert.match(r.reply,/Johar Town/i,text);assert.match(r.reply,/DHA Lahore/i,text);assert.doesNotMatch(r.reply,/^##/m,text);
 }
});
test('hybrid retrieval answers parking and furniture policy paraphrases',async()=>{
 let r=await q('parking','who will pay for parking ?');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/customer is responsible/i);
 r=await q('wardrobe','Can your cleaner move my heavy wardrobe?');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/should not move very heavy furniture/i);
});
test('unknown workforce count abstains instead of listing services',async()=>{
 for(const text of ['can you tell me about number of cleaners','How many cleaners do you employ?']){
   const r=await q(`count-${text}`,text);assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/don.t have approved information|team.*confirm/i);assert.doesNotMatch(r.reply,/Here are our cleaning services/i);
 }
});
test('knowledge question interrupts pending date then workflow resumes',async()=>{
 const u='interrupt';
 let r=await q(u,'i want my home cleaned');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/date/i);
 r=await q(u,'How many cleaners do you employ?');assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/don.t have approved information|team.*confirm/i);assert.match(r.reply,/date/i);
 r=await q(u,'tomorrow');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/time/i);
});
test('maid for two hours switches active service to hourly cleaner',async()=>{
 const u='switch';
 let r=await q(u,'i want my home cleaned');assert.equal(r.capabilityId,'cleaning');
 r=await q(u,'no no i want deep cleaning');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Deep Home Cleaning/i);
 r=await q(u,'actually i want a maid for two hours only');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Hourly Cleaner Hire/i);assert.match(r.reply,/AED 80/);assert.equal(r.state.capabilityState.cleaning.serviceId,'CLN-HOURLY');assert.equal(r.state.capabilityState.cleaning.durationHours,2);
});
test('operational service list still belongs to Cleaning',async()=>{
 const r=await q('services','what all services do you offer');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Deep Home Cleaning/);
});
test('villa action remains an action, not a knowledge question',async()=>{
 const r=await q('villa','i want my villa cleaned');assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/bedroom|configured (?:price|rate)|request/i);
});
