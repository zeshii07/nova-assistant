/**
 * v36.0 — File-existence cache with TTL. Avoids redundant fs.existsSync()
 * calls on hot paths (widget config, voice sample lookup, kiosk load).
 *
 * Why: every /api/widget/config/{tenantId} request does up to 7 fs.existsSync
 * calls to check for voice-profile.json + voice-samples/sample.{ext}. On
 * busy traffic this is 7 disk I/O operations per request × every request.
 * This cache memoizes the result for 60 seconds.
 */
class FileExistenceCache {
  constructor({ ttlMs = 60_000 } = {}) {
    this.ttlMs = ttlMs;
    this.cache = new Map(); // key → { exists, mtime, cachedAt }
  }

  /**
   * Check if a file exists, with caching.
   * @param {string} filePath - absolute path
   * @param {object} fs - require('fs')
   * @returns {boolean}
   */
  exists(filePath, fs) {
    const now = Date.now();
    const cached = this.cache.get(filePath);
    if (cached && now - cached.cachedAt < this.ttlMs) {
      return cached.exists;
    }
    let exists = false;
    try {
      exists = fs.existsSync(filePath);
    } catch {
      exists = false;
    }
    this.cache.set(filePath, { exists, cachedAt: now });
    return exists;
  }

  /**
   * Find the first existing file from a list of candidates, with caching.
   * @param {string[]} filePaths - list of absolute paths to check
   * @param {object} fs - require('fs')
   * @returns {string|null} first existing path, or null
   */
  findFirst(filePaths, fs) {
    for (const p of filePaths) {
      if (this.exists(p, fs)) return p;
    }
    return null;
  }

  /**
   * Invalidate cache for a specific path (call after file is created/deleted).
   */
  invalidate(filePath) {
    this.cache.delete(filePath);
  }

  /**
   * Invalidate all cached entries that start with a prefix (e.g., all voice samples for a tenant).
   */
  invalidatePrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.cache.clear();
  }
}

// Singleton instance — shared across all request handlers
const fileExistenceCache = new FileExistenceCache({ ttlMs: 60_000 });

module.exports = { FileExistenceCache, fileExistenceCache };
