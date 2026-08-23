const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
const {EntityResolver}=require('../packages/entity-resolution-engine/src/entityResolver');
let container;
test.before(async()=>{container=await buildContainer();});
async function msg(tenantId,customerId,text){return container.executionEngine.process({tenantId,channel:'test',customerId,text});}

test('restaurant menu uses generic offering capability and generic reservation flow',async()=>{
  const menu=await msg('restaurant-demo','generic-r','what food do you serve');
  assert.equal(menu.capabilityId,'offering');
  assert.match(menu.reply,/Chicken Biryani/i);
  assert.match(menu.reply,/Beef Burger/i);
  const start=await msg('restaurant-demo','generic-r','reserve a table tomorrow at 7 pm for 4 people');
  assert.equal(start.capabilityId,'booking');
  assert.match(start.reply,/name/i);
  await msg('restaurant-demo','generic-r','Zeeshan');
  const ready=await msg('restaurant-demo','generic-r','03001234567');
  assert.match(ready.reply,/Party Size: 4/i);
  const done=await msg('restaurant-demo','generic-r','confirm');
  assert.match(done.reply,/reservation request received/i);
});

test('salon booking is powered by the same generic booking capability',async()=>{
  const start=await msg('salon-demo','generic-s','can i get beard grooming tomorrow');
  assert.equal(start.capabilityId,'booking');
  assert.match(start.reply,/time/i);
  await msg('salon-demo','generic-s','5 pm');
  await msg('salon-demo','generic-s','Adeel');
  const ready=await msg('salon-demo','generic-s','03009999999');
  assert.match(ready.reply,/Beard Grooming/i);
  const done=await msg('salon-demo','generic-s','confirm');
  assert.match(done.reply,/Appointment request received/i);
});

test('healthcare consultation uses generic offering/booking semantics',async()=>{
  const browse=await msg('healthcare-demo','generic-h','what treatments do you offer');
  assert.ok(['offering','assistant'].includes(browse.capabilityId));
  assert.match(browse.reply,/General consultation/i);
  const start=await msg('healthcare-demo','generic-h','can i have general consultation tomorrow');
  assert.equal(start.capabilityId,'booking');
  assert.match(start.reply,/time/i);
});

test('education programs and admission inquiry use generic framework',async()=>{
  const browse=await msg('education-demo','generic-e','what classes do you provide');
  assert.equal(browse.capabilityId,'offering');
  assert.match(browse.reply,/Grades 1-5/i);
  const start=await msg('education-demo','generic-e','can i get my boy admitted to your school');
  assert.equal(start.capabilityId,'booking');
  assert.match(start.reply,/grade|class/i);
});

test('strict resolver suggests but never asserts a near domain entity',()=>{
  const resolver=new EntityResolver();
  const records=[{id:'general',name:'General Consultation',aliases:['general doctor consultation']}];
  const result=resolver.resolve('pediatric consultation',records);
  assert.notEqual(result.type,'exact');
});


test('unknown domain offering is never silently substituted',async()=>{
  const r=await msg('salon-demo','generic-unknown','do you offer body massage');
  assert.notEqual(r.intelligence?.selected?.intent,'offering.details');
  assert.doesNotMatch(r.reply,/Haircut[\s\S]*book/i);
});

test('generic cancel clears generic booking state',async()=>{
  await msg('salon-demo','generic-cancel','book facial tomorrow');
  const cancelled=await msg('salon-demo','generic-cancel','cancel');
  assert.match(cancelled.reply,/cancel/i);
  assert.deepEqual(cancelled.state.capabilityState.booking,{});
});
