const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer()});
test.after(async()=>{await c.registry.shutdownAll()});
const msg=(id,text)=>c.executionEngine.process({tenantId:'default',channel:'test',customerId:id,text});

async function prepareDraft(id){
  await msg(id,'can i get other type of shoes');
  await msg(id,'comfort slides');
  await msg(id,'black 41 size');
}

test('inventory rejection reports limit and does not acknowledge rejected quantity',async()=>{
  const id='tv-1'; await prepareDraft(id);
  const r=await msg(id,'50');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/only have 38|only 38/i);
  assert.match(r.reply,/up to 38|maximum 38/i);
  assert.doesNotMatch(r.reply,/^Perfect 👍/i);
});

test('invalid quantity is transactional and preserves prior valid draft slots only',async()=>{
  const id='tv-2'; await prepareDraft(id);
  const r=await msg(id,'50');
  const draft=r.state.capabilityState.catalog;
  assert.ok(draft.selectedProductId);
  assert.equal(draft.selectedAttributes.color,'Black');
  assert.equal(String(draft.selectedAttributes.size),'41');
  assert.equal(draft.selectedAttributes.quantity,undefined);
});

test('cart view explains empty committed cart and unfinished draft after inventory rejection',async()=>{
  const id='tv-3'; await prepareDraft(id); await msg(id,'50');
  const r=await msg(id,'show my cart');
  assert.equal(r.capabilityId,'commerce');
  assert.match(r.reply,/cart is currently empty/i);
  assert.match(r.reply,/product selection in progress/i);
  assert.match(r.reply,/Comfort Slides/);
  assert.match(r.reply,/Black/);
  assert.match(r.reply,/41/);
  assert.match(r.reply,/quantity hasn't been selected/i);
});

test('confirm after rejected quantity returns to quantity without losing product details',async()=>{
  const id='tv-4'; await prepareDraft(id); await msg(id,'50');
  const r=await msg(id,'confirm my order');
  assert.match(r.reply,/Comfort Slides/);
  assert.match(r.reply,/Black/);
  assert.match(r.reply,/41/);
  assert.match(r.reply,/How many|quantity/i);
  assert.doesNotMatch(r.reply,/Order Summary/i);
});
