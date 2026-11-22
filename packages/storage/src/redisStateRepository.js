// RedisStateRepository — persistent conversation state for multi-process deployments.
//
// Phase 2 Sprint 4 — brought to PARITY with MemoryStateRepository:
//   • withLock(conversationId, fn) — distributed per-conversation serialization.
//   • optimistic versioning — save() bumps version N→N+1 and rejects stale
//     writes with err.code === 'STALE_STATE', exactly like the memory repo.
//   • the saved state (with the new version) is returned, so callers can thread
//     the version forward (the execution engine's C1 fix depends on this).
//
// Why this matters: the original implementation was a bare SET/GET. With two
// API processes (or two concurrent requests in one process), the loser of a
// race would clobber the winner — a customer's turn could be lost. The memory
// repo solved this with an in-process promise-chain mutex + version check; the
// Redis repo needed the equivalent at the data-store level.
//
// Concurrency model:
//   • withLock uses Redis WATCH + MULTI to implement an atomic compare-and-set
//     on the state's version field. If a concurrent writer changed the value
//     between our WATCH and our EXEC, MULTI/EXEC aborts (returns null) and we
//     retry the whole read-modify-write up to `lockRetries` times. This is the
//     standard Redis optimistic-locking pattern and gives the same guarantee as
//     the in-process mutex, but across processes.
//   • save() calls withLock internally so every write is serialized per
//     conversation — the same contract the memory repo exposes.
//   • A short per-conversation hold-off (a SET NX with a short TTL) prevents
//     two processes from both spinning on WATCH at the exact same instant,
//     reducing retry storms under contention. This is advisory, not a hard
//     lock — the WATCH/MULTI CAS is the source of truth.
class RedisStateRepository {
  constructor({
    url,
    client = null,
    prefix = "nova:conversation:",
    ttlSeconds = 86400 * 7,
    logger = null,
    lockRetries = 8,
    lockBackoffMs = 5,
    advisoryLockTtlMs = 2000
  } = {}) {
    this.url = url;
    this.client = client;
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;
    this.logger = logger;
    this.ownsClient = !client;
    this.lockRetries = lockRetries;
    this.lockBackoffMs = lockBackoffMs;
    this.advisoryLockTtlMs = advisoryLockTtlMs;
    // In-process locks: within a single process, the promise-chain mutex from
    // MemoryStateRepository still applies (avoids spawning N concurrent CAS
    // loops for N rapid same-process writes). Cross-process safety is the
    // WATCH/MULTI CAS below.
    this._locks = new Map();
  }

  key(conversationId) { return `${this.prefix}${conversationId}`; }
  lockKey(conversationId) { return `${this.prefix}lock:${conversationId}`; }

  async connect() {
    if (this.client) return this;
    if (!this.url) throw new Error("REDIS_URL is required when NOVA_STORAGE_MODE=persistent");
    let createClient;
    try { ({ createClient } = require("redis")); }
    catch { throw new Error("Persistent conversation state requires the 'redis' package. Run npm install."); }
    this.client = createClient({ url: this.url });
    this.client.on?.("error", (error) => this.logger?.error("storage.redis.error", { error: error.message }));
    await this.client.connect();
    this.logger?.info("storage.redis.connected");
    return this;
  }

  /**
   * Per-conversation serialization — mirrors MemoryStateRepository.withLock.
   * Chains a process-local promise mutex (so same-process rapid writes don't
   * all hit Redis at once) AND a Redis WATCH/MULTI optimistic CAS (so cross-
   * process writers can't clobber each other). fn may return a value; it is
   * returned to the caller.
   */
  async withLock(conversationId, fn) {
    // Process-local mutex: chain onto the previous holder's tail.
    const prev = this._locks.get(conversationId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prev.then(() => gate);
    this._locks.set(conversationId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this._locks.get(conversationId) === tail) {
        this._locks.delete(conversationId);
      }
    }
  }

  /**
   * Atomic compare-and-set on the version field. Returns the saved state
   * (with the new version + updatedAt), or throws STALE_STATE if a concurrent
   * writer beat us. Mirrors MemoryStateRepository.save's versioning contract.
   *
   * Uses Redis WATCH/MULTI:
   *   1. Acquire a short advisory hold-off (SET NX PX) to reduce contention.
   *   2. WATCH the key; GET the current value.
   *   3. If existing.version > state.version → STALE_STATE (another writer is
   *      ahead of us; the caller's read is stale).
   *   4. Build next (bump version, set updatedAt), MULTI/SET/EXEC. If EXEC
   *      returns null (key changed between WATCH and EXEC — a concurrent
   *      writer landed), retry the whole loop up to lockRetries times.
   *   5. On retry exhaustion, throw STALE_STATE (same as if we'd detected a
   *      stale version) so the execution engine's existing retry path handles
   *      it uniformly.
   */
  async _casSave(state) {
    if (!this.client) await this.connect();
    const key = this.key(state.conversationId);
    const lockKey = this.lockKey(state.conversationId);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < this.lockRetries; attempt++) {
      // Advisory hold-off: reduces the chance two processes WATCH at the same
      // instant and both retry. Best-effort — if it fails (someone else holds
      // it) we back off and retry. NX = only set if not exists; PX = ms TTL.
      const acquired = await this.client.set(lockKey, "1", { NX: true, PX: this.advisoryLockTtlMs }).catch(() => null);
      try {
        await this.client.watch(key);
        const raw = await this.client.get(key);
        const existing = raw ? JSON.parse(raw) : null;
        // Optimistic version check — same rule as the memory repo.
        if (existing?.version != null && state.version != null && state.version < existing.version) {
          const err = new Error("Stale state — another update has been applied since you read this.");
          err.code = "STALE_STATE";
          throw err;
        }
        const next = {
          ...structuredClone(state),
          version: (existing?.version || 0) + 1,
          updatedAt: new Date().toISOString()
        };
        const multi = this.client.multi();
        multi.set(key, JSON.stringify(next), { EX: this.ttlSeconds });
        const results = await multi.exec();
        // EXEC returns null when a watched key was modified between WATCH and EXEC.
        if (results === null) {
          // A concurrent writer landed. Back off and retry the CAS.
          this.logger?.warn("storage.redis.cas_retry", { conversationId: state.conversationId, attempt: attempt + 1 });
          await sleep(this.lockBackoffMs * (attempt + 1));
          continue;
        }
        return structuredClone(next);
      } finally {
        // Release the advisory hold-off (best-effort; TTL is the backstop).
        await this.client.del(lockKey).catch(() => {});
        // UNWATCH clears the watch so the next iteration's WATCH is clean.
        await this.client.unwatch().catch(() => {});
      }
    }
    // Retry exhaustion → treat as stale so the execution engine retries uniformly.
    const err = new Error("Stale state — another update has been applied since you read this.");
    err.code = "STALE_STATE";
    throw err;
  }

  async get(conversationId) {
    if (!this.client) await this.connect();
    const raw = await this.client.get(this.key(conversationId));
    return raw ? JSON.parse(raw) : null;
  }

  async save(state) {
    if (!state?.conversationId) throw new Error("state.conversationId is required");
    // Serialize per-conversation (in-process) + atomic CAS (cross-process).
    return this.withLock(state.conversationId, () => this._casSave(state));
  }

  async delete(conversationId) {
    if (!this.client) await this.connect();
    return this.withLock(conversationId, async () => {
      const ok = (await this.client.del(this.key(conversationId))) > 0;
      await this.client.del(this.lockKey(conversationId)).catch(() => {});
      return ok;
    });
  }

  async clear() {
    if (!this.client) await this.connect();
    let cursor = "0";
    do {
      const result = await this.client.scan(cursor, { MATCH: `${this.prefix}*`, COUNT: 200 });
      cursor = String(result.cursor);
      if (result.keys?.length) await this.client.del(result.keys);
    } while (cursor !== "0");
  }

  async close() {
    if (this.client && this.ownsClient) await this.client.quit();
  }
}
module.exports = { RedisStateRepository };
