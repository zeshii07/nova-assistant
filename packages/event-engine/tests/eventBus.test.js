const test = require("node:test"); const assert = require("node:assert/strict");
const { EventBus } = require("../src/eventBus");
test("event bus publishes versioned events", async () => { const bus = new EventBus(); let seen; bus.subscribe("demo.created.v1", (event) => { seen = event; }); await bus.publish("demo.created.v1", { id: 1 }); assert.equal(seen.name, "demo.created.v1"); assert.equal(seen.payload.id, 1); });
test("one failing event handler does not stop others", async () => { const bus = new EventBus(); let count = 0; bus.subscribe("x.v1", () => { throw new Error("boom"); }); bus.subscribe("x.v1", () => { count += 1; }); const results = await bus.publish("x.v1"); assert.equal(count, 1); assert.equal(results.some((r) => !r.ok), true); });
