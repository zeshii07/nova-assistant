const test = require("node:test");
const assert = require("node:assert/strict");
const { PluginManager } = require("../src/pluginManager");

test("only resolves plugins enabled for the tenant", async () => {
  const manager = new PluginManager({});
  manager.register({ id: "assistant", canHandle: async () => true, execute: async () => ({ reply: "ok" }) });
  manager.register({ id: "booking", canHandle: async () => true, execute: async () => ({ reply: "booked" }) });
  const plugin = await manager.resolve({ tenant: { capabilities: ["assistant"] } });
  assert.equal(plugin.id, "assistant");
});
