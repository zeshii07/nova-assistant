/**
 * v31.0 — File-based repository for Google Calendar OAuth tokens.
 * Stores per-tenant tokens at .nova-calendar-tokens/{tenantId}.json
 * No database required; tokens persist across restarts.
 *
 * Tokens contain: accessToken, refreshToken, expiresAt, scope.
 * The refresh_token never expires (unless revoked by the user),
 * so we only need to store it once.
 */
const fs = require('fs');
const path = require('path');

class FileCalendarTokenRepository {
  constructor({ storageDir, logger = null } = {}) {
    this.storageDir = storageDir || path.resolve(process.cwd(), '.nova-calendar-tokens');
    this.logger = logger;
    this._ensureStorageDir();
  }

  _ensureStorageDir() {
    try { fs.mkdirSync(this.storageDir, { recursive: true }); }
    catch (error) { this.logger?.warn?.('calendar_token.storage_dir_failed', { error: error.message }); }
  }

  _filePath(tenantId) {
    return path.join(this.storageDir, `${tenantId}.json`);
  }

  save(tenantId, tokens) {
    const data = {
      tenantId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scope: tokens.scope,
      tokenType: tokens.token_type,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(this._filePath(tenantId), JSON.stringify(data, null, 2), 'utf8');
    this.logger?.info?.('calendar_token.saved', { tenantId });
    return data;
  }

  load(tenantId) {
    try {
      const filePath = this._filePath(tenantId);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch { return null; }
  }

  delete(tenantId) {
    try {
      const filePath = this._filePath(tenantId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      this.logger?.info?.('calendar_token.deleted', { tenantId });
      return true;
    } catch { return false; }
  }

  exists(tenantId) {
    return fs.existsSync(this._filePath(tenantId));
  }
}

module.exports = { FileCalendarTokenRepository };
