/**
 * v30.0 — File-based Notification Log Repository
 * Stores notifications as JSON in .nova-notifications/{tenantId}.json
 * No database required; persists across restarts.
 */
const fs = require('fs');
const path = require('path');

class FileNotificationLogRepository {
  constructor({ storageDir, logger = null } = {}) {
    this.storageDir = storageDir || path.resolve(process.cwd(), '.nova-notifications');
    this.logger = logger;
    this._ensureStorageDir();
  }

  _ensureStorageDir() {
    try { fs.mkdirSync(this.storageDir, { recursive: true }); }
    catch (error) { this.logger?.warn?.('notification_log.storage_dir_failed', { error: error.message }); }
  }

  _filePath(tenantId) {
    return path.join(this.storageDir, `${tenantId}.json`);
  }

  _load(tenantId) {
    try {
      const filePath = this._filePath(tenantId);
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  _save(tenantId, notifications) {
    try {
      const filePath = this._filePath(tenantId);
      fs.writeFileSync(filePath, JSON.stringify(notifications, null, 2), 'utf8');
    } catch (error) {
      this.logger?.warn?.('notification_log.save_failed', { tenantId, error: error.message });
    }
  }

  async append(tenantId, notification) {
    const notifications = this._load(tenantId);
    notifications.push(notification);
    // Cap to last 500 notifications per tenant
    if (notifications.length > 500) notifications.splice(0, notifications.length - 500);
    this._save(tenantId, notifications);
    return notification;
  }

  async list(tenantId, { limit = 100, offset = 0, unreadOnly = false } = {}) {
    const notifications = this._load(tenantId);
    let filtered = unreadOnly ? notifications.filter(n => !n.readAt) : notifications;
    // Newest first
    filtered = filtered.slice().reverse();
    return filtered.slice(offset, offset + limit);
  }

  async markRead(tenantId, notificationId) {
    const notifications = this._load(tenantId);
    const idx = notifications.findIndex(n => n.id === notificationId);
    if (idx === -1) return null;
    notifications[idx].readAt = new Date().toISOString();
    this._save(tenantId, notifications);
    return notifications[idx];
  }

  async markAllRead(tenantId) {
    const notifications = this._load(tenantId);
    const now = new Date().toISOString();
    let count = 0;
    for (const n of notifications) {
      if (!n.readAt) { n.readAt = now; count += 1; }
    }
    this._save(tenantId, notifications);
    return count;
  }

  async unreadCount(tenantId) {
    const notifications = this._load(tenantId);
    return notifications.filter(n => !n.readAt).length;
  }

  async totalCount(tenantId) {
    return this._load(tenantId).length;
  }
}

module.exports = { FileNotificationLogRepository };
