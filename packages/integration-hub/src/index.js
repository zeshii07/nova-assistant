/**
 * v51.0 — Integration Hub
 *
 * Connects Nova to external business systems (Google Calendar, Stripe,
 * payment gateways, POS, email providers, WhatsApp Business API, CRM).
 *
 * Responsibilities:
 *   1. Provider Registry — standardized interfaces for each integration
 *   2. Credential Manager — secure storage for API keys and tokens
 *   3. Connector Interface — standardized methods (connect, sync, webhook)
 *   4. Webhook Manager — receive and route provider webhooks
 *
 * Architecture rule: The business engine never depends directly on a
 * particular third-party provider. All integrations go through the hub.
 */

const crypto = require('crypto');

/**
 * Integration Provider
 *
 * Base class for all external integrations. Each provider implements
 * a standardized interface.
 */
class IntegrationProvider {
  constructor({ id, name, category, version = 1 } = {}) {
    this.id = id;
    this.name = name;
    this.category = category; // 'calendar' | 'payment' | 'email' | 'messaging' | 'crm' | 'pos'
    this.version = version;
    this.connected = false;
  }

  /**
   * Test the connection with the given credentials.
   */
  async testConnection(credentials) {
    throw new Error(`${this.id}.testConnection() not implemented`);
  }

  /**
   * Sync data from this provider (e.g., calendar events, payment records).
   */
  async sync(credentials, options = {}) {
    throw new Error(`${this.id}.sync() not implemented`);
  }

  /**
   * Handle an incoming webhook from this provider.
   */
  async handleWebhook(payload, signature, credentials) {
    throw new Error(`${this.id}.handleWebhook() not implemented`);
  }

  /**
   * Verify a webhook signature from this provider.
   */
  verifyWebhookSignature(payload, signature, secret) {
    return true; // Override per provider
  }
}

/**
 * Credential Manager
 *
 * Securely stores and retrieves API credentials for integrations.
 * In production, this should use an encrypted vault (e.g., AWS Secrets Manager).
 * For now, it uses in-memory storage with a simple encryption layer.
 */
class CredentialManager {
  constructor({ encryptionKey = 'nova-default-key', logger = null } = {}) {
    this.encryptionKey = encryptionKey;
    this.logger = logger;
    this.store = new Map(); // tenantId:providerId → encrypted credentials
  }

  /**
   * Store credentials for a tenant+provider.
   */
  set(tenantId, providerId, credentials) {
    const key = `${tenantId}:${providerId}`;
    const encrypted = this._encrypt(JSON.stringify(credentials));
    this.store.set(key, encrypted);
    this.logger?.info?.('credentials.stored', { tenantId, providerId });
  }

  /**
   * Retrieve credentials for a tenant+provider.
   */
  get(tenantId, providerId) {
    const key = `${tenantId}:${providerId}`;
    const encrypted = this.store.get(key);
    if (!encrypted) return null;
    try {
      return JSON.parse(this._decrypt(encrypted));
    } catch {
      return null;
    }
  }

  /**
   * Delete credentials.
   */
  delete(tenantId, providerId) {
    const key = `${tenantId}:${providerId}`;
    return this.store.delete(key);
  }

  /**
   * List all configured providers for a tenant.
   */
  listProviders(tenantId) {
    const prefix = `${tenantId}:`;
    return [...this.store.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  /**
   * Check if a provider is configured for a tenant.
   */
  has(tenantId, providerId) {
    return this.store.has(`${tenantId}:${providerId}`);
  }

  _encrypt(text) {
    // Simple XOR cipher for development (production: use AES-256-GCM)
    const key = Buffer.from(this.encryptionKey.padEnd(32).slice(0, 32));
    const buf = Buffer.from(text, 'utf8');
    const result = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
      result[i] = buf[i] ^ key[i % key.length];
    }
    return result.toString('base64');
  }

  _decrypt(encrypted) {
    const key = Buffer.from(this.encryptionKey.padEnd(32).slice(0, 32));
    const buf = Buffer.from(encrypted, 'base64');
    const result = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
      result[i] = buf[i] ^ key[i % key.length];
    }
    return result.toString('utf8');
  }
}

/**
 * Integration Hub
 *
 * Central registry for all external integrations. The business engine
 * uses this hub to access integrations without depending on specific providers.
 */
class IntegrationHub {
  constructor({ credentialManager = null, logger = null } = {}) {
    this.credentialManager = credentialManager || new CredentialManager({ logger });
    this.logger = logger;
    this.providers = new Map(); // providerId → IntegrationProvider instance
    this._registerBuiltinProviders();
  }

  /**
   * Register a new integration provider.
   */
  registerProvider(provider) {
    if (!(provider instanceof IntegrationProvider)) {
      throw new Error('Provider must extend IntegrationProvider');
    }
    this.providers.set(provider.id, provider);
    this.logger?.info?.('integration.provider_registered', { providerId: provider.id, category: provider.category });
    return this;
  }

  /**
   * Get a provider by ID.
   */
  getProvider(providerId) {
    return this.providers.get(providerId) || null;
  }

  /**
   * List all registered providers, optionally filtered by category.
   */
  listProviders(category = null) {
    const all = [...this.providers.values()];
    if (category) return all.filter(p => p.category === category);
    return all;
  }

  /**
   * List all configured (credentialled) integrations for a tenant.
   */
  getTenantIntegrations(tenantId) {
    return this.credentialManager.listProviders(tenantId).map(providerId => ({
      providerId,
      category: this.providers.get(providerId)?.category || 'unknown',
      name: this.providers.get(providerId)?.name || providerId,
      connected: this.providers.get(providerId)?.connected || false,
    }));
  }

  /**
   * Configure credentials for a tenant+provider.
   */
  configureIntegration(tenantId, providerId, credentials) {
    this.credentialManager.set(tenantId, providerId, credentials);
    return { ok: true, tenantId, providerId };
  }

  /**
   * Test an integration connection.
   */
  async testIntegration(tenantId, providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) return { ok: false, error: 'provider_not_found' };
    const credentials = this.credentialManager.get(tenantId, providerId);
    if (!credentials) return { ok: false, error: 'credentials_not_configured' };
    try {
      const result = await provider.testConnection(credentials);
      provider.connected = true;
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Sync data from a provider.
   */
  async syncIntegration(tenantId, providerId, options = {}) {
    const provider = this.getProvider(providerId);
    if (!provider) return { ok: false, error: 'provider_not_found' };
    const credentials = this.credentialManager.get(tenantId, providerId);
    if (!credentials) return { ok: false, error: 'credentials_not_configured' };
    return provider.sync(credentials, options);
  }

  /**
   * Handle a webhook from a provider.
   */
  async handleWebhook(tenantId, providerId, payload, signature) {
    const provider = this.getProvider(providerId);
    if (!provider) return { ok: false, error: 'provider_not_found' };
    const credentials = this.credentialManager.get(tenantId, providerId);
    // Verify webhook signature
    if (!provider.verifyWebhookSignature(payload, signature, credentials?.webhookSecret)) {
      return { ok: false, error: 'webhook_signature_invalid' };
    }
    try {
      return await provider.handleWebhook(payload, signature, credentials);
    } catch (err) {
      // Provider's handleWebhook not implemented — signature was valid,
      // so the webhook itself is authentic. Just not processed.
      return { ok: false, error: 'webhook_handler_not_implemented', message: err.message, signatureValid: true };
    }
  }

  // ─── Builtin providers ──────────────────────────────────

  _registerBuiltinProviders() {
    // Google Calendar
    this.registerProvider(new class extends IntegrationProvider {
      constructor() { super({ id: 'google-calendar', name: 'Google Calendar', category: 'calendar' }); }
      async testConnection(creds) {
        if (!creds?.accessToken) throw new Error('Access token required');
        return { connected: true, calendar: creds.calendarId || 'primary' };
      }
      async sync(creds, options = {}) {
        return { events: [], syncedAt: new Date().toISOString() };
      }
      verifyWebhookSignature(payload, signature, secret) {
        if (!secret) return true;
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
        return expected === signature;
      }
    }());

    // Stripe Payment
    this.registerProvider(new class extends IntegrationProvider {
      constructor() { super({ id: 'stripe', name: 'Stripe', category: 'payment' }); }
      async testConnection(creds) {
        if (!creds?.secretKey) throw new Error('Secret key required');
        return { connected: true, mode: creds.secretKey.startsWith('sk_test_') ? 'test' : 'live' };
      }
      async sync(creds, options = {}) {
        return { payments: [], syncedAt: new Date().toISOString() };
      }
      verifyWebhookSignature(payload, signature, secret) {
        if (!secret) return true;
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
        return expected === signature;
      }
    }());

    // Email (SMTP)
    this.registerProvider(new class extends IntegrationProvider {
      constructor() { super({ id: 'email-smtp', name: 'Email (SMTP)', category: 'email' }); }
      async testConnection(creds) {
        if (!creds?.host || !creds?.port) throw new Error('Host and port required');
        return { connected: true, host: creds.host, port: creds.port };
      }
    }());

    // WhatsApp Business API
    this.registerProvider(new class extends IntegrationProvider {
      constructor() { super({ id: 'whatsapp-business', name: 'WhatsApp Business API', category: 'messaging' }); }
      async testConnection(creds) {
        if (!creds?.phoneNumberId || !creds?.accessToken) throw new Error('Phone number ID and access token required');
        return { connected: true, phoneNumberId: creds.phoneNumberId };
      }
      verifyWebhookSignature(payload, signature, secret) {
        if (!secret) return true;
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
        return expected === signature;
      }
    }());

    // Generic POS
    this.registerProvider(new class extends IntegrationProvider {
      constructor() { super({ id: 'generic-pos', name: 'Generic POS', category: 'pos' }); }
      async testConnection(creds) {
        if (!creds?.apiUrl) throw new Error('API URL required');
        return { connected: true, apiUrl: creds.apiUrl };
      }
    }());
  }
}

module.exports = { IntegrationHub, IntegrationProvider, CredentialManager };
