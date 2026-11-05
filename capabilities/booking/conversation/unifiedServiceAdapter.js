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
    // v42.0 (Sprint 2): EARLY modification-intent detection
    // ─────────────────────────────────────────────────────────────────
    // These intents must be detected BEFORE service detail / booking trigger
    // detection, otherwise "cancel my booking" matches the trigger term
    // "book" (as a substring of "booking") and starts a new booking instead
    // of cancelling the existing one. Same trap applies to:
    //   - "remove X from my booking" (matches "book")
    //   - "swap X for Y" (matches neither, but we want a single detection point)
    //   - "add a note", "this is for my wife Sara"
    //   - "show my bookings" / "list my appointments"
    // Each pattern below short-circuits with a high-priority intent.
    // ═══════════════════════════════════════════════════════════════

    // (a) Cancel — works whether or not there's an active booking.
    if (/\b(?:cancel|stop)\b.*\b(?:booking|appointment|reservation|lesson|session|cleaning|service)\b/i.test(text) ||
        /\b(?:booking|appointment|reservation|cleaning|service)\b.*\b(?:cancel|stop)\b/i.test(text) ||
        /\bcancel\s+(?:my\s+)?(?:booking|appointment|it|this)\b/i.test(text)) {
      return this.pack("booking.cancel", 0.999, {}, "booking_cancel_request", 230);
    }

    // (b) List / show bookings.
    if (/\b(?:show|view|see|list)\s+(?:my\s+)?(?:booking|appointment|reservation|request)s?\b/i.test(text) ||
        /\bmy\s+(?:booking|appointment|reservation|request)s?\b/i.test(text)) {
      return this.pack("booking.list", 0.95, {}, "booking_history_request", 200);
    }

    // (c) For active bookings only — these need an active workflow to modify.
    if (active?.status === "collecting" || active?.status === "ready") {
      // Remove a single service from the booking
      if (/\b(?:remove|delete|drop|take\s+out|take\s+off)\b/i.test(text) && o && this._findMentionedOffering(text, tenant, o)) {
        const mentioned = this._findMentionedOffering(text, tenant, o);
        return this.pack("booking.remove_item", 0.999, { offeringId: mentioned.id, offeringName: mentioned.name }, "booking_remove_item_active", 232);
      }
      // Swap one service for another
      if (/\b(?:swap|replace|exchange)\b\s+(?:the\s+|my\s+)?(.+?)\s+(?:for|with|to)\s+(.+)/i.test(text)) {
        const swapMatch = text.match(/\b(?:swap|replace|exchange)\b\s+(?:the\s+|my\s+)?(.+?)\s+(?:for|with|to)\s+(.+)/i);
        if (swapMatch && o) {
          const fromName = swapMatch[1].trim();
          const toName = swapMatch[2].trim();
          const fromResolved = o.resolve(tenant.id, fromName);
          const toResolved = o.resolve(tenant.id, toName);
          if (fromResolved?.record && toResolved?.record) {
            return this.pack("booking.swap_item", 0.9999, {
              fromOfferingId: fromResolved.record.id, fromOfferingName: fromResolved.record.name,
              toOfferingId: toResolved.record.id, toOfferingName: toResolved.record.name,
            }, "booking_swap_item_active", 232);
          }
          if (toResolved?.record) {
            return this.pack("booking.service_change", 0.9999, { subject: toResolved.record.name, serviceId: toResolved.record.id }, "booking_service_change_active", 225);
          }
        }
      }
      // Add a note for the service provider
      if (/\b(?:add|leave|put|include)\b\s+(?:a\s+)?(?:note|instruction|remark|message)\b/i.test(text) ||
          /\b(?:note|instruction|remark)\s*[:\-]\s*(.+)/i.test(message.text) ||
          /\b(?:note|instruction|message)\s+(?:laga\s*do|likh\s*do|likho|karna\s+hai)\b/i.test(message.text)) {
        const noteMatch = message.text.match(/(?:note|instruction|remark|message)\s*[:\-]\s*(.+?)(?:\.|$)/i);
        const note = noteMatch ? noteMatch[1].trim() : null;
        return this.pack("booking.add_note", 0.999, { note }, "booking_add_note_active", 222);
      }
      // Recipient change
      if (/\b(?:this\s+is\s+for|book\s+for|appointment\s+is\s+for|booking\s+is\s+for|reserve\s+for)\s+(?:my\s+)?(.+)/i.test(text) ||
          /\b(?:change\s+the\s+name\s+to|change\s+name\s+to)\s+(.+)/i.test(text)) {
        const recipientMatch = message.text.match(/(?:this\s+is\s+for|book\s+for|appointment\s+is\s+for|booking\s+is\s+for|reserve\s+for|change\s+the\s+name\s+to|change\s+name\s+to)\s+(?:my\s+)?(.+)/i);
        const recipientName = recipientMatch ? recipientMatch[1].trim() : null;
        if (recipientName) {
          return this.pack("booking.recipient_change", 0.999, { recipientName }, "booking_recipient_change_active", 222);
        }
      }
      // Party size change (restaurant)
      if (/\b(?:change|update|make)\b.*\b(?:to|for)?\s*\d+\s*(?:people|persons|guests|seats)\b/i.test(text)) {
        return this.pack("booking.party_size_change", 0.999, {}, "booking_party_size_change_active", 220);
      }
      // Service change ("change to beard grooming")
      if (/\b(?:change|switch|update)\b.*\b(?:to|service|treatment|program)\b/i.test(text) && o) {
        const serviceNameMatch = text.match(/(?:change|switch|update)\s+(?:to\s+)?(.+)/i);
        const serviceName = serviceNameMatch ? serviceNameMatch[1].trim() : text;
        const resolved = o.resolve(tenant.id, serviceName);
        if (resolved?.record && resolved.type !== 'none') {
          return this.pack("booking.service_change", 0.9999, { subject: resolved.record.name, serviceId: resolved.record.id }, "booking_service_change_active", 225);
        }
      }
      // Field amendment (name/phone/email change)
      const fieldAmendment = extractFieldAmendment(message.text, { allowedFields: ['name', 'phone', 'email'] });
      if (fieldAmendment) {
        return this.pack("booking.field_edit", 0.999, { fieldAmendment }, "booking_field_amendment", 215);
      }
      // Reschedule
      if (/\b(?:change|move|reschedule|shift)\b.*\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+week)\b/i.test(text) ||
          /\b(?:change|move|reschedule|shift)\b.*\b(?:\d{1,2}\s*(?:am|pm|:\d{2}))\b/i.test(text) ||
          /\b(?:change|move|reschedule)\b.*\b(?:date|time|day|slot|schedule)\b/i.test(text)) {
        return this.pack("booking.reschedule", 0.999, {}, "booking_reschedule_active", 220);
      }
    }

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
      // v41.0: Guard against cleaning service access for tenants without cleaning capability
      const hasCleaning = tenant?.capabilities?.includes('cleaning');
      const safeCleaning = hasCleaning ? c : null;
      try {
        const serviceResult = this.detectServiceDetail(text, tenant, o, safeCleaning);
        if (serviceResult) {
          if (serviceResult.type === 'detail') {
            return this.pack("service.detail", 0.995, { serviceId: serviceResult.serviceId, serviceName: serviceResult.serviceName }, "service_detail_match", 190);
          }
          if (serviceResult.type === 'quote') {
            return this.pack("service.quote", 0.99, { serviceId: serviceResult.serviceId, serviceName: serviceResult.serviceName, requestedText: text }, "service_quote_request", 185);
          }
        }
      } catch (err) {
        // Silently skip — if service detection fails, fall through to booking trigger
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: BOOKING TRIGGER DETECTION
    // Universal: "book X", "schedule X", "reserve X", "i need X for tomorrow"
    // ═══════════════════════════════════════════════════════════════
    // v41.0: Guard cleaning access in booking trigger detection too
    const hasCleaningForTrigger = tenant?.capabilities?.includes('cleaning');
    const safeCleaningForTrigger = hasCleaningForTrigger ? c : null;
    const bookingTrigger = this.detectBookingTrigger(text, fullText, config, tenantDomain, o, safeCleaningForTrigger, tenant);
    if (bookingTrigger) {
      return this.pack("booking.start", bookingTrigger.confidence, bookingTrigger.entities, bookingTrigger.reason, 195);
    }

    // ═══════════════════════════════════════════════════════════════
    // v39.0: ACTIVE BOOKING WORKFLOW (continuation only)
    // All modification intents (cancel/remove/swap/note/recipient/etc) are
    // detected EARLIER in the v42.0 block above. This block now only
    // handles the "confirm" / "continue" intents for an active workflow.
    // ═══════════════════════════════════════════════════════════════
    if (active?.status === "ready" && isConfirmation(message.text)) {
      return this.pack("booking.confirm", 0.999, {}, "booking_confirmation");
    }
    if (active?.status === "collecting" || active?.status === "ready") {
      return this.pack("booking.continue", 0.995, {}, "active_booking_workflow");
    }

    return null;
  }

  // v42.0 helper: find mentioned offering in text (used by remove_item detection)
  _findMentionedOffering(text, tenant, offeringService) {
    if (!offeringService) return null;
    try {
      const items = offeringService.list(tenant.id);
      if (!items?.length) return null;
      for (const item of items) {
        const names = [item.name, ...(item.aliases || [])].map(n => n.toLowerCase());
        if (names.some(n => text.toLowerCase().includes(n))) {
          return item;
        }
      }
    } catch (_e) { /* ignore */ }
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
  // v42.0: Returns null when the message contains a booking trigger keyword
  // ("book", "schedule", "reserve", "tomorrow", "at 5pm", etc), so that the
  // booking trigger detection downstream can fire instead. Without this guard,
  // "book beard grooming tomorrow at 5pm" was misrouted to service.detail
  // because the text contains "beard grooming" (which o.resolve matches).
  // ═══════════════════════════════════════════════════════════════
  detectServiceDetail(text, tenant, offeringService, cleaningService) {
    // v42.0: Booking-trigger guard — don't intercept messages that look like
    // an actual booking request (they will be handled by detectBookingTrigger).
    const hasBookingTrigger = /\b(?:book|schedule|reserve|reservation|appointment|arrange)\b/i.test(text);
    const hasDateOrTime = /\b(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|kal|parson|parso)\b/i.test(text) ||
                          /\b(?:\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2}|morning|afternoon|evening|night|subah|shaam)\b/i.test(text);
    if (hasBookingTrigger || hasDateOrTime) return null;

    // Check if this is a price/quote request
    const isQuote = /\b(?:price|cost|charge|rate|quote|how\s+much|kitna|kitni|kitne|qimat|qeemat)\b/i.test(text);
    // Check if this is a detail request
    const isDetail = /\b(?:tell me about|details?|info(?:rmation)?|about|what is)\b/i.test(text);

    // v42.0: If neither quote nor detail keyword is present, don't return a match.
    // Previously this defaulted to 'detail' for any message mentioning a service,
    // which intercepted real booking requests. Now we require an explicit detail
    // keyword ("tell me about", "details of", "what is X") to return service.detail.
    if (!isQuote && !isDetail) return null;

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
