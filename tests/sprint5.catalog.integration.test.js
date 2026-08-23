const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContainer } = require("../apps/api/src/container");

async function chat(container, customerId, text) {
  return container.executionEngine.process({ tenantId: "default", customerId, channel: "http", text });
}

test("catalog finds product and official price from a misspelled query", async () => {
  const container = await buildContainer();
  const result = await chat(container, "catalog-price", "what is price of wireless airbud");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Wireless Earbuds/);
  assert.match(result.reply, /Rs4,500/);
  await container.registry.shutdownAll();
});

test("catalog handles pending typo color and quantity without fallback", async () => {
  const container = await buildContainer();
  let result = await chat(container, "catalog-flow", "what is price of wireless airbud");
  assert.match(result.reply, /What color/i);
  result = await chat(container, "catalog-flow", "i want blck");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Color: Black/);
  assert.match(result.reply, /How many/i);
  result = await chat(container, "catalog-flow", "1");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Quantity: 1/);
  assert.match(result.reply, /Subtotal: Rs4,500/);
  await container.registry.shutdownAll();
});

test("catalog rejects unavailable products without hallucinating", async () => {
  const container = await buildContainer();
  const result = await chat(container, "catalog-milk", "do you have sugar and milk");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /not available/i);
  assert.doesNotMatch(result.reply.split("\n")[0], /Cotton T-Shirt/i);
  await container.registry.shutdownAll();
});

test("catalog extracts product color and quantity from one message", async () => {
  const container = await buildContainer();
  const result = await chat(container, "catalog-complete", "i want 1 black wireless earbud");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Wireless Earbuds/);
  assert.match(result.reply, /Color: Black/);
  assert.match(result.reply, /Quantity: 1/);
  await container.registry.shutdownAll();
});

test("catalog supports Roman Urdu and records CRM activity", async () => {
  const container = await buildContainer();
  const result = await chat(container, "catalog-urdu", "mujhe white cotton t shirt chahiye");
  assert.equal(result.capabilityId, "catalog");
  assert.equal(result.state.language, "roman_urdu");
  assert.match(result.reply, /Cotton T-Shirt/);
  assert.match(result.reply, /Color: White/);
  const activities = await container.crmService.listActivities("default", "catalog-urdu");
  assert.ok(activities.some((item) => item.type === "catalog.product_viewed"));
  await container.registry.shutdownAll();
});

test("catalog data is tenant-owned and available from the service", async () => {
  const container = await buildContainer();
  const products = await container.catalogService.listProducts("default");
  assert.equal(products.length, 18);
  assert.equal(products[2].id, "P003");
  assert.equal(products[2].price, 4500);
  await container.registry.shutdownAll();
});
