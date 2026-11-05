/**
 * v38.0 — Tenant Adapter Registry
 * v44.0 — Now uses domainVocabulary.js for comprehensive per-domain vocabulary.
 *
 * Loads tenant adapters from tenants/{tenantId}/adapter/index.js
 * Falls back to a domain-based default adapter if no tenant-specific one exists.
 *
 * Used by the conversation intelligence engine to:
 *  1. Enrich message text before capabilities run
 *  2. Extract tenant-specific entities
 *  3. Suggest tenant-specific intents
 *  4. Format replies with tenant-specific language
 */
const fs = require('fs');
const path = require('path');
const { BaseTenantAdapter } = require('./baseTenantAdapter');
const domainVocabulary = require('./domainVocabulary');

class TenantAdapterRegistry {
  constructor({ tenantsDir, logger = null }) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.adapters = new Map(); // tenantId → adapter instance
    this.domainDefaults = new Map(); // domain → adapter class
    this._loadDomainDefaults();
  }

  _loadDomainDefaults() {
    // v44.0: Register domain-specific default adapters using the comprehensive
    // vocabulary dictionaries in domainVocabulary.js. Each adapter delegates
    // enrichText / extractEntities / suggestIntents to the shared vocabulary
    // module, so adding new terms is a one-file change.

    // Build an adapter class for each domain in the vocabulary
    for (const domain of Object.keys(domainVocabulary)) {
      if (domain === 'universal') continue; // skip universal — it's the fallback
      const vocab = domainVocabulary[domain];
      const AdapterClass = class extends BaseTenantAdapter {
        constructor(opts) { super(opts); this.priority = 72; this.vocabulary = vocab; }
        enrichText(text) {
          return domainVocabulary.enrichText(text, this.domain);
        }
        getQuantityUnits() { return vocab.quantityUnits || {}; }
        suggestIntents(text, context) {
          const candidates = [];
          const t = String(text || '').toLowerCase().trim();
          // Domain-specific intent suggestions based on vocabulary
          if (domain === 'restaurant') {
            // "i want to order some food" → menu browse
            if (/\b(?:i want|i need|i'?d like)\s+to\s+(?:order|eat|get|have)\s+(?:some\s+)?(?:food|something|lunch|dinner)\b/i.test(t)) {
              candidates.push({ intent: 'catalog.list', confidence: 0.99, entities: {}, reason: 'restaurant_food_order_intent' });
            }
            // "plate of biryani" → extract quantity=1 + product name
            if (/\b(?:plate|serving|portion|piece)\s+of\s+/i.test(t)) {
              candidates.push({ intent: 'commerce.cart.add_request', confidence: 0.998, entities: { requestedText: t, quantity: 1 }, reason: 'restaurant_plate_order' });
            }
          }
          if (domain === 'cleaning') {
            // "safai karwani hai" → cleaning request
            if (/\b(?:safai|safaiwala|safai karwani)\b/i.test(t)) {
              candidates.push({ intent: 'cleaning.pricing_request', confidence: 0.95, entities: { requestedText: t }, reason: 'cleaning_roman_urdu_request' });
            }
          }
          return candidates;
        }
      };
      // Name the class for debugging
      Object.defineProperty(AdapterClass, 'name', { value: `${domain.charAt(0).toUpperCase() + domain.slice(1)}DefaultAdapter` });
      this.domainDefaults.set(domain, AdapterClass);
    }

    // Universal fallback adapter — uses the universal vocabulary
    this.domainDefaults.set('universal', class UniversalDefaultAdapter extends BaseTenantAdapter {
      constructor(opts) { super(opts); this.priority = 72; this.vocabulary = domainVocabulary.universal; }
      enrichText(text) { return domainVocabulary.enrichText(text, 'universal'); }
      getQuantityUnits() { return domainVocabulary.universal.quantityUnits || {}; }
    });
  }

  /**
   * Get the adapter for a tenant. Returns null if no adapter exists.
   */
  get(tenant) {
    if (!tenant?.id) return null;

    // Check cache
    if (this.adapters.has(tenant.id)) {
      return this.adapters.get(tenant.id);
    }

    // Try to load tenant-specific adapter from tenants/{id}/adapter/index.js
    const adapterPath = path.join(this.tenantsDir, tenant.id, 'adapter', 'index.js');
    let adapter = null;

    if (fs.existsSync(adapterPath)) {
      try {
        const TenantAdapter = require(adapterPath);
        adapter = new TenantAdapter({ tenantId: tenant.id, domain: tenant.domain });
        this.logger?.info?.('tenant_adapter.loaded', { tenantId: tenant.id, source: 'tenant_specific' });
      } catch (err) {
        this.logger?.warn?.('tenant_adapter.load_failed', { tenantId: tenant.id, error: err.message });
      }
    }

    // Fall back to domain-based default adapter
    if (!adapter && tenant.domain) {
      const DomainAdapter = this.domainDefaults.get(tenant.domain);
      if (DomainAdapter) {
        adapter = new DomainAdapter({ tenantId: tenant.id, domain: tenant.domain });
        this.logger?.info?.('tenant_adapter.loaded', { tenantId: tenant.id, source: 'domain_default', domain: tenant.domain });
      }
    }

    // Final fallback to universal adapter
    if (!adapter) {
      const UniversalAdapter = this.domainDefaults.get('universal');
      if (UniversalAdapter) {
        adapter = new UniversalAdapter({ tenantId: tenant.id, domain: 'universal' });
        this.logger?.info?.('tenant_adapter.loaded', { tenantId: tenant.id, source: 'universal_fallback' });
      }
    }

    if (adapter) {
      this.adapters.set(tenant.id, adapter);
    }

    return adapter;
  }

  /**
   * Clear cache for a specific tenant (call when tenant config changes).
   */
  clear(tenantId) {
    if (tenantId) {
      this.adapters.delete(tenantId);
    } else {
      this.adapters.clear();
    }
  }
}

module.exports = { TenantAdapterRegistry, BaseTenantAdapter, domainVocabulary };
