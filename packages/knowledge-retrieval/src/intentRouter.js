/**
 * v56.0 — Intent Router
 *
 * Classifies customer intent + entities and routes the request to the correct
 * source(s). Wraps the existing multi-intent-router / ml-intent-classifier
 * infrastructure behind a single interface that produces the spec §4 Step 2
 * output shape:
 *
 *   { intent, entities, requiredSources, missingFields, confidence }
 *
 * Spec reference: §4 Step 2 (Detect intent and entities), §4 Step 3 (Route)
 *
 * Routing rules (spec §5 authority):
 *   - pricing_inquiry        → pricingService (NOT RAG)
 *   - availability_inquiry   → availabilityService (NOT RAG)
 *   - booking_intent         → bookingService (NOT RAG)
 *   - order_inquiry          → commerceService (NOT RAG)
 *   - business_info          → business configuration (structured, not RAG)
 *   - faq / policy / service_inquiry → RAG (knowledge retrieval)
 *   - complaint / unknown    → CRM/escalation
 *
 * Architecture rule: the classifier NEVER executes a business action. It only
 * produces a routing decision. Execution is the ExecutionEngine's job.
 */

/**
 * Built-in deterministic intent rules. High-confidence, well-defined patterns.
 * An LLM classifier can extend this; rules are the fast path.
 */
const INTENT_RULES = [
  // Pricing
  { pattern: /\b(how much|price|cost|charge|fee|pricing)\b/i, intent: 'pricing_inquiry',
    entities: ['service'], requiredSources: ['pricing', 'service_catalog'] },
  // Availability
  { pattern: /\b(available|availability|open tomorrow|free slot|slot)\b/i, intent: 'availability_inquiry',
    entities: ['date', 'service'], requiredSources: ['availability'] },
  // Booking
  { pattern: /\b(book|booking|reserve|reservation|appointment|schedule)\b/i, intent: 'booking_intent',
    entities: ['service', 'date', 'time'], requiredSources: ['booking', 'availability'] },
  // Order
  { pattern: /\b(where is my order|order status|track order|my order)\b/i, intent: 'order_inquiry',
    entities: ['orderId'], requiredSources: ['commerce'] },
  // Complaint
  { pattern: /\b(complaint|complain|unhappy|dissatisfied|refund|issue|problem)\b/i, intent: 'complaint',
    entities: ['orderId', 'service'], requiredSources: ['crm', 'escalation'] },
  // Policy
  { pattern: /\b(cancellation|cancel|refund policy|reschedule|rescheduling|notice)\b/i, intent: 'policy_inquiry',
    entities: ['policyTopic'], requiredSources: ['customer_policy'] },
  { pattern: /\b(parking|pets?|dogs?|cats?|fragrance|smoking|deposit)\b.{0,40}\b(allow|permitted|welcome|policy|fee|charge|bring|restriction)\b/i, intent: 'policy_inquiry',
    entities: ['policyTopic'], requiredSources: ['customer_policy'] },
  { pattern: /\b(do you (?:allow|permit|have).{0,30}(?:parking|pets?|dogs?|cats?|fragrance|smoking))\b/i, intent: 'policy_inquiry',
    entities: ['policyTopic'], requiredSources: ['customer_policy'] },
  // Service inquiry (descriptive)
  { pattern: /\b(what (is|are) included|what does .{0,20} include|service detail|deep cleaning|standard cleaning)\b/i, intent: 'service_inquiry',
    entities: ['service'], requiredSources: ['service_catalog', 'document'] },
  // Business info (structured)
  { pattern: /\b(where (are you|is your) located|location|address)\b/i, intent: 'business_info',
    entities: ['infoType=location'], requiredSources: ['business_config'] },
  { pattern: /\b(what (time|hours)|open|close|check.?in|check.?out)\b/i, intent: 'business_info',
    entities: ['infoType=hours'], requiredSources: ['business_config'] },
  { pattern: /\b(phone number|contact|email|reach you)\b/i, intent: 'business_info',
    entities: ['infoType=contact'], requiredSources: ['business_config'] },
  // FAQ (catch-all knowledge)
  { pattern: /\b(do you (have|offer|provide|serve)|can i|are you allowed|is it permitted)\b/i, intent: 'faq',
    entities: [], requiredSources: ['faq_collection', 'document'] },
];

/**
 * Entity extractors. Pull named entities out of the message for routing + missing-field detection.
 */
function extractEntities(text) {
  const t = String(text || '');
  const entities = {};
  // Service: look for known service keywords.
  const serviceMatch = t.match(/\b(deep cleaning|standard cleaning|move.?in cleaning|move.?out cleaning|carpet cleaning|sofa cleaning|kitchen cleaning|bathroom cleaning|window cleaning)\b/i);
  if (serviceMatch) entities.service = serviceMatch[1].toLowerCase().replace(/\s+/g, '_');
  // Property type.
  const propMatch = t.match(/\b(apartment|flat|villa|house|studio|office|shop)\b/i);
  if (propMatch) entities.propertyType = propMatch[1].toLowerCase();
  // Date: simple "tomorrow", "today", "monday", "next week".
  const dateMatch = t.match(/\b(today|tomorrow|day after tomorrow|next week|this weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dateMatch) entities.date = dateMatch[1].toLowerCase();
  // Time.
  const timeMatch = t.match(/\b(\d{1,2}\s*(?:am|pm)?|morning|afternoon|evening|noon)\b/i);
  if (timeMatch) entities.time = timeMatch[1].toLowerCase();
  // Order ID.
  const orderIdMatch = t.match(/\b(?:order|booking)\s*(?:id|number|#)?\s*[:#]?\s*([A-Z0-9-]{6,})\b/i);
  if (orderIdMatch) entities.orderId = orderIdMatch[1];
  return entities;
}

class IntentRouter {
  constructor({ rules = INTENT_RULES, classifier = null, logger = null } = {}) {
    this.rules = rules;
    this.classifier = classifier; // optional LLM/ml classifier for broader understanding
    this.logger = logger;
  }

  /**
   * Classify a customer message.
   * @param {string} text
   * @returns {{intent, entities, requiredSources, missingFields, confidence, originalText}}
   */
  classify(text) {
    const originalText = String(text || '');
    const entities = extractEntities(originalText);

    // Try deterministic rules first (fast path).
    let matchedRule = null;
    for (const rule of this.rules) {
      if (rule.pattern.test(originalText)) { matchedRule = rule; break; }
    }

    let intent = matchedRule ? matchedRule.intent : 'unknown';
    let requiredSources = matchedRule ? matchedRule.requiredSources : [];
    let confidence = matchedRule ? 0.9 : 0.3;

    // Merge entities declared as 'key=value' in the rule with extracted entities.
    // Rule entities like 'infoType=location' set the entity directly.
    if (matchedRule && Array.isArray(matchedRule.entities)) {
      for (const e of matchedRule.entities) {
        if (typeof e === 'string' && e.includes('=')) {
          const [k, v] = e.split('=');
          if (!entities[k]) entities[k] = v;
        }
      }
    }

    // Optional LLM classifier override for low-confidence cases.
    if (this.classifier && confidence < 0.6) {
      try {
        const ll = this.classifier.classify(originalText);
        if (ll && ll.intent && ll.confidence > confidence) {
          intent = ll.intent;
          confidence = ll.confidence;
          if (ll.requiredSources) requiredSources = ll.requiredSources;
        }
      } catch (err) {
        this.logger?.warn?.('intentRouter.classifier_failed', { error: err.message });
      }
    }

    // Detect missing required fields → triggers clarification (spec §4 Step 8).
    const missingFields = [];
    if (intent === 'pricing_inquiry' && !entities.service) missingFields.push('service');
    if (intent === 'booking_intent') {
      if (!entities.service) missingFields.push('service');
      if (!entities.date) missingFields.push('date');
    }
    if (intent === 'order_inquiry' && !entities.orderId) missingFields.push('orderId');

    return { intent, entities, requiredSources, missingFields, confidence, originalText };
  }

  /**
   * Decide whether the intent should be served by RAG (knowledge retrieval)
   * or by a structured/transactional system.
   * @returns {boolean}
   */
  isKnowledgeIntent(intent) {
    return ['faq', 'policy_inquiry', 'service_inquiry'].includes(intent);
  }

  /**
   * Decide whether the intent should be served by a structured system
   * (pricing, availability, booking, order, business info).
   */
  isStructuredIntent(intent) {
    return ['pricing_inquiry', 'availability_inquiry', 'booking_intent', 'order_inquiry', 'business_info'].includes(intent);
  }

  /**
   * Decide whether the intent needs escalation (complaint, unknown).
   */
  isEscalationIntent(intent) {
    return ['complaint'].includes(intent);
  }
}

module.exports = { IntentRouter, INTENT_RULES, extractEntities };
