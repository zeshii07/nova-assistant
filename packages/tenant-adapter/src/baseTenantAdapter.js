/**
 * v38.0 — Base Tenant Adapter
 *
 * Every tenant can have an optional adapter that provides:
 *  - Tenant-specific vocabulary (menu, food, dishes for restaurants;
 *    SKU, sizes, colors for retail; services, treatments for salons)
 *  - Tenant-specific entity mapping ("plate of biryani" → quantity:1, item:biryani)
 *  - Tenant-specific intent enrichment (dine-in flag, takeaway flag, etc.)
 *  - Tenant-specific typo corrections (chiken→chicken for restaurants)
 *
 * The adapter runs BEFORE the central capabilities. It can:
 *  1. Enrich the message text (fix typos, expand abbreviations)
 *  2. Extract tenant-specific entities (plate → quantity, serving → quantity)
 *  3. Suggest intent hints that the central capabilities use
 *  4. Handle tenant-specific tasks that don't exist in the central engine
 *
 * If no adapter exists for a tenant, the central capabilities handle everything
 * using their default vocabulary.
 */
class BaseTenantAdapter {
  constructor({ tenantId, domain } = {}) {
    this.tenantId = tenantId;
    this.domain = domain;
    this.priority = 70; // lower than catalog(80) and commerce(95) — runs first but doesn't override
  }

  /**
   * Pre-process the message text before any capability sees it.
   * Fix tenant-specific typos, expand abbreviations, normalize vocabulary.
   *
   * @param {string} text - original message text
   * @returns {string} - normalized text (or original if no changes)
   */
  enrichText(text) {
    return text;
  }

  /**
   * Extract tenant-specific entities from the message.
   * These are MERGED with entities from the central capabilities.
   *
   * @param {string} text - message text
   * @param {object} context - { tenant, message, state, services, normalizedText }
   * @returns {object} - extracted entities (e.g., { dineIn: true, takeaway: false, quantity: 2 })
   */
  extractEntities(text, context) {
    return {};
  }

  /**
   * Provide intent hints for the central capabilities.
   * Return candidate intents that the conversation intelligence engine
   * will merge with candidates from catalog/commerce adapters.
   *
   * @param {string} text - message text
   * @param {object} context - { tenant, message, state, services, normalizedText }
   * @returns {array} - [{ intent: 'commerce.cart.add_request', confidence: 0.99, entities: {...}, reason: 'tenant_specific_order' }]
   */
  suggestIntents(text, context) {
    return [];
  }

  /**
   * Format a reply with tenant-specific language.
   * Called AFTER the central capability generates its reply — allows
   * the adapter to customize the wording (e.g., "menu items" vs "products").
   *
   * @param {string} reply - reply from central capability
   * @param {object} context - { intent, language, tenant }
   * @returns {string} - customized reply (or original if no changes)
   */
  formatReply(reply, context) {
    return reply;
  }

  /**
   * Get tenant-specific product/item aliases.
   * Merged with the catalog's product aliases for entity resolution.
   *
   * @param {array} products - products from catalog
   * @returns {array} - products with additional aliases
   */
  enrichProductAliases(products) {
    return products;
  }

  /**
   * Get tenant-specific quantity unit mappings.
   * E.g., restaurant: "plate" → 1, "serving" → 1, "piece" → 1
   * Retail: "box" → 1, "pack" → 1
   *
   * @returns {object} - { unitName: multiplier }
   */
  getQuantityUnits() {
    return {};
  }
}

module.exports = { BaseTenantAdapter };
