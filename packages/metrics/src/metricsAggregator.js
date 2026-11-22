/**
 * Phase 3 Sprint 2 — Dashboard Metrics Aggregator.
 *
 * Captures production-health metrics for the T0/T1/T2 conversation-routing
 * engine so the audit gap ("no dashboard metrics for fallback %, p95 latency,
 * and LLM share") is closed.
 *
 * The aggregator subscribes to the eventBus for the coarse per-turn signals
 * (tenant + capability breakdown, total turns) that the ExecutionEngine emits
 * on every processed message, and accepts a finer-grained `recordIntelligence`
 * call (mirroring `executionEngine.process()`'s return value) for the NLU
 * details that the event payload does not carry: `deterministicFallback`,
 * `nlu.used`, and per-turn `latencyMs`.
 *
 * Metrics tracked per tenant AND per capability:
 *   - totalTurns
 *   - fallbackCount   (from intelligence.nlu.deterministicFallback)
 *   - llmUsedCount    (from intelligence.nlu.used)
 *   - latencyMs samples
 *
 * Derived metrics:
 *   - fallbackRate = fallbackCount / totalTurns
 *   - llmShare     = llmUsedCount / totalTurns
 *   - p95LatencyMs = 95th percentile of latency samples (nearest-rank)
 *
 * Empty-state safety: when no turns have been recorded, rates return 0 and
 * p95LatencyMs returns null (no division by zero, no NaN).
 */

const PROCESSED_EVENT = "message.processed.v1";

/** Per-tenant + per-capability metric rollup for the T0/T1/T2 engine. */
class MetricsAggregator {
  /**
   * @param {object} opts
   * @param {object} opts.eventBus   EventBus instance (publish/subscribe API).
   * @param {object} [opts.logger]   Logger with .warn/.error, optional.
   * @param {number} [opts.maxLatencySamples]  Cap on samples kept per bucket (default 5000).
   */
  constructor({ eventBus, logger = null, maxLatencySamples = 5000 } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") {
      throw new TypeError("MetricsAggregator requires an eventBus with subscribe()");
    }
    this.eventBus = eventBus;
    this.logger = logger || null;
    this.maxLatencySamples = maxLatencySamples;

    // tenantId → { totalTurns, fallbackCount, llmUsedCount, latencies: number[], byCapability: Map }
    this.tenants = new Map();

    // Subscribe to the ExecutionEngine's per-turn processed event.
    // Payload: { tenantId, conversationId, capabilityId }.
    this._unsubscribe = eventBus.subscribe(PROCESSED_EVENT, (event) => {
      try {
        const { tenantId, capabilityId } = event?.payload || {};
        if (!tenantId) return;
        this._incrementTurn(tenantId, capabilityId || null);
      } catch (error) {
        this.logger?.error?.("metrics.record_failed", { eventName: PROCESSED_EVENT, error: error.message });
      }
    });
  }

  /**
   * Record the rich intelligence details from a `process()` return value.
   *
   * The `message.processed.v1` event only carries { tenantId, conversationId,
   * capabilityId } — the NLU fallback / LLM-used / latency fields live on the
   * `intelligence.nlu` object the ExecutionEngine returns. Call this once per
   * turn (after process() resolves) to capture them. The turn is counted
   * exactly once even if the eventBus also fires `message.processed.v1` for
   * the same turn: the per-turn increment is de-duplicated by `turnId`.
   *
   * @param {object} input
   * @param {string} input.tenantId
   * @param {string|null} [input.capabilityId]
   * @param {object|null} [input.intelligence]   The `intelligence` from process()'s return.
   * @param {number} [input.latencyMs]          Optional explicit latency; falls back to intelligence.nlu.latencyMs.
   * @param {string} [input.turnId]             Optional de-dup key (e.g. conversationId + sequence).
   */
  recordIntelligence({ tenantId, capabilityId = null, intelligence = null, latencyMs = null, turnId = null }) {
    if (!tenantId) return;
    const tenant = this._bucket(tenantId);

    // Turn counting: the `message.processed.v1` event subscription is the
    // authoritative counter — it fires once per real turn and carries no
    // version, so it cannot be de-duplicated against this call. Therefore:
    //   • When `turnId` is provided, the event has ALREADY counted this turn
    //     (the container wrapper only calls recordIntelligence AFTER process()
    //     resolves, by which time the event has fired). We must NOT count again
    //     — we only enrich the NLU/latency fields below. (Earlier code counted
    //     in the else-branch here, double-counting every wrapped turn 2×.)
    //   • When `turnId` is null, the caller is the sole source of truth
    //     (e.g. a test injecting intelligence directly) — count the turn here.
    if (turnId == null) {
      tenant.totalTurns += 1;
      this._bumpCapability(tenant, capabilityId, (c) => { c.totalTurns += 1; });
    }

    const nlu = intelligence?.nlu || null;

    if (nlu?.deterministicFallback) {
      tenant.fallbackCount += 1;
      this._bumpCapability(tenant, capabilityId, (c) => { c.fallbackCount += 1; });
    }
    if (nlu?.used) {
      tenant.llmUsedCount += 1;
      this._bumpCapability(tenant, capabilityId, (c) => { c.llmUsedCount += 1; });
    }

    const latency = typeof latencyMs === "number" && Number.isFinite(latencyMs)
      ? latencyMs
      : (typeof nlu?.latencyMs === "number" && Number.isFinite(nlu.latencyMs) ? nlu.latencyMs : null);
    if (latency !== null && latency >= 0) {
      tenant.latencies.push(latency);
      if (tenant.latencies.length > this.maxLatencySamples) {
        tenant.latencies = tenant.latencies.slice(-this.maxLatencySamples);
      }
      this._bumpCapability(tenant, capabilityId, (c) => {
        c.latencies.push(latency);
        if (c.latencies.length > this.maxLatencySamples) {
          c.latencies = c.latencies.slice(-this.maxLatencySamples);
        }
      });
    }
  }

  /**
   * Read-only snapshot of all tenants + capabilities.
   * @returns {{ tenants: Record<string, { totalTurns: number, fallbackRate: number, llmShare: number, p95LatencyMs: number|null, byCapability: Record<string, object> }> }}
   */
  snapshot() {
    const out = {};
    for (const [tenantId, tenant] of this.tenants.entries()) {
      out[tenantId] = this._summarize(tenant);
    }
    return { tenants: out };
  }

  /** Clear all accumulated state. */
  reset() {
    this.tenants.clear();
  }

  /** Detach from the eventBus. Useful in tests to avoid dangling listeners. */
  dispose() {
    if (typeof this._unsubscribe === "function") this._unsubscribe();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  _bucket(tenantId) {
    let tenant = this.tenants.get(tenantId);
    if (!tenant) {
      tenant = {
        totalTurns: 0,
        fallbackCount: 0,
        llmUsedCount: 0,
        latencies: [],
        byCapability: new Map(),
        seenTurns: new Set(),
      };
      this.tenants.set(tenantId, tenant);
    }
    return tenant;
  }

  _incrementTurn(tenantId, capabilityId) {
    const tenant = this._bucket(tenantId);
    tenant.totalTurns += 1;
    this._bumpCapability(tenant, capabilityId, (c) => { c.totalTurns += 1; });
  }

  _bumpCapability(tenant, capabilityId, fn) {
    if (!capabilityId) capabilityId = "_unspecified";
    let cap = tenant.byCapability.get(capabilityId);
    if (!cap) {
      cap = { totalTurns: 0, fallbackCount: 0, llmUsedCount: 0, latencies: [] };
      tenant.byCapability.set(capabilityId, cap);
    }
    fn(cap);
  }

  _summarize(tenant) {
    const byCapability = {};
    for (const [capId, cap] of tenant.byCapability.entries()) {
      byCapability[capId] = this._summarizeBucket(cap);
    }
    return {
      totalTurns: tenant.totalTurns,
      fallbackRate: tenant.totalTurns > 0 ? tenant.fallbackCount / tenant.totalTurns : 0,
      llmShare: tenant.totalTurns > 0 ? tenant.llmUsedCount / tenant.totalTurns : 0,
      p95LatencyMs: this._p95(tenant.latencies),
      byCapability,
    };
  }

  _summarizeBucket(bucket) {
    return {
      totalTurns: bucket.totalTurns,
      fallbackRate: bucket.totalTurns > 0 ? bucket.fallbackCount / bucket.totalTurns : 0,
      llmShare: bucket.totalTurns > 0 ? bucket.llmUsedCount / bucket.totalTurns : 0,
      p95LatencyMs: this._p95(bucket.latencies),
    };
  }

  /**
   * 95th percentile via the nearest-rank method.
   *
   * Rationale: the existing AnalyticsEngine uses `Math.ceil(p/100 * n) - 1`
   * (also nearest-rank), so we match that convention for consistency across
   * the dashboard tooling. Linear interpolation would be over-precise for a
   * health metric whose purpose is "is p95 above the SLO?".
   *
   * @param {number[]} samples
   * @returns {number|null} null when there are no samples.
   */
  _p95(samples) {
    if (!samples || samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[idx < 0 ? 0 : idx];
  }
}

module.exports = { MetricsAggregator };
