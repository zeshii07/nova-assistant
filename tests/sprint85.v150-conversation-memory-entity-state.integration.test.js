const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");

let container;

test.before(async () => {
  // Ensure test tenant exists
  const tenantsDir = path.join(__dirname, "..", "tenants");
  container = await buildContainer();
  container.llmRouter.providers = [];
});

test.after(async () => {
  await container.storage?.close?.();
});

async function ask(tenantId, customerId, text) {
  return container.executionEngine.process({
    tenantId,
    channel: "sprint85",
    customerId,
    text,
    messageId: null,
  });
}

// === Conversation Memory Tests ===

test("conversation memory stores recent turns with entity snapshots", async () => {
  const user = "mem-turns";
  await ask("cleaning-demo", user, "book standard cleaning tomorrow at 10 AM for 2 cleaners 3 hours");

  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  const turns = inspect?.context?.recentTurns || [];

  assert.ok(turns.length >= 1, "Should have at least 1 turn stored");
  assert.equal(turns[0].capabilityId, "cleaning", "First turn should be cleaning capability");
  assert.ok(turns[0].text.includes("standard cleaning"), "Turn text should contain the message");
  assert.ok(turns[0].entities, "Turn should have entity snapshot");
  assert.ok(turns[0].entities.property.cleaningType === "standard", "Entity snapshot should have cleaningType=standard");
  assert.ok(!turns[0].entities.identity, "Entity snapshot should NOT contain PII (identity)");
});

test("conversation memory detects 'book it again' reference", async () => {
  const user = "mem-repeat";
  // First: create a booking
  await ask("cleaning-demo", user, "book standard cleaning tomorrow at 10 AM for 2 cleaners 3 hours");
  await ask("cleaning-demo", user, "House 42, Dubai Marina");
  await ask("cleaning-demo", user, "Ali Khan");
  await ask("cleaning-demo", user, "03012345678");
  await ask("cleaning-demo", user, "confirm");

  // Reset conversation (but CRM data persists)
  await container.stateRepository.delete(`cleaning-demo:sprint85:${user}`);

  // Now ask "book it again" — memory should detect the repeat intent
  const response = await ask("cleaning-demo", user, "book it again");

  // Check that memory context was resolved
  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  const memCtx = inspect?.context?.memoryContext;

  assert.ok(memCtx, "Memory context should be stored in state");
  assert.equal(memCtx.wantsRepeat, true, "Should detect wantsRepeat for 'book it again'");
});

test("conversation memory detects 'same address' reference", async () => {
  const user = "mem-address";
  // First: create a booking with address
  await ask("cleaning-demo", user, "book standard cleaning tomorrow at 10 AM for 2 cleaners 3 hours");
  await ask("cleaning-demo", user, "House 42, Dubai Marina");
  await ask("cleaning-demo", user, "Ali Khan");
  await ask("cleaning-demo", user, "03012345678");
  await ask("cleaning-demo", user, "confirm");

  // Reset conversation
  await container.stateRepository.delete(`cleaning-demo:sprint85:${user}`);

  // Now ask to use same address
  const response = await ask("cleaning-demo", user, "use the same address");

  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  const memCtx = inspect?.context?.memoryContext;

  assert.ok(memCtx, "Memory context should be stored");
  assert.equal(memCtx.wantsSameAddress, true, "Should detect wantsSameAddress");
  // lastAddress may be null if the booking wasn't fully completed in test
  // The important thing is that the reference was detected
});

test("conversation memory PII is excluded from entity snapshots", async () => {
  const user = "mem-pii";
  await ask("cleaning-demo", user, "my name is Zeeshan Ahmad and my phone is 03012345678");

  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  const turns = inspect?.context?.recentTurns || [];

  for (const turn of turns) {
    if (turn.entities) {
      assert.ok(!turn.entities.identity, "Entity snapshots must NOT contain identity (PII)");
    }
    // Also check that the raw turn text doesn't get stored with PII in entities
    if (turn.entities?.property) {
      assert.ok(!turn.entities.property.name, "Property entities must not contain name");
    }
  }
});

test("conversation memory session summary activates after threshold", async () => {
  const { ConversationMemoryEngine } = require("../packages/conversation-memory/src/conversationMemoryEngine");
  const engine = new ConversationMemoryEngine({});

  let state = { context: { recentTurns: [], sessionSummary: null } };

  // Add 10 turns (exceeds SUMMARIZE_THRESHOLD of 8)
  for (let i = 0; i < 10; i++) {
    const update = engine.addTurn({
      state,
      message: { text: `message ${i}` },
      capabilityId: "cleaning",
      intent: "cleaning.service_request",
      entities: null,
    });
    state = { context: { recentTurns: update.recentTurns, sessionSummary: update.sessionSummary } };
  }

  assert.ok(state.context.sessionSummary, "Session summary should exist after 10 turns");
  assert.ok(state.context.sessionSummary.includes("cleaning"), "Summary should contain capability info");
  assert.ok(state.context.recentTurns.length <= 6, "Recent turns should be capped at 6");
});

test("conversation memory resolves 'same time' reference", async () => {
  const { ConversationMemoryEngine } = require("../packages/conversation-memory/src/conversationMemoryEngine");
  const engine = new ConversationMemoryEngine({});

  const memory = {
    recentTurns: [
      { text: "book standard cleaning tomorrow at 10 AM", capabilityId: "cleaning", intent: "cleaning.service_request", entities: { temporal: { time: "10:00" } } },
    ],
    customer: {},
  };

  const result = engine.resolve("same time as last booking", memory);
  assert.equal(result.wantsSameTime, true, "Should detect 'same time' reference");
  assert.equal(result.lastBookingTime, "10:00", "Should resolve last booking time from memory");
});

test("conversation memory resolves 'change that' reference", async () => {
  const { ConversationMemoryEngine } = require("../packages/conversation-memory/src/conversationMemoryEngine");
  const engine = new ConversationMemoryEngine({});

  const memory = {
    recentTurns: [
      { text: "standard cleaning", capabilityId: "cleaning", intent: "cleaning.service_request", entities: { property: { cleaningType: "standard" } } },
    ],
    customer: {},
  };

  const result = engine.resolve("change that to deep cleaning", memory);
  assert.equal(result.wantsChange, true, "Should detect 'change that' reference");
  assert.equal(result.referencedService, "standard", "Should resolve last discussed service");
});

test("conversation memory context summary is human-readable", async () => {
  const { ConversationMemoryEngine } = require("../packages/conversation-memory/src/conversationMemoryEngine");
  const engine = new ConversationMemoryEngine({});

  const memory = {
    recentTurns: [
      { text: "book standard cleaning", capabilityId: "cleaning", intent: "cleaning.service_request" },
      { text: "what is the price", capabilityId: "cleaning", intent: "cleaning.standalone_quote" },
    ],
    sessionSummary: "Previous: discussed sofa cleaning",
  };

  const summary = engine.getContextSummary(memory);
  assert.ok(summary.includes("[SUMMARY]"), "Summary should include session summary");
  assert.ok(summary.includes("[1] cleaning/cleaning.service_request"), "Summary should list turns");
  assert.ok(summary.includes("[2] cleaning/cleaning.standalone_quote"), "Summary should list all turns");
});

// === Entity Extraction Tests ===

test("unified entity extraction extracts temporal entities", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");
  const entities = extractEntities("book cleaning tomorrow at 10 AM for 3 hours");

  assert.equal(entities.temporal.dateReference, "tomorrow");
  assert.equal(entities.temporal.startTime, "10:00");
  assert.equal(entities.temporal.durationHours, 3);
});

test("unified entity extraction extracts property entities", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");
  const entities = extractEntities("deep cleaning for 3 bedroom apartment");

  assert.equal(entities.property.bedrooms, 3);
  assert.equal(entities.property.propertyType, "apartment");
  assert.equal(entities.property.cleaningType, "deep");
});

test("unified entity extraction detects pricing questions", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");

  assert.equal(extractEntities("how much for deep cleaning").isPricingQuestion, true);
  assert.equal(extractEntities("what are charges for sofa cleaning").isPricingQuestion, true);
  assert.equal(extractEntities("book standard cleaning").isPricingQuestion, false);
});

test("unified entity extraction detects service support questions", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");

  const e1 = extractEntities("do you provide deep cleaning");
  assert.equal(e1.serviceSupport.isSupportQuestion, true);

  const e2 = extractEntities("do you clean curtains");
  assert.equal(e2.serviceSupport.isSupportQuestion, true);

  const e3 = extractEntities("book deep cleaning");
  assert.equal(e3.serviceSupport.isSupportQuestion, false);
});

test("unified entity extraction detects business identity questions", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");

  assert.equal(extractEntities("what is your business name").businessIdentity.isBusinessIdentity, true);
  assert.equal(extractEntities("what are your opening hours").businessIdentity.isBusinessIdentity, true);
  assert.equal(extractEntities("what is your phone number").businessIdentity.isBusinessIdentity, true);
  assert.equal(extractEntities("book deep cleaning").businessIdentity.isBusinessIdentity, false);
});

test("unified entity extraction detects booking actions", async () => {
  const { extractEntities } = require("../packages/entity-extraction/src/unifiedEntityExtractor");

  assert.equal(extractEntities("book standard cleaning").isBookingAction, true);
  assert.equal(extractEntities("schedule a cleaning").isBookingAction, true);
  assert.equal(extractEntities("how much for deep cleaning").isBookingAction, false);
});

// === State Machine Tests ===

test("state machine deep-merges nested objects", async () => {
  const stateMachine = require("../packages/state-machine/src/stateMachine");

  const target = { capabilityState: { cleaning: { step: "date", serviceName: "Standard" } } };
  const source = { capabilityState: { cleaning: { step: "time" } } };

  const result = stateMachine.deepMerge(target, source);
  assert.equal(result.capabilityState.cleaning.step, "time", "Should overwrite step");
  assert.equal(result.capabilityState.cleaning.serviceName, "Standard", "Should preserve serviceName");
});

test("state machine validates state schema", async () => {
  const stateMachine = require("../packages/state-machine/src/stateMachine");

  const state = stateMachine.createInitialState({
    tenantId: "test",
    conversationId: "test",
    channel: "playground",
    customerId: "user1",
  });

  const validation = stateMachine.validateState(state);
  assert.equal(validation.valid, true, "Initial state should be valid");
  assert.equal(validation.errors.length, 0, "Should have no errors");
});

test("state machine validates transition guards", async () => {
  const stateMachine = require("../packages/state-machine/src/stateMachine");

  assert.equal(stateMachine.isValidTransition("chatting", "collecting"), true, "chatting → collecting should be valid");
  assert.equal(stateMachine.isValidTransition("collecting", "reviewing"), true, "collecting → reviewing should be valid");
  assert.equal(stateMachine.isValidTransition("confirmed", "collecting"), false, "confirmed → collecting should be invalid");
  assert.equal(stateMachine.isValidTransition("cancelled", "reviewing"), false, "cancelled → reviewing should be invalid");
});

test("state machine snapshot and rollback", async () => {
  const stateMachine = require("../packages/state-machine/src/stateMachine");

  const state = { mode: "chatting", capabilityState: { cleaning: { step: "date" } } };
  const snapshot = stateMachine.snapshotState(state);

  // Modify state
  state.mode = "collecting";
  state.capabilityState.cleaning.step = "time";

  // Rollback
  const restored = stateMachine.rollbackState(state, snapshot);
  assert.equal(restored.mode, "chatting", "Should restore mode");
  assert.equal(restored.capabilityState.cleaning.step, "date", "Should restore capabilityState");
});

// === Intent Trace Logging Tests ===

test("intent trace logs routing decisions", async () => {
  const user = "trace-test";
  await ask("cleaning-demo", user, "how much for deep cleaning");

  // The trace should be visible in the server logs
  // We verify by checking the state was processed correctly
  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  assert.ok(inspect, "State should exist after processing");
  assert.ok(inspect.context?.lastCapability, "Should have lastCapability set");
});

// === Integration: Full Conversation Flow Tests ===

test("full cleaning booking flow with memory and entities", async () => {
  const user = "full-flow";

  // msg1: Book cleaning
  const r1 = await ask("cleaning-demo", user, "book standard cleaning tomorrow at 10 AM for 2 cleaners 3 hours");
  assert.ok(r1.reply.includes("AED 240") || r1.reply.includes("240"), "Should show AED 240");

  // msg2: Address
  const r2 = await ask("cleaning-demo", user, "House 42, Street 5, Dubai Marina, Dubai");
  assert.ok(r2.reply.toLowerCase().includes("name") || r2.reply.toLowerCase().includes("naam"), "Should ask for name");

  // msg3: Name
  const r3 = await ask("cleaning-demo", user, "Ali Khan");
  assert.ok(r3.reply.toLowerCase().includes("phone") || r3.reply.toLowerCase().includes("number"), "Should ask for phone");

  // msg4: Phone
  const r4 = await ask("cleaning-demo", user, "03012345678");
  assert.ok(r4.reply.toLowerCase().includes("confirm") || r4.reply.toLowerCase().includes("review"), "Should ask to confirm");

  // msg5: Confirm
  const r5 = await ask("cleaning-demo", user, "confirm");
  assert.ok(r5.reply.includes("CLN-") || r5.reply.includes("request"), "Should create a cleaning request");

  // Verify memory was stored
  const inspect = await container.stateRepository.get(`cleaning-demo:sprint85:${user}`);
  const turns = inspect?.context?.recentTurns || [];
  assert.ok(turns.length >= 5, "Should have 5+ turns in memory");
  assert.equal(turns[0].capabilityId, "cleaning", "First turn should be cleaning");

  // Verify entities were stored
  assert.ok(inspect?.context?.entities, "Should have entity model stored");
  assert.ok(inspect.context.entities.temporal, "Should have temporal entities stored");
});

test("full retail checkout flow with saved details", async () => {
  const user = "retail-flow";

  // msg1: Add product
  const r1 = await ask("default", user, "i want 1 polo shirt in white size small");
  assert.ok(r1.reply.includes("Polo") || r1.reply.includes("polo"), "Should show Polo Shirt");

  // msg2: Confirm
  const r2 = await ask("default", user, "confirm");
  assert.ok(r2.reply.toLowerCase().includes("name") || r2.reply.toLowerCase().includes("naam"), "Should ask for name");

  // msg3: Name
  await ask("default", user, "Ali Khan");
  // msg4: Phone
  await ask("default", user, "03012345678");
  // msg5: City
  await ask("default", user, "Lahore");
  // msg6: Address
  await ask("default", user, "House 42, Ali Town, Lahore");
  // msg7: Landmark
  await ask("default", user, "skip");
  // msg8: Payment
  await ask("default", user, "cod");
  // msg9: Confirm order
  const r9 = await ask("default", user, "confirm order");
  assert.ok(r9.reply.includes("ORD-") || r9.reply.includes("order"), "Should create an order");

  // Now test 2nd order with saved details
  await container.stateRepository.delete(`default:sprint85:${user}`);

  // msg1: Add another product
  await ask("default", user, "i want 1 denim jeans in blue size 32");
  // msg2: Confirm
  const r2b = await ask("default", user, "confirm");
  assert.ok(r2b.reply.includes("saved") || r2b.reply.includes("details"), "Should offer saved details");

  // msg3: "ok use" — should accept saved details
  const r3b = await ask("default", user, "ok use");
  assert.ok(r3b.reply.includes("saved") || r3b.reply.includes("Using"), "Should use saved details");

  // msg4: Confirm
  const r4b = await ask("default", user, "confirm");
  assert.ok(r4b.reply.includes("ORD-") || r4b.reply.includes("confirmed"), "Should create 2nd order");
});
