/**
 * v30.0 — Notification Service
 * Listens to business events, formats emails using templates,
 * sends via EmailService, logs to FileNotificationLogRepository.
 *
 * Subscribes to:
 *   - booking.confirmed.v1   → booking_confirmed email
 *   - offering.order.created.v1 → order_placed email
 *   - lead.converted.v1      → lead_captured email
 *   - handoff.requested.v1   → handoff_requested email
 *
 * Reads per-tenant notification preferences from tenantRepository.
 * Respects quiet hours (queues for next morning if configured).
 */
const crypto = require('crypto');

class NotificationService {
  constructor({ emailService, notificationLogRepository, tenantRepository, leadService = null, eventBus = null, logger = null }) {
    this.emailService = emailService;
    this.notificationLog = notificationLogRepository;
    this.tenantRepository = tenantRepository;
    this.leadService = leadService;
    this.eventBus = eventBus;
    this.logger = logger;
    this._subscribe();
  }

  _subscribe() {
    if (!this.eventBus) return;
    this.eventBus.subscribe('booking.confirmed.v1', (event) => this._handleBookingConfirmed(event));
    this.eventBus.subscribe('offering.order.created.v1', (event) => this._handleOrderCreated(event));
    this.eventBus.subscribe('lead.converted.v1', (event) => this._handleLeadConverted(event));
    this.eventBus.subscribe('handoff.requested.v1', (event) => this._handleHandoff(event));
    this.logger?.info?.('notification_service.subscribed', { events: ['booking.confirmed.v1', 'offering.order.created.v1', 'lead.converted.v1', 'handoff.requested.v1'] });
  }

  _getTenantPreferences(tenantId) {
    try {
      const profile = this.tenantRepository.getById(tenantId);
      return profile?.notifications || this._defaultPreferences();
    } catch { return this._defaultPreferences(); }
  }

  _defaultPreferences() {
    return {
      enabled: true,
      recipientEmails: [],
      events: {
        booking_confirmed: true,
        order_placed: true,
        lead_captured: true,
        handoff_requested: true,
        nova_failed: true
      },
      quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
      dailyDigest: { enabled: false, sendAt: '09:00' }
    };
  }

  _isInQuietHours(prefs) {
    if (!prefs.quietHours?.enabled) return false;
    const now = new Date();
    // Simple check: compare hour:minute to start/end (UTC; tz config is for future expansion)
    const [startH, startM] = (prefs.quietHours.start || '22:00').split(':').map(Number);
    const [endH, endM] = (prefs.quietHours.end || '07:00').split(':').map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    // Handle overnight window (e.g., 22:00 → 07:00)
    if (startMinutes > endMinutes) {
      return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  async _sendNotification({ tenantId, eventType, data, template }) {
    if (!template) {
      this.logger?.warn?.('notification.no_template', { tenantId, eventType });
      return null;
    }

    const prefs = this._getTenantPreferences(tenantId);
    if (!prefs.enabled) return null;
    if (!prefs.events?.[eventType]) return null;

    // Build notification record
    const notificationId = `NOT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const tenantProfile = (() => { try { return this.tenantRepository.getById(tenantId); } catch { return null; } })();
    const tenantName = tenantProfile?.name || tenantId;
    const enrichedData = { ...data, tenantId, tenantName };

    const notification = {
      id: notificationId,
      tenantId,
      eventType,
      createdAt: new Date().toISOString(),
      readAt: null,
      subject: template.subject(enrichedData),
      preview: template.text(enrichedData).slice(0, 200),
      data: enrichedData,
      email: { recipients: prefs.recipientEmails || [], sent: false, error: null, devMode: false, queued: false }
    };

    // If quiet hours, queue for later (we just log it; a cron would process the queue)
    if (this._isInQuietHours(prefs)) {
      notification.email.queued = true;
      this.logger?.info?.('notification.queued_quiet_hours', { tenantId, eventType, notificationId });
    } else if (prefs.recipientEmails.length > 0) {
      // Send email
      const result = await this.emailService.send({
        to: prefs.recipientEmails,
        subject: template.subject(enrichedData),
        html: template.html(enrichedData),
        text: template.text(enrichedData)
      });
      notification.email.sent = result.ok;
      notification.email.error = result.ok ? null : result.error;
      notification.email.devMode = !!result.dev;
      notification.email.messageId = result.messageId || null;
      if (result.ok && !result.dev) {
        this.logger?.info?.('notification.email_sent', { tenantId, eventType, notificationId, recipients: prefs.recipientEmails });
      } else if (result.dev) {
        this.logger?.info?.('notification.email_dev_mode', { tenantId, eventType, notificationId });
      }
    } else {
      // No recipients configured — log only
      notification.email.error = 'No recipient emails configured';
    }

    // Persist notification
    await this.notificationLog.append(tenantId, notification);
    return notification;
  }

  async _handleBookingConfirmed(event) {
    const { getTemplate } = require('./emailTemplates');
    const template = getTemplate('booking_confirmed');
    const data = event.payload || {};
    // Enrich with customer name if possible
    const enrichedData = {
      ...data,
      serviceName: data.serviceName || data.service || data.itemName || 'Booking',
      date: data.date || (data.slots && data.slots[0] ? data.slots[0].date : null),
      time: data.time || (data.slots && data.slots[0] ? data.slots[0].startTime : null),
      price: data.price || data.total || null,
      currency: data.currency || 'AED',
      customerName: data.customerName || data.customer?.name || null,
      customerPhone: data.customerPhone || data.customer?.phone || null,
      customerEmail: data.customerEmail || data.customer?.email || null
    };
    await this._sendNotification({ tenantId: data.tenantId, eventType: 'booking_confirmed', data: enrichedData, template });
  }

  async _handleOrderCreated(event) {
    const { getTemplate } = require('./emailTemplates');
    const template = getTemplate('order_placed');
    const data = event.payload || {};
    const enrichedData = {
      ...data,
      orderId: data.id || data.orderId,
      itemName: data.itemName || data.serviceName || 'Item',
      total: data.total || data.price,
      currency: data.currency || 'PKR',
      quantity: data.quantity || 1,
      customerName: data.customerName || null,
      customerPhone: data.customerPhone || null,
      deliveryAddress: data.deliveryAddress || data.address || null
    };
    await this._sendNotification({ tenantId: data.tenantId, eventType: 'order_placed', data: enrichedData, template });
  }

  async _handleLeadConverted(event) {
    const { getTemplate } = require('./emailTemplates');
    const template = getTemplate('lead_captured');
    const data = event.payload || {};
    // Try to enrich with lead details
    let leadData = {};
    try {
      if (this.leadService && data.leadId) {
        const lead = await this.leadService.get(data.tenantId, data.leadId);
        if (lead) {
          leadData = {
            customerName: lead.contact?.name || lead.customerId,
            customerPhone: lead.contact?.phone,
            customerEmail: lead.contact?.email,
            score: lead.score,
            grade: lead.grade,
            interests: (lead.interests || []).map(i => i.value).join(', '),
            message: lead.firstMessage,
            channel: lead.channel
          };
        }
      }
    } catch (error) {
      this.logger?.warn?.('notification.lead_enrichment_failed', { leadId: data.leadId, error: error.message });
    }
    const enrichedData = { ...data, ...leadData, leadId: data.leadId };
    await this._sendNotification({ tenantId: data.tenantId, eventType: 'lead_captured', data: enrichedData, template });
  }

  async _handleHandoff(event) {
    const { getTemplate } = require('./emailTemplates');
    const template = getTemplate('handoff_requested');
    const data = event.payload || {};
    await this._sendNotification({ tenantId: data.tenantId, eventType: 'handoff_requested', data, template });
  }

  // ─── Public API for dashboard ─────────────────────────────────────
  async listNotifications(tenantId, options = {}) {
    return this.notificationLog.list(tenantId, options);
  }
  async markRead(tenantId, notificationId) {
    return this.notificationLog.markRead(tenantId, notificationId);
  }
  async markAllRead(tenantId) {
    return this.notificationLog.markAllRead(tenantId);
  }
  async unreadCount(tenantId) {
    return this.notificationLog.unreadCount(tenantId);
  }
  getPreferences(tenantId) {
    return this._getTenantPreferences(tenantId);
  }
  updatePreferences(tenantId, prefs) {
    // Persist back to tenant profile.json (handled by caller)
    return prefs;
  }
}

module.exports = { NotificationService };
