// v35.3: Bounded in-memory replay repository with TTL + max-items cap.
// Previous version grew unbounded — every chat message added an entry that
// was never evicted, causing memory growth in long-running processes.
// Now: entries older than 7 days are evicted on save, and the map is capped
// at 5000 entries (FIFO eviction when exceeded).
const { createFileReplayRepository } = require('./fileReplayRepository');
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 5000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class InMemoryReplayRepository {
  constructor({ persistDir = null, logger = null } = {}) {
    this.items = new Map();
    this.byConversation = new Map();
    this.logger = logger;
    // v35.3: optional file-based persistence so conversations survive restarts.
    // When persistDir is set, the repository delegates save/list to a file-backed
    // implementation while keeping the in-memory cache for fast lookups.
    this.persistDir = persistDir;
    this.fileRepo = persistDir ? createFileReplayRepository({ dir: persistDir, logger }) : null;
    this._hydrated = false;
  }

  async _hydrate() {
    if (this._hydrated || !this.fileRepo) return;
    this._hydrated = true;
    try {
      const records = await this.fileRepo.list({ limit: MAX_ITEMS });
      for (const r of records) {
        this.items.set(r.id, clone(r));
        const arr = this.byConversation.get(r.conversationId) || [];
        arr.push(r.id);
        this.byConversation.set(r.conversationId, arr);
      }
      this.logger?.info?.('replay_repository.hydrated', { count: this.items.size });
    } catch (err) {
      this.logger?.warn?.('replay_repository.hydrate_failed', { error: err.message });
    }
  }

  async save(record) {
    if (this.fileRepo) {
      await this._hydrate();
      try { await this.fileRepo.save(record); } catch (err) {
        this.logger?.warn?.('replay_repository.persist_failed', { error: err.message });
      }
    }
    // v35.3: GC expired entries before adding new ones
    if (this.items.size > 100) this._gc();
    this.items.set(record.id, clone(record));
    const arr = this.byConversation.get(record.conversationId) || [];
    arr.push(record.id);
    this.byConversation.set(record.conversationId, arr);
    // v35.3: cap at MAX_ITEMS — evict oldest entries (FIFO)
    if (this.items.size > MAX_ITEMS) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
      // Also remove from byConversation index
      for (const [cid, ids] of this.byConversation) {
        const idx = ids.indexOf(oldest);
        if (idx !== -1) {
          ids.splice(idx, 1);
          if (ids.length === 0) this.byConversation.delete(cid);
          break;
        }
      }
    }
    return clone(record);
  }

  _gc() {
    const now = Date.now();
    let evicted = 0;
    for (const [id, record] of this.items) {
      const ts = record.createdAt ? new Date(record.createdAt).getTime() : 0;
      if (ts && now - ts > TTL_MS) {
        this.items.delete(id);
        evicted++;
      }
    }
    if (evicted > 0) this.logger?.info?.('replay_repository.gc', { evicted, remaining: this.items.size });
  }

  async get(id) {
    if (this.fileRepo) await this._hydrate();
    return clone(this.items.get(id) || null);
  }

  async list({ conversationId = null, limit = 50 } = {}) {
    if (this.fileRepo) await this._hydrate();
    let values;
    if (conversationId) {
      values = (this.byConversation.get(conversationId) || [])
        .map(id => this.items.get(id))
        .filter(Boolean);
    } else {
      values = [...this.items.values()];
    }
    return values
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit)
      .map(clone);
  }

  async clear() {
    this.items.clear();
    this.byConversation.clear();
    if (this.fileRepo) await this.fileRepo.clear();
  }
}

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

module.exports = { InMemoryReplayRepository };
