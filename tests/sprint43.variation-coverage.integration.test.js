/**
 * Sprint 3 — v43.0 Variation Coverage Test Runner
 *
 * Executes every case in tests/fixtures/variation-corpus.js and asserts the
 * expected behavior. Each case uses a unique customerId to avoid state pollution.
 *
 * Output: per-case pass/fail with detailed assertion messages + a final summary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');
const corpus = require('./fixtures/variation-corpus.js');

let container;
test.before(async () => { container = await buildContainer(); });

async function runCase(tc) {
  const customerId = `v43-corpus-${tc.id.toLowerCase()}`;
  // Run setup turns (warm up state, but don't assert on them)
  for (const setupText of (tc.setup || [])) {
    await container.executionEngine.process({
      tenantId: tc.tenant, customerId, channel: 'test', text: setupText,
    });
  }
  // Run the test message
  const r = await container.executionEngine.process({
    tenantId: tc.tenant, customerId, channel: 'test', text: tc.message,
  });
  return r;
}

function checkExpectations(tc, r) {
  const errors = [];
  const expect = tc.expect || {};
  if (expect.capabilityId && r.capabilityId !== expect.capabilityId) {
    errors.push(`capabilityId: expected "${expect.capabilityId}", got "${r.capabilityId}"`);
  }
  for (const re of (expect.replyMatches || [])) {
    if (!re.test(r.reply || '')) {
      errors.push(`reply should match /${re.source}/${re.flags} but got: ${(r.reply || '').slice(0, 200)}`);
    }
  }
  for (const re of (expect.replyNotMatch || [])) {
    if (re.test(r.reply || '')) {
      errors.push(`reply should NOT match /${re.source}/${re.flags} but it did. Reply: ${(r.reply || '').slice(0, 200)}`);
    }
  }
  return errors;
}

// Group cases by category for the test report
const byCategory = {};
for (const tc of corpus) {
  const cat = tc.id.replace(/-\d+$/, '').replace(/^[A-Z]+-/, '').toUpperCase();
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push(tc);
}

// Generate one test per case + one summary test per category.
// Node test runner runs tests sequentially by default in the same file —
// that's actually what we want here, since they share the container. Per-test
// timeout of 20s guards against pathological hangs.
for (const tc of corpus) {
  if (tc.skip) continue;
  test(`${tc.id}: ${tc.notes} [${tc.tenant}] "${tc.message.slice(0, 50)}"`, { timeout: 20000 }, async () => {
    const r = await runCase(tc);
    const errors = checkExpectations(tc, r);
    if (errors.length) {
      assert.fail(`\n  ${errors.join('\n  ')}\n  reply: ${(r.reply || '').slice(0, 300)}`);
    }
  });
}
