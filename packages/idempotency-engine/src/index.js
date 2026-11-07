/**
 * v49.0 — Idempotency Engine
 *
 * Prevents duplicate execution of business actions when customers retry
 * (e.g., double-clicking "Confirm Booking" or network retries).
 *
 * Each action execution gets a unique idempotency key derived from:
 *   - tenantId
 *   - customerId
 *   - actionId
 *   - input fingerprint
 *
 * If the same key is seen again within the TTL window, the cached result
 * is returned instead of re-executing the action.
 *
 * Architecture rule: Every consequential business action MUST be idempotent.
 * This engine enforces that at the execution layer.
 */

const crypto = require('crypto');

class IdempotencyEngine {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, logger = null } = {}) {
    this.ttlMs = ttlMs; // Default 24 hours
    this.logger = logger;
    this.store = new Map(); // In-memory (production: Redis/database)
    this._gc();
  }

  /**
   * Generate an idempotency key from the action parameters.
   */
  generateKey({ tenantId, customerId, actionId, input }) {
    const fingerprint = this._fingerprint(input);
    return `${tenantId}:${customerId}:${actionId}:${fingerprint}`;
  }

  /**
   * Check if an action with this key has already been executed.
   * Returns the cached result if found, null otherwise.
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.result;
  }

  /**
   * Store the result of an action execution.
   */
  set(key, result) {
    this.store.set(key, {
      result,
      storedAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Execute an action with idempotency protection.
   * If the action was already executed with the same key, returns the cached result.
   */
  async execute({ key, action }) {
    // Check cache first
    const cached = this.get(key);
    if (cached) {
      this.logger?.info?.('idempotency.cache_hit', { key: key.slice(0, 50) + '...' });
      return { ...cached, fromCache: true };
    }

    // Execute the action
    const result = await action();

    // Cache the result (only if successful — don't cache failures)
    if (result?.success !== false) {
      this.set(key, result);
    }

    return { ...result, fromCache: false };
  }

  /**
   * Create a fingerprint of the input for deduplication.
   */
  _fingerprint(input) {
    try {
      const sorted = this._sortKeys(input);
      return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
    } catch {
      return 'unhashable_' + Date.now();
    }
  }

  _sortKeys(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => this._sortKeys(v));
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = this._sortKeys(obj[key]);
    }
    return sorted;
  }

  _gc() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    // Schedule next GC (every 5 minutes)
    setTimeout(() => this._gc(), 5 * 60 * 1000).unref?.();
  }

  clear() { this.store.clear(); }
  size() { return this.store.size; }
}

module.exports = { IdempotencyEngine };
