const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContainer } = require("../apps/api/src/container");

async function chat(container, tenantId, customerId, text, channel = "http") {
  return container.executionEngine.process({ tenantId, customerId, channel, text });
}

test("expanded retail catalog exposes many categories and products", async () => {
  const c = await buildContainer();
  const products = await c.catalogRepository.listProducts("default");
  const categories = await c.catalogRepository.listCategories("default");
  assert.ok(products.length >= 18);
  assert.ok(categories.length >= 7);
  const result = await chat(c, "default", "catalog-expansion", "what products do you have");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Running Shoes/);
  assert.match(result.reply, /LED Desk Lamp/);
  assert.match(result.reply, /Urban Backpack/);
  await c.registry.shutdownAll();
});

test("three retail customers keep independent product and order state", async () => {
  const c = await buildContainer();
  const users = [
    ["customer-a", ["i want silver sunglasses", "4", "confirm order", "Ali Khan", "03001234567", "Lahore", "Model Town Lahore", "skip", "cash on delivery"]],
    ["customer-b", ["i want 2 black wireless earbuds", "confirm order", "Sara Ahmed", "03007654321", "Karachi", "Clifton Karachi", "skip", "cash on delivery"]],
    ["customer-c", ["i want black running shoes size 42", "1", "confirm order", "Usman", "03111222333", "Islamabad", "F-10 Islamabad", "skip", "cash on delivery"]]
  ];
  for (const [id, messages] of users) {
    let result;
    for (const text of messages) result = await chat(c, "default", id, text);
    assert.match(result.reply, /customer \/ delivery details|say confirm/i);
    result = await chat(c, "default", id, "confirm");
    assert.equal(result.capabilityId, "commerce");
    assert.match(result.reply, /order is confirmed/i);
  }
  const a = await c.commerceRepository.listOrders("default", "customer-a");
  const b = await c.commerceRepository.listOrders("default", "customer-b");
  const d = await c.commerceRepository.listOrders("default", "customer-c");
  assert.equal(a.length, 1); assert.equal(b.length, 1); assert.equal(d.length, 1);
  assert.equal(a[0].items[0].name, "Sunglasses");
  assert.equal(b[0].items[0].name, "Wireless Earbuds");
  assert.equal(d[0].items[0].name, "Running Shoes");
  await c.registry.shutdownAll();
});


test("numeric shoe size is not misread as quantity", async () => {
  const c = await buildContainer();
  const result = await chat(c, "default", "shoe-size-only", "i want black running shoes size 42");
  assert.equal(result.capabilityId, "catalog");
  assert.match(result.reply, /Size: 42/);
  assert.doesNotMatch(result.reply, /Quantity: 42/);
  assert.match(result.reply, /How many|quantity/i);
  await c.registry.shutdownAll();
});

test("cleaning tenant lists services and creates a service request", async () => {
  const c = await buildContainer();
  let result = await chat(c, "cleaning-demo", "clean-user", "what cleaning services do you offer");
  assert.equal(result.capabilityId, "cleaning");
  assert.match(result.reply, /Sofa Cleaning/);
  assert.match(result.reply, /Office Cleaning/);

  result = await chat(c, "cleaning-demo", "clean-user", "i need sofa cleaning");
  assert.equal(result.capabilityId, "cleaning");
  assert.match(result.reply, /date/i);
  for (const message of ["12 August", "4 pm", "House 12 Model Town Lahore", "Zeeshan Ahmad", "03019299608"]) result = await chat(c, "cleaning-demo", "clean-user", message);
  assert.match(result.reply, /confirm/i);
  result = await chat(c, "cleaning-demo", "clean-user", "confirm");
  assert.equal(result.capabilityId, "cleaning");
  assert.match(result.reply, /Request ID: CLN-/);
  assert.match(result.reply, /final confirmation/i);
  await c.registry.shutdownAll();
});

test("retail and cleaning tenant personas remain isolated", async () => {
  const c = await buildContainer();
  const retail = await chat(c, "default", "tenant-isolation-a", "hello");
  const cleaning = await chat(c, "cleaning-demo", "tenant-isolation-b", "hello");
  assert.equal(retail.capabilityId, "assistant");
  assert.equal(cleaning.capabilityId, "assistant");
  assert.doesNotMatch(retail.reply, /cleaning needs/i);
  assert.match(cleaning.reply, /cleaning/i);
  await c.registry.shutdownAll();
});
