/**
 * Phase 3 Sprint 2 — Dashboard metrics aggregator regression suite.
 *
 * Verifies the MetricsAggregator captures the T0/T1/T2 engine's production
 * health signals: fallback %, p95 latency, and LLM share, broken down per
 * tenant and per capability.
 *
 * The aggregator subscribes to `message.processed.v1` (emitted by
 * ExecutionEngine on every processed turn) for the per-tenant / per-capability
 * turn count. The richer `intelligence.nlu` fields (deterministicFallback,
 * used, latencyMs) are not on that event payload, so the test additionally
 * feeds each `process()` return into `aggregator.recordIntelligence()`. That
 * mirrors the wiring the container would apply (see the final report's
 * container.js insertion text).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildContainer } = require("../apps/api/src/container");
const { MetricsAggregator } = require("../packages/metrics/src");

let container;
let aggregator;

/** Drive a single message through the execution engine AND feed the return
 *  into the metrics aggregator so NLU details are captured. */
async function ask(customerId, text, tenantId = "default") {
  const result = await container.executionEngine.process({
    tenantId,
    channel: "p3-2-metrics",
    customerId,
    text,
  });
  // The eventBus subscription already counted the turn via message.processed.v1.
  // Use a turnId so recordIntelligence enriches (NLU + latency) without
  // double-counting the turn.
  aggregator.recordIntelligence({
    tenantId,
    capabilityId: result.capabilityId || null,
    intelligence: result.intelligence || null,
    latencyMs: result.intelligence?.nlu?.latencyMs ?? null,
    turnId: result.conversationId ? `${result.conversationId}:${result.state?.version ?? 0}` : null,
  });
  return result;
}

test.before(async () => {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p3-2-metrics-"));
  container = await buildContainer();
  container.llmRouter.providers = [];
  aggregator = new MetricsAggregator({ eventBus: container.eventBus, logger: container.logger });
});

test.after(() => {
  aggregator?.dispose?.();
});

// ─── 1. Empty-state safety ─────────────────────────────────────────────
test("snapshot() before any events returns no tenants and does not throw", () => {
  const fresh = new MetricsAggregator({ eventBus: container.eventBus });
  const snap = fresh.snapshot();
  assert.deepEqual(snap, { tenants: {} });
  fresh.dispose();
});

test("constructor rejects an eventBus without subscribe()", () => {
  assert.throws(() => new MetricsAggregator({ eventBus: {} }), /eventBus/);
});

// ─── 2. Real turns increment counters ──────────────────────────────────
test("a real restaurant-demo order turn is counted under the restaurant-demo tenant", async () => {
  aggregator.reset();
  await ask("p3-2-biryani", "i want 1 chicken biryani", "restaurant-demo");
  const snap = aggregator.snapshot();
  const tenant = snap.tenants["restaurant-demo"];
  assert.ok(tenant, "restaurant-demo tenant should exist after a turn");
  assert.ok(tenant.totalTurns >= 1, `totalTurns should be >= 1, got ${tenant.totalTurns}`);
  assert.ok(tenant.byCapability && Object.keys(tenant.byCapability).length >= 1,
    "per-capability breakdown should exist");
});

test("junk input 'asdfjkl' still produces a counted turn (no crash, no NaN)", async () => {
  aggregator.reset();
  await ask("p3-2-junk", "asdfjkl");
  const snap = aggregator.snapshot();
  const tenant = snap.tenants.default;
  assert.ok(tenant, "default tenant should exist after a junk turn");
  assert.ok(tenant.totalTurns >= 1);
  assert.ok(!Number.isNaN(tenant.fallbackRate), "fallbackRate must not be NaN");
  assert.ok(!Number.isNaN(tenant.llmShare), "llmShare must not be NaN");
});

test("fallbackRate and llmShare are always within [0, 1] across mixed turns", async () => {
  aggregator.reset();
  await ask("p3-2-mix-1", "hello");
  await ask("p3-2-mix-2", "i want 1 chicken biryani", "restaurant-demo");
  await ask("p3-2-mix-3", "asdfjkl");
  await ask("p3-2-mix-4", "thank you");
  const snap = aggregator.snapshot();
  for (const [tenantId, tenant] of Object.entries(snap.tenants)) {
    assert.ok(tenant.fallbackRate >= 0 && tenant.fallbackRate <= 1,
      `tenant ${tenantId} fallbackRate out of [0,1]: ${tenant.fallbackRate}`);
    assert.ok(tenant.llmShare >= 0 && tenant.llmShare <= 1,
      `tenant ${tenantId} llmShare out of [0,1]: ${tenant.llmShare}`);
  }
});

// ─── 3. Per-tenant + per-capability breakdowns ──────────────────────────
test("multiple tenants are tracked separately", async () => {
  aggregator.reset();
  await ask("p3-2-tenant-a", "hello", "default");
  await ask("p3-2-tenant-b", "i want 1 chicken biryani", "restaurant-demo");
  const snap = aggregator.snapshot();
  assert.ok(snap.tenants.default, "default tenant tracked");
  assert.ok(snap.tenants["restaurant-demo"], "restaurant-demo tenant tracked");
  assert.ok(snap.tenants.default.totalTurns >= 1);
  assert.ok(snap.tenants["restaurant-demo"].totalTurns >= 1);
});

test("per-capability breakdown is populated with sane structure", async () => {
  aggregator.reset();
  await ask("p3-2-cap-1", "i want 1 chicken biryani", "restaurant-demo");
  const snap = aggregator.snapshot();
  const caps = snap.tenants["restaurant-demo"].byCapability;
  assert.ok(Object.keys(caps).length >= 1, "at least one capability bucket exists");
  for (const [capId, cap] of Object.entries(caps)) {
    assert.ok(typeof cap.totalTurns === "number" && cap.totalTurns >= 1,
      `capability ${capId} totalTurns should be a positive number`);
    assert.ok(cap.fallbackRate >= 0 && cap.fallbackRate <= 1,
      `capability ${capId} fallbackRate out of range`);
    assert.ok(cap.llmShare >= 0 && cap.llmShare <= 1,
      `capability ${capId} llmShare out of range`);
    // p95 is null or a non-negative number.
    assert.ok(cap.p95LatencyMs === null || (typeof cap.p95LatencyMs === "number" && cap.p95LatencyMs >= 0),
      `capability ${capId} p95LatencyMs malformed: ${cap.p95LatencyMs}`);
  }
});

// ─── 4. p95 latency correctness (injected known values) ──────────────────
test("p95LatencyMs is null when no latency samples were recorded", async () => {
  const fresh = new MetricsAggregator({ eventBus: container.eventBus });
  // recordIntelligence with no latency and no nlu.latencyMs
  fresh.recordIntelligence({ tenantId: "p95-empty", capabilityId: "system", intelligence: { nlu: { latencyMs: 0, used: false } } });
  const snap = fresh.snapshot();
  // latencyMs 0 is recorded as a sample, so use a truly absent case:
  fresh.reset();
  fresh.recordIntelligence({ tenantId: "p95-empty", capabilityId: "system", intelligence: { nlu: { latencyMs: null } } });
  const snap2 = fresh.snapshot();
  assert.equal(snap2.tenants["p95-empty"].p95LatencyMs, null);
  fresh.dispose();
});

test("p95LatencyMs matches the nearest-rank 95th percentile for a known sample set", () => {
  const fresh = new MetricsAggregator({ eventBus: container.eventBus });
  // 20 samples: 10, 20, 30, ... 200. nearest-rank p95: idx = ceil(0.95*20)-1 = 18 → 190.
  for (let i = 1; i <= 20; i++) {
    fresh.recordIntelligence({
      tenantId: "p95-known",
      capabilityId: "catalog",
      intelligence: { nlu: { used: false, deterministicFallback: false, latencyMs: i * 10 } },
    });
  }
  const snap = fresh.snapshot();
  assert.equal(snap.tenants["p95-known"].totalTurns, 20);
  assert.equal(snap.tenants["p95-known"].p95LatencyMs, 190);
  assert.equal(snap.tenants["p95-known"].byCapability.catalog.p95LatencyMs, 190);
  fresh.dispose();
});

test("p95LatencyMs on a single-sample set returns that sample", () => {
  const fresh = new MetricsAggregator({ eventBus: container.eventBus });
  fresh.recordIntelligence({
    tenantId: "p95-single",
    capabilityId: "assistant",
    intelligence: { nlu: { used: false, deterministicFallback: false, latencyMs: 42 } },
  });
  const snap = fresh.snapshot();
  assert.equal(snap.tenants["p95-single"].p95LatencyMs, 42);
  fresh.dispose();
});

test("reset() clears all accumulated metrics", async () => {
  await ask("p3-2-reset", "hello");
  assert.ok(Object.keys(aggregator.snapshot().tenants).length >= 1);
  aggregator.reset();
  assert.deepEqual(aggregator.snapshot(), { tenants: {} });
});

test("snapshot keys match the documented contract shape", async () => {
  aggregator.reset();
  await ask("p3-2-shape", "i want 1 chicken biryani", "restaurant-demo");
  const snap = aggregator.snapshot();
  assert.ok(Object.prototype.hasOwnProperty.call(snap, "tenants"));
  const tenant = snap.tenants["restaurant-demo"];
  for (const key of ["totalTurns", "fallbackRate", "llmShare", "p95LatencyMs", "byCapability"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(tenant, key), `tenant snapshot missing key: ${key}`);
  }
});
