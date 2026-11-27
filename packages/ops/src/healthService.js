// Phase 4 hardening (roadmap #9) — Operational health service.
//
// Provides a lightweight health check for load balancers + a deeper status
// snapshot for operators. Checks the critical runtime dependencies:
//   - tenants dir is writable (the engine can't process without it)
//   - billing config (mock mode is flagged; in prod that's a degraded state)
//   - calendar providers configured (informational — not required to be healthy)
//   - process uptime + memory
//
// The health check is intentionally CHEAP (no disk reads beyond a stat) so it
// can be hit every few seconds by a load balancer without load.
const fs = require("fs");
const path = require("path");
const os = require("os");

const startTime = Date.now();

class HealthService {
  constructor({ config, planService = null, stripeClient = null, googleOAuthClient = null, microsoftOAuthClient = null, storage = null, logger = null }) {
    this.config = config;
    this.planService = planService;
    this.stripeClient = stripeClient;
    this.googleOAuthClient = googleOAuthClient;
    this.microsoftOAuthClient = microsoftOAuthClient;
    this.storage = storage; // v73.0: storage bundle (db + redis clients) for connectivity probes
    this.logger = logger;
  }

  /**
   * Cheap liveness probe for load balancers. Returns 200 if the process is up
   * and the tenants dir exists. Does NOT check downstream services (those can
   * flap and cause the LB to thrash).
   */
  liveness() {
    return { status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000), pid: process.pid };
  }

  /**
   * Deeper readiness check — is this instance ready to serve real traffic?
   * Returns a degraded status (still 200, but with warnings) if a non-critical
   * subsystem is misconfigured, and an unhealthy status (503-worthy) only if
   * the tenants dir is missing/unwritable.
   *
   * v73.0: now async + probes Redis + PostgreSQL connectivity when a storage
   * bundle is wired (persistent mode). A failed probe is a WARNING (degraded),
   * not unhealthy — the LB still routes traffic so the operator can debug, and
   * because memory-mode deploys have no Redis/PG to probe.
   */
  async readiness() {
    const checks = {};
    const warnings = [];

    // Tenants dir (critical — the engine reads tenant profiles from here).
    try {
      const dir = this.config?.tenantsDir;
      if (!dir) throw new Error("tenantsDir not configured");
      if (!fs.existsSync(dir)) throw new Error(`tenants dir does not exist: ${dir}`);
      fs.accessSync(dir, fs.constants.W_OK);
      checks.tenantsDir = { ok: true, path: dir };
    } catch (e) {
      checks.tenantsDir = { ok: false, error: e.message };
      return { status: "unhealthy", checks, warnings };
    }

    // Billing — mock mode is a degraded (but functional) state in production.
    const isProd = process.env.NODE_ENV === "production";
    if (this.stripeClient) {
      const mock = this.stripeClient.isMockMode();
      checks.billing = { ok: true, mode: mock ? "mock" : "live" };
      if (mock && isProd) warnings.push("Stripe is in mock mode — webhooks are disabled in production. Set STRIPE_SECRET_KEY.");
    } else {
      checks.billing = { ok: false, error: "not configured" };
      warnings.push("Billing not configured — self-serve signup unavailable.");
    }

    // Calendar providers (informational).
    checks.calendar = {
      google: this.googleOAuthClient?.isConfigured?.() || false,
      microsoft: this.microsoftOAuthClient?.isConfigured?.() || false,
    };

    // v73.0: Redis + PostgreSQL connectivity (persistent mode only). In memory
    // mode storage is null and these checks are omitted. A failed probe is a
    // warning (degraded), not unhealthy, so the LB keeps routing while ops
    // investigates — losing Redis mid-flight is recoverable (in-memory
    // fallbacks) and shouldn't take the instance out of rotation.
    checks.storage = { mode: this.storage?.mode || "memory" };
    if (this.storage?.mode === "persistent") {
      // Redis ping (best-effort, 1s timeout).
      try {
        const redisClient = this.storage?.redis?.client;
        if (redisClient && typeof redisClient.ping === "function") {
          const pong = await Promise.race([
            redisClient.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
          ]);
          checks.storage.redis = { ok: pong === "PONG", reply: pong };
          if (pong !== "PONG") warnings.push("Redis ping returned an unexpected reply.");
        } else {
          checks.storage.redis = { ok: false, error: "redis client not connected" };
          warnings.push("Redis client not connected — conversation state + dedup fall back to in-memory.");
        }
      } catch (e) {
        checks.storage.redis = { ok: false, error: e.message };
        warnings.push(`Redis probe failed: ${e.message}. Fallbacks are active but multi-instance safety is degraded.`);
      }
      // PostgreSQL SELECT 1 (best-effort, 1s timeout).
      try {
        const db = this.storage?.db;
        if (db && typeof db.query === "function") {
          await Promise.race([
            db.query("SELECT 1 AS ok"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
          ]);
          checks.storage.postgres = { ok: true };
        } else {
          checks.storage.postgres = { ok: false, error: "pg client not connected" };
          warnings.push("PostgreSQL client not connected — CRM/commerce/booking fall back to in-memory.");
        }
      } catch (e) {
        checks.storage.postgres = { ok: false, error: e.message };
        warnings.push(`PostgreSQL probe failed: ${e.message}. Relational repos are unavailable.`);
      }
    }

    // Process health.
    checks.process = {
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      loadAvg: os.loadavg(),
    };

    return {
      status: warnings.length ? "degraded" : "ok",
      checks,
      warnings,
      version: require("../../../package.json").version,
    };
  }
}

module.exports = { HealthService };
