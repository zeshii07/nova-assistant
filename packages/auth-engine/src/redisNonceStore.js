// v73.0 — Redis-backed OAuth nonce store (production), with in-memory fallback.
//
// Why: the original InMemoryNonceStore keeps nonces in a process-local Map, so
// in a multi-instance deployment a state token minted by instance A cannot be
// consumed by instance B's callback handler — the OAuth flow breaks across
// restarts and across load-balanced instances. CSRF protection (single-use
// nonces) also silently weakens to single-instance.
//
// This store implements the SAME public API as InMemoryNonceStore
// (record / consume / prune) so callers (oauthState.mintState /
// oauthState.verifyState) need no changes. When a redisClient is provided it
// stores nonces in Redis with the state token's TTL (single-use via GETDEL);
// when no client is provided it falls back to the original in-memory Map, so
// dev + tests (NOVA_STORAGE_MODE=memory) keep working unchanged.
//
// Redis commands used (all supported by the `redis` package v4+):
//   SET key value EX ttl   — record a nonce with its expiry
//   GETDEL key             — atomic get-and-delete for single-use consume
//   DEL key                — prune (best-effort)
// Note: record/consume are async in the Redis path. The oauthState.mintState
// helper already accepts an optional store and calls record(); we keep that
// call non-awaited (fire-and-forget) for record, and consume() returns a
// promise — verifyState callers should await consume. To stay backward-
// compatible with the existing sync consume() contract, consume() resolves to
// a boolean (true = fresh, false = replay/unknown) and a sync fallback returns
// a boolean synchronously when no redisClient is set.

/**
 * @typedef {Object} RedisLikeClient — subset of the `redis` package client we use.
 * @property {(key:string, value:string, opts?:object)=>Promise<string|null>} set
 * @property {(key:string)=>Promise<string|null>} get
 * @property {(key:string)=>Promise<string|null>} getDel
 * @property {(keys:string|string[])=>Promise<number>} del
 */

class RedisNonceStore {
  /**
   * @param {object} opts
   * @param {RedisLikeClient|null} [opts.client=null] Connected redis client. null → in-memory fallback.
   * @param {string} [opts.prefix='nova:oauth:nonce:'] Key prefix.
   * @param {object} [opts.logger=null]
   */
  constructor({ client = null, prefix = "nova:oauth:nonce:", logger = null } = {}) {
    this.client = client;
    this.prefix = prefix;
    this.logger = logger;
    // In-memory fallback (used when client is null — i.e. memory storage mode).
    // Mirrors InMemoryNonceStore exactly so behavior is identical in dev/tests.
    this._ttl = new Map();
    this._used = new Map();
  }

  _key(nonce) { return `${this.prefix}${nonce}`; }

  /**
   * Record a freshly-minted nonce so consume() will accept it once.
   * Fire-and-forget safe: mintState does not await this.
   * @param {string} nonce
   * @param {number} expiresAt  epoch-ms expiry (from the state token)
   */
  record(nonce, expiresAt) {
    if (!this.client) {
      this._ttl.set(nonce, expiresAt);
      return;
    }
    const ttlSec = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    // NX so a replayed mint doesn't overwrite. Best-effort: a failed SET
    // (nonce already present) just means record is a no-op, which is fine.
    this.client.set(this._key(nonce), "1", { EX: ttlSec, NX: true })
      .catch((e) => this.logger?.warn?.("oauth.nonce.record_failed", { error: e.message }));
  }

  /**
   * Atomically consume a nonce. Returns true if the nonce was fresh, false if
   * it was never recorded, already consumed, or expired.
   *
   * Sync when using the in-memory fallback (returns a boolean); returns a
   * Promise<boolean> when using Redis. Callers may await either.
   * @param {string} nonce
   * @returns {boolean|Promise<boolean>}
   */
  consume(nonce) {
    if (!this.client) {
      if (!this._ttl.has(nonce)) return false;
      this._ttl.delete(nonce);
      if (this._used.has(nonce)) return false;
      this._used.set(nonce, Date.now());
      if (this._used.size > 10000) {
        const cutoff = Date.now() - 3600000;
        for (const [k, t] of this._used) if (t < cutoff) this._used.delete(k);
      }
      return true;
    }
    return (async () => {
      try {
        // GETDEL is atomic: returns the value iff the key existed, and deletes
        // it in the same step. So a concurrent consumer gets null.
        const val = await this.client.getDel(this._key(nonce));
        return val != null;
      } catch (e) {
        this.logger?.error?.("oauth.nonce.consume_failed", { error: e.message });
        // Fail CLOSED: on a Redis error, reject the OAuth flow rather than risk
        // accepting a replayed/unknown nonce. The user can retry the consent.
        return false;
      }
    })();
  }

  /** Prune expired-but-unused nonces. No-op for Redis (TTL handles it). */
  prune() {
    if (!this.client) {
      const now = Date.now();
      for (const [k, t] of this._ttl) if (t < now) this._ttl.delete(k);
    }
  }
}

module.exports = { RedisNonceStore };
