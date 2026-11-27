// v73.0 — Redis-backed rate limiter (production), with in-memory fallback.
//
// Why: BusinessOwnerAuthService._failedAttempts is a process-local Map of
// { ip → { count, windowStart } }. A server restart resets every attacker's
// counter to zero, so brute-force protection restarts from scratch on every
// deploy. In a multi-instance deployment, each instance has its own Map, so an
// attacker can make 5 attempts per instance per minute.
//
// This module exports two rate limiters with the SAME async API:
//   - check(ip)  → { limited: boolean, count: number }  (does NOT increment)
//   - hit(ip)    → { limited: boolean, count: number }  (increments; returns post-increment count)
//   - clear(ip)  → void
// The auth service injects one of these. In memory mode it gets
// InMemoryRateLimiter (the original fixed-window logic, just extracted); in
// persistent mode it gets RedisRateLimiter (atomic INCR + EXPIRE on first
// increment of each window — race-safe across instances).
//
// Fixed-window (not sliding) is intentional: it matches the existing behavior
// (5 per 60s window) and is one Redis round-trip. Sliding-window would need a
// sorted set + ZREMRANGEBYSCORE — overkill for login rate-limiting.

/**
 * @typedef {Object} RedisLikeClient
 * @property {(key:string)=>Promise<number>} incr
 * @property {(key:string, seconds:number)=>Promise<number>} expire
 * @property {(key:string)=>Promise<number>} del
 * @property {(key:string)=>Promise<number|null>} get
 */

/** In-memory fixed-window rate limiter (dev/tests/memory mode). */
class InMemoryRateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.max=5] Max hits per window.
   * @param {number} [opts.windowMs=60000] Window length in ms.
   * @param {()=>number} [opts.now=Date.now]
   */
  constructor({ max = 5, windowMs = 60000, now = () => Date.now() } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this._counts = new Map(); // ip → { count, windowStart }
  }
  _entry(ip) {
    let e = this._counts.get(ip);
    if (!e || this.now() - e.windowStart > this.windowMs) {
      e = { count: 0, windowStart: this.now() };
      this._counts.set(ip, e);
    }
    return e;
  }
  async check(ip) {
    const e = this._entry(ip);
    return { limited: e.count >= this.max, count: e.count };
  }
  async hit(ip) {
    const e = this._entry(ip);
    if (this.now() - e.windowStart > this.windowMs) { e.count = 0; e.windowStart = this.now(); }
    e.count += 1;
    this._counts.set(ip, e);
    return { limited: e.count > this.max, count: e.count };
  }
  async clear(ip) { this._counts.delete(ip); }
}

/** Redis fixed-window rate limiter (persistent/multi-instance mode). */
class RedisRateLimiter {
  /**
   * @param {object} opts
   * @param {RedisLikeClient} opts.client Connected redis client.
   * @param {number} [opts.max=5] Max hits per window.
   * @param {number} [opts.windowMs=60000] Window length in ms.
   * @param {string} [opts.prefix='nova:ratelimit:login:'] Key prefix.
   * @param {object} [opts.logger=null]
   */
  constructor({ client, max = 5, windowMs = 60000, prefix = "nova:ratelimit:login:", logger = null } = {}) {
    if (!client) throw new Error("RedisRateLimiter requires a redis client");
    this.client = client;
    this.max = max;
    this.windowMs = windowMs;
    this.prefix = prefix;
    this.logger = logger;
  }
  _key(ip) { return `${this.prefix}${ip}`; }
  _windowSec() { return Math.max(1, Math.ceil(this.windowMs / 1000)); }

  async _currentCount(ip) {
    try {
      const raw = await this.client.get(this._key(ip));
      return raw == null ? 0 : Number(raw);
    } catch (e) {
      this.logger?.error?.("ratelimit.get_failed", { ip, error: e.message });
      return 0; // fail OPEN on read error (see hit() for the rationale)
    }
  }

  async check(ip) {
    const count = await this._currentCount(ip);
    return { limited: count >= this.max, count };
  }

  async hit(ip) {
    // Atomic INCR, then set EXPIRE only on the first hit of a window (count===1).
    // INCR + conditional EXPIRE is the standard Redis fixed-window pattern: the
    // TTL guarantees the counter resets even if no further hits arrive, and
    // setting it only on count===1 avoids resetting the window on every hit.
    try {
      const count = await this.client.incr(this._key(ip));
      if (count === 1) await this.client.expire(this._key(ip), this._windowSec());
      return { limited: count > this.max, count };
    } catch (e) {
      // Fail OPEN: if Redis is down, blocking all logins is worse than allowing
      // a potential brute-force burst (bcrypt + the per-IP network layer still
      // apply). Log loudly so ops sees the outage.
      this.logger?.error?.("ratelimit.hit_failed_open", { ip, error: e.message });
      return { limited: false, count: 0 };
    }
  }

  async clear(ip) {
    try { await this.client.del(this._key(ip)); }
    catch (e) { this.logger?.warn?.("ratelimit.clear_failed", { ip, error: e.message }); }
  }
}

module.exports = { InMemoryRateLimiter, RedisRateLimiter };
