/**
 * v46.0 — Context Resolution Engine
 *
 * Resolves pronouns and contextual references in customer messages using
 * the conversation's recent turns and CRM customer data.
 *
 * Examples:
 *   "book it again"        → looks up last booking in recent turns → reorder
 *   "same time as last week" → looks up last booking time → reuse time
 *   "use the same address" → looks up CRM lastKnownLocation → reuse address
 *   "change that to deep cleaning" → looks up last discussed service → modify
 *   "i'll have the usual"  → looks up last order → reorder
 *   "do it again"          → looks up last capability action → repeat
 *
 * The engine is deterministic — no LLM calls. It pattern-matches reference
 * phrases and looks up the resolved values from:
 *   1. state.context.recentTurns (last 6 customer messages + capability/intent)
 *   2. state.context.lastFailure (if the last turn failed, we know what to retry)
 *   3. CRM customer record (lastKnownLocation, lastOrderId, preferences)
 *   4. Commerce state (lastOrderId, cart items)
 *   5. Booking state (last bookingId, booking slots)
 *
 * The resolved context is injected into intelligence.resolvedContext so
 * adapters can use it without re-implementing the lookup logic.
 */
const { normalizeText } = require('../../conversation-intelligence/src/text');

// Reference patterns — phrases that indicate the customer is referring to
// something from a previous turn rather than stating a new request.
const REFERENCE_PATTERNS = {
  // "book it again", "do it again", "repeat that", "i'll have the usual"
  // Note: normalizeText strips apostrophes, so "i'll" becomes "i ll"
  repeat: /\b(?:book (?:it|that|this) again|do (?:it|that) again|repeat (?:that|it|the)|same (?:order|thing|usual)|i\s?ll have (?:the usual|my usual)|phir se|dobara|again)\b/i,
  // "same time as last week", "same time", "same day"
  sameTime: /\b(?:same time|same day|same slot|last week|pichli baar|پچھلی بار|pichla waqt)\b/i,
  // "same address", "same location", "use the same address"
  sameAddress: /\b(?:same address|same location|use (?:the|my) same|pichla address|پچھلا پتہ)\b/i,
  // "change that to X", "update that", "switch that"
  changeReference: /\b(?:change (?:that|it|this)|update (?:that|it|this)|switch (?:that|it)|modify (?:that|it))\b/i,
  // "the same one", "that one", "this one" (when not followed by a new product name)
  sameItem: /\b(?:the same one|that one|this one|same (?:product|item|service))\b/i,
  // "also add one more" — implicit reference to the last product
  alsoMore: /\b(?:also|too|bhi|aur)\b.*\b(?:one more|another|ek aur|1 more)\b/i,
};

class ContextResolutionEngine {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Resolve contextual references in the customer's message.
   *
   * @param {object} params - { message, state, customer, services }
   * @returns {object} resolved context:
   *   {
   *     hasReference: boolean,         // true if any reference pattern matched
   *     referenceType: string|null,    // 'repeat' | 'sameTime' | 'sameAddress' | 'changeReference' | 'sameItem' | 'alsoMore'
   *     lastCapability: string|null,   // last non-assistant/system capability
   *     lastIntent: string|null,       // last intent from recent turns
   *     lastBookingId: string|null,     // from booking state
   *     lastOrderId: string|null,       // from commerce state
   *     lastServiceName: string|null,  // from recent turns entity snapshot
   *     lastProductIds: string[],      // from cart state
   *     lastTime: string|null,         // from booking state slots
   *     lastDate: string|null,         // from booking state slots
   *     lastAddress: object|null,      // from CRM customer
   *     resolvedEntities: object,      // entities to inject if the adapter uses them
   *   }
   */
  resolve({ message, state, customer = null, services = null }) {
    const text = String(message?.text || '');
    const normalized = normalizeText(text);
    const result = {
      hasReference: false,
      referenceType: null,
      lastCapability: null,
      lastIntent: null,
      lastBookingId: null,
      lastOrderId: null,
      lastServiceName: null,
      lastProductIds: [],
      lastTime: null,
      lastDate: null,
      lastAddress: null,
      resolvedEntities: {},
    };

    // Detect reference patterns
    for (const [type, pattern] of Object.entries(REFERENCE_PATTERNS)) {
      if (pattern.test(normalized)) {
        result.hasReference = true;
        result.referenceType = type;
        break;
      }
    }

    // Always populate the context lookup fields — adapters can use them
    // even when there's no explicit reference pattern (e.g., "change to 5pm"
    // implicitly refers to the active booking's date).
    this._populateFromRecentTurns(state, result);
    this._populateFromBookingState(state, result);
    this._populateFromCommerceState(state, result);
    this._populateFromCustomer(customer, result);

    // If a reference was detected, build resolved entities
    if (result.hasReference) {
      result.resolvedEntities = this._buildResolvedEntities(result, normalized);
    }

    return result;
  }

  /**
   * Look up the last non-assistant/system capability from recent turns.
   */
  _populateFromRecentTurns(state, result) {
    const turns = state?.context?.recentTurns || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn.capabilityId && !['assistant', 'system', 'human_takeover'].includes(turn.capabilityId)) {
        result.lastCapability = turn.capabilityId;
        result.lastIntent = turn.intent || null;
        // Try to extract service/product name from the turn text
        const turnText = String(turn.text || '').toLowerCase();
        // Look for common service/product keywords
        const serviceMatch = turnText.match(/\b(?:beard grooming|haircut|hair styling|facial|hair color|deep cleaning|standard cleaning|sofa cleaning|carpet cleaning|general consultation|dermatology|physiotherapy)\b/);
        if (serviceMatch) result.lastServiceName = serviceMatch[0];
        break;
      }
    }
  }

  /**
   * Look up booking state for last booking ID, time, date.
   */
  _populateFromBookingState(state, result) {
    const booking = state?.capabilityState?.booking;
    if (booking?.bookingId) result.lastBookingId = booking.bookingId;
    if (booking?.slots?.time) result.lastTime = booking.slots.time;
    if (booking?.slots?.date) result.lastDate = booking.slots.date;
    if (booking?.items?.length) {
      const lastItem = booking.items[booking.items.length - 1];
      if (lastItem?.name) result.lastServiceName = lastItem.name;
    }
  }

  /**
   * Look up commerce state for last order ID and cart product IDs.
   */
  _populateFromCommerceState(state, result) {
    const commerce = state?.capabilityState?.commerce;
    if (commerce?.lastOrderId) result.lastOrderId = commerce.lastOrderId;
    // Cart items
    const cart = state?.capabilityState?.commerce;
    if (cart?.pendingMultiItemDraft?.length) {
      result.lastProductIds = cart.pendingMultiItemDraft.map(item => item.productId).filter(Boolean);
    }
  }

  /**
   * Look up CRM customer record for address and order history.
   */
  _populateFromCustomer(customer, result) {
    if (!customer) return;
    const customFields = customer.customFields || {};
    const lastKnownLocation = customFields.lastKnownLocation || customFields.lastDelivery || {};
    if (lastKnownLocation.address || customer.address) {
      result.lastAddress = {
        address: lastKnownLocation.address || customer.address || null,
        city: lastKnownLocation.city || null,
        landmark: lastKnownLocation.landmark || null,
      };
    }
  }

  /**
   * Build resolved entities that adapters can use when the customer makes
   * a contextual reference.
   */
  _buildResolvedEntities(result, normalizedText) {
    const entities = {};
    // "same time as last week" → inject lastTime as the time entity
    if (result.referenceType === 'sameTime' && result.lastTime) {
      entities.time = result.lastTime;
      entities.resolvedTime = result.lastTime;
    }
    // "same address" → inject lastAddress
    if (result.referenceType === 'sameAddress' && result.lastAddress) {
      entities.address = result.lastAddress.address;
      entities.city = result.lastAddress.city;
      entities.landmark = result.lastAddress.landmark;
      entities.resolvedAddress = true;
    }
    // "book it again" / "repeat" → inject lastServiceName and lastCapability
    if (result.referenceType === 'repeat') {
      if (result.lastServiceName) entities.subject = result.lastServiceName;
      if (result.lastCapability) entities.resumedCapability = result.lastCapability;
      if (result.lastOrderId) entities.reorderId = result.lastOrderId;
      if (result.lastBookingId) entities.rebookingId = result.lastBookingId;
    }
    // "change that to X" → inject lastCapability as the target
    if (result.referenceType === 'changeReference') {
      if (result.lastCapability) entities.targetCapability = result.lastCapability;
    }
    return entities;
  }

  /**
   * Get a human-readable summary for debugging.
   */
  getSummary(resolved) {
    const parts = [];
    if (resolved.hasReference) parts.push(`reference: ${resolved.referenceType}`);
    if (resolved.lastCapability) parts.push(`lastCapability: ${resolved.lastCapability}`);
    if (resolved.lastIntent) parts.push(`lastIntent: ${resolved.lastIntent}`);
    if (resolved.lastServiceName) parts.push(`lastService: ${resolved.lastServiceName}`);
    if (resolved.lastBookingId) parts.push(`lastBooking: ${resolved.lastBookingId}`);
    if (resolved.lastOrderId) parts.push(`lastOrder: ${resolved.lastOrderId}`);
    if (resolved.lastTime) parts.push(`lastTime: ${resolved.lastTime}`);
    if (resolved.lastAddress) parts.push(`lastAddress: ${resolved.lastAddress.address}`);
    return parts.join(', ') || 'no context resolved';
  }
}

module.exports = { ContextResolutionEngine, REFERENCE_PATTERNS };
