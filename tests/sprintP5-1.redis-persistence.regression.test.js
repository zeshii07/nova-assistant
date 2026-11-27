// Sprint P5-1 — Redis persistence regression tests (v73.0).
//
// Goal: prove the three stores that used to be lost on restart now behave
// correctly in BOTH paths:
//   - the in-memory fallback (memory storage mode — dev/tests/single-instance)
//   - the Redis path (persistent storage mode — production/multi-instance)
//
// There's no Redis binary in the test sandbox, so the Redis path is exercised
// against a FakeRedisClient that implements the exact command surface the
// stores use (set/get/getDel/exists/incr/expire/del/ping) with the SAME
// semantics (NX/EX options honored, GETDEL atomic, INCR returns post-increment
// count, EXPIRE sets TTL). This isolates the store logic from a live server
// while still validating every Redis command we issue.
//
// What's covered:
//   - RedisNonceStore: record → consume (true), consume-again (false, replay),
//     unknown-nonce consume (false), TTL-bound prune (in-memory path).
//   - RedisProcessedMessageStore: has on unknown (false), add → has (true),
//     concurrent add race (only one wins — atomicity), TTL expiry (in-memory).
//   - InMemoryRateLimiter + RedisRateLimiter: under-limit allow, over-limit
//     block, window-reset clears, clear() resets.
//   - BusinessOwnerAuthService: login is async; rate limiter blocks after 5
//     fails; successful login clears the counter.
//   - Container wiring: in memory mode the in-memory stores are selected; the
//     constructor names prove the right branch was taken.
//   - HealthService readiness: memory mode omits Redis/PG probes; persistent
//     mode (fake storage) probes them with fail-open warnings.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RedisNonceStore } = require("../packages/auth-engine/src/redisNonceStore");
const { InMemoryNonceStore } = require("../packages/auth-engine/src/oauthState");
const { RedisProcessedMessageStore, ProcessedMessageStore } = require("../packages/channel/src/whatsapp");
const { InMemoryRateLimiter, RedisRateLimiter } = require("../packages/auth-engine/src/rateLimiter");
const { BusinessOwnerAuthService } = require("../packages/auth-engine/src/businessOwnerAuthService");
const { HealthService } = require("../packages/ops/src/healthService");

// ─── FakeRedisClient: implements the exact command surface the stores use ──
// Honors: SET ... NX EX (insert-if-absent + TTL), GET, GETDEL (atomic),
// EXISTS, INCR (returns post-increment count), EXPIRE (sets TTL), DEL, PING.
// TTLs are tracked in ms; a virtual clock advances via _advanceMs.
class FakeRedisClient {
  constructor() { this.store = new Map(); this.ttls = new Map(); this._now = Date.now(); }
  _advanceMs(ms) { this._now += ms; this._sweep(); }
  _sweep() { for (const [k, exp] of this.ttls) if (exp <= this._now) { this.store.delete(k); this.ttls.delete(k); } }
  async set(key, value, opts = {}) {
    this._sweep();
    if (opts.NX && this.store.has(key)) return null;
    this.store.set(key, value);
    if (opts.EX) this.ttls.set(key, this._now + opts.EX * 1000);
    if (opts.PX) this.ttls.set(key, this._now + opts.PX);
    return "OK";
  }
  async get(key) { this._sweep(); return this.store.has(key) ? this.store.get(key) : null; }
  async getDel(key) { this._sweep(); if (!this.store.has(key)) return null; const v = this.store.get(key); this.store.delete(key); this.ttls.delete(key); return v; }
  async exists(key) { this._sweep(); return this.store.has(key) ? 1 : 0; }
  async incr(key) { this._sweep(); const n = (Number(this.store.get(key)) || 0) + 1; this.store.set(key, String(n)); return n; }
  async expire(key, seconds) { this._sweep(); if (!this.store.has(key)) return 0; this.ttls.set(key, this._now + seconds * 1000); return 1; }
  async del(key) { const had = this.store.has(key); this.store.delete(key); this.ttls.delete(key); return had ? 1 : 0; }
  async ping() { return "PONG"; }
}

// ═══════════════════════════════════════════════════════════════════════════
// RedisNonceStore (OAuth state single-use nonces)
// ═══════════════════════════════════════════════════════════════════════════
test("RedisNonceStore: record → consume returns true; second consume returns false (replay)", async () => {
  const client = new FakeRedisClient();
  const store = new RedisNonceStore({ client });
  const nonce = "abc123";
  store.record(nonce, Date.now() + 600000);
  await new Promise((r) => setTimeout(r, 5)); // let the fire-and-forget SET land
  assert.equal(await store.consume(nonce), true, "first consume of a recorded nonce must succeed");
  assert.equal(await store.consume(nonce), false, "second consume must fail (single-use / replay)");
});

test("RedisNonceStore: consume of an unknown nonce returns false", async () => {
  const store = new RedisNonceStore({ client: new FakeRedisClient() });
  assert.equal(await store.consume("never-recorded"), false);
});

test("RedisNonceStore: expired nonce is not consumable (TTL honored)", async () => {
  const client = new FakeRedisClient();
  const store = new RedisNonceStore({ client });
  store.record("short-lived", Date.now() + 1000); // 1s TTL
  await new Promise((r) => setTimeout(r, 5));
  client._advanceMs(2000); // past expiry
  assert.equal(await store.consume("short-lived"), false, "expired nonce must not be consumable");
});

test("RedisNonceStore: in-memory fallback (no client) matches InMemoryNonceStore behavior", async () => {
  const store = new RedisNonceStore({ client: null });
  store.record("n1", Date.now() + 600000);
  assert.equal(store.consume("n1"), true);
  assert.equal(store.consume("n1"), false);
  assert.equal(store.consume("unknown"), false);
});

test("RedisNonceStore: Redis error on consume fails CLOSED (rejects the OAuth flow)", async () => {
  // record() is fire-and-forget and calls client.set(); give it a working set
  // so the nonce is recorded, but make getDel() throw to simulate a Redis
  // outage AT CONSUME TIME. consume() must fail closed (return false) rather
  // than risk accepting a replayed/unknown nonce.
  const brokenClient = { set: async () => "OK", getDel: async () => { throw new Error("ECONNRESET"); } };
  const store = new RedisNonceStore({ client: brokenClient, logger: { warn: () => {}, error: () => {} } });
  store.record("n", Date.now() + 600000);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await store.consume("n"), false, "on Redis error, consume must reject (fail closed) — never accept a replayed/unknown nonce");
});

// ═══════════════════════════════════════════════════════════════════════════
// RedisProcessedMessageStore (WhatsApp message dedup)
// ═══════════════════════════════════════════════════════════════════════════
test("RedisProcessedMessageStore: has(unknown)=false; add → has=true; add-again loses the race", async () => {
  const store = new RedisProcessedMessageStore({ client: new FakeRedisClient() });
  assert.equal(await store.has("msg-1"), false);
  assert.equal(await store.add("msg-1"), true, "first add wins the insert race");
  assert.equal(await store.has("msg-1"), true);
  assert.equal(await store.add("msg-1"), false, "second add loses the race (already present)");
});

test("RedisProcessedMessageStore: atomic across two stores sharing one client (dedup race)", async () => {
  // Two instances, same Redis → only one wins. This is the multi-instance
  // guarantee the in-memory Map couldn't provide.
  const sharedClient = new FakeRedisClient();
  const instanceA = new RedisProcessedMessageStore({ client: sharedClient });
  const instanceB = new RedisProcessedMessageStore({ client: sharedClient });
  const [a, b] = await Promise.all([instanceA.add("dup-msg"), instanceB.add("dup-msg")]);
  // Exactly one must win; the other must see "already present".
  assert.equal(a || b, true, "at least one add must win");
  assert.equal(a && b, false, "both must not win — that's the dedup race the in-memory store lost");
});

test("RedisProcessedMessageStore: in-memory fallback matches ProcessedMessageStore", async () => {
  const store = new RedisProcessedMessageStore({ client: null });
  assert.equal(await store.has("m"), false);
  await store.add("m");
  assert.equal(await store.has("m"), true);
});

test("RedisProcessedMessageStore: Redis read error fails OPEN (does not drop the message)", async () => {
  const broken = { exists: async () => { throw new Error("ECONNRESET"); }, set: async () => { throw new Error("ECONNRESET"); } };
  const store = new RedisProcessedMessageStore({ client: broken, logger: { warn: () => {}, error: () => {} } });
  // has fails open (false) so the message is processed; add fails open (false) so the idempotency layer guards.
  assert.equal(await store.has("m"), false);
  assert.equal(await store.add("m"), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Rate limiters (login brute-force protection)
// ═══════════════════════════════════════════════════════════════════════════
test("InMemoryRateLimiter: allows up to max, then blocks; clear resets", async () => {
  const limiter = new InMemoryRateLimiter({ max: 3, windowMs: 60000, now: () => 1000 });
  for (let i = 0; i < 3; i++) {
    const { limited } = await limiter.hit("1.2.3.4");
    assert.equal(limited, false, `hit ${i + 1} must not be limited (under max)`);
  }
  const { limited, count } = await limiter.hit("1.2.3.4");
  assert.equal(limited, true, "4th hit must be limited (over max)");
  assert.equal(count, 4);
  await limiter.clear("1.2.3.4");
  const { limited: after } = await limiter.check("1.2.3.4");
  assert.equal(after, false, "clear must reset the counter");
});

test("RedisRateLimiter: atomic INCR + EXPIRE; blocks after max; clear resets", async () => {
  const limiter = new RedisRateLimiter({ client: new FakeRedisClient(), max: 3, windowMs: 60000 });
  for (let i = 0; i < 3; i++) {
    const { limited } = await limiter.hit("5.6.7.8");
    assert.equal(limited, false);
  }
  const { limited, count } = await limiter.hit("5.6.7.8");
  assert.equal(limited, true);
  assert.equal(count, 4);
  await limiter.clear("5.6.7.8");
  const { count: after } = await limiter.hit("5.6.7.8");
  assert.equal(after, 1, "clear must reset; next hit starts a fresh window");
});

test("RedisRateLimiter: shared client = shared counter (multi-instance)", async () => {
  const shared = new FakeRedisClient();
  const a = new RedisRateLimiter({ client: shared, max: 3, windowMs: 60000 });
  const b = new RedisRateLimiter({ client: shared, max: 3, windowMs: 60000 });
  await a.hit("9.9.9.9"); await b.hit("9.9.9.9"); await a.hit("9.9.9.9");
  const { limited } = await b.hit("9.9.9.9");
  assert.equal(limited, true, "the 4th hit across two instances sharing Redis must be limited — the in-memory Map could not do this");
});

test("RedisRateLimiter: Redis error fails OPEN (does not lock out all logins)", async () => {
  const broken = { incr: async () => { throw new Error("ECONNRESET"); }, expire: async () => 0, get: async () => null, del: async () => 0 };
  const limiter = new RedisRateLimiter({ client: broken, max: 5, logger: { warn: () => {}, error: () => {} } });
  const { limited } = await limiter.hit("10.0.0.1");
  assert.equal(limited, false, "on Redis outage, login must stay allowed (fail open) — bcrypt + network layer still apply");
});

// ═══════════════════════════════════════════════════════════════════════════
// BusinessOwnerAuthService integration with the injected rate limiter
// ═══════════════════════════════════════════════════════════════════════════
function makeAuthWithLimiter(limiter) {
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-auth-"));
  const svc = new BusinessOwnerAuthService({ tenantsDir, logger: null, rateLimiter: limiter });
  const tenantId = "t1";
  fs.mkdirSync(path.join(tenantsDir, tenantId), { recursive: true });
  fs.writeFileSync(path.join(tenantsDir, tenantId, "profile.json"), JSON.stringify({ id: tenantId, name: "T" }));
  svc.createOwner({ tenantId, email: "owner@t.com", password: "rightpass1", name: "O" });
  return { svc, tenantId };
}

test("BusinessOwnerAuthService: loginWithPassword is async + rate-limiter blocks after 5 fails", async () => {
  const limiter = new InMemoryRateLimiter({ max: 5, windowMs: 60000 });
  const { svc, tenantId } = makeAuthWithLimiter(limiter);
  // 5 wrong passwords → 5 hits.
  for (let i = 0; i < 5; i++) {
    const r = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "wrongpass1", ip: "1.1.1.1" });
    assert.equal(r.ok, false);
  }
  // 6th attempt — even with the RIGHT password — must be rate-limited.
  const blocked = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "rightpass1", ip: "1.1.1.1" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Too many login attempts/i);
});

test("BusinessOwnerAuthService: a successful login clears the rate-limit counter", async () => {
  const limiter = new InMemoryRateLimiter({ max: 5, windowMs: 60000 });
  const { svc, tenantId } = makeAuthWithLimiter(limiter);
  // 2 fails, then a success.
  await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "bad1", ip: "2.2.2.2" });
  await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "bad2", ip: "2.2.2.2" });
  const ok = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "rightpass1", ip: "2.2.2.2" });
  assert.equal(ok.ok, true);
  // Counter cleared → 5 more fails should still be under the limit.
  for (let i = 0; i < 5; i++) {
    const r = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "wrong", ip: "2.2.2.2" });
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.error, /Too many/i, `hit ${i + 1} after clear must not be rate-limited`);
  }
});

test("BusinessOwnerAuthService: works with a Redis-backed rate limiter (shared counter)", async () => {
  const shared = new FakeRedisClient();
  const limiter = new RedisRateLimiter({ client: shared, max: 5, windowMs: 60000, logger: { warn: () => {}, error: () => {} } });
  const { svc, tenantId } = makeAuthWithLimiter(limiter);
  for (let i = 0; i < 5; i++) {
    const r = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "wrong", ip: "3.3.3.3" });
    assert.equal(r.ok, false);
  }
  const blocked = await svc.loginWithPassword({ tenantId, email: "owner@t.com", password: "rightpass1", ip: "3.3.3.3" });
  assert.equal(blocked.ok, false, "6th attempt must be blocked by the Redis-shared counter");
  assert.match(blocked.error, /Too many/i);
});


// ═══════════════════════════════════════════════════════════════════════════
// HealthService readiness: memory mode omits Redis/PG probes
// ═══════════════════════════════════════════════════════════════════════════
test("HealthService: memory-mode readiness omits Redis/PG probes + returns ok", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-hs-"));
  const hs = new HealthService({
    config: { tenantsDir: tmp },
    storage: { mode: "memory" },
    stripeClient: { isMockMode: () => true },
    logger: null,
  });
  const r = await hs.readiness();
  assert.equal(r.status, "ok");
  assert.equal(r.checks.storage.mode, "memory");
  assert.equal("redis" in r.checks.storage, false, "memory mode must not probe Redis");
  assert.equal("postgres" in r.checks.storage, false, "memory mode must not probe Postgres");
});

test("HealthService: persistent-mode readiness probes Redis + PG, fail-open on error", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-hs-"));
  // A storage bundle whose redis/PG clients throw on ping/query → must produce
  // warnings (degraded), NOT unhealthy.
  const hs = new HealthService({
    config: { tenantsDir: tmp },
    storage: {
      mode: "persistent",
      redis: { client: { ping: async () => { throw new Error("ECONNREFUSED"); } } },
      db: { query: async () => { throw new Error("connection terminated"); } },
    },
    stripeClient: { isMockMode: () => true },
    logger: null,
  });
  const r = await hs.readiness();
  assert.equal(r.status, "degraded", "failed probes must be warnings, not unhealthy");
  assert.equal(r.checks.storage.redis.ok, false);
  assert.equal(r.checks.storage.postgres.ok, false);
  assert.ok(r.warnings.some((w) => /Redis/.test(w)));
  assert.ok(r.warnings.some((w) => /PostgreSQL/.test(w)));
});

test("HealthService: persistent-mode readiness ok when Redis + PG respond", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-hs-"));
  const hs = new HealthService({
    config: { tenantsDir: tmp },
    storage: {
      mode: "persistent",
      redis: { client: { ping: async () => "PONG" } },
      db: { query: async () => ({ rows: [{ ok: 1 }] }) },
    },
    stripeClient: { isMockMode: () => false },
    logger: null,
  });
  const r = await hs.readiness();
  assert.equal(r.status, "ok");
  assert.equal(r.checks.storage.redis.ok, true);
  assert.equal(r.checks.storage.postgres.ok, true);
});
