const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContainer } = require("../apps/api/src/container");

test("assistant writes language preference and message history", async () => {
  const container = await buildContainer();
  await container.executionEngine.process({ tenantId: "default", customerId: "memory-user", channel: "http", text: "aap kaise ho" });
  const tenant = container.tenantRepository.getById("default");
  const memory = container.memoryService.scope({ tenant, capabilityId: "assistant", customerId: "memory-user", conversationId: "default:http:memory-user" });
  assert.equal(await memory.getPreference("language"), "roman_urdu");
  const history = await memory.list({ tags: ["history"] });
  assert.equal(history.length, 1);
  assert.equal(history[0].value.event, "assistant.message");
  await container.registry.shutdownAll();
});

test("memory emits versioned write events", async () => {
  const container = await buildContainer();
  let count = 0;
  container.eventBus.subscribe("memory.written.v1", () => { count += 1; });
  await container.executionEngine.process({ tenantId: "default", customerId: "event-user", channel: "http", text: "hello" });
  assert.equal(count >= 1, true);
  await container.registry.shutdownAll();
});
