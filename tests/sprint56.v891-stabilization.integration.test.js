const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');

let c;
async function q(tenant,user,text){
  return c.executionEngine.process({tenantId:tenant,channel:'v891',customerId:user,text});
}

test.before(async()=>{c=await buildContainer();if(c.llmRouter)c.llmRouter.providers=[];});

test('explicit Standard Cleaning tolerates a bounded villa typo and consumes supplied fields',async()=>{
  const r=await q('cleaning-demo','villa-typo','i want to book standard cleaning for my 2 bedroom vila with 1 cleaner for 3 hours on friday 9 am');
  assert.equal(r.capabilityId,'cleaning');
  assert.doesNotMatch(r.reply,/need the hours/i);
  assert.match(r.reply,/AED 40 per hour/i);
  assert.match(r.reply,/full service address/i);
  assert.equal(r.state.capabilityState.cleaning.propertyType,'villa');
  assert.equal(r.state.capabilityState.cleaning.preferredTime,'09:00');
  assert.equal(r.state.capabilityState.cleaning.step,'address');
});

test('weekday plus on plus time fills both pending fields',async()=>{
  const u='weekday-on-time';
  let r=await q('cleaning-demo',u,'i want standard cleaning for my 2 bedroom villa with 1 cleaner for 3 hours');
  assert.equal(r.state.capabilityState.cleaning.step,'date');
  r=await q('cleaning-demo',u,'friday on 2 pm');
  assert.equal(r.state.capabilityState.cleaning.step,'address');
  assert.equal(r.state.capabilityState.cleaning.preferredTime,'14:00');
  assert.match(r.reply,/full service address/i);
});

test('time replacement without the word time owns the cleaning workflow and preserves its pending field',async()=>{
  const u='time-replacement';
  let r=await q('cleaning-demo',u,'i want standard cleaning for my 2 bedroom villa with 1 cleaner for 3 hours friday at 2 pm');
  assert.equal(r.state.capabilityState.cleaning.step,'address');
  r=await q('cleaning-demo',u,'can i change my request from 2 pm to 6 pm please');
  assert.equal(r.capabilityId,'cleaning');
  assert.equal(r.intelligence.selected.intent,'cleaning.schedule_edit');
  assert.equal(r.state.capabilityState.cleaning.preferredTime,'18:00');
  assert.equal(r.state.capabilityState.cleaning.step,'address');
  assert.match(r.reply,/18:00/);
  assert.doesNotMatch(r.reply,/Monday to Saturday/i);
});

test('quote and availability inquiry does not start booking or collect customer details',async()=>{
  const text="Hi, I need 3 cleaners this Saturday for a 4-bedroom apartment. I'd prefer 9:00 AM for 4 hours, but 10:00 AM is also okay. They must bring all equipment and supplies, and everything needs to be finished by 2:00 PM. Check 9:00 AM first. If 3 cleaners aren't available, don't reduce it to 2 without asking me. If Saturday isn't available, check Sunday at the same times. Tell me the total price and available option before booking anything.";
  const r=await q('cleaning-demo','quote-only',text);
  assert.equal(r.capabilityId,'cleaning');
  assert.match(r.reply,/AED 480/);
  assert.match(r.reply,/no booking|not booked|before booking/i);
  assert.match(r.reply,/3 cleaners/i);
  assert.match(r.reply,/Saturday/i);
  assert.match(r.reply,/Sunday.*closed/i);
  assert.doesNotMatch(r.reply,/share the full service address/i);
  assert.ok(!r.state.capabilityState.cleaning.step);
  assert.equal(r.state.capabilityState.cleaning.pendingAvailabilityInquiry?.noSubstitutionWithoutConsent,true);
});

test('a customer can view tenant-scoped cleaning request details after submission',async()=>{
  const u='request-details';
  let r=await q('cleaning-demo',u,'i want 2 bedroom apartment deep cleaning friday at 9 am');
  const requestedDate=r.state.capabilityState.cleaning.preferredDate;
  r=await q('cleaning-demo',u,'jumeira village circle phase two');
  r=await q('cleaning-demo',u,'Zeeshan Ahmad');
  r=await q('cleaning-demo',u,'03019299608');
  r=await q('cleaning-demo',u,'confirm');
  assert.match(r.reply,/request has been received/i);
  r=await q('cleaning-demo',u,'show my service details');
  assert.equal(r.capabilityId,'cleaning');
  assert.match(r.reply,/Deep Apartment Cleaning/i);
  assert.match(r.reply,new RegExp(escapeRegex(requestedDate)));
  assert.match(r.reply,/09:00|9 am/i);
  assert.doesNotMatch(r.reply,/Our services:/i);
});

function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

test('generic product discovery tolerates common typo and purchase wording',async()=>{
  let r=await q('default','list-products-buy','hello i want to buy some products from you');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/Cotton T-Shirt/);
  assert.doesNotMatch(r.reply,/not available right now/i);
  r=await q('default','list-products-typo','actually i want to see wht products do you have');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/Smart Watch/);
  assert.doesNotMatch(r.reply,/not available right now/i);
});

test('multi-item drafts recognize bounded product typos and safely own shorthand attributes',async()=>{
  const u='multi-attribute-slots';
  let r=await q('default',u,'ok can i have smrt watch cotton t shirt and gel pen pack');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/Smart Watch needs a color/i);
  assert.match(r.reply,/Cotton T-Shirt needs a color/i);
  assert.match(r.reply,/Gel Pen Pack needs a color/i);
  assert.equal(r.state.capabilityState.commerce.pendingMultiItemDraft.length,3);

  r=await q('default',u,'black and black');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/three|3|name each product/i);
  assert.ok(r.state.capabilityState.commerce.pendingMultiItemDraft.every(x=>!x.color));

  r=await q('default',u,'cotton shirt black and gel pen black');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/Smart Watch needs a color/i);
  assert.match(r.reply,/Cotton T-Shirt needs a size/i);

  r=await q('default',u,'s');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/Smart Watch needs a color/i);
  assert.doesNotMatch(r.reply,/support@example\.com/i);
  assert.equal(r.state.capabilityState.commerce.pendingMultiItemDraft.find(x=>x.productId==='P001').size,'S');

  r=await q('default',u,'smart watch silver');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/Added to your cart/i);
  const cart=await c.commerceRepository.getCart('default',u);
  assert.equal(cart.items.length,3);
  assert.deepEqual(cart.items.map(x=>x.productId).sort(),['P001','P004','P018']);
});

test('unlabeled attributes map by order only when the pending slots are unambiguous',async()=>{
  const u='ordered-attribute-slots';
  let r=await q('default',u,'i want a cotton t shirt and gel pen pack');
  assert.equal(r.state.capabilityState.commerce.pendingMultiItemDraft.length,2);
  r=await q('default',u,'navy and blue');
  assert.equal(r.capabilityId,'commerce');
  assert.equal(r.state.capabilityState.commerce.pendingMultiItemDraft.find(x=>x.productId==='P001').color,'Navy');
  assert.equal(r.state.capabilityState.commerce.pendingMultiItemDraft.find(x=>x.productId==='P018').color,'Blue');
  assert.match(r.reply,/Cotton T-Shirt needs a size/i);
  r=await q('default',u,'small');
  assert.match(r.reply,/Added to your cart/i);
  const cart=await c.commerceRepository.getCart('default',u);
  assert.equal(cart.items.length,2);
});
