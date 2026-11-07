/**
 * v52.0 — Customer Memory
 *
 * Manages customer-specific data across conversations:
 *   - Preferences (preferred time, language, payment method)
 *   - Interaction history (past orders, bookings, enquiries)
 *   - Consent (what the customer has agreed to share)
 *
 * Architecture rule: Customer memory is tenant-isolated, consent-aware,
 * and configurable. Don't automatically treat every conversation detail
 * as permanent customer memory.
 */

/**
 * Customer Memory Record
 */
class CustomerMemoryRecord {
  constructor(data = {}) {
    this.tenantId = data.tenantId;
    this.customerId = data.customerId;
    this.preferences = data.preferences || {};
    this.interactionHistory = data.interactionHistory || [];
    this.consent = data.consent || { dataCollection: true, marketing: false };
    this.tags = data.tags || [];
    this.notes = data.notes || [];
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  hasConsent(scope) {
    return Boolean(this.consent?.[scope]);
  }

  addInteraction(interaction) {
    this.interactionHistory.unshift({
      type: interaction.type || 'unknown',
      capabilityId: interaction.capabilityId || null,
      intent: interaction.intent || null,
      summary: interaction.summary || '',
      outcome: interaction.outcome || 'unknown',
      timestamp: interaction.timestamp || new Date().toISOString(),
    });
    // Keep only last 50 interactions
    if (this.interactionHistory.length > 50) {
      this.interactionHistory = this.interactionHistory.slice(0, 50);
    }
    this.updatedAt = new Date().toISOString();
  }

  setPreference(key, value) {
    if (!this.hasConsent('dataCollection')) return false;
    this.preferences[key] = value;
    this.updatedAt = new Date().toISOString();
    return true;
  }

  getPreference(key, defaultValue = null) {
    return this.preferences[key] ?? defaultValue;
  }

  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.updatedAt = new Date().toISOString();
    }
  }

  addNote(note, addedBy = 'system') {
    this.notes.push({
      text: note,
      addedBy,
      at: new Date().toISOString(),
    });
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      tenantId: this.tenantId,
      customerId: this.customerId,
      preferences: this.preferences,
      interactionHistory: this.interactionHistory,
      consent: this.consent,
      tags: this.tags,
      notes: this.notes,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Customer Memory Service
 *
 * Manages customer memory per tenant. Tenant-isolated — a customer from
 * Tenant A can never access Tenant B's data.
 */
class CustomerMemoryService {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.store = new Map(); // tenantId:customerId → CustomerMemoryRecord
  }

  /**
   * Get or create a customer memory record.
   */
  get(tenantId, customerId) {
    const key = `${tenantId}:${customerId}`;
    if (!this.store.has(key)) {
      this.store.set(key, new CustomerMemoryRecord({ tenantId, customerId }));
    }
    return this.store.get(key);
  }

  /**
   * Record a customer interaction (order, booking, enquiry).
   */
  recordInteraction(tenantId, customerId, interaction) {
    const record = this.get(tenantId, customerId);
    if (!record.hasConsent('dataCollection')) {
      this.logger?.warn?.('customer_memory.consent_denied', { tenantId, customerId });
      return false;
    }
    record.addInteraction(interaction);
    return true;
  }

  /**
   * Set a customer preference.
   */
  setPreference(tenantId, customerId, key, value) {
    const record = this.get(tenantId, customerId);
    return record.setPreference(key, value);
  }

  /**
   * Get a customer preference.
   */
  getPreference(tenantId, customerId, key, defaultValue = null) {
    const record = this.get(tenantId, customerId);
    return record.getPreference(key, defaultValue);
  }

  /**
   * Update consent settings.
   */
  updateConsent(tenantId, customerId, consent) {
    const record = this.get(tenantId, customerId);
    record.consent = { ...record.consent, ...consent };
    record.updatedAt = new Date().toISOString();
    return record.consent;
  }

  /**
   * Add a tag to a customer.
   */
  addTag(tenantId, customerId, tag) {
    const record = this.get(tenantId, customerId);
    record.addTag(tag);
  }

  /**
   * Add a note to a customer.
   */
  addNote(tenantId, customerId, note, addedBy = 'system') {
    const record = this.get(tenantId, customerId);
    record.addNote(note, addedBy);
  }

  /**
   * Get customer's interaction history.
   */
  getHistory(tenantId, customerId, options = {}) {
    const record = this.get(tenantId, customerId);
    let history = record.interactionHistory;
    if (options.type) history = history.filter(h => h.type === options.type);
    if (options.limit) history = history.slice(0, options.limit);
    return history;
  }

  /**
   * Get all customer preferences.
   */
  getPreferences(tenantId, customerId) {
    return this.get(tenantId, customerId).preferences;
  }

  /**
   * Get all tags for a customer.
   */
  getTags(tenantId, customerId) {
    return this.get(tenantId, customerId).tags;
  }

  /**
   * Get customer insights (derived from history + preferences).
   */
  getInsights(tenantId, customerId) {
    const record = this.get(tenantId, customerId);
    const history = record.interactionHistory;
    const insights = {
      totalInteractions: history.length,
      lastInteraction: history[0]?.timestamp || null,
      preferredChannel: record.getPreference('channel'),
      preferredLanguage: record.getPreference('language'),
      preferredPaymentMethod: record.getPreference('paymentMethod'),
      preferredTime: record.getPreference('preferredTime'),
      tags: record.tags,
      isVip: record.tags.includes('vip') || record.tags.includes('premium'),
      hasMarketingConsent: record.hasConsent('marketing'),
    };

    // Calculate interaction type counts
    const typeCounts = {};
    for (const h of history) {
      typeCounts[h.type] = (typeCounts[h.type] || 0) + 1;
    }
    insights.interactionBreakdown = typeCounts;

    // Calculate success rate
    const successful = history.filter(h => h.outcome === 'success').length;
    if (history.length > 0) {
      insights.successRate = Math.round((successful / history.length) * 100);
    }

    return insights;
  }

  /**
   * Delete all data for a customer (GDPR right to erasure).
   */
  delete(tenantId, customerId) {
    const key = `${tenantId}:${customerId}`;
    return this.store.delete(key);
  }

  /**
   * List all customers for a tenant (for admin dashboard).
   */
  listCustomers(tenantId, options = {}) {
    const prefix = `${tenantId}:`;
    let records = [];
    for (const [key, record] of this.store) {
      if (!key.startsWith(prefix)) continue;
      records.push(record);
    }
    if (options.tag) records = records.filter(r => r.tags.includes(options.tag));
    if (options.limit) records = records.slice(0, options.limit);
    return records.map(r => ({
      customerId: r.customerId,
      tags: r.tags,
      interactionCount: r.interactionHistory.length,
      lastInteraction: r.interactionHistory[0]?.timestamp || null,
    }));
  }
}

module.exports = { CustomerMemoryService, CustomerMemoryRecord };
