const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');

async function chat(container, id, text) {
  return container.executionEngine.process({ tenantId:'default', customerId:id, channel:'playground', text });
}

test('goal engine preserves footwear browse context and asks for candidate selection', async () => {
  const c = await buildContainer();
  let r = await chat(c, 'goal-footwear', 'can i get shoes');
  assert.equal(r.capabilityId, 'catalog');
  assert.match(r.reply, /Running Shoes/);
  assert.match(r.reply, /Comfort Slides/);
  assert.equal(r.state.context.goal.type, 'purchase_product');
  assert.equal(r.state.context.goal.categoryId, 'footwear');
  assert.equal(r.state.context.goal.candidateIds.length, 2);

  r = await chat(c, 'goal-footwear', 'ok book my order');
  assert.equal(r.capabilityId, 'catalog');
  assert.match(r.reply, /which product|product choose|کون سا پروڈکٹ/i);
  assert.match(r.reply, /Running Shoes/);
  assert.match(r.reply, /Comfort Slides/);
  assert.equal(r.state.context.goal.stage, 'awaiting_product_selection');
  await c.registry.shutdownAll();
});

test('confirming a candidate product selects it before commerce and collects details', async () => {
  const c = await buildContainer();
  await chat(c, 'goal-select', 'can i get shoes');
  const r = await chat(c, 'goal-select', 'confirm running shoes as my order');
  assert.equal(r.capabilityId, 'catalog');
  assert.match(r.reply, /Running Shoes/);
  assert.doesNotMatch(r.reply, /Please complete the product details first/i);
  const product = await c.catalogService.getProductById('default', r.state.context.goal.selectedProductId);
  assert.equal(product.name, 'Running Shoes');
  assert.match(r.reply, /color|size|quantity/i);
  await c.registry.shutdownAll();
});

test('goal hands off to commerce only after product details are complete', async () => {
  const c = await buildContainer();
  await chat(c, 'goal-checkout', 'can i get shoes');
  await chat(c, 'goal-checkout', 'running shoes');
  await chat(c, 'goal-checkout', 'white');
  await chat(c, 'goal-checkout', '42');
  await chat(c, 'goal-checkout', '1');
  const r = await chat(c, 'goal-checkout', 'confirm my order');
  assert.equal(r.capabilityId, 'commerce');
  assert.match(r.reply, /Order Summary/);
  assert.match(r.reply, /full name|naam|نام/i);
  assert.equal(r.state.context.goal.stage, 'checkout');
  await c.registry.shutdownAll();
});

test('cancel clears active goal', async () => {
  const c = await buildContainer();
  await chat(c, 'goal-cancel', 'can i get shoes');
  const r = await chat(c, 'goal-cancel', 'cancel my order');
  assert.equal(r.capabilityId, 'system');
  assert.equal(r.state.context.goal, null);
  await c.registry.shutdownAll();
});
