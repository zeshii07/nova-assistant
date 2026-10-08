/**
 * Nova Concurrency Control (v26.0)
 *
 * Provides three production-safety mechanisms:
 *
 * 1. DistributedLock — Redis-based distributed locks for calendar slots
 *    Prevents two users from booking the same time slot simultaneously.
 *    Uses Redis SET NX EX (atomic set-if-not-exists with TTL).
 *
 * 2. OptimisticVersioning — Prevents lost updates when concurrent messages
 *    modify the same conversation state. Each state has a version number;
 *    save only succeeds if the version matches.
 *
 * 3. IdempotencyGuard — Prevents duplicate processing of retried webhooks.
 *    Uses a UNIQUE constraint on (provider, provider_event_id).
 *
 * All three mechanisms have graceful fallbacks when Redis is not available:
 * - DistributedLock falls back to in-memory Map (single-instance only)
 * - OptimisticVersioning falls back to in-memory version counter
 * - IdempotencyGuard falls back to in-memory Set
 *
 * Design principle: "Never block the conversation." If a lock fails,
 * the system continues with a best-effort approach and logs a warning.
 */

// === 1. Distributed Lock ===

class DistributedLock {
  /**
   * @param {object} options
   * @param {object} options.redisClient - Redis client (or null for in-memory)
   * @param {object} options.logger
   * @param {number} options.defaultTtl - Default TTL in seconds (default: 900 = 15 min)
   */
  constructor({ redisClient = null, logger = null, defaultTtl = 900 } = {}) {
    this.redis = redisClient;
    this.logger = logger;
    this.defaultTtl = defaultTtl;
    this._memoryLocks = new Map(); // Fallback for in-memory mode
  }

  /**
   * Acquire a distributed lock.
   *
   * @param {string} key - Lock key (e.g., "slot:cleaning-demo:2026-09-21:10:00")
   * @param {string} ownerId - Who holds the lock (e.g., customerId)
   * @param {number} ttl - TTL in seconds
   * @returns {Promise<{acquired: boolean, lockId: string|null}>}
   */
  async acquire(key, ownerId, ttl = this.defaultTtl) {
    const lockKey = `nova:lock:${key}`;
    const lockId = `${ownerId}:${Date.now()}`;

    if (this.redis) {
      try {
        // Atomic SET NX EX: set only if key doesn't exist, with TTL
        const result = await this.redis.set(lockKey, lockId, 'NX', 'EX', ttl);
        if (result === 'OK') {
          return { acquired: true, lockId };
        }
        return { acquired: false, lockId: null };
      } catch (error) {
        this.logger?.warn?.('distributed_lock.redis_failed', { key, error: error.message });
        // Fall through to in-memory
      }
    }

    // In-memory fallback (single-instance only)
    const existing = this._memoryLocks.get(lockKey);
    if (existing && Date.now() < existing.expiresAt) {
      return { acquired: false, lockId: null };
    }
    this._memoryLocks.set(lockKey, { lockId, expiresAt: Date.now() + ttl * 1000 });
    return { acquired: true, lockId };
  }

  /**
   * Release a distributed lock.
   *
   * @param {string} key - Lock key
   * @param {string} lockId - The lock ID returned by acquire()
   * @returns {Promise<boolean>} True if released, false if not held
   */
  async release(key, lockId) {
    const lockKey = `nova:lock:${key}`;

    if (this.redis) {
      try {
        // Use a Lua script to ensure we only delete if we own the lock
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await this.redis.eval(script, 1, lockKey, lockId);
        return result === 1;
      } catch (error) {
        this.logger?.warn?.('distributed_lock.release_failed', { key, error: error.message });
      }
    }

    // In-memory fallback
    const existing = this._memoryLocks.get(lockKey);
    if (existing && existing.lockId === lockId) {
      this._memoryLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  /**
   * Check if a lock is held.
   *
   * @param {string} key - Lock key
   * @returns {Promise<boolean>}
   */
  async isLocked(key) {
    const lockKey = `nova:lock:${key}`;

    if (this.redis) {
      try {
        const result = await this.redis.get(lockKey);
        return result !== null;
      } catch (error) {
        this.logger?.warn?.('distributed_lock.check_failed', { key, error: error.message });
      }
    }

    const existing = this._memoryLocks.get(lockKey);
    return existing && Date.now() < existing.expiresAt;
  }

  /**
   * Build a calendar slot lock key.
   *
   * @param {string} tenantId
   * @param {string} date - YYYY-MM-DD format
   * @param {string} time - HH:MM format
   * @returns {string}
   */
  static slotKey(tenantId, date, time) {
    return `slot:${tenantId}:${date}:${time}`;
  }

  /**
   * Build a conversation lock key.
   *
   * @param {string} tenantId
   * @param {string} conversationId
   * @returns {string}
   */
  static conversationKey(tenantId, conversationId) {
    return `conversation:${tenantId}:${conversationId}`;
  }
}


// === 2. Optimistic Versioning ===

class OptimisticVersioning {
  /**
   * @param {object} options
   * @param {object} options.redisClient - Redis client (or null for in-memory)
   * @param {object} options.logger
   */
  constructor({ redisClient = null, logger = null } = {}) {
    this.redis = redisClient;
    this.logger = logger;
    this._memoryVersions = new Map(); // Fallback: conversationId → version
  }

  /**
   * Get the current version for a conversation.
   *
   * @param {string} conversationId
   * @returns {Promise<number>}
   */
  async getVersion(conversationId) {
    const key = `nova:version:${conversationId}`;

    if (this.redis) {
      try {
        const version = await this.redis.get(key);
        return version ? parseInt(version, 10) : 0;
      } catch (error) {
        this.logger?.warn?.('optimistic_versioning.get_failed', { conversationId, error: error.message });
      }
    }

    return this._memoryVersions.get(conversationId) || 0;
  }

  /**
   * Try to save state with optimistic concurrency control.
   * Only succeeds if the version hasn't changed since we read it.
   *
   * @param {string} conversationId
   * @param {number} expectedVersion - The version we read
   * @returns {Promise<{success: boolean, currentVersion: number}>}
   */
  async trySave(conversationId, expectedVersion) {
    const key = `nova:version:${conversationId}`;
    const newVersion = expectedVersion + 1;

    if (this.redis) {
      try {
        // Use a Lua script for atomic check-and-increment
        const script = `
          local current = tonumber(redis.call("get", KEYS[1]) or "0")
          if current == tonumber(ARGV[1]) then
            redis.call("set", KEYS[1], ARGV[2])
            return 1
          else
            return 0
          end
        `;
        const result = await this.redis.eval(script, 1, key, expectedVersion.toString(), newVersion.toString());
        if (result === 1) {
          return { success: true, currentVersion: newVersion };
        }
        // Version mismatch — another request modified the state
        const current = await this.redis.get(key);
        return { success: false, currentVersion: parseInt(current || '0', 10) };
      } catch (error) {
        this.logger?.warn?.('optimistic_versioning.save_failed', { conversationId, error: error.message });
        // Fall through to in-memory
      }
    }

    // In-memory fallback
    const current = this._memoryVersions.get(conversationId) || 0;
    if (current === expectedVersion) {
      this._memoryVersions.set(conversationId, newVersion);
      return { success: true, currentVersion: newVersion };
    }
    return { success: false, currentVersion: current };
  }

  /**
   * Force-set the version (used when creating a new conversation).
   *
   * @param {string} conversationId
   * @param {number} version
   */
  async setVersion(conversationId, version) {
    const key = `nova:version:${conversationId}`;

    if (this.redis) {
      try {
        await this.redis.set(key, version.toString());
        return;
      } catch (error) {
        this.logger?.warn?.('optimistic_versioning.set_failed', { conversationId, error: error.message });
      }
    }

    this._memoryVersions.set(conversationId, version);
  }

  /**
   * Increment the version (used after successful save in fallback mode).
   *
   * @param {string} conversationId
   */
  async increment(conversationId) {
    const key = `nova:version:${conversationId}`;

    if (this.redis) {
      try {
        await this.redis.incr(key);
        return;
      } catch (error) {
        this.logger?.warn?.('optimistic_versioning.increment_failed', { conversationId, error: error.message });
      }
    }

    const current = this._memoryVersions.get(conversationId) || 0;
    this._memoryVersions.set(conversationId, current + 1);
  }
}


// === 3. Idempotency Guard ===

class IdempotencyGuard {
  /**
   * @param {object} options
   * @param {object} options.redisClient - Redis client (or null for in-memory)
   * @param {object} options.logger
   * @param {number} options.ttl - How long to remember processed events (default: 86400 = 24h)
   */
  constructor({ redisClient = null, logger = null, ttl = 86400 } = {}) {
    this.redis = redisClient;
    this.logger = logger;
    this.ttl = ttl;
    this._memorySeen = new Map(); // Fallback: key → timestamp
  }

  /**
   * Check if an event has already been processed.
   * If not, mark it as processed.
   *
   * @param {string} provider - 'whatsapp', 'http', etc.
   * @param {string} eventId - Provider's unique event ID
   * @returns {Promise<{isDuplicate: boolean}>}
   */
  async checkAndMark(provider, eventId) {
    if (!eventId) return { isDuplicate: false };
    const key = `nova:idempotency:${provider}:${eventId}`;

    if (this.redis) {
      try {
        const result = await this.redis.set(key, Date.now().toString(), 'NX', 'EX', this.ttl);
        if (result === 'OK') {
          return { isDuplicate: false };
        }
        // Key already exists — this is a duplicate
        return { isDuplicate: true };
      } catch (error) {
        this.logger?.warn?.('idempotency_guard.redis_failed', { provider, eventId, error: error.message });
      }
    }

    // In-memory fallback
    if (this._memorySeen.has(key)) {
      return { isDuplicate: true };
    }
    this._memorySeen.set(key, Date.now());
    // Clean up old entries (simple TTL — runs on every call)
    if (this._memorySeen.size > 10000) {
      const cutoff = Date.now() - this.ttl * 1000;
      for (const [k, v] of this._memorySeen) {
        if (v < cutoff) this._memorySeen.delete(k);
      }
    }
    return { isDuplicate: false };
  }

  /**
   * Generate a unique event ID from a webhook payload.
   *
   * @param {object} payload - Webhook payload
   * @returns {string|null}
   */
  static extractEventId(payload) {
    // WhatsApp Cloud API: use message ID
    if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id) {
      return payload.entry[0].changes[0].value.messages[0].id;
    }
    // Generic: use a hash of the payload
    if (payload?.event_id) return payload.event_id;
    if (payload?.messageId) return payload.messageId;
    return null;
  }
}

module.exports = { DistributedLock, OptimisticVersioning, IdempotencyGuard };
