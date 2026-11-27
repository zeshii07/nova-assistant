// v73.0 — Redis-backed WhatsApp message dedup (production), with in-memory fallback.
//
// Why: the original ProcessedMessageStore keeps processed message-ids in a
// process-local Map. A server restart — or a retried webhook landing on a
// different instance — causes the SAME WhatsApp message to be processed
// twice: the customer gets two replies, two orders, two bookings. This is the
// exact "data lost on restart" symptom for the WhatsApp channel.
//
// This store implements has()/add() over Redis (SET NX EX = atomic insert with
// TTL, so two concurrent retried webhooks on different instances can't both
// win), with an in-memory Map fallback when no client is configured (dev +
// tests). The API is async (returns Promises) to match the Redis client; the
// webhook handler awaits both calls.
//
// Redis commands used:
//   SET key "1" NX EX ttl   — add(): atomic insert-if-absent with expiry
//   EXISTS key              — has(): check without consuming
//   (TTL auto-expires entries; cleanup() is a no-op for Redis)

/** @typedef {Object} RedisLikeClient */
class RedisProcessedMessageStore {
  /**
   * @param {object} opts
   * @param {RedisLikeClient|null} [opts.client=null] Connected redis client. null → in-memory fallback.
   * @param {number} [opts.ttlMs=24*60*60*1000] Dedup window (WhatsApp retries within 24h).
   * @param {string} [opts.prefix='nova:whatsapp:seen:'] Key prefix.
   * @param {object} [opts.logger=null]
   * @param {()=>number} [opts.now=Date.now] Injected clock for tests (in-memory path only).
   */
  constructor({ client = null, ttlMs = 24 * 60 * 60 * 1000, prefix = "nova:whatsapp:seen:", logger = null, now = () => Date.now() } = {}) {
    this.client = client;
    this.ttlMs = ttlMs;
    this.prefix = prefix;
    this.logger = logger;
    this.now = now;
    // In-memory fallback (mirrors the original ProcessedMessageStore).
    this.records = new Map();
  }

  _key(messageId) { return `${this.prefix}${messageId}`; }

  /**
   * Has this message-id been processed within the dedup window?
   * @param {string} messageId
   * @returns {Promise<boolean>}
   */
  async has(messageId) {
    if (!this.client) {
      this._cleanup();
      return this.records.has(messageId);
    }
    try {
      const n = await this.client.exists(this._key(messageId));
      return n > 0;
    } catch (e) {
      this.logger?.error?.("whatsapp.dedup.has_failed", { messageId, error: e.message });
      // Fail OPEN on read errors: a false negative risks duplicate processing,
      // but a false positive (claiming seen) would silently drop a real
      // message. Duplicate processing is recoverable; a dropped customer
      // message is not. The idempotency layer in execution-engine + commerce
      // repo is the second line of defense.
      return false;
    }
  }

  /**
   * Mark a message-id as processed. Atomic across instances via SET NX.
   * Returns true if THIS call won the insert race (i.e. the message was
   * previously unseen), false if it was already present.
   * @param {string} messageId
   * @returns {Promise<boolean>}
   */
  async add(messageId) {
    if (!this.client) {
      this._cleanup();
      const wasPresent = this.records.has(messageId);
      this.records.set(messageId, this.now() + this.ttlMs);
      return !wasPresent;
    }
    try {
      const ttlSec = Math.max(1, Math.ceil(this.ttlMs / 1000));
      // SET NX EX: only sets if absent. Returns "OK" on success, null if the
      // key already existed. This makes the check-then-process window atomic
      // across processes — two retried webhooks cannot both see "not present".
      const res = await this.client.set(this._key(messageId), "1", { NX: true, EX: ttlSec });
      return res != null;
    } catch (e) {
      this.logger?.error?.("whatsapp.dedup.add_failed", { messageId, error: e.message });
      // Fail OPEN: if we can't record, assume not-yet-seen so the message is
      // processed (idempotency layer guards against duplicate side effects).
      return false;
    }
  }

  /** Prune expired entries. No-op for Redis (TTL handles expiry). */
  cleanup() {
    if (!this.client) this._cleanup();
  }
  _cleanup() {
    const now = this.now();
    for (const [id, expiresAt] of this.records) if (expiresAt <= now) this.records.delete(id);
  }
}

module.exports = { RedisProcessedMessageStore };
