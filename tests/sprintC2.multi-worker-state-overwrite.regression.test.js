// C2 regression: two MemoryStateRepository instances pointed at the same
// snapshot file (= two cluster workers in production with memory mode).
//
// The bug report's proof: A.save(c1); B.get(c1) → null; after B.save(c2) the
// file contains only c2 — c1 was erased. This is why, in production under
// `npm start` (cluster), a user's next message can land on a worker that has
// never seen them and whose later write wipes the other worker's conversations.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { MemoryStateRepository } = require('../packages/state/src/memoryStateRepository');

function freshSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-c2-'));
  return path.join(dir, 'state.json');
}

test('C2 repro: two instances on the same snapshot do NOT see each other and overwrite on persist', async () => {
  const snapshot = freshSnapshot();
  const A = new MemoryStateRepository({ snapshotFile: snapshot });
  const B = new MemoryStateRepository({ snapshotFile: snapshot });

  // A writes conversation c1.
  await A.save({ conversationId: 'c1', version: 1, context: { who: 'alice' } });

  // B was constructed before A wrote, so B does NOT have c1 (per-process Map).
  const bGet = await B.get('c1');
  assert.equal(bGet, null, 'worker B never saw worker A\'s conversation (per-process memory)');

  // B writes c2. Both share the same snapshot file; B.persist() writes the
  // WHOLE file from B's in-memory Map, which contains only c2.
  await B.save({ conversationId: 'c2', version: 1, context: { who: 'bob' } });

  // A third worker (or A after a restart) loads the snapshot from disk and
  // finds ONLY c2 — c1 was erased by B's last-writer-wins persist.
  const C = new MemoryStateRepository({ snapshotFile: snapshot });
  const c1After = await C.get('c1');
  const c2After = await C.get('c2');
  assert.equal(c1After, null, 'c1 was erased from disk by B\'s persist (last writer wins)');
  assert.ok(c2After, 'only c2 survived on disk');

  // Cleanup
  fs.rmSync(path.dirname(snapshot), { recursive: true, force: true });
});
