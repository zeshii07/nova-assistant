const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');

async function chat(container, customerId, text) {
  return container.executionEngine.process({ tenantId: 'default', customerId, channel: 'http', text });
}

test('specific product wins over generic word products', async () => {
  const container = await buildContainer();
  const result = await chat(container, 'ci-product', 'i want to make an order for sunglasses from your products');
  assert.equal(result.capabilityId, 'catalog');
  assert.match(result.reply, /Sunglasses/);
  assert.match(result.reply, /Rs1,800/);
  assert.doesNotMatch(result.reply, /^Certainly!.*products available/is);
  await container.registry.shutdownAll();
});

test('quantity words are handled against pending catalog state', async () => {
  const container = await buildContainer();
  let result = await chat(container, 'ci-quantity-word', 'i want silver sunglasses');
  assert.equal(result.capabilityId, 'catalog');
  assert.match(result.reply, /Silver/);
  result = await chat(container, 'ci-quantity-word', 'i want to order four pieces');
  assert.equal(result.capabilityId, 'catalog');
  assert.match(result.reply, /Quantity: 4/);
  assert.match(result.reply, /Rs7,200/);
  assert.match(result.reply, /confirm/i);
  await container.registry.shutdownAll();
});

test('quantity correction phrase updates pending selection', async () => {
  const container = await buildContainer();
  await chat(container, 'ci-correction', 'silver sunglasses');
  const result = await chat(container, 'ci-correction', 'i meant 4');
  assert.equal(result.capabilityId, 'catalog');
  assert.match(result.reply, /Quantity: 4/);
  assert.match(result.reply, /Rs7,200/);
  await container.registry.shutdownAll();
});

test('roman urdu generic inventory phrase lists products instead of unavailable item', async () => {
  const container = await buildContainer();
  const result = await chat(container, 'ci-browse-ru', 'ap k pass kia kia hai?');
  assert.equal(result.capabilityId, 'catalog');
  assert.match(result.reply, /Cotton T-Shirt/);
  assert.doesNotMatch(result.reply, /kia kia.*available nahi/i);
  await container.registry.shutdownAll();
});

test('common greetings reliably route to assistant', async () => {
  const container = await buildContainer();
  for (const [id, text] of [['g1','hi'], ['g2','hello'], ['g3','assalam o alaikum kia hal hai']]) {
    const result = await chat(container, id, text);
    assert.equal(result.capabilityId, 'assistant');
    assert.ok(result.reply && result.reply.trim().length > 0);
  }
  await container.registry.shutdownAll();
});
