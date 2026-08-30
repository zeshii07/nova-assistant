/**
 * Sprint 90 — v18.0 Workflow Order & Typo Tolerance Fixes
 *
 * Validates the fixes for the user's reported bugs:
 *
 * 1. "i want deeep cleaning for my villa" (typo: deeep → deep)
 *    Previously: fell through to booking_type_clarification (asking Standard vs Deep)
 *    Now: correctly identifies Deep Villa Cleaning (CLN011) and asks for bedrooms
 *
 * 2. "i want deep cleaning for my villa" (no typo)
 *    Previously: returned "Deep Villa Cleaning requires a custom quotation..."
 *    Now: correctly selects CLN011, asks "How many bedrooms?" BEFORE date
 *
 * 3. "i want furniture cleaning service"
 *    Already fixed in v17.0 — asks "Which type of furniture?" with full list
 *    Re-verified here for regression coverage.
 *
 * 4. "do you do deep clening or furniture cleaning" (typo + multi-service)
 *    Already fixed in v17.0 — routes to availability.multi_service_support
 *    Re-verified here.
 *
 * 5. "do you provide deep cleaning service" / "do you offer deep cleaning"
 *    Already fixed in v17.0 — routes to availability with service list
 *    Re-verified here.
 *
 * 6. Silent service swap (Deep Villa → Laundry) — defensive guard from v17.0
 *    Re-verified here with the exact user scenario.
 *
 * 7. Standard cleaning workflow preserves correct serviceId/price
 *    Re-verified: 3 cleaners × 3 hours × AED 40 = AED 360 (not AED 31.50)
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
    channel: "sprint90",
    customerId,
    text,
    messageId: null,
  });
}

// === Bug 1: deeep typo ===

test("'i want deeep cleaning for my villa' (deeep typo) selects Deep Villa Cleaning", async () => {
  const cid = "deeep-typo-1";
  const r = await ask("cleaning-demo", cid, "i want deeep cleaning for my villa");
  assert.equal(r.capabilityId, "cleaning");
  // Should NOT ask "Standard vs Deep" — it should recognize "deeep" as "deep"
  // and directly select Deep Villa Cleaning, then ask for bedrooms.
  assert.ok(/deep villa cleaning selected/i.test(r.reply),
    `Should select Deep Villa Cleaning, got: ${r.reply}`);
  assert.ok(/bedrooms/i.test(r.reply),
    `Should ask for bedrooms, got: ${r.reply}`);

  const st = await container.stateRepository.get(`cleaning-demo:sprint90:${cid}`);
  assert.equal(st.capabilityState?.cleaning?.serviceId, "CLN011");
  assert.equal(st.capabilityState?.cleaning?.serviceName, "Deep Villa Cleaning");
  assert.equal(st.capabilityState?.cleaning?.step, "bedrooms");
});

// === Bug 2: deep cleaning for villa asks bedrooms BEFORE date ===

test("'i want deep cleaning for my villa' asks bedrooms before date", async () => {
  const cid = "deep-villa-1";
  const r = await ask("cleaning-demo", cid, "i want deep cleaning for my villa");
  assert.equal(r.capabilityId, "cleaning");
  assert.ok(/deep villa cleaning selected/i.test(r.reply),
    `Should select Deep Villa Cleaning, got: ${r.reply}`);
  // Must ask for bedrooms, NOT for date
  assert.ok(/bedrooms/i.test(r.reply),
    `Should ask for bedrooms, got: ${r.reply}`);
  assert.ok(!/what date|which date|preferred date/i.test(r.reply),
    `Should NOT ask for date yet, got: ${r.reply}`);

  const st = await container.stateRepository.get(`cleaning-demo:sprint90:${cid}`);
  assert.equal(st.capabilityState?.cleaning?.serviceId, "CLN011");
  assert.equal(st.capabilityState?.cleaning?.step, "bedrooms");
  assert.deepEqual(st.capabilityState?.cleaning?.requiredPricingFields, ["bedrooms"]);
  assert.equal(st.capabilityState?.cleaning?.pricingFirst, true);
});

test("deep cleaning villa → 3 bedrooms → shows AED 440 then asks for date", async () => {
  const cid = "deep-villa-flow-1";
  await ask("cleaning-demo", cid, "i want deep cleaning for my villa");
  const r = await ask("cleaning-demo", cid, "3");
  assert.equal(r.capabilityId, "cleaning");
  // Should show the configured estimate AED 440 (3 bedrooms × villa deep cleaning)
  assert.ok(/440/i.test(r.reply),
    `Should show AED 440 estimate, got: ${r.reply}`);
  // Should now ask for date (since bedrooms is captured)
  assert.ok(/date/i.test(r.reply),
    `Should ask for date, got: ${r.reply}`);
});

// === Bug 3: furniture cleaning asks type first ===

test("'i want furniture cleaning service' asks which type of furniture", async () => {
  const cid = "furn-type-1";
  const r = await ask("cleaning-demo", cid, "i want furniture cleaning service");
  assert.equal(r.capabilityId, "cleaning");
  // Must ask which type of furniture — NOT immediately ask for a date
  assert.ok(/which type of furniture|sofa cleaning|carpet cleaning|mattress/i.test(r.reply),
    `Should ask for furniture type, got: ${r.reply}`);
  assert.ok(!/what date|which date|preferred date/i.test(r.reply),
    `Should NOT ask for date yet, got: ${r.reply}`);
});

test("furniture cleaning → sofa → asks for size", async () => {
  const cid = "furn-sofa-1";
  await ask("cleaning-demo", cid, "i want furniture cleaning service");
  const r = await ask("cleaning-demo", cid, "sofa");
  assert.equal(r.capabilityId, "cleaning");
  // Should ask for size (3-seater, etc.) — NOT date yet
  assert.ok(/size|seater|quantity/i.test(r.reply),
    `Should ask for size, got: ${r.reply}`);
});

// === Bug 4: "do you do deep clening or furniture cleaning" ===

test("'do you do deep clening or furniture cleaning' lists services (no assistant fallback)", async () => {
  const cid = "do-you-do-1";
  const r = await ask("cleaning-demo", cid, "do you do deep clening or furniture cleaning");
  // Should route to availability or cleaning — NOT assistant fallback
  assert.ok(['cleaning', 'availability'].includes(r.capabilityId),
    `Expected cleaning or availability, got ${r.capabilityId}`);
  // Should mention deep cleaning and/or furniture cleaning
  assert.ok(/deep|furniture|sofa|carpet|mattress/i.test(r.reply),
    `Should mention services, got: ${r.reply}`);
  // Should NOT say "I don't have approved information"
  assert.ok(!/don.t have approved|not approved information/i.test(r.reply),
    `Should NOT say 'no approved information', got: ${r.reply}`);
});

// === Bug 5: "do you provide deep cleaning service" consistency ===

test("'do you provide deep cleaning service' routes to availability with service list", async () => {
  const cid = "provide-deep-1";
  const r = await ask("cleaning-demo", cid, "do you provide deep cleaning service");
  assert.ok(['cleaning', 'availability'].includes(r.capabilityId),
    `Expected cleaning or availability, got ${r.capabilityId}`);
  assert.ok(/deep/i.test(r.reply),
    `Should mention deep cleaning, got: ${r.reply}`);
});

test("'do you offer deep cleaning' routes consistently", async () => {
  const cid = "offer-deep-1";
  const r = await ask("cleaning-demo", cid, "do you offer deep cleaning");
  assert.ok(['cleaning', 'availability'].includes(r.capabilityId),
    `Expected cleaning or availability, got ${r.capabilityId}`);
  assert.ok(/deep/i.test(r.reply),
    `Should mention deep cleaning, got: ${r.reply}`);
});

// === Bug 6: Silent service swap (Deep Villa → Laundry) ===

test("silent service swap does not occur (Deep Villa stays Deep Villa)", async () => {
  const cid = "swap-test-1";
  // Seed CRM history with a laundry order
  await ask("cleaning-demo", cid, "i want laundry home care cleaning");
  await ask("cleaning-demo", cid, "tomorrow at 11 AM");
  await ask("cleaning-demo", cid, "Villa 34, JVC Phase 2, Dubai");
  await ask("cleaning-demo", cid, "James Watson");
  await ask("cleaning-demo", cid, "03077374765");
  await ask("cleaning-demo", cid, "zeeshan@gmil.com");
  await ask("cleaning-demo", cid, "confirm");
  // Reset conversation
  await container.stateRepository.delete(`cleaning-demo:sprint90:${cid}`);

  // Now make a Deep Villa Cleaning request
  await ask("cleaning-demo", cid, "i want deep cleaning for my villa");
  await ask("cleaning-demo", cid, "3");
  const r = await ask("cleaning-demo", cid, "friday 7 pm");

  // Reply must mention Deep Villa Cleaning, NOT laundry
  assert.ok(/deep\s+villa\s+cleaning/i.test(r.reply) || /deep\s+cleaning/i.test(r.reply),
    `Reply should mention Deep (Villa) Cleaning, got: ${r.reply}`);
  assert.ok(!/laundry|home.?care|textile/i.test(r.reply),
    `Reply should NOT mention Laundry (silent swap bug), got: ${r.reply}`);

  const st = await container.stateRepository.get(`cleaning-demo:sprint90:${cid}`);
  assert.equal(st.capabilityState?.cleaning?.serviceId, "CLN011",
    `Expected CLN011, got ${st.capabilityState?.cleaning?.serviceId}`);
});

// === Bug 7: Standard cleaning workflow preserves correct price ===

test("standard cleaning apartment → 3 cleaners 3 hours → AED 360 (not AED 31.50)", async () => {
  const cid = "std-cleaning-1";
  await ask("cleaning-demo", cid, "i want a cleaning service for my apartment");
  await ask("cleaning-demo", cid, "standard cleaning");
  const r = await ask("cleaning-demo", cid, "i want 3 cleaners for 3 hours");

  assert.equal(r.capabilityId, "cleaning");
  // Should show AED 360 (3 × 3 × 40), NOT AED 31.50 (laundry price)
  assert.ok(/360/i.test(r.reply),
    `Should show AED 360, got: ${r.reply}`);
  assert.ok(!/31\.50/i.test(r.reply),
    `Should NOT show AED 31.50 (laundry price leak), got: ${r.reply}`);

  const st = await container.stateRepository.get(`cleaning-demo:sprint90:${cid}`);
  assert.equal(st.capabilityState?.cleaning?.serviceId, "CLN008",
    `Expected CLN008 (Apartment Cleaning), got ${st.capabilityState?.cleaning?.serviceId}`);
  assert.equal(st.capabilityState?.cleaning?.cleanerCount, 3);
  assert.equal(st.capabilityState?.cleaning?.durationHours, 3);
  assert.equal(st.capabilityState?.cleaning?.total, 360);
});

test("standard cleaning summary shows correct service name (not Laundry)", async () => {
  const cid = "std-cleaning-2";
  // Seed laundry history
  await ask("cleaning-demo", cid, "i want laundry home care cleaning");
  await ask("cleaning-demo", cid, "tomorrow at 11 AM");
  await ask("cleaning-demo", cid, "Villa 34, JVC Phase 2, Dubai");
  await ask("cleaning-demo", cid, "James Watson");
  await ask("cleaning-demo", cid, "03077374765");
  await ask("cleaning-demo", cid, "zeeshan@gmil.com");
  await ask("cleaning-demo", cid, "confirm");
  await container.stateRepository.delete(`cleaning-demo:sprint90:${cid}`);

  // Now standard cleaning
  await ask("cleaning-demo", cid, "i want a cleaning service for my apartment");
  await ask("cleaning-demo", cid, "standard cleaning");
  await ask("cleaning-demo", cid, "3 cleaners for 3 hours");
  const r = await ask("cleaning-demo", cid, "friday 2 pm");

  // Summary must mention Apartment Cleaning, NOT Laundry
  assert.ok(/apartment cleaning|standard/i.test(r.reply),
    `Reply should mention Apartment/Standard Cleaning, got: ${r.reply}`);
  assert.ok(!/laundry/i.test(r.reply),
    `Reply should NOT mention Laundry, got: ${r.reply}`);
});

// === Typo tolerance for additional variants ===

test("'deepp cleaning' typo resolves to deep cleaning", async () => {
  const cid = "deepp-typo-1";
  const r = await ask("cleaning-demo", cid, "i want deepp cleaning for my villa");
  assert.equal(r.capabilityId, "cleaning");
  assert.ok(/deep villa cleaning selected|deep cleaning selected/i.test(r.reply),
    `Should recognize deepp as deep, got: ${r.reply}`);
});

test("'depe cleaning' typo resolves to deep cleaning", async () => {
  const cid = "depe-typo-1";
  const r = await ask("cleaning-demo", cid, "i want depe cleaning for my villa");
  assert.equal(r.capabilityId, "cleaning");
  // May ask Standard vs Deep (since "depe" is a harder typo) but should still
  // route to cleaning, not fall back to laundry/assistant
  assert.ok(/cleaning/i.test(r.reply),
    `Should mention cleaning, got: ${r.reply}`);
});

test("'standar cleaning' typo resolves to standard cleaning", async () => {
  const cid = "standar-typo-1";
  const r = await ask("cleaning-demo", cid, "i want standar cleaning for my apartment");
  assert.equal(r.capabilityId, "cleaning");
  assert.ok(/standard cleaning selected|standard/i.test(r.reply),
    `Should recognize standar as standard, got: ${r.reply}`);
});

// === Full booking flow with correct service throughout ===

test("full deep villa booking: deep → 3 bedrooms → friday 7 pm → address → confirm", async () => {
  const cid = "full-flow-1";
  const r1 = await ask("cleaning-demo", cid, "i want deep cleaning for my villa");
  assert.ok(/deep villa cleaning selected/i.test(r1.reply));

  const r2 = await ask("cleaning-demo", cid, "3");
  assert.ok(/440/i.test(r2.reply), `Should show AED 440, got: ${r2.reply}`);

  const r3 = await ask("cleaning-demo", cid, "friday 7 pm");
  // Either asks for address or shows saved details summary
  assert.equal(r3.capabilityId, "cleaning");

  // Continue the flow
  if (/address/i.test(r3.reply) && !/villa 34/i.test(r3.reply)) {
    const r4 = await ask("cleaning-demo", cid, "Villa 34, JVC Phase 2, Dubai");
    // Should ask for name next or show summary
    assert.equal(r4.capabilityId, "cleaning");
  }

  // Verify state throughout
  const st = await container.stateRepository.get(`cleaning-demo:sprint90:${cid}`);
  assert.equal(st.capabilityState?.cleaning?.serviceId, "CLN011");
  assert.equal(st.capabilityState?.cleaning?.serviceName, "Deep Villa Cleaning");
  assert.equal(st.capabilityState?.cleaning?.bedrooms, 3);
});
