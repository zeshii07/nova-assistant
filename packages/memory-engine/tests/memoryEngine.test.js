const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryMemoryRepository } = require("../src/inMemoryMemoryRepository");
const { MemoryPermissionService } = require("../src/memoryPermissionService");
const { MemoryService } = require("../src/memoryService");
const { EventBus } = require("../../event-engine/src/eventBus");

function setup(permissions = ["memory.read:assistant", "memory.write:assistant", "memory.delete:assistant"]) {
  const repository = new InMemoryMemoryRepository();
  const service = new MemoryService({ repository, permissionService: new MemoryPermissionService(), eventBus: new EventBus() });
  const tenant = { id: "tenant-a", permissions };
  return { repository, tenant, memory: service.scope({ tenant, capabilityId: "assistant", customerId: "customer-1", conversationId: "tenant-a:http:customer-1" }) };
}

test("stores and retrieves customer memory", async () => {
  const { memory } = setup();
  await memory.put("favoriteColor", "Black");
  assert.equal(await memory.value("favoriteColor"), "Black");
});

test("preferences and history are namespaced", async () => {
  const { memory } = setup();
  await memory.setPreference("language", "roman_urdu");
  await memory.appendHistory("assistant.message", { intent: "greet" });
  assert.equal(await memory.getPreference("language"), "roman_urdu");
  const history = await memory.list({ tags: ["history"] });
  assert.equal(history.length, 1);
  assert.equal(history[0].value.event, "assistant.message");
});

test("denies memory access without tenant permission", async () => {
  const { memory } = setup([]);
  await assert.rejects(() => memory.put("x", 1), /permission denied/i);
  await assert.rejects(() => memory.get("x"), /permission denied/i);
});

test("expired records are not returned", async () => {
  const { memory } = setup();
  await memory.put("temporary", "value", { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await memory.get("temporary"), null);
});

test("customer memories are isolated", async () => {
  const repository = new InMemoryMemoryRepository();
  const service = new MemoryService({ repository, permissionService: new MemoryPermissionService(), eventBus: new EventBus() });
  const tenant = { id: "tenant-a", permissions: ["memory.read:assistant", "memory.write:assistant"] };
  const first = service.scope({ tenant, capabilityId: "assistant", customerId: "one", conversationId: "tenant-a:http:one" });
  const second = service.scope({ tenant, capabilityId: "assistant", customerId: "two", conversationId: "tenant-a:http:two" });
  await first.put("name", "Ali");
  assert.equal(await second.value("name"), null);
});
