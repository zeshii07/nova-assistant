const {
  IntentEngine,
} = require("../../../packages/assistant/src/intentEngine");
const {
  extractQueryFacets,
} = require("../../../packages/conversation-intelligence/src/queryFacetExtractor");
const {
  hasAcquisitionCue,
} = require("../../../packages/conversation-intelligence/src/acquisitionIntent");
class AssistantConversationAdapter {
  constructor() {
    this.capabilityId = "assistant";
    this.priority = 20;
    this.intentEngine = new IntentEngine();
  }
  async analyze({ message, tenant, services, messageFrame }) {
    const r = this.intentEngine.detect(message.text),
      candidates = [];
    if (looksLikeRestrictedDataRequest(message.text)) {
      const entities = {
        scope:
          /\b(other|another|different)\s+(?:tenant|business|company)\b/i.test(
            message.text,
          )
            ? "cross_tenant"
            : "customer_data",
      };
      return {
        priority: this.priority,
        candidates: [
          {
            intent: "assistant.data_access_denied",
            confidence: 1,
            priority: 220,
            entities,
            reason: "customer_channel_restricted_data_request",
          },
        ],
        entities,
        vocabularyMatches: [
          { type: "safety_boundary", value: "restricted_data", score: 1 },
        ],
      };
    }
    if (looksLikeRefundAction(message.text)) {
      const entities = { requestedAction: "refund" };
      return {
        priority: this.priority,
        candidates: [
          {
            intent: "assistant.refund_action_requires_authorization",
            confidence: 1,
            priority: 210,
            entities,
            reason: "refund_requires_business_authorization",
          },
        ],
        entities,
        vocabularyMatches: [
          { type: "safety_boundary", value: "refund_authorization", score: 1 },
        ],
      };
    }
    const domainQuery = detectDomainQuery(message.text, tenant);
    if (domainQuery && !tenantSupportsDomain(tenant, domainQuery)) {
      candidates.push({
        intent: "assistant.domain_mismatch",
        confidence: 1,
        priority: 140,
        entities: {
          requestedDomain: domainQuery,
          currentDomain: tenant.domain || null,
        },
        reason: "query_targets_unconfigured_business_domain",
      });
      return {
        priority: this.priority,
        candidates,
        entities: candidates[0].entities,
        vocabularyMatches: [
          { type: "domain_boundary", value: domainQuery, score: 1 },
        ],
      };
    }
    if (
      domainQuery === "healthcare" &&
      /\b(doctors?|doctor on board|physicians?|providers?)\b/i.test(
        message.text,
      )
    ) {
      candidates.push({
        intent: "assistant.provider_summary",
        confidence: 1,
        priority: 130,
        entities: { requestedDomain: "healthcare" },
        reason: "healthcare_provider_summary",
      });
      return {
        priority: this.priority,
        candidates,
        entities: candidates[0].entities,
        vocabularyMatches: [
          { type: "provider_query", value: "healthcare", score: 1 },
        ],
      };
    }
    const requestedArea = extractRequestedServiceArea(message.text);
    if (requestedArea) {
      const entities = { facets: ["service_area"], requestedArea };
      candidates.push({
        intent: "assistant.knowledge_question",
        confidence: 1,
        priority: 155,
        entities,
        reason: "tenant_service_area_question",
      });
      return {
        priority: this.priority,
        candidates,
        entities,
        vocabularyMatches: [
          { type: "knowledge_facet", value: "service_area", score: 1 },
        ],
      };
    }
    const facets = extractQueryFacets(message.text);
    const framedAcquisition = (messageFrame?.intents || []).some((item) =>
      ["booking.create", "order.create"].includes(item.intent),
    );
    const operationalCompound =
      framedAcquisition ||
      (hasAcquisitionCue(message.text) &&
        /\b(cleaners?|cleaning|service|appointment|booking|order|products?)\b/i.test(
          message.text,
        ));
    const concreteNewRequest =
      /\b\d+\s*(?:cleaners?|maids?|bedrooms?|bhk|balcon(?:y|ies)|windows?|items?|products?)\b|\binside (?:refrigerator|oven)\b/i.test(
        message.text,
      );
    if (facets.length >= 2 && !operationalCompound) {
      candidates.push({
        intent: "assistant.multi_info_question",
        confidence: 1,
        priority: 120,
        entities: { facets },
        reason: "multi_business_information_question",
      });
    }
    const explicitInformationRequest =
      /\b(?:information|details?|tell me about|explain|what|which|where|when|why|how|policy|fee|documents?|should i|pets?|dogs?|cats?|stay home|be at home|present during)\b/i.test(
        message.text,
      );
    const informational =
      (!operationalCompound ||
        (explicitInformationRequest && !concreteNewRequest)) &&
      looksInformational(message.text, r.intent);
    const retrieval = informational
      ? services.knowledgeService?.retrieve(message.text, tenant, {
          limit: 4,
          minScore: 0.16,
          minMargin: 0.025,
          minSemantic: 0.12,
          kinds: ["document", "faq_collection", "business_profile"],
        })
      : null;

    if (informational) {
      candidates.push({
        intent: "assistant.knowledge_question",
        confidence: 1,
        priority: 150,
        entities: {
          knowledgeConfidence: retrieval?.confidence || 0,
          knowledgeAnswerable: Boolean(retrieval?.answerable),
        },
        reason: retrieval?.answerable
          ? "approved_tenant_knowledge"
          : "knowledge_question_abstention",
      });
    }

    const mixedTask =
      /\b(can i|get|do you have|do you sell|i want|i need|show me|order|buy|purchase|book|schedule|clean|cleaned|cleaner|cleaning|sofas?|mattresses?|product|shoes?|shirt|earbuds?)\b/i.test(
        message.text,
      );
    const socialOnly = new Set(["greet", "thanks", "small_talk", "goodbye"]);
    const confidence =
      mixedTask && socialOnly.has(r.intent) ? 0.35 : r.confidence;
    if (r.intent !== "other")
      candidates.push({
        intent: `assistant.${r.intent}`,
        confidence,
        entities: {},
        reason: mixedTask ? "assistant_social_prefix" : "assistant_rule",
      });
    return {
      priority: this.priority,
      candidates,
      entities: {},
      vocabularyMatches: candidates.map((x) => ({
        type: "assistant_intent",
        value: x.intent,
        score: x.confidence,
      })),
    };
  }
}

function looksInformational(text, detectedIntent = "other") {
  const n = String(text || "")
    .toLowerCase()
    .trim();
  if (!n) return false;

  // High-value informational themes. These may override an over-broad identity
  // detector because they are clearly asking for tenant facts/policies.
  const cancellationQuestion =
    /\b(cancel|cancellation|cancelled|canceled)\b/.test(n) &&
    /\b(can i|could i|may i|how|policy|fee|allowed|possible|booked|booking|service)\b/.test(
      n,
    );
  if (cancellationQuestion) return true;
  const reschedulePolicy =
    /\b(reschedule|rescheduling|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/.test(
      n,
    ) && /\b(how|policy|fee|charge|cost|pay|hours?|before)\b/.test(n);
  if (reschedulePolicy) return true;
  const arrivalPolicy =
    /\b(haven(?:'t| not) arrived|officially late|arrival window|how late|(?:are|is) (?:the )?(?:cleaners?|team|staff) late|(?:cleaners?|team|staff) (?:are|is) late)\b/.test(
      n,
    );
  if (arrivalPolicy) return true;
  // "Please confirm availability and price" is an action request, not a
  // policy question. Own only questions asking whether a quote itself created
  // a confirmed appointment.
  const confirmationPolicy =
    /\b(?:does (?:that|this) mean|am i|is (?:my|the))\b.{0,80}\bconfirm(?:ed|ation)?\b/.test(
      n,
    ) ||
    /\b(?:quote|quotation|estimate|price|cost)\b.{0,50}\b(?:mean|make)\b.{0,30}\bconfirm(?:ed|ation)?\b/.test(
      n,
    );
  if (confirmationPolicy) return true;
  const limitationPolicy =
    /\b(high[ -]?rise|climb(?:ing)? outside|unsafe height|fragrance[ -]?free|pet surcharge|pet fee|heavy pet hair)\b/.test(
      n,
    );
  if (limitationPolicy) return true;
  const requirementsQuestion =
    /\b(?:what|which)\s+(?:documents?|paperwork|requirements?)\b|\bwhat (?:documents? )?(?:do|might|will) i need\b|\bdocuments? (?:do|might|will) i need\b/.test(
      n,
    );
  if (requirementsQuestion) return true;

  const explicitKnowledgeTheme =
    /\b(serving areas?|service areas?|areas? (?:do you|you) serve|where do you (?:serve|operate|work))\b/.test(
      n,
    ) ||
    /\b(parking|pets?|dogs?|cats?|wardrobe|heavy furniture|furniture moving|cleaning materials?|supplies|stay home|be at home|present during|customer presence|balcony|terrace|window cleaning)\b/.test(
      n,
    ) ||
    /\b(how many|number of|total)\b.*\b(cleaners?|maids?|staff|employees?|workers?|employ|workforce)\b/.test(
      n,
    ) ||
    /\b(cleaners?|maids?|staff|employees?|workers?)\b.*\b(how many|number of|total|employ|workforce)\b/.test(
      n,
    );
  if (explicitKnowledgeTheme) {
    if (/\b(?:book|schedule)\b/.test(n) && /\b(window|balcony)\b/.test(n))
      return false;
    return true;
  }

  // Existing deterministic assistant intents (identity, location, hours, contact,
  // payment, returns, etc.) keep ownership instead of being re-routed through RAG.
  if (detectedIntent && detectedIntent !== "other") return false;
  if (
    /\b(who are you|what is your name|what's your name|what are you|your name|what is my name|what's my name|do you know my name)\b/.test(
      n,
    )
  )
    return false;

  // Durable transaction reads belong to their owning capability. They are not
  // general knowledge questions even though they often begin with "what".
  if (
    /\b(?:what(?:'s| is)\s+in|show|view|list|open|see)\b[\s\S]{0,30}\b(?:my\s+)?(?:cart|order|orders|order history|booking|appointment|request|service history)\b|\bmy\s+(?:cart|orders?|order history|booking|appointment|request|service history)\b/.test(
      n,
    )
  )
    return false;

  // Clear actions/discovery belong to Catalog/Offering/Booking/etc.
  if (
    /\b(i want|i need|i would like|i'd like|can i get|can i have|can i buy|can i order|can i book|book|schedule|place (?:an|my) order|buy|purchase|add (?:this|it|to)|confirm|cancel|reschedule|admit|admitted)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:can you|could you|please|i need to|i want to)\s+(?:move|change|shift)\s+(?:my|the)?\s*(?:appointment|booking|time|date)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:can|could)\s+(?:you|someone|a cleaner|your team)\s+(?:clean|book|schedule|repair|treat|reserve|send|bring|come|arrange)\b/.test(
      n,
    )
  )
    return false;
  if (
    /^\s*(?:do you have|do you sell|what do you have|what do you sell|show me|list)\b/.test(
      n,
    )
  )
    return false;
  if (/^\s*what\b.*\bdo you (?:have|sell|teach|serve|offer|provide)\b/.test(n))
    return false;
  // "do you do/offer/provide X cleaning" is a service support question for
  // the availability adapter, not a knowledge question.
  if (/\b(?:do you|can you|will you|are you)\b[\s\S]{0,20}\b(?:do|provide|offer|have|give)\b[\s\S]{0,40}\b(?:clean|cleaning|service)\b/i.test(n))
    return false;
  // "what type/kind of cleaning do you do" is an operational service-list
  // question for the cleaning capability, not a knowledge/policy question.
  if (/\bwhat (?:type|kind|sort) of (?:cleaning|service)/i.test(n))
    return false;
  if (/\bwhat (?:cleaning|services?) do you\b/i.test(n))
    return false;
  if (/\bwhat (?:subjects?|courses?|classes?|programs?) do you teach\b/.test(n))
    return false;
  if (
    /\b(?:what food do you serve|what do you serve|how to get admission|admission inquiry|apply for admission)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:what|which)\b.*\b(?:products?|items?|food|menu|services?|treatments?|classes?|programs?|grades?|things?|cheez|cheezen|chezyn)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:do you offer|do you provide)\b.*\b(?:cleaning|haircut|facial|consultation|treatment|product|shoes?|shirts?|service|delivery|takeaway)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:quote|quotation|estimate|price|cost|charges?|rate|discount|how much)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:are you open|business hours|opening hours|are you available|available on|slot)\b/.test(
      n,
    )
  )
    return false;
  if (
    /\b(?:ap|aap)\s+k\s+pass\b.*\b(?:kia|kya|cheezen|cheez|chezyn)\b|\b(?:kia|kya)\s+(?:kia|kya)\s+(?:hai|hain)\b/.test(
      n,
    )
  )
    return false;

  // Remaining natural questions may use managed knowledge, but only after all
  // operational forms above have been excluded.
  return (
    /\?|^(who|what|where|when|why|how|do|does|is|are|can|could|will|would|should|which)\b/.test(
      n,
    ) || /\b(policy|allowed|responsible|included)\b/.test(n)
  );
}

function looksLikeRestrictedDataRequest(value) {
  const n = String(value || "").toLowerCase();
  const protectedRecords =
    /\b(customers?|customer list|clients?|client list|crm|orders?|bookings?|appointments?|customer notes?|phone numbers?|contact list|knowledge files?|tenant data)\b/.test(
      n,
    );
  const disclose =
    /\b(send|show|give|list|export|download|reveal|share|provide|access|see)\b/.test(
      n,
    );
  const crossTenant =
    /\b(other|another|different)\s+(?:tenant|business|company)\b|\bother (?:tenant's|tenants'|business's|businesses')\b/.test(
      n,
    );
  const bulkCustomers =
    /\b(?:all|every|the)\s+(?:customers?|clients?)\b|\b(?:customer|client)\s+list\b/.test(
      n,
    );
  return protectedRecords && disclose && (crossTenant || bulkCustomers);
}

function looksLikeRefundAction(value) {
  const n = String(value || "").toLowerCase();
  return (
    /\b(?:give|issue|send|process|make|approve|pay|start|create)\b[\s\S]{0,30}\brefund\b|\brefund\b[\s\S]{0,20}\b(?:now|immediately|to me|my money)\b/.test(
      n,
    ) &&
    !/\b(?:can i|could i|may i|what is|what's|how|policy|eligible|allowed|possible|when)\b[\s\S]{0,30}\brefund\b/.test(
      n,
    )
  );
}

function extractRequestedServiceArea(value) {
  const text = String(value || "").trim();
  const patterns = [
    /\b(?:are you available|do you (?:serve|provide|offer)|can you (?:serve|come|provide)|services? available)\s+(?:services?\s+)?in\s+([\p{L}][\p{L} .'-]{1,60})[?!.]*$/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function detectDomainQuery(text, tenant) {
  const n = String(text || "").toLowerCase();
  if (
    /\b(doctors?|physicians?|clinic|medical|treatments?|dermatology|physiotherapy)\b/.test(
      n,
    )
  )
    return "healthcare";
  if (
    /\b(admissions?|classes?|grades?|school programs?|education programs?|student enrollment)\b/.test(
      n,
    )
  )
    return "education";
  if (
    /\b(?:what|which|show|list|view|available)\b[\s\S]{0,35}\b(?:properties|property listings?|houses? for (?:sale|rent)|apartments? for (?:sale|rent))\b|\b(?:property reference|valuation visit|rental brokerage|prime property advisors)\b/.test(
      n,
    )
  )
    return "real_estate";
  const cleaning =
    /\b(clean|cleaned|cleaners?|cleaning|maid|sofas?|mattresses?|carpets?)\b/.test(
      n,
    ) &&
    (/\b(clean|cleaned|cleaning|cleaners?|maid)\b/.test(n) ||
      /\b(sofas?|mattresses?|carpets?)\b.{0,30}\b(service|clean|cleaned|cleaning|wash)\b/.test(
        n,
      ));
  const retail =
    /\b(shoes?|shirts?|jeans?|catalog|cart|buy|purchase)\b/.test(n) ||
    (/\bproducts?\b/.test(n) &&
      /\b(show|list|sell|stock|catalog|buy|purchase|order|available)\b/.test(
        n,
      ));
  // Tenant vocabulary is the first grounding boundary for ambiguous phrases
  // such as "cleaning products". Strong unsupported-domain requests still fail.
  if (cleaning && tenantSupportsDomain(tenant, "cleaning")) return "cleaning";
  if (retail) return "retail";
  if (cleaning) return "cleaning";
  return null;
}
function tenantSupportsDomain(tenant, domain) {
  const current = String(tenant?.domain || "").toLowerCase();
  if (current === domain) return true;
  const caps = new Set(tenant?.capabilities || []);
  if (domain === "retail") return caps.has("catalog") || caps.has("commerce");
  if (domain === "cleaning") return caps.has("cleaning");
  if (domain === "healthcare") return current === "healthcare";
  if (domain === "education") return current === "education";
  return false;
}

module.exports = {
  AssistantConversationAdapter,
  looksInformational,
  looksLikeRestrictedDataRequest,
  looksLikeRefundAction,
  extractRequestedServiceArea,
  detectDomainQuery,
  tenantSupportsDomain,
};
