/**
 * v38.0 — Tenant Adapter Registry
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

class TenantAdapterRegistry {
  constructor({ tenantsDir, logger = null }) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.adapters = new Map(); // tenantId → adapter instance
    this.domainDefaults = new Map(); // domain → adapter class
    this._loadDomainDefaults();
  }

  _loadDomainDefaults() {
    // Register domain-specific default adapters
    // These provide vocabulary for all tenants of a given domain
    // without requiring a per-tenant adapter file.

    // Restaurant domain defaults
    this.domainDefaults.set('restaurant', class RestaurantDefaultAdapter extends BaseTenantAdapter {
      constructor(opts) { super(opts); this.priority = 72; }
      enrichText(text) {
        return String(text || '')
          .replace(/\bchiken\b/gi, 'chicken')
          .replace(/\bbiriyani\b/gi, 'biryani')
          .replace(/\bburgers\b/gi, 'burger')
          .replace(/\bwnt\b/gi, 'want')
          .replace(/\bsomw\b/gi, 'some')
          .replace(/\bwht\b/gi, 'what')
          .replace(/\bresturant\b/gi, 'restaurant')
          .replace(/\brestaurent\b/gi, 'restaurant')
          .replace(/\bordr\b/gi, 'order')
          .replace(/\bpls\b/gi, 'please')
          .replace(/\bplz\b/gi, 'please');
      }
      getQuantityUnits() {
        return { plate: 1, serving: 1, piece: 1, portion: 1, bowl: 1, cup: 1, glass: 1, plate_of: 1, piece_of: 1, serving_of: 1 };
      }
      formatReply(reply, context) {
        if (!reply) return reply;
        // Replace "products" with "menu items" for restaurant context
        if (context?.intent === 'catalog.list' || context?.intent === 'CATALOG_LIST_VIEWED') {
          return reply
            .replace(/Available products:/gi, 'Here are our menu items:')
            .replace(/Mention a product name/gi, 'Tell me which item')
            .replace(/Here's what we currently have available/gi, "Here are our menu items");
        }
        return reply;
      }
      suggestIntents(text, context) {
        const candidates = [];
        const t = String(text || '').toLowerCase().trim();
        // "i want to order some food" → menu browse
        if (/\b(?:i want|i need|i'?d like)\s+to\s+(?:order|eat|get|have)\s+(?:some\s+)?(?:food|something|lunch|dinner)\b/i.test(t)) {
          candidates.push({
            intent: 'catalog.list',
            confidence: 0.99,
            entities: {},
            reason: 'restaurant_food_order_intent',
          });
        }
        // "plate of biryani" → extract quantity=1 + product name
        if (/\b(?:plate|serving|portion|piece)\s+of\s+/i.test(t)) {
          candidates.push({
            intent: 'commerce.cart.add_request',
            confidence: 0.998,
            entities: { requestedText: t, quantity: 1 },
            reason: 'restaurant_plate_order',
          });
        }
        return candidates;
      }
    });

    // Retail domain defaults
    this.domainDefaults.set('retail', class RetailDefaultAdapter extends BaseTenantAdapter {
      constructor(opts) { super(opts); this.priority = 72; }
      getQuantityUnits() {
        return { box: 1, pack: 1, pair: 1, set: 1, bundle: 1, dozen: 12 };
      }
    });

    // Cleaning domain defaults
    this.domainDefaults.set('cleaning', class CleaningDefaultAdapter extends BaseTenantAdapter {
      constructor(opts) { super(opts); this.priority = 72; }
      enrichText(text) {
        return String(text || '')
          .replace(/\bsafai\b/gi, 'cleaning')
          .replace(/\bsafai karwani hai\b/gi, 'i want cleaning')
          .replace(/\bghar ki safai\b/gi, 'home cleaning')
          .replace(/\bdeep safai\b/gi, 'deep cleaning');
      }
    });

    // Salon domain defaults
    this.domainDefaults.set('salon', class SalonDefaultAdapter extends BaseTenantAdapter {
      constructor(opts) { super(opts); this.priority = 72; }
      enrichText(text) {
        return String(text || '')
          .replace(/\bhair cut\b/gi, 'haircut')
          .replace(/\bhair style\b/gi, 'hairstyle')
          .replace(/\bbeard trim\b/gi, 'beard trimming');
      }
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

module.exports = { TenantAdapterRegistry, BaseTenantAdapter };
