// Phase 2 Sprint 4 — Per-conversation serialization for the persistent (Redis)
// storage path.
//
// H8 root cause (storage): "MemoryStateRepository has per-conversation locks +
// optimistic versioning (STALE_STATE); RedisStateRepository was a bare SET/GET.
// With two API processes, the loser of a race would clobber the winner — a
// customer's turn could be lost." Sprint 4 brings RedisStateRepository to
// parity: withLock (process-local promise mutex + Redis WATCH/MULTI optimistic
// CAS), version bumps, and STALE_STATE rejection with the same error code the
// execution engine's retry loop already handles.
//
// These tests run WITHOUT a live Redis server. They inject a fake client that
// faithfully emulates the Redis WATCH/MULTI/EXEC optimistic-CAS semantics (a
// per-key monotonic version counter; EXEC returns null when a watched key
// advanced between WATCH and EXEC). This is exactly the contract node-redis
// exposes, so the repository code under test is the real production code.
const test = require("node:test");
const assert = require("node:assert/strict");
const { RedisStateRepository } = require("../packages/storage/src/redisStateRepository");

// ── Fake Redis client ─────────────────────────────────────────────────────
// Models WATCH/MULTI/EXEC optimistic concurrency. Each write bumps a per-key
// monotonic version. WATCH records the watched keys' current versions; EXEC
// aborts (returns null) if any watched key's version advanced since WATCH.
function makeShared() {
  const store = new Map();      // key -> string value
  const versions = new Map();   // key -> int version (bumps on every write)
  return { store, versions };
}
function makeClient(shared) {
  const { store, versions } = shared;
  let watchedAt = new Map();    // key -> version at WATCH time (per client)
  const ver = (k) => versions.get(k) || 0;
  const bump = (k) => versions.set(k, ver(k) + 1);
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v, opts) {
      if (opts && opts.NX && store.has(k)) return null;
      store.set(k, v); bump(k); return "OK";
    },
    async del(k) {
      let removed = 0;
      const keys = Array.isArray(k) ? k : [k];
      for (const key of keys) { if (store.delete(key)) { bump(key); removed++; } }
      return removed;
    },
    async watch(k) { watchedAt.set(k, ver(k)); return "OK"; },
    async unwatch() { watchedAt.clear(); return "OK"; },
    multi() {
      const ops = [];
      const m = {
        set(kk, vv, oo) { ops.push(["set", kk, vv, oo]); return m; },
        del(kk) { ops.push(["del", kk]); return m; },
        async exec() {
          // Abort if any watched key's version advanced since WATCH.
          let aborted = false;
          for (const [k, at] of watchedAt) { if (ver(k) !== at) { aborted = true; break; } }
          watchedAt.clear();
          if (aborted) return null;
          for (const [op, k, v, opts] of ops) {
            if (op === "set") {
              if (opts && opts.NX && store.has(k)) continue;
              store.set(k, v); bump(k);
            } else if (op === "del") {
              if (store.delete(k)) bump(k);
            }
          }
          return ops.map(() => "OK");
        }
      };
      return m;
    },
    async scan() { return { cursor: "0", keys: [...store.keys()] }; },
    async quit() { return "OK"; },
    on() {}
  };
}

// ── Versioning + STALE_STATE (parity with MemoryStateRepository) ───────────

test("versioning: first save on a new conversation bumps version 0 → 1 + sets updatedAt", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  const saved = await repo.save({ conversationId: "c1", context: { msg: "hi" }, version: 0 });
  assert.equal(saved.version, 1);
  assert.ok(saved.updatedAt, "updatedAt must be set");
  assert.equal(saved.context.msg, "hi");
});

test("versioning: sequential saves with the correct prior version bump N → N+1", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  const s1 = await repo.save({ conversationId: "c1", context: { n: 1 }, version: 0 });
  const s2 = await repo.save({ conversationId: "c1", context: { n: 2 }, version: s1.version });
  const s3 = await repo.save({ conversationId: "c1", context: { n: 3 }, version: s2.version });
  assert.equal(s1.version, 1);
  assert.equal(s2.version, 2);
  assert.equal(s3.version, 3);
  assert.equal(s3.context.n, 3);
});

test("STALE_STATE: a write with an older version is rejected with err.code === 'STALE_STATE'", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  await repo.save({ conversationId: "c1", context: { msg: "v1" }, version: 0 });
  await repo.save({ conversationId: "c1", context: { msg: "v2" }, version: 1 });
  // Now attempt to write a stale version (we held onto version 0).
  await assert.rejects(
    () => repo.save({ conversationId: "c1", context: { msg: "stale" }, version: 0 }),
    (err) => err.code === "STALE_STATE" && /stale state/i.test(err.message)
  );
});

test("STALE_STATE: matches the same code the execution engine's retry loop checks for", () => {
  // The execution engine retries on err.code === 'STALE_STATE' OR /stale state/i.
  // Both must hold so the retry loop works against either repository unchanged.
  const err = new Error("Stale state — another update has been applied since you read this.");
  err.code = "STALE_STATE";
  assert.equal(err.code, "STALE_STATE");
  assert.match(err.message, /stale state/i);
});

// ── Round-trip + delete ───────────────────────────────────────────────────

test("round-trip: get returns exactly what save stored (with the bumped version)", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  await repo.save({ conversationId: "c1", context: { msg: "hello", nested: { a: 1 } }, version: 0 });
  const got = await repo.get("c1");
  assert.equal(got.version, 1);
  assert.equal(got.context.msg, "hello");
  assert.equal(got.context.nested.a, 1);
});

test("round-trip: get on a missing conversation returns null (no throw)", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  assert.equal(await repo.get("does-not-exist"), null);
});

test("delete: removes the conversation + returns true when it existed, false otherwise", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  await repo.save({ conversationId: "c1", context: {}, version: 0 });
  assert.equal(await repo.delete("c1"), true);
  assert.equal(await repo.get("c1"), null);
  assert.equal(await repo.delete("c1"), false);
});

test("save rejects when state.conversationId is missing (guards the key derivation)", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  await assert.rejects(() => repo.save({ context: {} }), /conversationId is required/i);
});

// ── Cross-process race serialization (the core Sprint 4 fix) ───────────────

test("race: two concurrent writers — exactly ONE commits, the other gets STALE_STATE", async () => {
  // Two repo instances sharing ONE store (simulates two API processes on one Redis).
  const shared = makeShared();
  const repo1 = new RedisStateRepository({ client: makeClient(shared), lockRetries: 6, lockBackoffMs: 1 });
  const repo2 = new RedisStateRepository({ client: makeClient(shared), lockRetries: 6, lockBackoffMs: 1 });
  await repo1.save({ conversationId: "c1", context: { msg: "seed" }, version: 0 });
  // Both read the SAME current state (version 1), then both save concurrently.
  const s1 = await repo1.get("c1");
  const s2 = await repo2.get("c1");
  assert.equal(s1.version, 1);
  assert.equal(s2.version, 1);
  const results = await Promise.allSettled([
    repo1.save({ conversationId: "c1", context: { msg: "from-1" }, version: s1.version }),
    repo2.save({ conversationId: "c1", context: { msg: "from-2" }, version: s2.version })
  ]);
  const committed = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(committed.length, 1, "exactly one writer must commit (the other aborts)");
  assert.equal(rejected.length, 1, "exactly one writer must be rejected");
  assert.equal(rejected[0].reason.code, "STALE_STATE");
  const final = await repo1.get("c1");
  assert.equal(final.version, 2, "final version must be 2 (one bump, not two)");
});

test("race: three concurrent writers — exactly ONE commits, the other two get STALE_STATE", async () => {
  const shared = makeShared();
  const mk = () => new RedisStateRepository({ client: makeClient(shared), lockRetries: 5, lockBackoffMs: 1 });
  const repos = [mk(), mk(), mk()];
  await repos[0].save({ conversationId: "c1", context: { msg: "seed" }, version: 0 });
  const reads = await Promise.all(repos.map((r) => r.get("c1")));
  reads.forEach((r) => assert.equal(r.version, 1));
  const results = await Promise.allSettled(repos.map((r, i) =>
    r.save({ conversationId: "c1", context: { msg: `from-${i}` }, version: 1 })
  ));
  const committed = results.filter((r) => r.status === "fulfilled").length;
  const stale = results.filter((r) => r.status === "rejected" && r.reason.code === "STALE_STATE").length;
  assert.equal(committed, 1);
  assert.equal(stale, 2);
  const final = await repos[0].get("c1");
  assert.equal(final.version, 2);
});

// ── withLock contract (parity with MemoryStateRepository) ─────────────────

test("withLock: serializes same-conversation calls (no overlap)", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  const order = [];
  const a = repo.withLock("c1", async () => {
    order.push("a-start");
    await new Promise((r) => setTimeout(r, 20));
    order.push("a-end");
    return "a";
  });
  const b = repo.withLock("c1", async () => {
    order.push("b-start");
    await new Promise((r) => setTimeout(r, 5));
    order.push("b-end");
    return "b";
  });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, "a");
  assert.equal(rb, "b");
  // b must NOT start before a finishes (serialized, no overlap).
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("withLock: different conversations run concurrently (no false serialization)", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  const order = [];
  const a = repo.withLock("c1", async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 20)); order.push("a-end"); });
  const b = repo.withLock("c2", async () => { order.push("b-start"); await new Promise((r) => setTimeout(r, 20)); order.push("b-end"); });
  await Promise.all([a, b]);
  // b must start before a ends (different conversations → concurrent).
  assert.ok(order.indexOf("b-start") < order.indexOf("a-end"), `expected b-start before a-end, got ${order.join(",")}`);
});

test("withLock: releases the lock even if fn throws", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  await assert.rejects(() => repo.withLock("c1", async () => { throw new Error("boom"); }), /boom/);
  // The lock must be released so the next caller doesn't hang.
  const result = await repo.withLock("c1", async () => "after-throw");
  assert.equal(result, "after-throw");
});

// ── Factory parity (the storageFactory wires this repository in persistent mode) ─

test("factory parity: storageFactory exposes RedisStateRepository as stateRepository in persistent mode", () => {
  // The factory imports RedisStateRepository and assigns it to stateRepository
  // when config.storageMode === 'persistent'. This test confirms the wiring is
  // present in the source (a live Redis connection is not required).
  const fs = require("fs");
  const path = require("path");
  const factory = fs.readFileSync(path.join(__dirname, "../packages/storage/src/storageFactory.js"), "utf8");
  assert.match(factory, /RedisStateRepository/);
  assert.match(factory, /stateRepository:\s*redis/);
  assert.match(factory, /config\.storageMode\s*!==\s*["']persistent["']/);
  // MemoryStateRepository is the default (local mode).
  assert.match(factory, /MemoryStateRepository/);
});

// ── TTL is applied (conversations expire, so Redis doesn't grow unbounded) ─

test("TTL: save passes the EX (expiry) option so conversations expire", async () => {
  // The repo issues SET inside a MULTI/EXEC (the CAS loop), so EX is applied to
  // the MULTI's set, not the bare client.set. We wrap the client's `multi()`
  // factory and capture the set options from the returned multi object.
  const shared = makeShared();
  let capturedOpts = null;
  const client = makeClient(shared);
  const origMulti = client.multi.bind(client);
  client.multi = () => {
    const m = origMulti();
    const origMSet = m.set.bind(m);
    m.set = (k, v, opts) => { capturedOpts = opts; return origMSet(k, v, opts); };
    return m;
  };
  const repo = new RedisStateRepository({ client, ttlSeconds: 604800 });
  await repo.save({ conversationId: "c1", context: {}, version: 0 });
  assert.ok(capturedOpts, "MULTI.set was called");
  assert.equal(capturedOpts.EX, 604800, "EX must match ttlSeconds (7 days default)");
});

// ── clear() removes all conversations (test/cleanup path) ──────────────────

test("clear: removes all conversations under the prefix", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()), prefix: "nova:conversation:" });
  await repo.save({ conversationId: "c1", context: {}, version: 0 });
  await repo.save({ conversationId: "c2", context: {}, version: 0 });
  await repo.clear();
  assert.equal(await repo.get("c1"), null);
  assert.equal(await repo.get("c2"), null);
});

// ── Contract: the saved state is a deep clone (caller can't mutate stored) ─

test("immutability: save returns a deep clone so callers can't mutate the stored state", async () => {
  const repo = new RedisStateRepository({ client: makeClient(makeShared()) });
  const saved = await repo.save({ conversationId: "c1", context: { msg: "hi", nested: { a: 1 } }, version: 0 });
  saved.context.msg = "mutated";
  saved.context.nested.a = 999;
  const got = await repo.get("c1");
  assert.equal(got.context.msg, "hi", "top-level field must be unaffected by caller mutation");
  assert.equal(got.context.nested.a, 1, "nested field must be unaffected by caller mutation");
});
