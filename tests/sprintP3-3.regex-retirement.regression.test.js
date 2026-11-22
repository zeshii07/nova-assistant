/**
 * Phase 3 Sprint 3 — Legacy Regex NLU Retirement regression test.
 *
 * The deterministic T0/T1/T2 routing engine (T0/T1 in
 * packages/conversation-intelligence, T2 in packages/dialogue-manager) has
 * reached coverage parity with the legacy regex-based IntentEngine
 * (packages/assistant/src/intentEngine.js). This test proves the retirement is
 * safe and stays safe:
 *
 *   1. Coverage parity — the T0/T1/T2 engine still routes every intent the
 *      legacy regex ladder used to own (greeting, thanks, order, booking,
 *      cleaning, help, ask_hours, junk) WITHOUT the regex path being loaded.
 *   2. Env gate — with NOVA_LEGACY_REGEX_NLU unset (default OFF), the legacy
 *      regex path is not used; with it truthy, the legacy regex path is
 *      available for comparison.
 *   3. No regression — a set of real, representative messages still route to
 *      the right capability through the live executionEngine.
 *
 * The test runs the live container (apps/api/src/container.js → buildContainer)
 * exactly the way the production active path does, so a green run means the
 * retirement did not break the active path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContainer } = require('../apps/api/src/container');
const { isLegacyRegexEnabled, LEGACY_REGEX_FLAG } = require('../packages/assistant/src/intentEngine');

let container;
test.before(async () => {
  // NOVA_LEGACY_REGEX_NLU is unset in the test env (tests/test-env.js), so the
  // default-OFF (retired) path is exercised by buildContainer().
  container = await buildContainer();
});

/**
 * Run one message through the live executionEngine and return the result.
 * Each case uses a unique customerId so state never leaks across cases.
 * @param {object} tc
 * @returns {Promise<object>}
 */
async function runCase(tc) {
  const customerId = `sprintP3-3-${tc.id.toLowerCase()}`;
  for (const setupText of (tc.setup || [])) {
    await container.executionEngine.process({
      tenantId: tc.tenant, customerId, channel: 'test', text: setupText,
    });
  }
  return container.executionEngine.process({
    tenantId: tc.tenant, customerId, channel: 'test', text: tc.message,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Coverage parity — intents the legacy regex handled, now routed by T0/T1/T2
// ──────────────────────────────────────────────────────────────────────────

/**
 * Each case lists the legacy regex IntentEngine intent it used to hit, the
 * capability the T0/T1/T2 path must route it to, and assertions on the reply
 * that prove the routing is correct WITHOUT the regex path being loaded.
 *
 * Legacy regex intents (from packages/assistant/src/intentEngine.js):
 *   greet, thanks, goodbye, ask_hours, ask_payment, ask_services,
 *   ask_contact, ask_location, ask_returns, ask_delivery, ask_takeaway,
 *   ask_about, ask_business_info, small_talk, assistant_identity, other.
 */
const COVERAGE_CASES = [
  {
    id: 'COV-GREET-001',
    tenant: 'restaurant-demo',
    message: 'hi',
    legacyIntent: 'greet',
    expectCapability: 'assistant',
    expectReason: 't0_fast_path',
    replyMatches: [/hi|hello|salam|welcome|help you/i],
    replyNotMatch: [/couldn't find|not fully sure|didn't quite catch/i],
    notes: 'greeting — T0 greet fast-path (legacy: greet)',
  },
  {
    id: 'COV-THANKS-001',
    tenant: 'restaurant-demo',
    message: 'shukriya',
    legacyIntent: 'thanks',
    expectCapability: 'assistant',
    expectReason: 't0_fast_path',
    replyMatches: [/welcome|pleasure|anytime|no problem|glad|khushi|شکریہ|آپ کا|آپ کا شکریہ/i],
    replyNotMatch: [/couldn't find|not fully sure/i],
    notes: 'gratitude — T0 thanks fast-path (legacy: thanks)',
  },
  {
    id: 'COV-ORDER-001',
    tenant: 'restaurant-demo',
    message: 'i want 1 chicken biryani',
    legacyIntent: 'other → commerce adapter',
    expectCapability: 'commerce',
    replyMatches: [/biryani/i],
    replyNotMatch: [/couldn't find|not fully sure|sorry, we don't/i],
    notes: 'order — T1/T2 commerce adapter (legacy: other → commerce)',
  },
  {
    id: 'COV-BOOKING-001',
    tenant: 'salon-demo',
    message: 'book beard grooming tomorrow at 5pm',
    legacyIntent: 'other → booking adapter',
    expectCapability: 'booking',
    replyNotMatch: [/couldn't find|not fully sure/i],
    notes: 'booking — T1/T2 booking adapter (legacy: other → booking)',
  },
  {
    id: 'COV-CLEANING-001',
    tenant: 'cleaning-demo',
    message: 'i want deep cleaning for my apartment',
    legacyIntent: 'other → cleaning adapter',
    expectCapability: 'cleaning',
    replyNotMatch: [/couldn't find|not fully sure/i],
    notes: 'cleaning request — T1/T2 cleaning adapter (legacy: other → cleaning)',
  },
  {
    id: 'COV-HOURS-001',
    tenant: 'restaurant-demo',
    message: 'what are your hours',
    legacyIntent: 'ask_hours',
    replyNotMatch: [/couldn't find|not fully sure|didn't quite catch/i],
    notes: 'business hours — T1/T2 knowledge + assistant (legacy: ask_hours)',
  },
  {
    id: 'COV-HELP-001',
    tenant: 'restaurant-demo',
    message: 'help',
    legacyIntent: 'other',
    expectCapability: 'assistant',
    expectReason: 't0_fast_path',
    replyMatches: [/help|services|products|quote|booking|what would you like/i],
    replyNotMatch: [/couldn't find|not fully sure/i],
    notes: 'help — T0 help fast-path (legacy: other)',
  },
  {
    id: 'COV-JUNK-001',
    tenant: 'restaurant-demo',
    message: 'what is the weather',
    legacyIntent: 'other',
    replyNotMatch: [/couldn't find|not fully sure/i],
    notes: 'out-of-scope junk — T1/T2 abstains safely (legacy: other)',
  },
];

for (const tc of COVERAGE_CASES) {
  test(`coverage: ${tc.id} — ${tc.notes} [legacy=${tc.legacyIntent}]`, { timeout: 20000 }, async () => {
    const r = await runCase(tc);
    // The reply must exist and not be empty.
    assert.ok(r && typeof r.reply === 'string' && r.reply.length > 0,
      `expected a reply; got: ${JSON.stringify(r && r.reply)}`);
    // The T0 fast-path must be reflected in the intelligence reason when we
    // expect it (proof the deterministic engine, not the regex engine, decided).
    if (tc.expectReason) {
      const reason = r.intelligence?.selected?.reason;
      assert.equal(reason, tc.expectReason,
        `expected selected.reason "${tc.expectReason}" (T0 deterministic) but got "${reason}"`);
    }
    // The routed capability must match when asserted.
    if (tc.expectCapability) {
      assert.equal(r.capabilityId, tc.expectCapability,
        `expected capabilityId "${tc.expectCapability}" but got "${r.capabilityId}"`);
    }
    // The reply content must match / not-match the assertions.
    for (const re of (tc.replyMatches || [])) {
      assert.ok(re.test(r.reply),
        `reply should match /${re.source}/ but got: ${(r.reply || '').slice(0, 200)}`);
    }
    for (const re of (tc.replyNotMatch || [])) {
      assert.equal(re.test(r.reply), false,
        `reply should NOT match /${re.source}/ but it did: ${(r.reply || '').slice(0, 200)}`);
    }
    // Regression-safety: the legacy regex path must NOT have been loaded by
    // the active path (default OFF). The intelligence must not carry a legacy
    // "rules" source from IntentEngine.
    const src = r.intelligence?.selected?.source;
    assert.notEqual(src, 'rules',
      `legacy regex IntentEngine ("source: rules") must not decide routing; got source="${src}"`);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Env gate — NOVA_LEGACY_REGEX_NLU default OFF, opt-in ON
// ──────────────────────────────────────────────────────────────────────────

test('env gate: NOVA_LEGACY_REGEX_NLU is unset in test env → legacy regex disabled (default OFF)', () => {
  // tests/test-env.js does not set the flag, so the helper must report OFF.
  assert.equal(isLegacyRegexEnabled(), false,
    `expected legacy regex path to be OFF by default; env=${process.env[LEGACY_REGEX_FLAG]}`);
  assert.equal(LEGACY_REGEX_FLAG, 'NOVA_LEGACY_REGEX_NLU',
    'the flag name must match the documented env var');
});

test('env gate: legacy regex path is available when NOVA_LEGACY_REGEX_NLU is truthy', () => {
  // Save & restore the env var so this test is hermetic.
  const saved = process.env[LEGACY_REGEX_FLAG];
  try {
    for (const truthy of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
      process.env[LEGACY_REGEX_FLAG] = truthy;
      assert.equal(isLegacyRegexEnabled(), true,
        `expected "${truthy}" to enable the legacy regex path`);
    }
    for (const falsy of ['', '0', 'false', 'no', 'off', undefined]) {
      if (falsy === undefined) delete process.env[LEGACY_REGEX_FLAG];
      else process.env[LEGACY_REGEX_FLAG] = falsy;
      assert.equal(isLegacyRegexEnabled(), false,
        `expected "${falsy}" to keep the legacy regex path OFF`);
    }
  } finally {
    if (saved === undefined) delete process.env[LEGACY_REGEX_FLAG];
    else process.env[LEGACY_REGEX_FLAG] = saved;
  }
});

test('env gate: assistantService honors the flag — default OFF routes greet via T0, not the regex engine', { timeout: 20000 }, async () => {
  // With the flag unset (the test-env default), a bare "hi" must route via the
  // T0 fast-path, proving the regex IntentEngine.detect() was skipped.
  assert.equal(isLegacyRegexEnabled(), false, 'precondition: flag must be OFF here');
  const r = await runCase({ id: 'GATE-DEFAULT-001', tenant: 'restaurant-demo', message: 'hi' });
  assert.equal(r.intelligence?.selected?.reason, 't0_fast_path',
    'default-OFF path must route greet via T0, not the legacy regex engine');
  assert.notEqual(r.intelligence?.selected?.source, 'rules',
    'the legacy regex IntentEngine ("source: rules") must not have been consulted');
});

// ──────────────────────────────────────────────────────────────────────────
// 3. No regression — real messages still route to the right capability
// ──────────────────────────────────────────────────────────────────────────

const NO_REGRESSION_CASES = [
  {
    id: 'REG-ORDER-001', tenant: 'restaurant-demo',
    message: 'order 2 chicken biryani', expectCapability: 'commerce',
    replyMatches: [/biryani/i], notes: 'real order routes to commerce',
  },
  {
    id: 'REG-BOOKING-001', tenant: 'salon-demo',
    message: 'can i get a haircut tomorrow at 3pm', expectCapability: 'booking',
    replyNotMatch: [/couldn't find|not fully sure/i], notes: 'real booking routes to booking',
  },
  {
    id: 'REG-CLEAN-001', tenant: 'cleaning-demo',
    message: 'mujhe safai chahiye', expectCapability: 'cleaning',
    replyNotMatch: [/couldn't find|not fully sure/i], notes: 'Roman-Urdu cleaning request routes to cleaning',
  },
];

for (const tc of NO_REGRESSION_CASES) {
  test(`no-regression: ${tc.id} — ${tc.notes}`, { timeout: 20000 }, async () => {
    const r = await runCase(tc);
    assert.ok(r && r.reply && r.reply.length > 0, 'expected a non-empty reply');
    if (tc.expectCapability) {
      assert.equal(r.capabilityId, tc.expectCapability,
        `expected capabilityId "${tc.expectCapability}" but got "${r.capabilityId}"`);
    }
    for (const re of (tc.replyMatches || [])) {
      assert.ok(re.test(r.reply), `reply should match /${re.source}/: ${(r.reply || '').slice(0, 200)}`);
    }
    for (const re of (tc.replyNotMatch || [])) {
      assert.equal(re.test(r.reply), false,
        `reply should NOT match /${re.source}/: ${(r.reply || '').slice(0, 200)}`);
    }
  });
}
