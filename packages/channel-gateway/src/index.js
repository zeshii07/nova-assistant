/**
 * v51.0 — Channel Gateway
 *
 * Unified communication layer that normalizes incoming/outgoing messages across
 * all channels (website, WhatsApp, Instagram, Telegram, voice, kiosk, REST API).
 *
 * Responsibilities:
 *   1. Receive incoming messages from any channel
 *   2. Authenticate channel integrations
 *   3. Normalize incoming messages to a universal format
 *   4. Map channel users to customer identities
 *   5. Handle attachments and media
 *   6. Send outgoing messages via the correct channel
 *   7. Track delivery status
 *   8. Handle provider webhooks
 *
 * Architecture rule: Channels must NEVER own business logic.
 * WhatsApp and website chat are interchangeable communication interfaces
 * over the same underlying business system.
 *
 * Universal message format:
 *   {
 *     channel:        'whatsapp' | 'website' | 'instagram' | 'telegram' | 'kiosk' | 'api',
 *     channelId:      string,         // unique message ID from the provider
 *     tenantId:        string,         // resolved tenant
 *     customerId:      string,         // resolved customer identity
 *     customerName:    string | null,   // if provided by the channel
 *     customerPhone:   string | null,   // if provided (WhatsApp, voice)
 *     text:            string,          // message text (transcribed if voice)
 *     attachments:     [],             // images, audio, documents, location
 *     timestamp:       string,         // ISO timestamp
 *     metadata:        {},             // channel-specific extras
 *     raw:             {},             // original provider payload (for debugging)
 *   }
 */

/**
 * Normalized incoming message.
 */
class NormalizedMessage {
  constructor(data = {}) {
    this.channel = data.channel || 'website';
    this.channelMessageId = data.channelMessageId || null;
    this.tenantId = data.tenantId || null;
    this.customerId = data.customerId || null;
    this.customerName = data.customerName || null;
    this.customerPhone = data.customerPhone || null;
    this.text = data.text || '';
    this.attachments = data.attachments || [];
    this.timestamp = data.timestamp || new Date().toISOString();
    this.metadata = data.metadata || {};
    this.raw = data.raw || null;
  }

  toExecutionMessage() {
    return {
      tenantId: this.tenantId,
      customerId: this.customerId,
      channel: this.channel,
      text: this.text,
      metadata: {
        ...this.metadata,
        channelMessageId: this.channelMessageId,
        customerName: this.customerName,
        customerPhone: this.customerPhone,
        hasAttachments: this.attachments.length > 0,
        attachmentTypes: this.attachments.map(a => a.type),
      },
    };
  }
}

/**
 * Channel Adapter Interface
 *
 * Each channel implements this interface. The Channel Gateway uses it to
 * normalize incoming messages and format outgoing replies.
 */
class ChannelAdapter {
  constructor({ id, displayName } = {}) {
    this.id = id || 'unknown';
    this.displayName = displayName || this.id;
  }

  /**
   * Normalize an incoming provider payload to a NormalizedMessage.
   * Must be implemented by each channel.
   */
  normalizeIncoming(payload, tenantId) {
    throw new Error(`${this.id}.normalizeIncoming() not implemented`);
  }

  /**
   * Format an outgoing reply for this channel.
   * Default: return the text as-is (works for text channels).
   */
  formatOutgoing(reply, context = {}) {
    return { text: reply, channel: this.id };
  }

  /**
   * Verify a webhook signature from this channel's provider.
   * Must be implemented by channels that receive webhooks.
   */
  verifyWebhookSignature(payload, signature, config) {
    return true; // Default: no verification (override per channel)
  }

  /**
   * Send an outgoing message via this channel's provider.
   * Must be implemented by channels that support outbound messaging.
   */
  async send(config, to, message) {
    throw new Error(`${this.id}.send() not implemented`);
  }
}

/**
 * Website / HTTP Channel Adapter
 */
class WebsiteChannelAdapter extends ChannelAdapter {
  constructor() { super({ id: 'website', displayName: 'Website Chat' }); }

  normalizeIncoming(payload, tenantId) {
    return new NormalizedMessage({
      channel: 'website',
      channelMessageId: payload.messageId || null,
      tenantId: tenantId || payload.tenantId,
      customerId: String(payload.customerId || payload.userId || 'anon'),
      customerName: payload.customerName || payload.name || null,
      customerPhone: payload.customerPhone || payload.phone || null,
      text: String(payload.text || ''),
      attachments: this._parseAttachments(payload.attachments),
      metadata: payload.metadata || {},
      raw: payload,
    });
  }

  formatOutgoing(reply, context = {}) {
    return {
      channel: 'website',
      text: reply,
      replyTo: context.channelMessageId || null,
    };
  }

  _parseAttachments(attachments) {
    if (!attachments) return [];
    if (!Array.isArray(attachments)) attachments = [attachments];
    return attachments.map(a => ({
      type: a.type || 'file',
      url: a.url || a.link || null,
      mimeType: a.mimeType || a.contentType || null,
      filename: a.filename || a.name || null,
      size: a.size || null,
    }));
  }
}

/**
 * WhatsApp Channel Adapter
 */
class WhatsAppChannelAdapter extends ChannelAdapter {
  constructor({ client = null } = {}) {
    super({ id: 'whatsapp', displayName: 'WhatsApp' });
    this.client = client;
  }

  normalizeIncoming(payload, tenantId) {
    // WhatsApp Cloud API webhook payload structure
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const contact = change?.value?.contacts?.[0];

    if (!message) return null;

    const text = message?.text?.body || message?.button?.text || '';
    const phone = message?.from || contact?.wa_id || null;

    // Handle different message types
    let attachments = [];
    if (message?.type === 'image' && message.image) {
      attachments.push({ type: 'image', mediaId: message.image.id, caption: message.image.caption || null, mimeType: message.image.mime_type });
    } else if (message?.type === 'audio' && message.audio) {
      attachments.push({ type: 'audio', mediaId: message.audio.id, mimeType: message.audio.mime_type });
    } else if (message?.type === 'document' && message.document) {
      attachments.push({ type: 'document', mediaId: message.document.id, filename: message.document.filename, mimeType: message.document.mime_type });
    } else if (message?.type === 'location' && message.location) {
      attachments.push({ type: 'location', latitude: message.location.latitude, longitude: message.location.longitude, name: message.location.name || null });
    }

    return new NormalizedMessage({
      channel: 'whatsapp',
      channelMessageId: message.id || null,
      tenantId,
      customerId: phone ? `wa_${phone}` : null,
      customerName: contact?.profile?.name || null,
      customerPhone: phone,
      text,
      attachments,
      timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
      metadata: {
        whatsappBusinessPhone: change?.value?.metadata?.phone_number_id || null,
        messageType: message.type,
      },
      raw: payload,
    });
  }

  formatOutgoing(reply, context = {}) {
    // WhatsApp has a 4096 character limit
    const truncated = reply.length > 4096 ? reply.slice(0, 4090) + '…' : reply;
    return {
      channel: 'whatsapp',
      text: truncated,
      to: context.customerPhone || context.to || null,
      replyTo: context.channelMessageId || null,
    };
  }

  verifyWebhookSignature(payload, signature, config) {
    // WhatsApp uses HMAC-SHA256
    if (!config?.appSecret || !signature) return true; // Skip if not configured
    try {
      const crypto = require('crypto');
      const expected = 'sha256=' + crypto.createHmac('sha256', config.appSecret).update(JSON.stringify(payload)).digest('hex');
      return expected === signature;
    } catch { return false; }
  }

  async send(config, to, message) {
    if (!this.client) throw new Error('WhatsAppCloudClient not configured');
    return this.client.sendText(config, to, message.text || message);
  }
}

/**
 * Kiosk Channel Adapter
 */
class KioskChannelAdapter extends ChannelAdapter {
  constructor() { super({ id: 'kiosk', displayName: 'Tablet Kiosk' }); }

  normalizeIncoming(payload, tenantId) {
    return new NormalizedMessage({
      channel: 'kiosk',
      channelMessageId: payload.messageId || null,
      tenantId: tenantId || payload.tenantId,
      customerId: String(payload.customerId || `kiosk_${Date.now()}`),
      customerName: payload.customerName || null,
      text: String(payload.text || ''),
      metadata: { kioskId: payload.kioskId || null, ...payload.metadata },
      raw: payload,
    });
  }

  formatOutgoing(reply, context = {}) {
    // Kiosk: show larger text, no markdown
    return {
      channel: 'kiosk',
      text: reply.replace(/\*/g, '').replace(/_/g, ''),
      replyTo: context.channelMessageId || null,
    };
  }
}

/**
 * REST API Channel Adapter (for programmatic integrations)
 */
class ApiChannelAdapter extends ChannelAdapter {
  constructor() { super({ id: 'api', displayName: 'REST API' }); }

  normalizeIncoming(payload, tenantId) {
    return new NormalizedMessage({
      channel: 'api',
      channelMessageId: payload.messageId || `api_${Date.now()}`,
      tenantId: tenantId || payload.tenantId,
      customerId: String(payload.customerId || payload.userId || 'api_user'),
      customerName: payload.customerName || null,
      text: String(payload.text || ''),
      metadata: { apiKey: payload.apiKey ? '[redacted]' : null, ...payload.metadata },
      raw: payload,
    });
  }

  formatOutgoing(reply, context = {}) {
    return {
      channel: 'api',
      text: reply,
      conversationId: context.conversationId || null,
      metadata: context.metadata || {},
    };
  }
}

/**
 * Channel Gateway
 *
 * The main entry point. Routes incoming messages to the correct channel adapter,
 * normalizes them, and provides a unified interface for sending replies.
 */
class ChannelGateway {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.adapters = new Map();
    this.identityMap = new Map(); // channel:channelUserId → customerId

    // Register built-in channels
    this.register(new WebsiteChannelAdapter());
    this.register(new WhatsAppChannelAdapter()); // Register without client (send() will throw if used)
    this.register(new KioskChannelAdapter());
    this.register(new ApiChannelAdapter());
  }

  /**
   * Register a channel adapter.
   */
  register(adapter) {
    if (!(adapter instanceof ChannelAdapter)) {
      throw new Error('Adapter must extend ChannelAdapter');
    }
    this.adapters.set(adapter.id, adapter);
    this.logger?.info?.('channel.registered', { channelId: adapter.id, displayName: adapter.displayName });
    return this;
  }

  /**
   * Receive an incoming message from any channel.
   * Normalizes it and resolves the customer identity.
   */
  receive(payload, tenantId, channelId = null) {
    // Auto-detect channel from payload if not specified
    if (!channelId) {
      channelId = this._detectChannel(payload);
    }

    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return { ok: false, error: 'unknown_channel', channelId };
    }

    const normalized = adapter.normalizeIncoming(payload, tenantId);
    if (!normalized) {
      return { ok: false, error: 'normalization_failed', channelId };
    }

    // Resolve customer identity (map channel user to customer ID)
    const resolvedCustomerId = this._resolveIdentity(normalized);
    if (resolvedCustomerId) normalized.customerId = resolvedCustomerId;

    return { ok: true, message: normalized, channel: channelId };
  }

  /**
   * Format an outgoing reply for the correct channel.
   */
  formatReply(reply, context = {}) {
    const channelId = context.channel || 'website';
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return { channel: channelId, text: reply };
    }
    return adapter.formatOutgoing(reply, context);
  }

  /**
   * Send a reply via the correct channel provider.
   */
  async send(channelId, config, to, message) {
    const adapter = this.adapters.get(channelId);
    if (!adapter) throw new Error(`Channel '${channelId}' not registered`);
    if (typeof adapter.send !== 'function') {
      return { ok: true, message: 'no_send_implementation', channel: channelId };
    }
    return adapter.send(config, to, message);
  }

  /**
   * Verify a webhook signature.
   */
  verifyWebhook(channelId, payload, signature, config) {
    const adapter = this.adapters.get(channelId);
    if (!adapter) return false;
    return adapter.verifyWebhookSignature(payload, signature, config);
  }

  /**
   * List all registered channels.
   */
  listChannels() {
    return [...this.adapters.values()].map(a => ({ id: a.id, displayName: a.displayName }));
  }

  /**
   * Get a channel adapter by ID.
   */
  getAdapter(channelId) {
    return this.adapters.get(channelId) || null;
  }

  // ─── Private ──────────────────────────────────────────────

  _detectChannel(payload) {
    if (payload?.entry?.[0]?.changes?.[0]?.value?.messages) return 'whatsapp';
    if (payload?.kioskId || payload?.channel === 'kiosk') return 'kiosk';
    if (payload?.apiKey || payload?.channel === 'api') return 'api';
    return 'website';
  }

  _resolveIdentity(message) {
    // Try to map channel user to a stable customer ID
    if (!message.customerId) return null;
    const key = `${message.channel}:${message.customerId}`;
    if (this.identityMap.has(key)) {
      return this.identityMap.get(key);
    }
    // First time: use the channel-specific ID as the customer ID
    this.identityMap.set(key, message.customerId);
    return message.customerId;
  }
}

module.exports = {
  ChannelGateway,
  ChannelAdapter,
  NormalizedMessage,
  WebsiteChannelAdapter,
  WhatsAppChannelAdapter,
  KioskChannelAdapter,
  ApiChannelAdapter,
};
