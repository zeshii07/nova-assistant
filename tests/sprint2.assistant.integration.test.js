const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContainer } = require("../apps/api/src/container");

async function chat(containerOrPromise, customerId, text) {
  const container = await containerOrPromise;
  return container.executionEngine.process({ tenantId: "default", channel: "http", customerId, text });
}

test("English greeting is natural", async () => {
  const result = await chat(buildContainer(), "en-1", "hello");
  assert.match(result.reply, /Hello|help/i);
  assert.equal(result.state.language, "english");
});

test("Roman Urdu small talk keeps Roman Urdu", async () => {
  const result = await chat(buildContainer(), "ru-1", "aap kaise ho");
  assert.match(result.reply, /theek|madad/i);
  assert.equal(result.state.language, "roman_urdu");
});

test("Urdu script location answer uses approved tenant location", async () => {
  const result = await chat(buildContainer(), "ur-1", "آپ کہاں واقع ہیں؟");
  assert.match(result.reply, /Lahore|لاہور/i);
  assert.equal(result.state.language, "urdu");
});

test("Services come only from approved knowledge", async () => {
  const result = await chat(buildContainer(), "svc-1", "what services do you offer");
  assert.match(result.reply, /AI assistance/);
  assert.doesNotMatch(result.reply, /booking|products/i);
});

test("Thanks does not fall back", async () => {
  const result = await chat(buildContainer(), "thanks-1", "ok thanks");
  assert.match(result.reply, /welcome|anytime/i);
  assert.equal(result.state.lastIntent, "thanks");
});

test("Unknown information fails safely when LLM is unavailable", async () => {
  const container = await buildContainer();
  const result = await chat(container, "unknown-1", "what is the founder's favorite movie");
  assert.match(result.reply, /not fully sure|approved information|contact/i);
  assert.doesNotMatch(result.reply, /Titanic|Avatar|Inception/i);
});
