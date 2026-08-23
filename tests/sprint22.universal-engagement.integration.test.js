const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer();});
async function msg(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v34',customerId:u,text});}

test('jeans family browse never silently treats large as a valid Denim Jeans size',async()=>{
  const u='eng-jeans';
  const r=await msg('default',u,'can i get large size jeans');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/jeans/i);
  assert.match(r.reply,/30|32|34|36/i);
  assert.doesNotMatch(r.reply,/What color would you like/i);
  const r2=await msg('default',u,'any other jeans');
  assert.match(r2.reply,/Denim Jeans/i);
});

test('commerce central field validation extracts embedded name and rejects invalid phone',async()=>{
  const u='eng-commerce';
  await msg('default',u,'i want polo shirt white xl one');
  await msg('default',u,'confirm my order');
  const name=await msg('default',u,'that good use my name Zeeshan');
  assert.match(name.reply,/phone/i);
  assert.equal(name.state.capabilityState.commerce.pendingField,'phone');
  const bad=await msg('default',u,'234567890');
  assert.match(bad.reply,/not valid|valid contact number/i);
  assert.equal(bad.state.capabilityState.commerce.pendingField,'phone');
});

test('track my order routes to Commerce after order creation',async()=>{
  const u='eng-track';
  await msg('default',u,'i want polo shirt white xl one');
  await msg('default',u,'confirm');
  await msg('default',u,'Zeeshan Ahmad');
  await msg('default',u,'03019299608');
  await msg('default',u,'lahore');
  await msg('default',u,'old book bazar thokar');
  await msg('default',u,'skip');
  await msg('default',u,'cash on delivery');
  const track=await msg('default',u,'track my order');
  assert.equal(track.capabilityId,'commerce');
  assert.match(track.reply,/ORD-|order/i);
});

test('cleaning rejects past date and requires a valid phone before confirmation',async()=>{
  const u='eng-clean';
  await msg('cleaning-demo',u,'home cleaning for two hours');
  const past=await msg('cleaning-demo',u,'09/05/2024');
  assert.match(past.reply,/past|future/i);
  const future=await msg('cleaning-demo',u,'10/05/2027');
  assert.match(future.reply,/time/i);
  await msg('cleaning-demo',u,'5 pm');
  const addr=await msg('cleaning-demo',u,'House 12, Model Town, Lahore');
  assert.match(addr.reply,/full name/i);
  const named=await msg('cleaning-demo',u,'Zeeshan Ahmad');
  assert.match(named.reply,/contact|number/i);
  const bad=await msg('cleaning-demo',u,'0301929');
  assert.match(bad.reply,/not valid|valid contact/i);
  const good=await msg('cleaning-demo',u,'03019299608');
  assert.match(good.reply,/confirm/i);
  assert.match(good.reply,/03019299608/);
});

test('salon booking can contain multiple services with one shared contact workflow',async()=>{
  const u='eng-salon';
  await msg('salon-demo',u,'i want a hair cut on 24 may');
  await msg('salon-demo',u,'7 pm');
  await msg('salon-demo',u,'zeeshan');
  const bad=await msg('salon-demo',u,'0301929');
  assert.match(bad.reply,/not valid|valid contact/i);
  const add=await msg('salon-demo',u,'i want facial also');
  assert.equal(add.capabilityId,'booking');
  assert.match(add.reply,/phone|contact/i);
  const ready=await msg('salon-demo',u,'03019299608');
  assert.match(ready.reply,/Haircut/i);
  assert.match(ready.reply,/Facial/i);
  assert.match(ready.reply,/confirm/i);
});

test('yearless dates are future-oriented, not silently mapped into the past',async()=>{
  const u='eng-date';
  const first=await msg('salon-demo',u,'i want a haircut on 24 may');
  // Current date is August 2026 in this release; "24 May" should become next May.
  assert.equal(first.state.capabilityState.booking.slots.date,'24/05/2027');
});

test('config-only unseen tutoring business browses and books without tutor-specific code',async()=>{
  const u='eng-tutor';
  const list=await msg('tutor-demo',u,'what subjects do you teach');
  assert.equal(list.capabilityId,'offering');
  assert.match(list.reply,/Math Tutoring/i);
  const start=await msg('tutor-demo',u,'book math tutoring tomorrow at 6 pm');
  assert.equal(start.capabilityId,'booking');
  assert.match(start.reply,/name|student|parent/i);
  await msg('tutor-demo',u,'Ali Khan');
  const ready=await msg('tutor-demo',u,'03019299608');
  assert.match(ready.reply,/Math Tutoring/i);
  assert.match(ready.reply,/confirm/i);
});

test('central engagement parser provides a single contract for common fields',async()=>{
  const e=c.engagementService;
  assert.equal(e.parseField('phone','0301929',{minDigits:10,maxDigits:15}).valid,false);
  assert.equal(e.parseField('phone','03019299608',{minDigits:10,maxDigits:15}).valid,true);
  assert.equal(e.parseField('name','use my name Zeeshan').value,'Zeeshan');
  assert.equal(e.parseField('date','09/05/2024',{allowPast:false}).valid,false);
  assert.equal(e.parseField('time','9 pm').value,'9 pm');
});
