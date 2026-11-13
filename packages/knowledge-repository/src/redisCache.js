/**
 * v58.0 — Redis Cache with Pub/Sub Invalidation
 *
 * Per-tenant LRU cache backed by Redis. When any instance invalidates a tenant's
 * cache, it publishes to 'knowledge:invalidate:{tenantId}' and every subscriber
 * drops their in-memory copy.
 *
 * Spec reference: §10 (Redis), migration safeguard §10
 *
 * Degradation: when no Redis client is wired, this cache uses an in-process Map.
 * clearCache() still works, but invalidation does NOT cross instances. This is
 * the single-node default and the operator must configure Redis before enabling
 * horizontal scaling.
 *
 * Spec safeguard (§10): "Do not rely only on process-local clearCache() in a
 * multi-instance deployment." This component is the implementation of that rule.
 */

const CHANNEL_PREFIX = 'knowledge:invalidate:';
const DEFAULT_TTL_SECONDS = 300; // 5 minutes — stale reads self-heal on TTL expiry

class RedisCache {
  constructor({ redisClient = null, logger = null, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
    this.redis = redisClient; // ioredis or node-redis compatible
    this.logger = logger;
    this.ttlSeconds = ttlSeconds;
    this.local = new Map(); // fallback in-process cache
    this.subscribed = new Set(); // channels already subscribed on this client
  }

  /**
   * Get a cached value for a tenant+key.
   */
  async get(tenantId, key) {
    const fullKey = this._key(tenantId, key);
    if (this.redis) {
      const raw = await this.redis.get(fullKey);
      return raw ? JSON.parse(raw) : null;
    }
    const entry = this.local.get(fullKey);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.local.delete(fullKey);
      return null;
    }
    return entry.value;
  }

  /**
   * Set a cached value with TTL.
   */
  async set(tenantId, key, value) {
    const fullKey = this._key(tenantId, key);
    if (this.redis) {
      await this.redis.set(fullKey, JSON.stringify(value), 'EX', this.ttlSeconds);
      return;
    }
    this.local.set(fullKey, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  /**
   * Invalidate a tenant's cache. When Redis is configured, publishes to the
   * tenant's invalidation channel so every instance drops its copy.
   */
  async invalidate(tenantId, key = null) {
    if (key) {
      const fullKey = this._key(tenantId, key);
      if (this.redis) await this.redis.del(fullKey);
      else this.local.delete(fullKey);
    } else {
      // Invalidate the whole tenant namespace.
      if (this.redis) {
        const pattern = `nova:knowledge:${tenantId}:*`;
        // SCAN + DEL to avoid blocking on large keyspaces.
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = next;
          if (keys.length) await this.redis.del(...keys);
        } while (cursor !== '0');
      } else {
        for (const k of [...this.local.keys()]) {
          if (k.startsWith(`nova:knowledge:${tenantId}:`)) this.local.delete(k);
        }
      }
    }
    // Publish to the invalidation channel (no-op without Redis).
    if (this.redis) {
      try {
        await this.redis.publish(CHANNEL_PREFIX + tenantId, JSON.stringify({ tenantId, key, at: new Date().toISOString() }));
      } catch (err) {
        this.logger?.warn?.('redisCache.publish_failed', { tenantId, error: err.message });
      }
    }
  }

  /**
   * Subscribe to invalidation events for a tenant. On event, drop the local copy.
   */
  async subscribe(tenantId) {
    if (!this.redis) return; // no-op in single-node mode
    const channel = CHANNEL_PREFIX + tenantId;
    if (this.subscribed.has(channel)) return;
    this.subscribed.add(channel);
    await this.redis.subscribe(channel);
    this.redis.on('message', (ch, payload) => {
      if (ch !== channel) return;
      try {
        const evt = JSON.parse(payload);
        if (evt.key) {
          this.local.delete(this._key(evt.tenantId, evt.key));
        } else {
          for (const k of [...this.local.keys()]) {
            if (k.startsWith(`nova:knowledge:${evt.tenantId}:`)) this.local.delete(k);
          }
        }
      } catch {
        // malformed payload — ignore
      }
    });
  }

  _key(tenantId, key) {
    return `nova:knowledge:${tenantId}:${key}`;
  }
}

module.exports = { RedisCache, CHANNEL_PREFIX, DEFAULT_TTL_SECONDS };
