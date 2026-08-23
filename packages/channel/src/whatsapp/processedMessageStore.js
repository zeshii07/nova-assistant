/** In-memory idempotency store. Replace with Redis before multi-instance deployment. */
class ProcessedMessageStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.records = new Map();
  }
  has(messageId) {
    this.cleanup();
    return this.records.has(messageId);
  }
  add(messageId) {
    this.cleanup();
    this.records.set(messageId, this.now() + this.ttlMs);
  }
  cleanup() {
    const now = this.now();
    for (const [id, expiresAt] of this.records) if (expiresAt <= now) this.records.delete(id);
  }
}
module.exports = { ProcessedMessageStore };
