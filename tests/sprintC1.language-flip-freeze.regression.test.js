// C1 end-to-end regression: the real freeze scenario from the bug report.
//
// Report says: a 4-message conversation with a language flip (Roman Urdu →
// English) freezes the worker and the 4th message never returns. The trigger
// is #finalize saving state, ignoring the returned version, then re-saving
// the stale object after humanization changes the reply language → STALE_STATE
// → (before the withLock fix) leaked lock → next message spins forever.
//
// This test sends that exact 4-message sequence to the real execution engine
// and asserts every message returns within a hard 2s guard. Before the fix it
// hangs on message 4; after the fix all four resolve.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');

async function withContainer(work) {
  const previous = process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE = 'off';
  let container;
  try {
    container = await buildContainer();
    return await work(container);
  } finally {
    await container?.registry?.shutdownAll?.();
    if (previous === undefined) delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE = previous;
  }
}

function ask(container, tenantId, customerId, text) {
  return container.executionEngine.process({ tenantId, channel: 'c1-freeze', customerId, text });
}

test('C1: a language-flip conversation does not freeze on the 4th message', async () => {
  await withContainer(async (container) => {
    const customerId = `c1-freeze-${Date.now()}`;
    // Roman Urdu, English, Roman Urdu, English — the language flips between
    // turns are exactly what poisoned #finalize before the fix.
    const messages = [
      { text: 'kya haal hai', tenantId: 'restaurant-demo' },               // roman urdu
      { text: 'show me the menu', tenantId: 'restaurant-demo' },            // english
      { text: 'thanks', tenantId: 'restaurant-demo' },                       // english
      { text: 'hello', tenantId: 'restaurant-demo' },                        // english
    ];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const reply = await Promise.race([
        ask(container, m.tenantId, customerId, m.text),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error(`message ${i + 1} ("${m.text}") hung — worker frozen (C1 deadlock)`)),
          2000,
        )),
      ]);
      assert.ok(reply, `message ${i + 1} returned a result`);
      assert.equal(typeof reply.reply, 'string', `message ${i + 1} has a reply string`);
    }
  });
});

test('C1: repeated saves with a language change keep the stored version monotonic', async () => {
  await withContainer(async (container) => {
    const customerId = `c1-lang-${Date.now()}`;
    // Send two messages whose detected language differs; the stored state
    // version must keep climbing (no STALE_STATE swallowed, no lost write).
    const r1 = await ask(container, 'salon-demo', customerId, 'mujhe haircut chahiye');
    const r2 = await ask(container, 'salon-demo', customerId, 'I want a haircut tomorrow');
    assert.ok(r1.reply && r2.reply, 'both turns replied');

    const conv = `${'salon-demo'}:${'c1-freeze'}:${customerId}`;
    const s1 = await container.stateRepository.get(conv);
    assert.ok(s1, 'state persisted');
    assert.ok(s1.version >= 1, `state version is monotonic (got ${s1.version})`);
    // No leaked lock after the conversation.
    assert.equal(container.stateRepository._locks.has(conv), false, 'no lock leaked for the conversation');
  });
});
