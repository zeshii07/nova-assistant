const test = require("node:test"); const assert = require("node:assert/strict");
const path = require("path");
const { CapabilityLoader } = require("../src/capabilityLoader");
const { CapabilityRegistry } = require("../src/capabilityRegistry");
const { CapabilityRouter } = require("../src/capabilityRouter");
const { CapabilityPermissionService } = require("../../permission-engine/src/capabilityPermissionService");

test("loader discovers assistant capability", () => { const loader = new CapabilityLoader({ capabilitiesDir: path.resolve(__dirname, "../../../capabilities") }); const found = loader.discover(); assert.equal(found.some((item) => item.manifest.id === "assistant"), true); });
test("registry initializes and shuts down capability", async () => { const registry = new CapabilityRegistry(); const capability = { id: "demo", manifest: { id: "demo" }, initialize: async function(){ this.ready = true; }, shutdown: async function(){ this.ready = false; }, canHandle: async () => ({ confidence: 1 }), execute: async () => ({ reply: "ok" }) }; await registry.register(capability); assert.equal(capability.ready, true); await registry.unregister("demo"); assert.equal(capability.ready, false); });
test("router enforces tenant capabilities and permissions", async () => { const registry = new CapabilityRegistry(); await registry.register({ id: "demo", manifest: { id: "demo", permissions: ["demo.read"], priority: 1 }, initialize: async()=>{}, shutdown: async()=>{}, canHandle: async()=>({ confidence: .9 }), execute: async()=>({}) }); const router = new CapabilityRouter({ registry, permissionService: new CapabilityPermissionService() }); assert.equal((await router.resolve({ tenant: { capabilities:["demo"], permissions:["demo.read"] } })).capability.id, "demo"); assert.equal(await router.resolve({ tenant: { capabilities:["demo"], permissions:[] } }), null); });
