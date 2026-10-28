/**
 * v39.0 — Unified Service Capability
 *
 * This is the MATURE unified booking/service capability that handles ALL
 * service-based tenants: cleaning, salon, healthcare, education, driving school.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Unified Service Conversation Adapter (this file)            │
 * │                                                               │
 * │  Handles:                                                     │
 * │  1. Service browse ("what services do you offer?")             │
 * │  2. Service detail ("tell me about haircut")                   │
 * │  3. Quote request ("how much for deep cleaning?")             │
 * │  4. Booking trigger ("book a haircut for tomorrow")           │
 * │  5. Booking continuation (date, time, name, phone)            │
 * │  6. Booking confirmation                                      │
 * │  7. Reschedule / cancel                                       │
 * │  8. Domain-aware vocabulary (cleaning, salon, clinic, etc.)  │
 * │                                                               │
 * │  Uses tenant adapter for tenant-specific vocabulary + typos.  │
 * │  Uses booking service for the actual state machine + record.  │
 * │  Uses offering service for service list + details (when avail). │
 * │  Uses cleaning service for cleaning-specific pricing (when     │
 * │  tenant has cleaning capability).                              │
 * └─────────────────────────────────────────────────────────────┘
 *
 * The key difference from the old architecture: ONE adapter handles ALL
 * service types. No more separate cleaning adapter, offering adapter,
 * and booking adapter competing for the same message.
 */
const {
  normalizeText,
  numberFromText,
} = require("../../../packages/conversation-intelligence/src/text");
const {
  isConfirmation,
} = require("../../../packages/conversation-intelligence/src/confirmation");
const {
  extractFieldAmendment,
} = require("../../../packages/conversation-intelligence/src/fieldAmendmentExtractor");
const {
  hasAcquisitionCue,
} = require("../../../packages/conversation-intelligence/src/acquisitionIntent");

class UnifiedServiceConversationAdapter {
  constructor() {
    // v39.0: Uses 'booking' as capabilityId but with higher priority.
    // The registry is a Map keyed by capabilityId, so we can't register two
    // adapters with the same ID. Instead, we register with 'service' and
    // add 'service' to tenant capabilities alongside 'booking'.
    this.capabilityId = "service";
    this.priority = 115;
  }

  async analyze({ tenant, message, state, services, normalizedText, domain, clauseSemantics, temporal, messageFrame }) {
    // v39.0 debug
    if (tenant?.id === 'salon-demo') {
      console.warn('[UnifiedService] analyze called for salon-demo, services keys:', Object.keys(services || {}));
    }
    const b = services?.bookingService;
    const o = services?.offeringService;
    const c = services?.cleaningService;
    // v39.0 debug: log if services are missing
    if (!b && tenant?.capabilities?.includes('booking')) {
      // Only log if tenant should have booking but service is missing
      console.warn('[UnifiedService] bookingService missing for tenant', tenant.id, 'available keys:', Object.keys(services || {}).filter(k => k.toLowerCase().includes('book')));
    }
    if (!b) return null;
    const config = b.getConfig(tenant.id);
    if (!config?.enabled) return null;

    const primaryRaw = clauseSemantics?.primaryText || message.text;
    const text = normalizeText(primaryRaw) || normalizedText || normalizeText(message.text);
    const fullText = normalizedText || normalizeText(message.text);
    const active = state.capabilityState?.booking;
    const lang = state.language || 'english';
    const tenantDomain = tenant.domain || 'universal';

    // ═══════════════════════════════════════════════════════════════
    // v39.0: DOMAIN-AWARE SERVICE BROWSE
    // Handles "what services do you offer?" for ALL service types
    // ═══════════════════════════════════════════════════════════════
    const isServiceBrowse = this.detectServiceBrowse(text, tenantDomain);
    if (isServiceBrowse && !active?.status) {
      return this.pack("service.browse", 0.99, {}, "domain_service_browse", 200);
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: SERVICE DETAIL / QUOTE
    // "tell me about haircut" / "how much for deep cleaning?"
    // ═══════════════════════════════════════════════════════════════
    if (!active?.status || active.status === 'completed') {
      const serviceResult = this.detectServiceDetail(text, tenant, o, c);
      if (serviceResult) {
        if (serviceResult.type === 'detail') {
          return this.pack("service.detail", 0.995, { serviceId: serviceResult.serviceId, serviceName: serviceResult.serviceName }, "service_detail_match", 190);
        }
        if (serviceResult.type === 'quote') {
          return this.pack("service.quote", 0.99, { serviceId: serviceResult.serviceId, serviceName: serviceResult.serviceName, requestedText: text }, "service_quote_request", 185);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: BOOKING TRIGGER DETECTION
    // Universal: "book X", "schedule X", "reserve X", "i need X for tomorrow"
    // ═══════════════════════════════════════════════════════════════
    const bookingTrigger = this.detectBookingTrigger(text, fullText, config, tenantDomain, o, c, tenant);
    if (bookingTrigger) {
      return this.pack("booking.start", bookingTrigger.confidence, bookingTrigger.entities, bookingTrigger.reason, 195);
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: ACTIVE BOOKING WORKFLOW
    // Handle continuation: date, time, partySize, name, phone
    // ═══════════════════════════════════════════════════════════════
    if (active?.status === "ready" && isConfirmation(message.text)) {
      return this.pack("booking.confirm", 0.999, {}, "booking_confirmation");
    }
    if (active?.status === "collecting" || active?.status === "ready") {
      // Check for field amendments (customer wants to change name/phone)
      const fieldAmendment = extractFieldAmendment(message.text, { allowedFields: ['name', 'phone', 'email'] });
      if (fieldAmendment && (active.status === 'collecting' || active.status === 'ready')) {
        return this.pack("booking.field_edit", 0.999, { fieldAmendment }, "booking_field_amendment", 215);
      }
      return this.pack("booking.continue", 0.995, {}, "active_booking_workflow");
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: BOOKING MANAGEMENT
    // Cancel, reschedule, view bookings
    // ═══════════════════════════════════════════════════════════════
    if (/\b(?:cancel|stop)\b.*\b(?:booking|appointment|reservation|lesson|session|cleaning|service)\b/i.test(text) ||
        /\b(?:booking|appointment|reservation|cleaning|service)\b.*\b(?:cancel|stop)\b/i.test(text)) {
      return this.pack("booking.cancel", 0.99, {}, "booking_cancel_request", 200);
    }
    if (/\b(?:reschedule|move|change|shift)\b.*\b(?:booking|appointment|reservation|time|date|day)\b/i.test(text)) {
      return this.pack("booking.reschedule", 0.99, {}, "booking_reschedule_request", 200);
    }
    if (/\b(?:show|view|my).*(?:booking|appointment|reservation|request)s?\b/i.test(text)) {
      return this.pack("booking.list", 0.92, {}, "booking_history_request", 180);
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Detect service browse intent
  // ═══════════════════════════════════════════════════════════════
  detectServiceBrowse(text, domain) {
    // Universal patterns
    if (/\b(?:what|which|show|tell me|list|see).*(?:services?|treatments?|programs?|classes?|courses?|options?|packages?)\b/i.test(text)) return true;
    if (/\b(?:what|which).*(?:do you offer|do you have|do you provide|can i get|are available)\b/i.test(text)) return true;
    if (/\b(?:show|see|view)\s+(?:me\s+)?(?:your\s+)?(?:services?|menu|offerings?|options?|packages?)\b/i.test(text)) return true;
    // Domain-specific
    if (domain === 'cleaning' && /\b(?:what|which|show).*(?:cleaning|safai|services?)\b/i.test(text)) return true;
    if (domain === 'salon' && /\b(?:what|which|show).*(?:salon|beauty|hair|grooming|spa|services?)\b/i.test(text)) return true;
    if (domain === 'healthcare' && /\b(?:what|which|show).*(?:clinic|medical|doctor|consultation|services?)\b/i.test(text)) return true;
    if (domain === 'education' && /\b(?:what|which|show).*(?:programs?|courses?|classes?|grades?|admission)\b/i.test(text)) return true;
    if (domain === 'driving_school' && /\b(?:what|which|show).*(?:packages?|lessons?|courses?|driving)\b/i.test(text)) return true;
    // Roman Urdu
    if (/\b(?:aap\s+ke\s+paas|kya\s+kya|konsi|konsay).*(?:services?|cheezen|options?|courses?)\b/i.test(text)) return true;
    if (/\b(?:services?|safai|treatment|course)\s+(?:dikhao|batao|kya\s+hain)\b/i.test(text)) return true;
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Detect service detail or quote request
  // ═══════════════════════════════════════════════════════════════
  detectServiceDetail(text, tenant, offeringService, cleaningService) {
    // Check if this is a price/quote request
    const isQuote = /\b(?:price|cost|charge|rate|quote|how\s+much|kitna|kitni|kitne|qimat|qeemat)\b/i.test(text);
    // Check if this is a detail request
    const isDetail = /\b(?:tell me about|details?|info(?:rmation)?|about|what is)\b/i.test(text);

    // Try offering service first (salon, healthcare, education)
    if (offeringService) {
      const items = offeringService.list(tenant.id);
      if (items && items.length > 0) {
        const resolved = offeringService.resolve(tenant.id, text);
        if (resolved?.record && resolved.type !== 'none') {
          return {
            type: isQuote ? 'quote' : 'detail',
            serviceId: resolved.record.id,
            serviceName: resolved.record.name,
          };
        }
      }
    }

    // Try cleaning service (cleaning tenants)
    if (cleaningService) {
      const scoped = cleaningService.scope?.({ tenant, capabilityId: 'cleaning', customerId: 'scope-test', conversationId: 'scope-test' });
      if (scoped) {
        const found = scoped.findService(text);
        if (found?.service) {
          return {
            type: isQuote ? 'quote' : 'detail',
            serviceId: found.service.id,
            serviceName: found.service.name,
          };
        }
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Detect booking trigger
  // ═══════════════════════════════════════════════════════════════
  detectBookingTrigger(text, fullText, config, domain, offeringService, cleaningService, tenant) {
    // Check config trigger terms
    const triggerTerms = config.triggerTerms || [];
    const hasTrigger = triggerTerms.some(term => text.includes(normalizeText(term)));

    // Check for date/time in message (strong booking signal)
    const hasDate = /\b(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|kal|parson|parso)\b/i.test(fullText);
    const hasTime = /\b(?:\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2}|morning|afternoon|evening|night|subah|shaam)\b/i.test(fullText);
    const hasAcquisition = hasAcquisitionCue(fullText);

    // Check if a service is mentioned
    let serviceMatch = null;
    if (offeringService) {
      const resolved = offeringService.resolve(tenant.id, text);
      if (resolved?.record && resolved.type !== 'none') {
        serviceMatch = { id: resolved.record.id, name: resolved.record.name };
      }
    }
    if (!serviceMatch && cleaningService) {
      const scoped = cleaningService.scope?.({ tenant, capabilityId: 'cleaning', customerId: 'scope-test', conversationId: 'scope-test' });
      if (scoped) {
        const found = scoped.findService(text);
        if (found?.service) {
          serviceMatch = { id: found.service.id, name: found.service.name };
        }
      }
    }

    // Reservation-specific (restaurant)
    const hasReservation = /\b(?:table|reservation|reserve|party|guests?|seats?)\b/i.test(text);

    const bookingTrigger =
      hasTrigger ||
      (hasAcquisition && (hasDate || hasTime) && (serviceMatch || config.defaultSubject)) ||
      (hasReservation && (hasDate || hasTime || hasAcquisition));

    if (!bookingTrigger) return null;

    const entities = {};
    if (serviceMatch) {
      entities.subject = serviceMatch.name;
      entities.serviceId = serviceMatch.id;
    } else if (config.defaultSubject) {
      entities.subject = config.defaultSubject;
    }

    // Extract party size (restaurant)
    const partyMatch = text.match(/\b(?:for\s+)?(\d+)\s*(?:people|persons|guests|seats)\b|\b(?:table|reservation)\s+for\s+(\d{1,2})\b/i);
    if (partyMatch) {
      entities.partySize = Number(partyMatch[1] || partyMatch[2]);
    }

    return {
      confidence: serviceMatch ? 0.997 : 0.99,
      entities,
      reason: 'unified_booking_trigger',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Pack intent
  // ═══════════════════════════════════════════════════════════════
  pack(intent, confidence, entities, reason, priority = 110) {
    return {
      capabilityId: "service",
      intent,
      confidence,
      entities,
      priority,
      candidates: [{ intent, confidence, entities, reason }],
      vocabularyMatches: [],
    };
  }
}

module.exports = { UnifiedServiceConversationAdapter };
