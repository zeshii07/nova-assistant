// Phase 4 Sprint 1 — File-backed subscription repository.
//
// Stores each tenant's subscription state in
//   tenants/<tenantId>/subscription.json
// keeping it separate from profile.json (which describes the business, not the
// billing relationship). Mirrors FileTenantRepository's caching + validation
// pattern so the rest of the codebase sees a familiar shape.
//
// Schema (subscription.json):
//   {
//     "tenantId":       "restaurant-demo",
//     "status":         "trialing" | "active" | "past_due" | "canceled" | "incomplete",
//     "planId":         "starter" | "growth" | "scale",
//     "stripeCustomerId":     "cus_..." | null,
//     "stripeSubscriptionId": "sub_..." | null,
//     "currentPeriodEnd":     "2026-12-26T00:00:00Z" | null,
//     "trialEnd":             "2026-12-10T00:00:00Z" | null,
//     "canceledAt":           "2026-12-01T00:00:00Z" | null,
//     "messagesThisCycle":    0,
//     "cycleStart":           "2026-11-26T00:00:00Z",
//     "updatedAt":            "2026-11-26T12:00:00Z"
//   }
const fs = require("fs");
const path = require("path");
const { withFileLock, atomicWriteJson } = require("../../storage/src/atomicWrite");
const { NotFoundError, ValidationError } = require("../../shared/src/errors");

const VALID_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "incomplete"]);

class FileSubscriptionRepository {
  constructor({ tenantsDir, logger, clock = null }) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.clock = clock || (() => new Date().toISOString());
    this.cache = new Map();
  }

  _filePath(tenantId) { return path.join(this.tenantsDir, tenantId, "subscription.json"); }

  /** Read a tenant's subscription, or return null if none exists (not provisioned yet). */
  get(tenantId) {
    if (this.cache.has(tenantId)) return structuredClone(this.cache.get(tenantId));
    const filePath = this._filePath(tenantId);
    if (!fs.existsSync(filePath)) return null;
    let sub;
    try {
      sub = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new ValidationError(`Subscription for '${tenantId}' is invalid JSON`, { cause: error.message });
    }
    this.validate(sub, tenantId);
    this.cache.set(tenantId, sub);
    return structuredClone(sub);
  }

  /** Persist + cache a subscription. Sets updatedAt + validates. Uses atomic
   *  write (temp-file + rename) so concurrent saves never leave a partial file. */
  save(subscription) {
    this.validate(subscription, subscription.tenantId);
    const updated = { ...subscription, updatedAt: this.clock() };
    const dir = path.join(this.tenantsDir, subscription.tenantId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteJson(this._filePath(subscription.tenantId), updated, { pretty: true });
    this.cache.set(subscription.tenantId, updated);
    this.logger?.info("subscription.saved", { tenantId: subscription.tenantId, status: updated.status, planId: updated.planId });
    return structuredClone(updated);
  }

  /**
   * Atomically read-modify-write the subscription under a file lock. Use this
   * for any counter increment or status transition so concurrent calls don't
   * lose updates. The mutator receives the CURRENT on-disk record (re-read
   * inside the lock, bypassing the cache) and returns the new record to save.
   * @param {string} tenantId
   * @param {(sub: object|null) => object|null} mutator  return null to abort (no write)
   * @returns {object|null} the saved record, or null if mutator aborted / no sub.
   */
  async mutate(tenantId, mutator) {
    const filePath = this._filePath(tenantId);
    return withFileLock(filePath, () => {
      // Re-read from disk inside the lock — the cache may be stale if another
      // concurrent caller just wrote.
      let sub = null;
      if (fs.existsSync(filePath)) {
        try { sub = JSON.parse(fs.readFileSync(filePath, "utf8")); }
        catch (error) { throw new ValidationError(`Subscription for '${tenantId}' is invalid JSON`, { cause: error.message }); }
      }
      const next = mutator(sub);
      if (!next) return null;
      this.validate(next, tenantId);
      const updated = { ...next, updatedAt: this.clock() };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      atomicWriteJson(filePath, updated, { pretty: true });
      this.cache.set(tenantId, updated);
      return structuredClone(updated);
    });
  }

  /** Provision a fresh trial subscription for a new tenant. */
  provisionTrial(tenantId, planId, { trialDays = 14 } = {}) {
    const now = this.clock();
    const trialEnd = new Date(new Date(now).getTime() + trialDays * 86400000).toISOString();
    return this.save({
      tenantId,
      status: "trialing",
      planId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd,
      canceledAt: null,
      messagesThisCycle: 0,
      cycleStart: now,
      updatedAt: now,
    });
  }

  validate(sub, expectedTenantId) {
    if (!sub || typeof sub !== "object") throw new ValidationError("Subscription must be an object");
    if (sub.tenantId !== expectedTenantId) throw new ValidationError("Subscription tenantId does not match its folder");
    if (!VALID_STATUSES.has(sub.status)) throw new ValidationError(`Subscription status '${sub.status}' is invalid`);
    if (!sub.planId || typeof sub.planId !== "string") throw new ValidationError("Subscription requires a planId");
    if (typeof sub.messagesThisCycle !== "number" || sub.messagesThisCycle < 0) {
      throw new ValidationError("Subscription messagesThisCycle must be a non-negative number");
    }
  }

  clearCache(tenantId) { tenantId ? this.cache.delete(tenantId) : this.cache.clear(); }
}

module.exports = { FileSubscriptionRepository, VALID_STATUSES };
