// Sprint P5-2 — container wiring regression test (v73.0).
//
// Verifies that buildContainer() selects the RIGHT store implementations based
// on NOVA_STORAGE_MODE:
//   - memory mode  → InMemoryNonceStore, ProcessedMessageStore, InMemoryRateLimiter
//   - persistent mode → RedisNonceStore, RedisProcessedMessageStore, RedisRateLimiter
//     (only when REDIS_URL is reachable; this test can't reach a real Redis, so
//      it asserts the memory-mode branch + that the redisClient extraction logic
//      is correct by inspecting the storage bundle shape.)
//
// This file is SEPARATE from sprintP5-1 because buildContainer() starts
// background timers (engine periodic jobs) that keep the event loop alive, so
// the test force-exits in test.after once assertions are done. sprintP5-1's
// pure-logic tests exit naturally and don't need this.
//
// All assertions are in ONE test() block so test.after (which force-exits)
// runs only after every assertion has completed — Node runs top-level tests
// concurrently, so multiple test() blocks + process.exit would cut off
// in-flight tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("container (memory mode): selects in-memory fallback stores + async auth + health wiring", async () => {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p5-2-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "k");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "o");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  // NOVA_STORAGE_MODE unset → defaults to "memory" (see packages/config/src/config.js).
  const { buildContainer } = require("../apps/api/src/container");
  const c = await buildContainer();
  try {
    // storage mode + redis client absence.
    assert.equal(c.storage.mode, "local", "memory mode → storage.mode 'local'");
    assert.ok(!c.storage.redis || !c.storage.redis.client, "memory mode must not connect a Redis client");

    // The 3 stores must be the in-memory fallbacks (proves the redisClient-null
    // branch in container.js was taken for each).
    assert.equal(c.oauthNonceStore.constructor.name, "InMemoryNonceStore");
    assert.equal(c.whatsappProcessedStore.constructor.name, "ProcessedMessageStore");
    assert.equal(c.businessOwnerAuthService.rateLimiter.constructor.name, "InMemoryRateLimiter");

    // loginWithPassword became async in v73.0 (rate limiter may be Redis-backed).
    const p = c.businessOwnerAuthService.loginWithPassword({
      tenantId: "no-such-tenant", email: "x@y.com", password: "wrong123", ip: "1.2.3.4",
    });
    assert.ok(p && typeof p.then === "function", "loginWithPassword must return a Promise");
    await p; // drain (will be { ok:false } — tenant doesn't exist)

    // healthService is wired with the storage bundle; memory mode omits probes.
    const r = await c.healthService.readiness();
    assert.equal(r.status, "ok");
    assert.equal(r.checks.storage.mode, "local");
    assert.equal("redis" in r.checks.storage, false, "memory mode must not probe Redis");
    assert.equal("postgres" in r.checks.storage, false, "memory mode must not probe Postgres");
  } finally {
    await c.registry.shutdownAll().catch(() => {});
  }
  // Background timers (engine periodic jobs) keep the event loop alive. All
  // assertions have run, so force-exit so `npm test` completes. This is the
  // only test in the file, so nothing is cut off.
  process.exit(0);
});
