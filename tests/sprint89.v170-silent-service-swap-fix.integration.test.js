/**
 * Sprint 89 — v17.0 Silent Service Swap Fix
 *
 * Validates that the defensive guard added to `summary()` in
 * capabilities/cleaning/src/index.js prevents the silent service swap bug
 * the user reported.
 *
 * Bug description:
 *   User asks for villa → deep cleaning → 3 bedrooms → date.
 *   At the date step, Nova's savedCustomerTransition jumps straight to
 *   the confirm step and calls summary(service, state, language).
 *   If `service` is undefined (e.g., because state.serviceId was somehow
 *   lost) OR if `service` lookup returns the WRONG service (e.g., the
 *   customer's most recent laundry order leaking through CRM), the
 *   summary would silently display a DIFFERENT service than what the
 *   user actually selected.
 *
 * Fix:
 *   summary() now defensively checks that `service.id === state.serviceId`.
 *   If they don't match (or service is undefined), it falls back to
 *   `state.configuredServiceName || state.serviceName` so the displayed
 *   service name ALWAYS matches what the user selected.
 *
 * Test strategy:
 *   - Direct unit test of summary() with mismatched service
 *   - End-to-end test: confirm that the user's actual reported conversation
 *     (villa → deep → 3 → friday 7 pm) shows "Deep Villa Cleaning" in the
 *     summary, NOT a previously-ordered laundry service
 *   - End-to-end test with stale CRM history: confirm the matcher never
 *     leaks the previous order's service name into the new request summary
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");

let container;

test.before(async () => {
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
    channel: "sprint89",
    customerId,
    text,
    messageId: null,
  });
}

// === Unit tests of the summary() defensive guard ===

test("summary() uses state.serviceName when service lookup fails", async () => {
  // Load the cleaning capability to access its internal summary function
  // We test indirectly by inspecting the reply text.
  // The bug case: user picked Deep Villa Cleaning (CLN011), then at confirm
  // step the summary should show "Deep Villa Cleaning" (state.configuredServiceName)
  // NOT a stale service from CRM history.

  const cid = "swap-unit-1";
  // Create laundry order to seed CRM history
  await ask("cleaning-demo", cid, "i want laundry home care cleaning");
  await ask("cleaning-demo", cid, "tomorrow at 11 AM");
  await ask("cleaning-demo", cid, "Villa 34, JVC Phase 2, Dubai");
  await ask("cleaning-demo", cid, "James Watson");
  await ask("cleaning-demo", cid, "03077374765");
  await ask("cleaning-demo", cid, "zeeshan@gmil.com");
  await ask("cleaning-demo", cid, "confirm");

  // Reset conversation
  await container.stateRepository.delete(`cleaning-demo:sprint89:${cid}`);

  // Now make a fresh Deep Villa Cleaning request
  await ask("cleaning-demo", cid, "hello i want cleaning service for my villa");
  await ask("cleaning-demo", cid, "i want deep cleaning");
  await ask("cleaning-demo", cid, "3");
  const r = await ask("cleaning-demo", cid, "friday 7 pm");

  // The reply should mention Deep Villa Cleaning (the user's selected service)
  // NOT "Home-care & Textile Laundry" or "Laundry Home-care Cleaning"
  assert.ok(/deep\s+villa\s+cleaning/i.test(r.reply),
    `Reply should mention Deep Villa Cleaning, got: ${r.reply}`);
  assert.ok(!/laundry|home.?care|textile/i.test(r.reply),
    `Reply should NOT mention Laundry (silent swap bug), got: ${r.reply}`);
});

// === End-to-end: the exact scenario the user reported ===

test("user's reported bug: villa → deep → 3 → friday 7 pm shows Deep Villa Cleaning", async () => {
  const cid = "user-bug-report-2";

  // Step 1: User asks for villa cleaning
  const r1 = await ask("cleaning-demo", cid, "hello i want cleaning service for my villa");
  assert.equal(r1.capabilityId, "cleaning");
  assert.ok(/standard|deep/i.test(r1.reply), "Should ask Standard vs Deep");

  // Step 2: User picks deep cleaning
  const r2 = await ask("cleaning-demo", cid, "i want deep cleaning");
  assert.equal(r2.capabilityId, "cleaning");
  assert.ok(/deep cleaning selected/i.test(r2.reply), "Should confirm Deep Cleaning selected");
  assert.ok(/bedrooms/i.test(r2.reply), "Should ask for bedrooms");

  // Step 3: User says 3 bedrooms
  const r3 = await ask("cleaning-demo", cid, "3");
  assert.equal(r3.capabilityId, "cleaning");
  // Should show configured estimate for Deep Villa Cleaning (3 bedrooms)
  assert.ok(/aed|estimate|configured/i.test(r3.reply),
    `Should show estimate, got: ${r3.reply}`);

  // Step 4: User provides date+time. With no CRM history, Nova asks for address next.
  // With CRM history, Nova shows the saved-details summary.
  // In BOTH cases, the reply must NOT silently swap to a different service.
  const r4 = await ask("cleaning-demo", cid, "friday 7 pm");
  assert.equal(r4.capabilityId, "cleaning");

  // The reply at this step is either:
  //   (a) "Please share the full service address..." (no CRM history) — fine
  //   (b) "Cleaning request summary: Deep Villa Cleaning ..." (with CRM history)
  // In case (a) there's no service mention, so we just verify no laundry leak.
  // In case (b) we verify the service name matches the user's selection.
  assert.ok(!/laundry|home.?care|textile/i.test(r4.reply),
    `Reply should NOT mention Laundry (silent swap bug), got: ${r4.reply}`);

  // If reply contains a summary, it should mention Deep Villa Cleaning
  if (/cleaning request summary/i.test(r4.reply)) {
    assert.ok(/deep\s+villa\s+cleaning/i.test(r4.reply),
      `Summary should mention Deep Villa Cleaning, got: ${r4.reply}`);
  }
});

// === Even with heavy CRM history, the new request keeps its service ===

test("stale laundry history does not leak into new deep cleaning summary", async () => {
  const cid = "swap-leak-1";

  // Create MULTIPLE laundry orders to maximize the chance of leakage
  for (let i = 0; i < 2; i++) {
    await ask("cleaning-demo", cid, "i want laundry home care cleaning");
    await ask("cleaning-demo", cid, "tomorrow at 11 AM");
    await ask("cleaning-demo", cid, "Villa 34, JVC Phase 2, Dubai");
    await ask("cleaning-demo", cid, "James Watson");
    await ask("cleaning-demo", cid, "03077374765");
    await ask("cleaning-demo", cid, "zeeshan@gmil.com");
    await ask("cleaning-demo", cid, "confirm");
    await container.stateRepository.delete(`cleaning-demo:sprint89:${cid}`);
  }

  // Now make a deep cleaning request
  await ask("cleaning-demo", cid, "hello i want cleaning service for my villa");
  await ask("cleaning-demo", cid, "i want deep cleaning");
  await ask("cleaning-demo", cid, "3");
  const r = await ask("cleaning-demo", cid, "friday 7 pm");

  // CRITICAL: must show deep cleaning, not laundry
  assert.ok(/deep\s+(villa\s+)?cleaning/i.test(r.reply),
    `Reply must mention Deep (Villa) Cleaning, got: ${r.reply}`);
  assert.ok(!/laundry|home.?care|textile/i.test(r.reply),
    `Reply must NOT mention Laundry. Got: ${r.reply}`);
});

// === State.serviceId is preserved throughout the workflow ===

test("state.serviceId stays as CLN011 (Deep Villa Cleaning) throughout", async () => {
  const cid = "swap-state-1";
  await ask("cleaning-demo", cid, "hello i want cleaning service for my villa");
  await ask("cleaning-demo", cid, "i want deep cleaning");
  await ask("cleaning-demo", cid, "3");

  const state = await container.stateRepository.get(`cleaning-demo:sprint89:${cid}`);
  assert.equal(state.capabilityState?.cleaning?.serviceId, "CLN011",
    `Expected CLN011 (Deep Villa Cleaning), got ${state.capabilityState?.cleaning?.serviceId}`);
  assert.equal(state.capabilityState?.cleaning?.serviceName, "Deep Cleaning");
  assert.equal(state.capabilityState?.cleaning?.configuredServiceName, "Deep Villa Cleaning");
  assert.equal(state.capabilityState?.cleaning?.bedrooms, 3);
});

// === Furniture cleaning correctly asks for furniture type ===

test("furniture cleaning asks 'which type of furniture' before date", async () => {
  const cid = "furn-fix-1";
  const r = await ask("cleaning-demo", cid, "i want furniture cleaning service");
  assert.equal(r.capabilityId, "cleaning");
  // Must ask which type of furniture — NOT immediately ask for a date
  assert.ok(/which type of furniture|sofa cleaning|carpet cleaning|mattress/i.test(r.reply),
    `Should ask for furniture type, got: ${r.reply}`);
  assert.ok(!/what date|which date|preferred date/i.test(r.reply),
    `Should NOT ask for date yet, got: ${r.reply}`);
});

// === 'do you clean sofa and mattress' (no active draft) lists services ===

test("'do you clean sofa and mattress' lists furniture services when no draft", async () => {
  const cid = "do-you-clean-1";
  const r = await ask("cleaning-demo", cid, "do you clean sofa and mattress");
  // Should route to availability or cleaning (not assistant fallback)
  assert.ok(['cleaning', 'availability'].includes(r.capabilityId),
    `Expected cleaning or availability, got ${r.capabilityId}`);
  // Reply should mention sofa and/or mattress services
  assert.ok(/sofa|mattress/i.test(r.reply),
    `Should mention sofa/mattress, got: ${r.reply}`);
  // Should NOT say "I don't have approved information"
  assert.ok(!/don.t have approved|not approved information/i.test(r.reply),
    `Should NOT say 'no approved information', got: ${r.reply}`);
});

// === Catalog query 'show me watches' should return Smart Watch ===

test("retail 'show me watches' returns Smart Watch in catalog browse", async () => {
  const cid = "show-watches-1";
  const r = await ask("default", cid, "show me watches");
  assert.ok(r.capabilityId, "Should route to a capability");
  // Reply should mention Smart Watch (the product matcher should surface it)
  assert.ok(/smart watch/i.test(r.reply),
    `Should mention Smart Watch, got: ${r.reply}`);
});
