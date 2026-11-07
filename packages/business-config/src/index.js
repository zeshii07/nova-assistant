/**
 * v52.0 — Business Configuration Profile
 *
 * Replaces hardcoded business-type logic with a declarative, configurable
 * profile that determines what Nova can do for each tenant.
 *
 * A business type provides sensible defaults. Enabled capabilities determine
 * available functionality. Business policies determine what is permitted.
 * Integrations determine which external systems can be used.
 * Tenant configuration determines how Nova communicates.
 *
 * This makes it possible to support an unusual business (e.g., pet grooming)
 * without introducing another hardcoded business category — just enable the
 * right capabilities and policies.
 */

/**
 * Business Config Profile
 *
 * The complete configuration for how Nova serves a tenant.
 */
class BusinessConfigProfile {
  constructor(config = {}) {
    // Core identity
    this.tenantId = config.tenantId || null;
    this.businessType = config.businessType || config.domain || 'universal';
    this.businessName = config.businessName || config.name || 'Unknown Business';

    // Capabilities — determines what functionality is available
    this.enabledCapabilities = config.enabledCapabilities || config.capabilities || [];

    // Channels — which communication channels are active
    this.channels = config.channels || ['website'];

    // Assistant personality — how Nova communicates
    this.assistant = {
      language: config.assistant?.language || config.defaultLanguage || ['en'],
      tone: config.assistant?.tone || 'friendly',
      responseLength: config.assistant?.responseLength || 'balanced',
      emojiUsage: config.assistant?.emojiUsage || 'minimal',
      greetingStyle: config.assistant?.greetingStyle || 'casual',
      brandPersonality: config.assistant?.brandPersonality || 'friendly',
      escalationStyle: config.assistant?.escalationStyle || 'polite',
      ...config.assistant,
    };

    // Policies — what is permitted (uses BusinessPolicyEngine)
    this.policies = config.policies || {};

    // Integrations — which external systems are connected
    this.integrations = config.integrations || {};

    // Custom fields — tenant-specific data (catalog settings, service areas, etc.)
    this.customFields = config.customFields || {};

    // Metadata
    this.version = config.version || 1;
    this.createdAt = config.createdAt || new Date().toISOString();
    this.updatedAt = config.updatedAt || new Date().toISOString();
  }

  /**
   * Check if a capability is enabled.
   */
  hasCapability(capabilityId) {
    return this.enabledCapabilities.includes(capabilityId);
  }

  /**
   * Check if a channel is enabled.
   */
  hasChannel(channelId) {
    return this.channels.includes(channelId);
  }

  /**
   * Check if an integration is configured.
   */
  hasIntegration(integrationId) {
    return Boolean(this.integrations[integrationId]);
  }

  /**
   * Get a policy value by path (e.g., 'cancellation.windowHours').
   */
  getPolicy(path, defaultValue = null) {
    const parts = path.split('.');
    let val = this.policies;
    for (const part of parts) {
      val = val?.[part];
      if (val == null) return defaultValue;
    }
    return val ?? defaultValue;
  }

  /**
   * Validate the profile against a schema.
   * Returns { valid, errors }.
   */
  validate() {
    const errors = [];
    if (!this.tenantId) errors.push({ field: 'tenantId', message: 'tenantId is required' });
    if (!this.businessName) errors.push({ field: 'businessName', message: 'businessName is required' });
    if (!Array.isArray(this.enabledCapabilities) || !this.enabledCapabilities.length) {
      errors.push({ field: 'enabledCapabilities', message: 'At least one capability must be enabled' });
    }
    if (!Array.isArray(this.channels) || !this.channels.length) {
      errors.push({ field: 'channels', message: 'At least one channel must be configured' });
    }
    // Validate assistant config
    const validTones = ['professional', 'friendly', 'casual'];
    if (!validTones.includes(this.assistant.tone)) {
      errors.push({ field: 'assistant.tone', message: `Must be one of: ${validTones.join(', ')}` });
    }
    const validLengths = ['short', 'balanced', 'detailed'];
    if (!validLengths.includes(this.assistant.responseLength)) {
      errors.push({ field: 'assistant.responseLength', message: `Must be one of: ${validLengths.join(', ')}` });
    }
    return { valid: errors.length === 0, errors };
  }

  toJSON() {
    return {
      tenantId: this.tenantId,
      businessType: this.businessType,
      businessName: this.businessName,
      enabledCapabilities: this.enabledCapabilities,
      channels: this.channels,
      assistant: this.assistant,
      policies: this.policies,
      integrations: this.integrations,
      customFields: this.customFields,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Business Config Registry
 *
 * Manages business configuration profiles for all tenants.
 * Loads from tenant profile.json + policies.json + personality.json and
 * merges them into a unified BusinessConfigProfile.
 */
class BusinessConfigRegistry {
  constructor({ tenantsDir, logger = null } = {}) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.cache = new Map();
  }

  /**
   * Get the business config profile for a tenant.
   * Merges profile.json, policies.json, and personality.json into one object.
   */
  getProfile(tenant) {
    if (!tenant?.id) return null;

    if (this.cache.has(tenant.id)) return this.cache.get(tenant.id);

    // Build from tenant object + optional config files
    const config = {
      tenantId: tenant.id,
      businessType: tenant.domain || 'universal',
      businessName: tenant.name || tenant.business?.name || 'Unknown',
      enabledCapabilities: tenant.capabilities || [],
      channels: tenant.channels || ['website'],
      defaultLanguage: tenant.defaultLanguage || 'english',
      assistant: {},
      policies: {},
      integrations: {},
    };

    // Load personality.json if it exists
    const personality = this._loadJson(tenant.id, 'personality.json');
    if (personality) {
      config.assistant.tone = personality.tone;
      config.assistant.emojiUsage = personality.emojiLevel || personality.emojiUsage;
      config.assistant.greetingStyle = personality.greetingStyle;
      config.assistant.brandPersonality = personality.brandPersonality;
    }

    // Load policies.json if it exists
    const policies = this._loadJson(tenant.id, 'policies.json');
    if (policies) config.policies = policies;

    // Determine integrations from tenant config
    if (tenant.capabilities?.includes('booking')) {
      config.integrations.calendar = Boolean(tenant.business?.calendarProvider);
    }

    const profile = new BusinessConfigProfile(config);
    this.cache.set(tenant.id, profile);
    return profile;
  }

  /**
   * Create or update a business config profile.
   */
  setProfile(tenantId, config) {
    const profile = new BusinessConfigProfile({ ...config, tenantId });
    this.cache.set(tenantId, profile);
    this.logger?.info?.('business_config.updated', { tenantId, businessType: profile.businessType });
    return profile;
  }

  /**
   * Get sensible defaults for a business type.
   */
  getDefaults(businessType) {
    return DOMAIN_DEFAULTS[businessType] || DOMAIN_DEFAULTS.universal;
  }

  _loadJson(tenantId, filename) {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(this.tenantsDir, tenantId, filename);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return null; }
  }

  clearCache(tenantId) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}

/**
 * Default capability sets and config per business type.
 * These provide sensible defaults that tenants can override.
 */
const DOMAIN_DEFAULTS = {
  restaurant: {
    capabilities: ['assistant', 'crm', 'catalog', 'commerce', 'booking', 'service'],
    channels: ['website', 'whatsapp'],
    assistant: { tone: 'friendly', emojiUsage: 'moderate', brandPersonality: 'friendly' },
    policies: { cancellation: { windowHours: 2 }, booking: { maxPartySize: 20 } },
  },
  hotel: {
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    channels: ['website', 'whatsapp'],
    assistant: { tone: 'professional', emojiUsage: 'minimal', brandPersonality: 'premium' },
    policies: { cancellation: { windowHours: 48, chargePercentage: 100 } },
  },
  salon: {
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    channels: ['website', 'whatsapp'],
    assistant: { tone: 'friendly', emojiUsage: 'moderate', brandPersonality: 'youthful' },
    policies: { cancellation: { windowHours: 4, chargePercentage: 50 } },
  },
  cleaning: {
    capabilities: ['assistant', 'crm', 'cleaning', 'pricing', 'availability', 'service'],
    channels: ['website', 'whatsapp', 'kiosk'],
    assistant: { tone: 'friendly', emojiUsage: 'minimal', brandPersonality: 'friendly' },
    policies: { cancellation: { windowHours: 12 } },
  },
  retail: {
    capabilities: ['assistant', 'crm', 'catalog', 'commerce'],
    channels: ['website', 'api'],
    assistant: { tone: 'casual', emojiUsage: 'moderate', brandPersonality: 'youthful' },
    policies: { refund: { windowDays: 14, percentage: 100 } },
  },
  healthcare: {
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    channels: ['website'],
    assistant: { tone: 'professional', emojiUsage: 'none', brandPersonality: 'premium' },
    policies: { cancellation: { windowHours: 24 }, booking: { requiresStaffApproval: [] } },
  },
  education: {
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    channels: ['website'],
    assistant: { tone: 'professional', emojiUsage: 'minimal', brandPersonality: 'friendly' },
    policies: { cancellation: { windowHours: 48 } },
  },
  driving_school: {
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    channels: ['website', 'whatsapp'],
    assistant: { tone: 'casual', emojiUsage: 'moderate', brandPersonality: 'friendly' },
    policies: { cancellation: { windowHours: 12, chargePercentage: 50 } },
  },
  universal: {
    capabilities: ['assistant', 'crm'],
    channels: ['website'],
    assistant: { tone: 'friendly', emojiUsage: 'minimal', brandPersonality: 'friendly' },
    policies: {},
  },
};

module.exports = { BusinessConfigProfile, BusinessConfigRegistry, DOMAIN_DEFAULTS };
