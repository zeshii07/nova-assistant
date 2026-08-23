const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { Logger } = require("../packages/logger/src/logger");
const { FileTenantRepository } = require("../packages/tenant/src/tenantRepository");
const { PluginManager } = require("../packages/plugin/src/pluginManager");
const { AssistantPlugin } = require("../packages/plugin/src/assistantPlugin");
const { MemoryStateRepository } = require("../packages/state/src/memoryStateRepository");
const { ConversationOrchestrator } = require("../packages/conversation/src/conversationOrchestrator");

function createSystem() {
  const logger = new Logger({ level: "error" });
  const tenantRepository = new FileTenantRepository({ tenantsDir: path.resolve(__dirname, "../tenants"), logger });
  const pluginManager = new PluginManager({ logger }).register(new AssistantPlugin());
  const stateRepository = new MemoryStateRepository();
  const orchestrator = new ConversationOrchestrator({ tenantRepository, pluginManager, stateRepository, logger, defaultTenantId: "default" });
  return { orchestrator, stateRepository };
}

test("routes a greeting through tenant, plugin, and state engines", async () => {
  const { orchestrator, stateRepository } = createSystem();
  const result = await orchestrator.process({ channel: "http", customerId: "user-1", tenantId: "default", text: "hello" });
  assert.match(result.reply, /Hello|store|help/i);
  assert.equal(result.conversationId, "default:http:user-1");
  const state = await stateRepository.get(result.conversationId);
  assert.equal(state.activePlugin, "assistant");
  assert.equal(state.lastIntent, "greet");
});

test("persists state across messages", async () => {
  const { orchestrator, stateRepository } = createSystem();
  await orchestrator.process({ channel: "http", customerId: "user-2", text: "hello" });
  await orchestrator.process({ channel: "http", customerId: "user-2", text: "tell me more" });
  const state = await stateRepository.get("default:http:user-2");
  assert.equal(state.context.lastMessage, "tell me more");
  assert.equal(state.lastIntent, "assistant_message");
});

test("isolates customers by conversation id", async () => {
  const { orchestrator, stateRepository } = createSystem();
  await orchestrator.process({ channel: "http", customerId: "a", text: "hello" });
  await orchestrator.process({ channel: "http", customerId: "b", text: "different" });
  assert.notDeepEqual(await stateRepository.get("default:http:a"), await stateRepository.get("default:http:b"));
});
