// C1 regression: a stale-version save must NOT leak the per-conversation lock
// and freeze the next operation on that conversation.
//
// Before the fix, withLock() ran `finally { this._locks.delete(id) }` during
// the synchronous throw of fn(), then ran `this._locks.set(id, promise)`
// AFTER the delete. The stored promise was already resolved, so the next
// caller's `while (this._locks.has(id)) await this._locks.get(id)` spun on
// microtasks forever — starving the event loop so even setTimeout never fired.
//
// This test is the minimal repro from the bug report: two saves that bump the
// version, a third save with a stale (lower) version throws STALE_STATE, and
// the fourth save MUST return within 2 s (timer fires, process exits 0).
const test = require('node:test');
const assert = require('node:assert');
const { MemoryStateRepository } = require('../packages/state/src/memoryStateRepository');

test('C1: stale-state save does not leak the lock or hang the next save', async () => {
  const r = new MemoryStateRepository({});

  // Seed: v5 stored, then bumped to v99.
  await r.save({ conversationId: 'c1', version: 5 });
  await r.save({ conversationId: 'c1', version: 99 });

  // A save with a stale (lower) version must reject with STALE_STATE.
  await assert.rejects(
    () => r.save({ conversationId: 'c1', version: 1 }),
    (err) => err.code === 'STALE_STATE',
  );

  // The lock must NOT be leaked. If it is, the next save spins forever.
  assert.equal(r._locks.has('c1'), false, 'lock was leaked after a STALE_STATE throw');

  // The next save on the same conversation must complete.
  let timerFired = false;
  const timer = new Promise((resolve) => setTimeout(() => { timerFired = true; resolve(); }, 50));
  const next = await Promise.race([
    r.save({ conversationId: 'c1', version: 200 }).then((s) => ({ ok: true, s })),
    timer.then(() => ({ ok: false })),
    // Hard guard: reject the whole test if nothing resolves in 2 s.
    new Promise((_, reject) => setTimeout(() => reject(new Error('next save hung — lock leaked')), 2000)),
  ]);
  assert.equal(next.ok, true, 'next save completed before the guard timer');
  // version is a server-side monotonic counter (bumped from the stored value),
  // not the client-supplied number, so it must simply be greater than the
  // version that was stored before this save.
  assert.ok(next.s.version > 2, 'returned state carries the bumped version');
  assert.equal(timerFired, false, 'save did not need to wait for the guard timer');
});

test('C1: concurrent saves on the same conversation serialize without losing the lock', async () => {
  const r = new MemoryStateRepository({});
  // Three saves fired concurrently; all must resolve and the lock must be
  // released afterwards (no leak, no hang).
  const results = await Promise.all([
    r.save({ conversationId: 'c2', version: 1 }),
    r.save({ conversationId: 'c2', version: 2 }),
    r.save({ conversationId: 'c2', version: 3 }),
  ]);
  assert.equal(results.length, 3);
  assert.equal(r._locks.has('c2'), false, 'lock released after concurrent saves');
  // Final stored version is monotonically bumped from the last writer.
  const stored = await r.get('c2');
  assert.ok(stored.version >= 3);
});

test('C1: withLock propagates synchronous throws without leaking the lock', async () => {
  const r = new MemoryStateRepository({});
  await assert.rejects(
    () => r.withLock('c3', () => { throw new Error('boom'); }),
    (err) => err.message === 'boom',
  );
  assert.equal(r._locks.has('c3'), false, 'lock released after a synchronous throw inside withLock');
  // Subsequent operation on the same id must still work.
  const s = await r.save({ conversationId: 'c3', version: 1 });
  assert.ok(s.version >= 1);
});
