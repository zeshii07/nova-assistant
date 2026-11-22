// Reproduce H2a (Phase 1 item 1): the generic fallback claims
// "I've kept your current request safely paused" even when NOTHING is pending,
// and offers no concrete options. Run: node /home/z/my-project/nova-assistant/scripts/repro_p1_1.js
'use strict';
const path = require('path');
const { buildContainer } = require(path.join('/home/z/my-project/nova-assistant', 'apps/api/src/container'));

function claimPaused(reply) {
  return /paused|safely paused|kept your current/i.test(String(reply || ''));
}

(async () => {
  const container = buildContainer();
  const executionEngine = container.executionEngine;
  const tenantId = 'restaurant-demo';

  // Fresh customer → NO pending workflow. The fallback must NOT claim a request is paused.
  const cases = [
    { text: 'lol', label: 'lol' },
    { text: 'ok', label: 'ok' },
    { text: 'good morning', label: 'good morning' },
    { text: '👍', label: 'emoji' },
    { text: '...', label: '...' },
    { text: 'help', label: 'help' },
  ];
  console.log('=== NO pending workflow (must NOT claim paused) ===');
  let falseClaims = 0;
  for (const c of cases) {
    const customerId = 'repro-nopending-' + c.label.replace(/[^a-z0-9]/gi, '') + '-' + Date.now();
    const res = await executionEngine.process({ tenantId, customerId, channel: 'http', text: c.text });
    const reply = res?.result?.reply || res?.reply || '(no reply)';
    const paused = claimPaused(reply);
    if (paused) falseClaims++;
    console.log(`  [${c.label.padEnd(12)}] claimsPaused=${paused} | ${JSON.stringify(reply).slice(0, 140)}`);
  }
  console.log(`\nFalse paused-claims with no pending request: ${falseClaims}/${cases.length}`);

  // Now WITH a pending workflow (salon booking date prompt) → 'lol' should re-prompt honestly, not false-claim.
  console.log('\n=== WITH pending booking workflow ===');
  const cid2 = 'repro-pending-' + Date.now();
  await executionEngine.process({ tenantId: 'salon-demo', customerId: cid2, channel: 'http', text: 'book a haircut' });
  const res2 = await executionEngine.process({ tenantId: 'salon-demo', customerId: cid2, channel: 'http', text: 'lol' });
  const reply2 = res2?.result?.reply || res2?.reply || '(no reply)';
  console.log(`  [pending+lol] ${JSON.stringify(reply2).slice(0, 160)}`);
})().catch((e) => { console.error('REPRO ERROR:', e.stack || e.message); process.exit(1); });
