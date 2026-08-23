const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer();});
async function msg(t,u,text){return c.executionEngine.process({tenantId:t,channel:'ux',customerId:u,text});}

test('retail unavailable response recommends a real nearest product without selecting it',async()=>{
 const r=await msg('default','ux-retail','do you have skinny jeans');
 assert.equal(r.intelligence.selected.intent,'catalog.unavailable_request');
 assert.match(r.reply,/skinny jeans/i);
 assert.match(r.reply,/Denim Jeans/i);
 assert.match(r.reply,/similar available options|consider/i);
 assert.equal(r.state.capabilityState.catalog.selectedProductId,null);
 assert.doesNotMatch(r.reply,/offer\s*\./i);
});

test('checkout product browsing interrupts city/address collection',async()=>{
 const u='ux-checkout';
 await msg('default',u,'i want comfort slides black size 42 2 pieces');
 await msg('default',u,'confirm');
 await msg('default',u,'Zeeshan');
 await msg('default',u,'03019299608');
 const r=await msg('default',u,'can i see other products please');
 assert.notEqual(r.intelligence.selected?.intent,'commerce.checkout_input');
 assert.doesNotMatch(r.reply,/full delivery address/i);
});

test('booking accepts DD/MM/YYYY and ordinal grade',async()=>{
 const u='ux-booking';
 await msg('healthcare-demo',u,'book dermatology service');
 const d=await msg('healthcare-demo',u,'24/2/2027');
 assert.match(d.reply,/time/i);
 assert.equal(d.state.capabilityState.booking.slots.date,'24/02/2027');
 const e='ux-edu';
 await msg('education-demo',e,'admission inquiry');
 const g=await msg('education-demo',e,'8th grade');
 assert.match(g.reply,/parent|guardian/i);
 assert.equal(g.state.capabilityState.booking.slots.grade,'8');
});

test('booking prompts show date/time examples for better UX',async()=>{
 const r=await msg('healthcare-demo','ux-hints','book dermatology service');
 assert.match(r.reply,/24\/02\/2026|tomorrow/i);
 const t=await msg('healthcare-demo','ux-hints','24/02/2027');
 assert.match(t.reply,/9:00 PM|21:00/i);
});

test('cleaning never stores tomorrow as a time',async()=>{
 const u='ux-clean';
 const a=await msg('cleaning-demo',u,'clean my house tomorrow');
 assert.match(a.reply,/time/i);
 const b=await msg('cleaning-demo',u,'tomorrow');
 assert.match(b.reply,/9:00 AM|14:30/i);
 assert.equal(b.state.capabilityState.cleaning.preferredTime,null);
});

test('offering suggestion can be confirmed with yes',async()=>{
 const u='ux-offering';
 const a=await msg('education-demo',u,'tell me bout admissions');
 assert.match(a.reply,/Did you mean Admission Inquiry/i);
 const b=await msg('education-demo',u,'yes');
 assert.equal(b.capabilityId,'offering');
 assert.match(b.reply,/Admission Inquiry/i);
});

test('education grades question browses instead of saying unavailable',async()=>{
 const r=await msg('education-demo','ux-grades','what grades do you offer');
 assert.equal(r.capabilityId,'offering');
 assert.match(r.reply,/Primary Program|Grades 1-5/i);
});

test('greetings are tenant-specific',async()=>{
 const retail=await msg('default','ux-greet-r','hello');
 const salon=await msg('salon-demo','ux-greet-s','hello');
 const clinic=await msg('healthcare-demo','ux-greet-h','hello');
 assert.match(retail.reply,/Hello|help/i);
 assert.match(salon.reply,/salon/i);
 assert.match(clinic.reply,/clinic/i);
});
