// v35.3: MemoryStateRepository with per-conversation locks.
// Prevents race conditions when two concurrent requests update the same
// conversation state (e.g. customer sends two messages in quick succession
// while an owner takeover is also being applied).
const { LocalJsonFile } = require('../../storage/src/localJsonFile');
const { atomicWriteJson, readJsonSync } = require('../../storage/src/atomicWrite');

class MemoryStateRepository {
  constructor({ snapshotFile = null } = {}) {
    this.snapshotFile = snapshotFile;
    // v35.3: read snapshot with atomic-write helper (no partial reads)
    if (snapshotFile) {
      this.snapshot = { states: readJsonSync(snapshotFile, { states: {} })?.states || {} };
    } else {
      this.snapshot = { states: {} };
    }
    this.states = new Map(Object.entries(this.snapshot.states));
    // v35.3: in-process locks keyed by conversationId
    this._locks = new Map();
    // v35.3: bounded cache — evict conversations older than 24h
    this._maxStates = 10000;
    this._ttlMs = 24 * 60 * 60 * 1000;
    this._gc();
  }

  _gc() {
    const now = Date.now();
    let evicted = 0;
    for (const [id, state] of this.states) {
      const ts = state?.updatedAt ? new Date(state.updatedAt).getTime() : 0;
      if (ts && now - ts > this._ttlMs) {
        this.states.delete(id);
        evicted++;
      }
    }
    // Hard cap: if still over limit, evict oldest
    if (this.states.size > this._maxStates) {
      const sorted = [...this.states.entries()]
        .sort((a, b) => {
          const ta = a[1]?.updatedAt ? new Date(a[1].updatedAt).getTime() : 0;
          const tb = b[1]?.updatedAt ? new Date(b[1].updatedAt).getTime() : 0;
          return ta - tb;
        });
      while (this.states.size > this._maxStates) {
        const [id] = sorted.shift();
        this.states.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  persist() {
    if (!this.snapshotFile) return;
    try {
      atomicWriteJson(this.snapshotFile, { states: Object.fromEntries(this.states) }, { pretty: false });
    } catch (err) {
      // Persistence failure shouldn't crash the server — log and continue
      console.warn('MemoryStateRepository.persist failed:', err.message);
    }
  }

  /**
   * v35.3: Acquire a sequential lock for a conversation. Releases
   * automatically after the callback completes.
   */
  async withLock(conversationId, fn) {
    while (this._locks.has(conversationId)) {
      await this._locks.get(conversationId);
    }
    const promise = (async () => {
      try { return await fn(); }
      finally { this._locks.delete(conversationId); }
    })();
    this._locks.set(conversationId, promise.catch(() => {}));
    return promise;
  }

  async get(conversationId) {
    const value = this.states.get(conversationId);
    return value ? structuredClone(value) : null;
  }

  async save(state) {
    return this.withLock(state.conversationId, () => {
      // v35.3: optimistic versioning — reject stale writes
      const existing = this.states.get(state.conversationId);
      if (existing?.version && state.version && state.version < existing.version) {
        const err = new Error('Stale state — another update has been applied since you read this.');
        err.code = 'STALE_STATE';
        throw err;
      }
      // Bump version + timestamp
      const next = {
        ...structuredClone(state),
        version: (existing?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      this.states.set(state.conversationId, next);
      // Periodic GC
      if (this.states.size % 100 === 0) this._gc();
      this.persist();
      return structuredClone(next);
    });
  }

  async delete(conversationId) {
    return this.withLock(conversationId, () => {
      const ok = this.states.delete(conversationId);
      this.persist();
      return ok;
    });
  }

  async clear() {
    this.states.clear();
    this._locks.clear();
    this.persist();
  }
}

module.exports = { MemoryStateRepository };
