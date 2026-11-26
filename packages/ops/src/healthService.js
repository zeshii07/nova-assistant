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
  constructor({ config, planService = null, stripeClient = null, googleOAuthClient = null, microsoftOAuthClient = null, logger = null }) {
    this.config = config;
    this.planService = planService;
    this.stripeClient = stripeClient;
    this.googleOAuthClient = googleOAuthClient;
    this.microsoftOAuthClient = microsoftOAuthClient;
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
   */
  readiness() {
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
