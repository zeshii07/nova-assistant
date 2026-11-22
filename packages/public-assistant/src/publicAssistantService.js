/**
 * PublicAssistantService — the orchestrator for the public product assistant.
 *
 * Implements the §5 request lifecycle, §11 response strategy, §14 product
 * recommendation logic, and §15 conversation memory.
 *
 * The service is deliberately deterministic (no LLM by default) to keep the
 * public endpoint fast, cheap, and safe. It reuses the existing KnowledgeService
 * for retrieval against the tenants/public-product/ namespace, the existing
 * MemoryStateRepository for session memory, the EventBus + AnalyticsEngine for
 * telemetry, and the new PublicLeadService / PublicFeatureRegistryService for
 * lead capture and feature lookups.
 *
 * Hard isolation (§4): the public tenant id is fixed server-side and can never
 * be overridden by a browser-supplied value.
 */
const crypto = require("crypto");
const { createInitialState, applyStatePatch } = require("../../state/src/stateSchema");
const { PublicOptionResolver } = require("./publicOptionResolver");

// §11 — the four response outcomes.
const OUTCOMES = { ANSWER: "answer", CLARIFY: "clarify", ESCALATE: "escalate", REFUSE: "refuse", LEAD: "lead", GREETING: "greeting", SMALL_TALK: "small_talk" };

// §14 — map a visitor problem keyword to a recommended feature_id.
const RECOMMENDATION_MAP = [
  { problem: "repeated questions", feature_id: "knowledge_based_answers", follow_up: "What do your customers ask most?" },
  { problem: "appointments", feature_id: "booking_workflows", follow_up: "Do you use a booking system today?" },
  { problem: "service enquiries", feature_id: "service_catalogue", follow_up: "How many services do you offer?" },
  { problem: "product enquiries", feature_id: "product_catalogue", follow_up: "Do you maintain a digital product list?" },
  { problem: "price questions", feature_id: "pricing_and_availability", follow_up: "Are prices fixed or quotation-based?" },
  { problem: "availability questions", feature_id: "pricing_and_availability", follow_up: "Is availability managed elsewhere?" },
  { problem: "shopping", feature_id: "commerce", follow_up: "Which part of the order journey matters?" },
  { problem: "organizing leads", feature_id: "crm", follow_up: "Where do you store leads now?" }
];

// §10 — contextual starter chips.
const STARTERS = {
  welcome: ["What is Nova?", "What can Nova automate?", "Can Nova work for my business?", "Show me a booking example", "How can I request a demo?"],
  feature: ["Automate customer enquiries", "Explore booking workflows", "Manage product and service information", "Understand pricing and availability"],
  industry: ["I run a salon", "I manage a clinic", "I own a cleaning business", "I run a restaurant", "I have an online store"],
  conversion: ["Request a demo", "Discuss my business requirements", "Ask about pricing", "Contact the Nova team"]
};

const CONSENT_TEXT = {
  v1: "I agree to be contacted by the Nova team about my enquiry. I can withdraw consent at any time."
};

class PublicAssistantService {
  constructor({
    knowledgeService,
    knowledgeRepository,
    tenantRepository,
    featureRegistryService,
    leadService,
    intentRouter,
    policy,
    stateRepository,
    eventBus = null,
    logger = null,
    publicTenantId = "public-product",
    unansweredQuestionRepository = null,
    llmAnswerService = null
  } = {}) {
    this.knowledgeService = knowledgeService;
    this.knowledgeRepository = knowledgeRepository;
    this.tenantRepository = tenantRepository;
    this.featureRegistryService = featureRegistryService;
    this.leadService = leadService;
    this.intentRouter = intentRouter;
    this.policy = policy;
    this.stateRepository = stateRepository;
    this.eventBus = eventBus;
    this.logger = logger;
    this.publicTenantId = publicTenantId;
    this.unansweredQuestionRepository = unansweredQuestionRepository;
    this.llmAnswerService = llmAnswerService;
    // H3 + H5 (Phase 1 items 3 & 5): resolves ordinals / demonstratives
    // ("first one", "option 2", "wo", "usko", "pehla wala", "dusra") against
    // state.context.lastShown BEFORE intent classification, so a shorthand
    // reply picks the option the assistant just displayed instead of falling
    // through to knowledge retrieval as `unknown`.
    this.optionResolver = new PublicOptionResolver();
  }

  /**
   * §5 — the full request lifecycle for a public chat message.
   * Returns { conversation_id, reply, suggested_actions, lead_status, intent, outcome }.
   */
  async handleMessage({ conversation_id, message, locale = "en", page_context = null, campaign = null }) {
    const startedAt = Date.now();
    // 1. Validate input (§5.1).
    const text = String(message || "").trim();
    if (!text) return this._error(400, "message is required");
    if (text.length > 4000) return this._error(400, "message is too long (max 4000 chars)");

    // 2. Resolve session (§5.2). Browser-supplied tenantId is ignored (§20.4).
    const tenantId = this.policy.resolveTenantId(page_context?.tenantId);
    const sessionId = String(conversation_id || `pub-${crypto.randomUUID()}`);

    // 3. Load the fixed public assistant identity + tenant (§5.3).
    const tenant = await this._loadPublicTenant(tenantId);
    if (!tenant) return this._error(503, "public assistant unavailable");

    // 4. Load limited public conversation history (§5.4).
    let state = await this.stateRepository.get(this._conversationKey(sessionId));
    if (!state) {
      state = createInitialState({ tenantId, conversationId: this._conversationKey(sessionId), channel: "public", customerId: sessionId, language: locale });
    }

    // 5. Detect language + intent (§5.5, §6).
    const language = this._normalizeLocale(locale);
    // H3 + H5 (Phase 1 items 3 & 5): resolve ordinal / demonstrative replies
    // ("first one", "option 2", "wo", "usko", "dusra", bare "2") against the
    // options this assistant displayed on the PREVIOUS turn (stored in
    // state.context.lastShown). If the visitor is referencing an option, feed
    // that option's value to the classifier as if they had typed it — instead
    // of letting "first one" classify as `unknown` and fall through to
    // knowledge retrieval. The ORIGINAL text is still recorded + refused-on
    // (if unsafe), so this only widens what the router sees; it never bypasses
    // the policy.
    const lastShown = state.context?.lastShown || null;
    const optionResolution = this.optionResolver.resolve(text, lastShown);
    const routedText = optionResolution.resolved ? optionResolution.value : text;
    const classification = this.intentRouter.classify(routedText);

    // 6. Apply the policy refuse check FIRST (§6 priority: safety wins).
    const refuse = this.policy.evaluateMessage(text);
    if (refuse.refuse) {
      const reply = this._refuseReply(language);
      await this._recordMessage(state, "user", text, classification.intent, "refused");
      await this._recordMessage(state, "assistant", reply, classification.intent, "refused");
      await this._save(state);
      await this._publish("public_chat.message_sent", { session_id: sessionId, intent: classification.intent, outcome: "refused" });
      return this._response(sessionId, reply, [], this._leadStatus(state), classification.intent, "refuse", startedAt, language);
    }

    // 7. Route by intent (§6).
    await this._recordMessage(state, "user", text, classification.intent, "received");

    // 8. Decide outcome.
    let result;
    if (classification.intent === "greeting") {
      // Friendly greeting — start the conversation warmly without dumping product info.
      const isUrdu = language === "ur" || language === "roman_urdu";
      const greetingReply = isUrdu
        ? "Assalam-o-alaikum! 👋 Main Nova hoon — AI business assistant. Aap apne business ke baare mein bataiye, ya mujhse Nova ki capabilities, bookings, ya customer automation ke baare mein poochein. Aap kya explore karna chahenge?"
        : "Hello! 👋 I'm Nova, an AI business assistant for customer conversations and automation. Tell me what kind of business you run, or ask me anything about Nova — what it does, how it works, or how it could help your business. What would you like to explore first?";
      result = { reply: greetingReply, outcome: OUTCOMES.GREETING, confidence: 0.95 };
    } else if (classification.intent === "small_talk") {
      // Thanks / how-are-you / goodbye / compliments — friendly short replies.
      result = { ...this._handleSmallTalk(text, language, classification), outcome: OUTCOMES.SMALL_TALK };
    } else if (classification.intent === "demo_intent" || classification.intent === "purchase_intent") {
      // Demo / purchase → start lead capture flow (§13).
      result = await this._handleLeadIntent(text, state, sessionId, language, classification, page_context, campaign);
    } else if (classification.intent === "existing_customer_support") {
      // Escalate to authenticated support (§24).
      result = this._escalateToSupport(language, "existing_customer");
    } else if (classification.intent === "pricing") {
      // §11 — pricing uses approved records or controlled fallback.
      result = await this._handlePricing(text, tenant, language, classification);
    } else {
      // Default: retrieve from public knowledge base (§5.6, §5.7, §5.8).
      result = await this._handleKnowledge(text, tenant, language, classification);
    }

    // 9-10. Generate + validate response (the reply is already composed above).
    let reply = this.policy.redactReply(result.reply);

    // 11. Record safe analytics (§19 — no personal data in events).
    await this._recordMessage(state, "assistant", reply, classification.intent, result.outcome);
    // Suggested actions (§5.10) — computed here so we can persist them as
    // lastShown (H5) for the NEXT turn's ordinal/demonstrative resolution.
    const suggested = this._suggestedActions(classification, state, language);
    // 12. Update session memory (§15) — persist lastShown + pending (H5).
    state = this._updateMemory(state, classification, result, text, { suggested, optionResolution });
    await this._save(state);
    await this._publish("public_chat.answer_generated", {
      session_id: sessionId, intent: classification.intent, outcome: result.outcome,
      industry: classification.industry, retrieval_confidence: result.confidence || null
    });

    return this._response(sessionId, reply, suggested, this._leadStatus(state), classification.intent, result.outcome, startedAt, language, result.lead);
  }

  // ─── Intent handlers ────────────────────────────────────────────────

  async _handleKnowledge(text, tenant, language, classification) {
    // §5.6 — retrieve only from the public Nova knowledge base.
    // First: try a direct FAQ question match (highest precision). If the
    // visitor's message closely matches an FAQ question, use that answer
    // directly — this avoids the loose lexical retrieval picking a wrong FAQ.
    const directFaq = this._matchFaqDirectly(text, tenant);
    if (directFaq) {
      const sanitized = this.policy.sanitizeEvidence(directFaq.answer);
      if (sanitized.text.trim()) {
        const reply = this._composeAnswer(sanitized.text, classification, language);
        return { outcome: OUTCOMES.ANSWER, reply, confidence: 0.95 };
      }
    }
    const retrieval = this.knowledgeService.retrieve(text, tenant, { limit: 5 });
    // §5.7 — source authority + evidence validation.
    const answerable = retrieval.answerable && !retrieval.conflict && retrieval.matches.length > 0;
    if (retrieval.conflict) {
      // §7 — conflicting approved sources: abstain + route for review.
      return this._escalateWithLogging({ text, language, classification, reason: "conflict", evidence: "", sessionId: null, confidence: retrieval.confidence });
    }
    if (!answerable) {
      // §24 — escalate when product facts are missing.
      return this._escalateWithLogging({ text, language, classification, reason: "missing", evidence: "", sessionId: null, confidence: retrieval.confidence });
    }
    // Prefer FAQ matches (curated Q&A) over business-profile field matches,
    // because FAQ text is already a clean answer while a business.json field
    // match can leak its dotted path (e.g. "pricing.note: ...").
    const faqMatch = retrieval.matches.find((m) => m.kind === "faq_collection" || (m.sourceKind === "faq_collection"));
    const best = faqMatch || retrieval.matches[0];
    // §4 + §16 — assert the chunk belongs to the public namespace.
    if (!this.policy.assertChunkPublic(best)) {
      return this._escalateWithLogging({ text, language, classification, reason: "isolation", evidence: "", sessionId: null, confidence: 0 });
    }
    // §16 — sanitize the evidence (strip injected instructions + field-path prefix).
    let evidenceText = best.text || "";
    // Strip a leading "field.path:" prefix that business.json field matches carry.
    evidenceText = evidenceText.replace(/^[a-zA-Z_][a-zA-Z0-9_.]*:\s*/, "");
    const sanitized = this.policy.sanitizeEvidence(evidenceText);
    if (!sanitized.text.trim()) {
      return this._escalateWithLogging({ text, language, classification, reason: "missing", evidence: "", sessionId: null, confidence: retrieval.confidence });
    }
    // §11 — direct answer + brief explanation + example + limitation + follow-up.
    const reply = this._composeAnswer(sanitized.text, classification, language);
    return { outcome: OUTCOMES.ANSWER, reply, confidence: retrieval.confidence };
  }

  /**
   * §18/§24 — funnel all escalation paths through here so unanswered questions
   * are logged for the admin dashboard. Optionally attempts an LLM-grounded
   * answer (§16/§17) before falling back to a templated escalate reply.
   */
  async _escalateWithLogging({ text, language, classification, reason, evidence, sessionId, confidence }) {
    // §18 — record the unanswered question (fire-and-forget; never blocks the reply).
    this._recordUnanswered({ question: text, sessionId, classification, language, outcome: "escalate", reason });
    // §16/§17 — if LLM generation is enabled and we have any evidence, try it.
    if (this.llmAnswerService && evidence && evidence.trim()) {
      const llmResult = await this.llmAnswerService.generateAnswer({ question: text, evidence, language, classification });
      if (llmResult.success && llmResult.text) {
        return { outcome: OUTCOMES.ANSWER, reply: llmResult.text, confidence: 0.6, llm_generated: true };
      }
    }
    return { outcome: OUTCOMES.ESCALATE, reply: this._escalateReply(language, reason), confidence };
  }

  _recordUnanswered({ question, sessionId, classification, language, outcome, reason }) {
    if (!this.unansweredQuestionRepository) return;
    try {
      this.unansweredQuestionRepository.record({
        question,
        session_id: sessionId,
        intent: classification?.intent,
        outcome,
        industry: classification?.industry,
        language
      }).catch((error) => {
        this.logger?.error?.("public_assistant.unanswered_log_failed", { error: error.message });
      });
    } catch (error) {
      this.logger?.error?.("public_assistant.unanswered_record_threw", { error: error.message });
    }
  }

  async _handlePricing(text, tenant, language, classification) {
    // §11 — "How much does Nova cost?" If approved pricing exists, retrieve it.
    // Otherwise, controlled fallback: don't guess, route to sales.
    const retrieval = this.knowledgeService.retrieve("pricing cost price how much", tenant, { limit: 3 });
    const pricingMatch = retrieval.matches.find((m) => /price|cost|fee|trial/i.test(m.text || ""));
    if (pricingMatch && this.policy.assertChunkPublic(pricingMatch)) {
      let evidenceText = pricingMatch.text || "";
      evidenceText = evidenceText.replace(/^[a-zA-Z_][a-zA-Z0-9_.]*:\s*/, "");
      const sanitized = this.policy.sanitizeEvidence(evidenceText);
      if (sanitized.text.trim()) {
        return { outcome: OUTCOMES.ANSWER, reply: sanitized.text + "\n\nWhat type of business are you planning to use Nova for?", confidence: retrieval.confidence };
      }
    }
    // Controlled fallback — never guess a price.
    const reply = language === "ur"
      ? "Nova ki qeemat aapki zarooriyat par depend karti hai. Main ghalat raqam nahi dunga. Main aapko Nova team se raabta kara sakta hoon. Aap kis type ka business chalate hain?"
      : "Pricing depends on the features and setup your business needs. I don't want to give you an outdated or inaccurate figure. I can help arrange a pricing discussion with the Nova team. What type of business are you planning to use Nova for?";
    return { outcome: OUTCOMES.ANSWER, reply, confidence: 0.5 };
  }

  async _handleLeadIntent(text, state, sessionId, language, classification, page_context, campaign) {
    // §12, §13 — start the lead capture flow. Don't show a long form.
    // First turn: ask qualifying questions. The actual lead submission happens
    // via the /api/public/lead endpoint once the visitor consents.
    const isUrdu = language === "ur" || language === "roman_urdu";
    if (classification.intent === "demo_intent") {
      const reply = isUrdu
        ? "Bilkul. Main aapko Nova ka demo arrange karne mein madad kar sakta hoon. Pehle, aap kis type ka business chalate hain, aur aap kya dekhna chahte hain — customer enquiries, bookings, product information, ya koi aur workflow?"
        : "Absolutely. I can help arrange a Nova demo. First, what type of business do you operate, and what would you most like to see — customer enquiries, bookings, product information, or another workflow?";
      // Mark lead capture as started in session memory.
      state.context = state.context || {};
      state.context.lead_capture_state = "qualifying";
      state.context.demo_intent = true;
      return { outcome: OUTCOMES.LEAD, reply, lead: { demo_intent: true, capture_state: "qualifying" } };
    }
    // purchase_intent
    const reply = isUrdu
      ? "Shukriya! Main aapko Nova team se raabta kara sakta hoon. Aap kis type ka business chalate hain, aur aap kaunsa workflow sabse pehle enable karna chahte hain?"
      : "Thanks for your interest! I can arrange for the Nova team to follow up. What type of business do you run, and which workflow would you want to enable first?";
    state.context = state.context || {};
    state.context.lead_capture_state = "qualifying";
    state.context.purchase_intent = true;
    return { outcome: OUTCOMES.LEAD, reply, lead: { purchase_intent: true, capture_state: "qualifying" } };
  }

  _escalateToSupport(language, reason) {
    // §24 — existing customer support is not the public assistant's job.
    const reply = language === "ur"
      ? "Yeh account-specific sawal hai. Main isay public assistant se handle nahi kar sakta. Kripya authenticated support route ka istemal karein. Main aapse kabhi password ya API key nahi mangta."
      : "That looks like an account-specific question, which I'm not able to help with from the public assistant. Please use the configured authenticated support route. I'll never ask for your password or API key.";
    return { outcome: OUTCOMES.ESCALATE, reply };
  }

  // ─── Small talk (greetings/thanks/bye/compliments) ────────────────
  // §6.2 — short, friendly, on-brand replies that don't dump product info.
  _handleSmallTalk(text, language, classification) {
    const q = String(text || "").toLowerCase();
    const isUrdu = language === "roman_urdu" || language === "ur";
    // thanks / appreciation
    if (/\b(thank\s?you|thanks|shukriya|appreciate)\b/i.test(q)) {
      const reply = isUrdu
        ? "Shukriya! 😊 Main yahin hoon jab bhi aap customer automation, bookings, sales, ya support ke baare mein baat karna chahein. Aage kya explore karein?"
        : "You're very welcome! 😊 I'm here whenever you want to explore customer automation, bookings, sales, or support. What would you like to look at next?";
      return { reply, outcome: "small_talk", confidence: 0.92 };
    }
    // goodbye
    if (/\b(bye|goodbye|see you|tata|khuda hafiz)\b/i.test(q)) {
      const reply = isUrdu
        ? "Khuda hafiz! 👋 Wapas aate hi mujhse koi bhi customer workflow ya business problem poochein jo aap Nova se automate karna chahein."
        : "Goodbye for now 👋 When you return, ask me about any customer workflow or business problem you'd like Nova to automate.";
      return { reply, outcome: "small_talk", confidence: 0.92 };
    }
    // compliment
    if (/\b(you'?re\s+(great|amazing|awesome|good|cool)|i\s+like\s+you|nice\s+work)\b/i.test(q)) {
      const reply = isUrdu
        ? "Shukriya — yeh bohot pyaari baat hai! 😊 Main isi tarah natural business conversation aur reliable workflows ke beech balance rakhne ke liye bana hoon. Koi practical use case dekhna chahenge?"
        : "Thank you — that means a lot! 😊 I'm built to make business conversations feel this natural while keeping the underlying work reliable. Want to see a practical use case?";
      return { reply, outcome: "small_talk", confidence: 0.92 };
    }
    // how are you / what's up (default small talk branch)
    const reply = isUrdu
      ? "Main bohat accha hoon, shukriya! 😊 Main hamesha taiyar hoon batane ke liye Nova kaise madad kar sakta hai. Kya aap mujhe ek assistant ke taur par explore kar rahe hain, ya kisi booking aur customer-support agent ki talaash mein hain apke business ke liye?"
      : "I'm doing great, thank you! 😊 I'm always happy to chat and explain how Nova can help. Are you exploring me as an assistant, or as a booking and customer-support agent for your business?";
    return { reply, outcome: "small_talk", confidence: 0.9 };
  }

  // ─── Lead submission (called by the /api/public/lead route) ─────────

  async submitLead(fields, consent) {
    return this.leadService.submitLead({ ...fields, source: fields.source || "public_nova_assistant" }, consent);
  }

  async requestDemo({ lead_id, requested_scenario, preferred_contact_method }) {
    return this.leadService.requestDemo({ lead_id, requested_scenario, preferred_contact_method });
  }

  /**
   * Direct FAQ match: if the visitor's message closely matches an FAQ question
   * (token overlap ≥ 0.6 or substring containment), return that FAQ. This is
   * higher-precision than the hybrid retriever for short product questions.
   */
  _matchFaqDirectly(text, tenant) {
    try {
      const files = this.knowledgeRepository.getForTenant(tenant.id);
      const faqs = Array.isArray(files?.faqs) ? files.faqs : [];
      if (!faqs.length) return null;
      const q = String(text || "").toLowerCase().trim();
      // Normalize: collapse non-alphanumeric to space.
      const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\s]/g, " ").replace(/\s+/g, " ").trim();
      const qNorm = normalize(q);
      const qTokens = new Set(qNorm.split(" ").filter((t) => t.length > 1));
      let best = null, bestScore = 0;
      for (const faq of faqs) {
        const fNorm = normalize(faq.question);
        const fTokens = new Set(fNorm.split(" ").filter((t) => t.length > 1));
        // Substring containment either way.
        if (fNorm.includes(qNorm) || qNorm.includes(fNorm)) return faq;
        // Token overlap (Jaccard-ish).
        let overlap = 0;
        for (const t of fTokens) if (qTokens.has(t)) overlap++;
        const score = overlap / Math.max(1, Math.min(qTokens.size, fTokens.size));
        if (score > bestScore) { bestScore = score; best = faq; }
      }
      return bestScore >= 0.6 ? best : null;
    } catch (error) {
      this.logger?.error?.("public_assistant.faq_match_failed", { error: error.message });
      return null;
    }
  }

  // ─── Recommendation (§14) ──────────────────────────────────────────

  recommend(problemText) {
    const q = String(problemText || "").toLowerCase();
    for (const r of RECOMMENDATION_MAP) {
      if (q.includes(r.problem)) {
        const feature = this.featureRegistryService.getStatus(r.feature_id);
        if (feature && this.featureRegistryService.isAvailable(r.feature_id)) {
          return { feature, follow_up: r.follow_up };
        }
      }
    }
    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  async _loadPublicTenant(tenantId) {
    try {
      const tenant = await this.tenantRepository.getById(tenantId);
      return tenant;
    } catch (error) {
      this.logger?.error?.("public_assistant.tenant_load_failed", { error: error.message });
      return null;
    }
  }

  _conversationKey(sessionId) { return `${this.publicTenantId}:public:${sessionId}`; }

  _normalizeLocale(locale) {
    const l = String(locale || "en").toLowerCase();
    if (l.startsWith("ur")) return "ur";        // Urdu script
    if (l.includes("roman")) return "roman_urdu"; // Roman Urdu (Latin script)
    return "en";
  }

  _composeAnswer(evidence, classification, language) {
    // §11 response structure: direct answer + follow-up.
    // The evidence text is already the approved answer (from FAQs or documents).
    // Append one useful follow-up question based on intent — but only if the
    // evidence doesn't already contain a follow-up (FAQs typically do).
    const base = evidence.trim();
    const endsWithQuestion = /\?\s*$/.test(base);
    if (endsWithQuestion) return base;
    // Pick the follow-up this intent would add, and skip if the evidence already
    // contains it (avoids duplicating the FAQ's built-in follow-up).
    let followUp = "";
    if (classification.industry) {
      const ind = classification.industry.replace(/_/g, " ");
      followUp = ` Does your ${ind} currently manage this manually, or do you already use a system?`;
    } else if (classification.intent === "feature_discovery") {
      followUp = " Which of these is most relevant to your business?";
    } else if (classification.intent === "product_overview") {
      followUp = " What type of business do you run? I can show you the most relevant ways Nova could help.";
    }
    if (followUp && base.toLowerCase().includes(followUp.trim().toLowerCase().slice(0, 40))) {
      return base;
    }
    return base + followUp;
  }

  _refuseReply(language) {
    if (language === "ur") return "Main is sawal mein madad nahi kar sakta. Kripya apna sawal badal kar poochein.";
    return "I'm not able to help with that request. Please ask me about Nova's products, features, or how it could work for your business.";
  }

  _escalateReply(language, reason) {
    if (reason === "conflict") {
      return language === "ur"
        ? "Mujhe is sawal par conflicting information mili hai. Main ghalat jawab nahi dunga. Main isay Nova team ko forward karta hoon."
        : "I found conflicting information for that question, so I won't guess. I've recorded this so the Nova team can confirm the answer.";
    }
    if (reason === "isolation") {
      return "I'm not able to answer that from this session. Let me connect you with the Nova team.";
    }
    return language === "ur"
      ? "Mujhe abhi is sawal ka confirmed jawab nahi hai. Main aapko galat maloomat nahi dunga. Main isay Nova team ko forward karta hoon."
      : "I don't have a confirmed answer about that yet, and I don't want to mislead you. I can record what you need and pass it to the Nova team.";
  }

  _suggestedActions(classification, state, language) {
    const actions = [];
    // Show the demo CTA when interest is clear but lead capture hasn't started.
    const leadState = state?.context?.lead_capture_state;
    if ((classification.intent === "industry_use_case" || classification.intent === "feature_discovery" || classification.intent === "pricing") && leadState !== "qualifying") {
      actions.push({ label: language === "ur" ? "Demo request karein" : "Request a demo", action: "demo_request" });
    }
    // Industry follow-up.
    if (classification.industry) {
      const ind = classification.industry.replace(/_/g, " ");
      actions.push({ label: `Explore ${ind} use case`, action: "ask", value: `Show me an example ${ind} conversation.` });
    }
    // Always offer "talk to team" for purchase intent.
    if (classification.intent === "purchase_intent") {
      actions.push({ label: "Contact the Nova team", action: "demo_request" });
    }
    // Cap at 3.
    return actions.slice(0, 3);
  }

  _leadStatus(state) {
    const ctx = state?.context || {};
    if (ctx.lead_submitted) return "submitted";
    if (ctx.lead_capture_state === "qualifying") return "in_progress";
    if (ctx.demo_intent || ctx.purchase_intent) return "intent_detected";
    return "not_started";
  }

  _updateMemory(state, classification, result, text, extra = {}) {
    const ctx = state.context || {};
    if (classification.industry) ctx.industry = classification.industry;
    if (classification.intent === "industry_use_case" || classification.intent === "feature_discovery") {
      ctx.interest_level = "high";
    }
    if (result.lead && result.lead.capture_state === "qualifying") {
      ctx.lead_capture_state = "qualifying";
      if (classification.intent === "demo_intent") ctx.demo_intent = true;
      if (classification.intent === "purchase_intent") ctx.purchase_intent = true;
    }
    // Track the conversation topic.
    ctx.last_topic = classification.intent;
    ctx.last_industry = classification.industry;

    // H5 (Phase 1 item 5) — persist the options this assistant just displayed,
    // so the NEXT turn can resolve "first one" / "option 2" / "wo" / "usko"
    // against them (H3). Only store the label/value/action needed for
    // resolution (no secrets, no PII — suggested actions are public chips).
    // Also track `pending`: the assistant just offered choices and is awaiting
    // a selection. It is cleared when the visitor's message resolved an option
    // this turn (extra.optionResolution.resolved), so we don't keep a stale
    // "awaiting choice" state after the visitor has picked.
    const suggested = Array.isArray(extra.suggested) ? extra.suggested : [];
    if (suggested.length > 0) {
      ctx.lastShown = suggested.map((s) => ({ label: s.label, value: s.value, action: s.action }));
      ctx.lastShownAt = new Date().toISOString();
      ctx.pending = "option_selection";
    } else if (extra.optionResolution?.resolved) {
      // The visitor picked an option this turn and the assistant produced a
      // terminal answer (no new options offered) — clear the pending state.
      ctx.lastShown = null;
      ctx.pending = null;
    } else if (extra.optionResolution && !extra.optionResolution.resolved && ctx.pending === "option_selection") {
      // The visitor sent something that was NOT an option reference while a
      // selection was pending. Keep lastShown for one more turn (the visitor
      // may still reference it) but don't treat it as a hard pending state.
      // Expire stale lastShown after 2 turns to avoid resolving against
      // long-stale options.
      const ageTurns = (ctx.lastShownAge || 0) + 1;
      ctx.lastShownAge = ageTurns;
      if (ageTurns > 2) { ctx.lastShown = null; ctx.pending = null; ctx.lastShownAge = 0; }
    } else {
      ctx.lastShownAge = 0;
    }
    return applyStatePatch(state, { context: ctx });
  }

  async _recordMessage(state, role, content, intent, status) {
    // §15 — store only what is needed to continue the conversation.
    if (!Array.isArray(state.context?.messages)) {
      state.context = state.context || {};
      state.context.messages = [];
    }
    state.context.messages.push({ role, content_preview: String(content).slice(0, 200), intent, status, at: new Date().toISOString() });
    // Keep only the last 6 turns (§15 retention rule).
    if (state.context.messages.length > 12) state.context.messages = state.context.messages.slice(-12);
  }

  async _save(state) {
    try { await this.stateRepository.save(state); }
    catch (error) { this.logger?.error?.("public_assistant.state_save_failed", { error: error.message }); }
  }

  async _publish(name, properties) {
    try { await this.eventBus?.publish(name, properties, { source: "public-assistant" }); }
    catch (error) { this.logger?.error?.("public_assistant.publish_failed", { name, error: error.message }); }
  }

  _response(sessionId, reply, suggestedActions, leadStatus, intent, outcome, startedAt, language, lead = null) {
    return {
      conversation_id: sessionId,
      reply,
      suggested_actions: suggestedActions,
      lead_status: leadStatus,
      intent,
      outcome,
      language,
      lead,
      latency_ms: Date.now() - startedAt
    };
  }

  _error(status, message) {
    return { error: true, status, message };
  }

  getStarters(group = "welcome") { return STARTERS[group] || STARTERS.welcome; }
  getConsentText(version = "v1") { return CONSENT_TEXT[version] || CONSENT_TEXT.v1; }
}

module.exports = { PublicAssistantService, OUTCOMES, RECOMMENDATION_MAP, STARTERS, CONSENT_TEXT };
