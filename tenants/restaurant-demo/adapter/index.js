/**
 * v38.0 — Restaurant Demo Tenant Adapter
 *
 * Provides restaurant-specific vocabulary, entity extraction, and task handling
 * that the central catalog+commerce capabilities don't natively understand.
 *
 * Loaded automatically by TenantAdapterRegistry when the restaurant-demo tenant
 * is active. Central capabilities handle cart/checkout — this adapter handles:
 *
 *  - Food vocabulary: menu, dishes, starters, desserts, specials
 *  - Quantity units: plate, serving, portion, piece, bowl, cup, glass
 *  - Food-specific typos: chiken→chicken, biriyani→biryani, zinger→(not available)
 *  - Order type detection: dine-in, takeaway, delivery
 *  - Dietary questions: halal, vegetarian, vegan, spicy, nuts allergy
 *  - Combined queries: "book table + pre-order food"
 */
const { BaseTenantAdapter } = require('../../../packages/tenant-adapter/src/baseTenantAdapter');

class RestaurantDemoAdapter extends BaseTenantAdapter {
  constructor({ tenantId, domain } = {}) {
    super({ tenantId: tenantId || 'restaurant-demo', domain: domain || 'restaurant' });
    this.priority = 75;
  }

  // ─── Text enrichment ────────────────────────────────────────
  enrichText(text) {
    return String(text || '')
      // Food-specific typos
      .replace(/\bchiken\b/gi, 'chicken')
      .replace(/\bbiriyani\b/gi, 'biryani')
      .replace(/\bbiryanis\b/gi, 'biryani')
      .replace(/\bburgers\b/gi, 'burger')
      .replace(/\bwnt\b/gi, 'want')
      .replace(/\bsomw\b/gi, 'some')
      .replace(/\bwht\b/gi, 'what')
      .replace(/\bresturant\b/gi, 'restaurant')
      .replace(/\brestaurent\b/gi, 'restaurant')
      .replace(/\bordr\b/gi, 'order')
      .replace(/\bpls\b/gi, 'please')
      .replace(/\bplz\b/gi, 'please')
      .replace(/\bhw\b/gi, 'how')
      .replace(/\bshw\b/gi, 'show')
      .replace(/\bavailabl\b/gi, 'available')
      // Normalize "do biryani" → "order biryani" (do as verb)
      .replace(/\bdo\s+(biryani|burger|pasta|chicken|beef|food|order)\b/gi, 'order $1')
      // Normalize "plate of" → "1 plate of" for quantity detection
      .replace(/\bplate\s+of\b/gi, '1 plate of')
      .replace(/\bpiece\s+of\b/gi, '1 piece of')
      .replace(/\bserving\s+of\b/gi, '1 serving of')
      .replace(/\bportion\s+of\b/gi, '1 portion of')
      // Normalize "let do one X" → "order 1 X"
      .replace(/\blet\s+do\s+(?:one\s+)?/gi, 'order 1 ')
      .replace(/\blet\s+me\s+get\s+(?:one\s+)?/gi, 'order 1 ')
      // "i want to eat" → "i want to order" (for consistent intent detection)
      .replace(/\bi\s+want\s+to\s+eat\b/gi, 'i want to order')
      .replace(/\bi\s+need\s+to\s+eat\b/gi, 'i need to order');
  }

  // ─── Entity extraction ──────────────────────────────────────
  extractEntities(text, context) {
    const entities = {};
    const t = String(text || '').toLowerCase().trim();

    // Detect order type: dine-in, takeaway, delivery
    if (/\b(?:dine[ -]?in|eat\s+here|sit\s+in|here)\b/i.test(t)) {
      entities.orderType = 'dine-in';
    }
    if (/\b(?:takeaway|take\s+away|take\s+out|to\s+go|pack\s+up|parcel)\b/i.test(t)) {
      entities.orderType = 'takeaway';
    }
    if (/\b(?:deliver|delivery|home\s+delivery|ship\s+to)\b/i.test(t)) {
      entities.orderType = 'delivery';
    }

    // Extract quantity from food-specific units
    // "plate of biryani" → quantity: 1
    // "2 plates of biryani" → quantity: 2
    // "3 servings" → quantity: 3
    const plateMatch = t.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:plates?|servings?|portions?|pieces?|bowls?|cups?|glasses?)?\s+of\s+/i);
    if (plateMatch) {
      const wordToNum = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
      const num = plateMatch[1].match(/^\d+$/) ? parseInt(plateMatch[1]) : (wordToNum[plateMatch[1]] || 1);
      entities.quantity = num;
    }

    // Detect dietary preferences
    if (/\b(?:halal|zabiha|islamic)\b/i.test(t)) {
      entities.dietary = 'halal';
    }
    if (/\b(?:vegetarian|vegan|veg)\b/i.test(t)) {
      entities.dietary = entities.dietary ? entities.dietary + ',vegetarian' : 'vegetarian';
    }
    if (/\b(?:spicy|less\s+spicy|more\s+spicy|mirch\s+kam)\b/i.test(t)) {
      entities.spiceLevel = /less|kam/i.test(t) ? 'mild' : (/more|zyada/i.test(t) ? 'extra_spicy' : 'spicy');
    }
    if (/\b(?:nuts?\s+allergy|peanut|moongphali)\b/i.test(t)) {
      entities.allergy = 'nuts';
    }

    return entities;
  }

  // ─── Intent suggestions ─────────────────────────────────────
  suggestIntents(text, context) {
    const candidates = [];
    const t = String(text || '').toLowerCase().trim();

    // "i want to order some food" → catalog.list (show menu)
    if (/\b(?:i want|i need|i'?d like)\s+to\s+order\s+(?:some\s+)?(?:food|something|lunch|dinner)\b/i.test(t)) {
      candidates.push({
        intent: 'catalog.list',
        confidence: 0.99,
        entities: {},
        reason: 'restaurant_food_order_intent',
      });
    }

    // "what type/kind of food" → catalog.list
    if (/\b(?:what|which)\s+(?:type|kind)\s+of\s+(?:food|dishes?|items?)/i.test(t)) {
      candidates.push({
        intent: 'catalog.list',
        confidence: 0.995,
        entities: {},
        reason: 'restaurant_food_type_question',
      });
    }

    // "can i see what you are offering" → catalog.list
    if (/\b(?:can\s+i\s+see|show\s+me)\s+(?:what\s+)?(?:you\s+)?(?:are\s+)?(?:offering|your\s+menu|the\s+menu)/i.test(t)) {
      candidates.push({
        intent: 'catalog.list',
        confidence: 0.99,
        entities: {},
        reason: 'restaurant_menu_browse',
      });
    }

    // "do you have any food" → catalog.list
    if (/\bdo\s+you\s+(?:have|offer)\s+(?:any\s+)?(?:food|dishes?|items?)\b/i.test(t)) {
      candidates.push({
        intent: 'catalog.list',
        confidence: 0.99,
        entities: {},
        reason: 'restaurant_food_availability',
      });
    }

    // "plate of biryani" → commerce.cart.add_request with quantity
    if (/\b(?:\d+\s*)?(?:plate|serving|portion|piece)\s+of\s+/i.test(t)) {
      const wordToNum = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
      const qtyMatch = t.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:plates?|servings?|portions?|pieces?)?\s+of/i);
      const qty = qtyMatch ? (qtyMatch[1].match(/^\d+$/) ? parseInt(qtyMatch[1]) : (wordToNum[qtyMatch[1]] || 1)) : 1;
      candidates.push({
        intent: 'commerce.cart.add_request',
        confidence: 0.998,
        entities: { requestedText: text, quantity: qty },
        reason: 'restaurant_portion_order',
      });
    }

    return candidates;
  }

  // ─── Reply formatting ───────────────────────────────────────
  formatReply(reply, context) {
    if (!reply) return reply;

    // Replace generic "products" language with restaurant-specific language
    if (context?.intent === 'catalog.list' || context?.intent === 'CATALOG_LIST_VIEWED') {
      return reply
        .replace(/Available products:/gi, 'Here are our menu items:')
        .replace(/Mention a product name/gi, 'Tell me which item')
        .replace(/Here's what we currently have available/gi, "Here are our menu items")
        .replace(/Here are the available/gi, 'Here are our menu items')
        .replace(/Tell me which option/gi, 'Tell me which item');
    }

    // Replace "cart" with "order" in restaurant context
    if (context?.domain === 'restaurant') {
      return reply
        .replace(/\byour cart\b/gi, 'your order')
        .replace(/\badd to cart\b/gi, 'add to your order')
        .replace(/\bcart is empty\b/gi, 'order is empty');
    }

    return reply;
  }

  // ─── Product aliases ───────────────────────────────────────
  enrichProductAliases(products) {
    // Add restaurant-specific aliases for menu items
    const foodAliases = {
      'chicken-biryani': ['biryani', 'chicken biryani', 'biryani plate', 'plate of biryani'],
      'beef-burger': ['burger', 'beef burger', 'burger plate', 'zinger burger'],
      'alfredo-pasta': ['pasta', 'alfredo pasta', 'pasta plate', 'alfredo'],
      'grilled-chicken': ['chicken', 'grilled chicken', 'chicken plate', 'grill'],
    };
    return products.map(p => ({
      ...p,
      aliases: [...(p.aliases || []), ...(foodAliases[p.id] || [])],
    }));
  }

  // ─── Quantity units ────────────────────────────────────────
  getQuantityUnits() {
    return {
      plate: 1,
      serving: 1,
      portion: 1,
      piece: 1,
      bowl: 1,
      cup: 1,
      glass: 1,
    };
  }
}

module.exports = RestaurantDemoAdapter;
