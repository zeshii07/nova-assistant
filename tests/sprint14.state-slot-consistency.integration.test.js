const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer()});
test.after(async()=>{await c.registry.shutdownAll()});
const msg=(id,text,tenantId='default')=>c.executionEngine.process({tenantId,channel:'test',customerId:id,text});

test('completed catalog configuration is immediately visible in canonical cart',async()=>{
  const id='ss-1';
  await msg(id,'i want comfort slides');
  await msg(id,'black 40 size');
  await msg(id,'30');
  const cart=await msg(id,'show my cart');
  assert.equal(cart.intelligence.selected.intent,'commerce.cart.view');
  assert.match(cart.reply,/Comfort Slides/);
  assert.match(cart.reply,/30/);
  assert.match(cart.reply,/57,000/);
});

test('add N more validates total quantity against inventory and reports remaining capacity',async()=>{
  const id='ss-2';
  await msg(id,'i want comfort slides');
  await msg(id,'black 40 size');
  await msg(id,'30');
  const r=await msg(id,'add 50 more comfort slides');
  assert.equal(r.intelligence.selected.intent,'commerce.cart.increment_quantity');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/already have 30/i);
  assert.match(r.reply,/only 38/i);
  assert.match(r.reply,/up to 8 more/i);
  const cart=await msg(id,'show my cart');
  assert.match(cart.reply,/× 30/);
});

test('checkout consumes canonical cart without duplicating staged item',async()=>{
  const id='ss-3';
  await msg(id,'i want comfort slides'); await msg(id,'black 40 size'); await msg(id,'30');
  const r=await msg(id,'confirm my order');
  assert.match(r.reply,/Comfort Slides \(Black\) \(40\) × 30/);
  assert.doesNotMatch(r.reply,/× 60/);
});

test('cleaning duration semantic entity is preserved into cleaning capability slots',async()=>{
  const id='ss-4';
  const r=await msg(id,'hello i want a cleaner for two hours','cleaning-demo');
  assert.equal(r.capabilityId,'cleaning');
  assert.equal(r.intelligence.entities.durationHours,2);
  assert.equal(r.state.capabilityState.cleaning.durationHours,2);
  assert.match(r.reply,/AED 80|40 per hour/i);
});

test('repeated generic cleaning request keeps duration instead of dropping it',async()=>{
  const id='ss-5';
  await msg(id,'i want a cleaner for two hours','cleaning-demo');
  const r=await msg(id,'can i get a cleaner for two hours','cleaning-demo');
  assert.equal(r.state.capabilityState.cleaning.durationHours,2);
  assert.match(r.reply,/2 hours/i);
});
