/**
 * Coordinates language, intent, tenant knowledge, response templates, and
 * optional LLM fallback. The LLM receives approved facts and cannot alter them.
 */
class AssistantService {
  constructor({ languageEngine, intentEngine, knowledgeService, responseEngine, llmRouter, logger }) {
    this.languageEngine = languageEngine;
    this.intentEngine = intentEngine;
    this.knowledgeService = knowledgeService;
    this.responseEngine = responseEngine;
    this.llmRouter = llmRouter;
    this.logger = logger;
  }

  async handle(context) {
    const nluLanguage = context.intelligence?.nlu?.interpretation?.language;
    const language = mapNluLanguage(nluLanguage) || this.languageEngine.detect(context.message.text, context.state.language);
    const forcedIntent = context.intelligence?.selected?.intent || '';
    if (forcedIntent === 'assistant.data_access_denied') {
      const reply="I can’t access or disclose customer, CRM, order, booking, or knowledge records from another tenant. Business data is isolated by tenant, and customer lists are available only to authorized staff through the business CRM.";
      return this.result(reply,language,'data_access_denied','tenant_privacy_boundary');
    }
    if (forcedIntent === 'assistant.refund_action_requires_authorization') {
      const policy=this.knowledgeService.answer('ask_returns',context.tenant);
      const reply=["I can’t issue or approve a refund directly in customer chat. A business team member must review and authorize the request.",policy?`Approved policy: ${policy}`:null,"I can help you request human support if you want."].filter(Boolean).join('\n\n');
      return this.result(reply,language,'refund_requires_authorization','transaction_authorization_boundary');
    }
    if (forcedIntent === 'assistant.domain_mismatch') {
      const requested=context.intelligence?.entities?.requestedDomain||'that type of business';
      const current=context.tenant?.domain||'current';
      const name=context.tenant?.name||context.tenant?.business?.name||'This business';
      const labels={healthcare:'doctor or healthcare services',education:'admissions or education programs',retail:'retail products and shopping',cleaning:'cleaning services',real_estate:'property listings or real-estate services'};
      const capabilities={
        retail:'We can show you our available products, explain product details, help build or change a cart, and prepare an order.',
        grocery:'We can show you our available groceries, help build or change a cart, and prepare an order.',
        cleaning:'We can explain our cleaning services, prepare a quotation, and help create or change a cleaning request.',
        real_estate:'We can explain our configured properties and services and help prepare a viewing, valuation, buying, or rental request.',
        healthcare:'We can explain the configured clinic services and help prepare an appointment request.',
        education:'We can explain the configured programs and help with an enquiry or admission request.'
      };
      const reply=`Thanks for asking. ${name} is configured as a ${humanDomain(current)} business, so we don’t provide ${labels[requested]||requested} through this assistant. ${capabilities[current]||'I can help with this business’s configured services, information, and requests.'}`;
      return this.result(reply,language,'domain_mismatch','domain_boundary');
    }
    if (forcedIntent === 'assistant.provider_summary') {
      const items=context.services?.offeringService?.list?.(context.tenant.id)||[];
      const names=items.map(x=>x.name).filter(Boolean);
      const reply=names.length
        ? `Configured clinic services are: ${names.join(', ')}. I don't see individual doctor/provider profiles configured yet, so I won't invent doctor names.`
        : `I don't see individual doctor/provider profiles or clinic services configured yet.`;
      return this.result(reply,language,'provider_summary','configured_provider_boundary');
    }

    if (forcedIntent === 'assistant.unsupported_capability') {
      const domain = context.intelligence?.entities?.domain || 'that service';
      const reply = this.responseEngine.reply({ intent: 'unsupported_capability', language, tenant: context.tenant, fact: domain });
      return this.result(reply, language, 'unsupported_capability', 'conversation_intelligence');
    }
    if (forcedIntent === 'assistant.nlu_information_question') {
      const reply = await this.structuredInformation(context);
      if (reply) return this.result(reply, language, 'nlu_information_question', 'tenant_structured_data');
      return this.result(this.missingKnowledge(language, context.tenant), language, 'knowledge_missing', 'structured_data_abstention');
    }
    if (forcedIntent === 'assistant.price_concern') {
      const reply = this.responseEngine.reply({ intent: 'price_concern', language, tenant: context.tenant });
      return this.result(reply, language, 'price_concern', 'social_intelligence');
    }
    if (forcedIntent === 'assistant.multi_info_question') {
      const facets=context.intelligence?.entities?.facets||[];
      const parts=[];
      for(const facet of facets){
        if(facet==='payment'){
          const fact=this.knowledgeService.answer('ask_payment',context.tenant);
          if(fact) parts.push(`Payment methods: ${fact}.`);
          else {
            const r=this.knowledgeService.retrieve('accepted payment methods cards cash bank transfer',context.tenant,{limit:4,minScore:.16,minMargin:.02,minSemantic:.1,kinds:['document','faq_collection','business_profile']});
            parts.push(r.answerable?`Payment: ${this.extractiveAnswer(r)}`:`Payment: ${this.missingKnowledge(language,context.tenant)}`);
          }
        } else if(facet==='discount'){
          const cfg=context.services?.pricing?.getConfig?.()||{};
          const active=(cfg.discounts||[]).filter(x=>x.enabled!==false);
          if(active.length){
            const labels=active.map(d=>d.type==='percent'?`${d.value}%`:`${d.value} ${cfg.currency||''}`.trim()).join(', ');
            parts.push(`Discounts: configured discounts currently include ${labels} for eligible services.`);
          } else parts.push('Discounts: there is no configured discount right now.');
        } else if(facet==='cancellation'){
          const r=this.knowledgeService.retrieve(context.message.text,context.tenant,{limit:4,minScore:.14,minMargin:.02,minSemantic:.08,kinds:['document','faq_collection','business_profile']});
          parts.push(r.answerable?`Cancellation: ${this.knowledgeService.groundedAnswer(context.message.text,r,{focus:'cancellation'})||this.extractiveAnswer(r)}`:`Cancellation: ${this.missingKnowledge(language,context.tenant)}`);
        } else if(['rescheduling','arrival','confirmation','safety','fragrance_free','pets'].includes(facet)){
          const r=this.knowledgeService.retrieve(context.message.text,context.tenant,{limit:4,minScore:.14,minMargin:.02,minSemantic:.08,kinds:['document','faq_collection','business_profile']});
          const label={rescheduling:'Rescheduling',arrival:'Arrival',confirmation:'Confirmation',safety:'Safety',fragrance_free:'Fragrance-free products',pets:'Pets'}[facet];
          parts.push(r.answerable?`${label}: ${this.knowledgeService.groundedAnswer(context.message.text,r,{focus:facet})||this.extractiveAnswer(r)}`:`${label}: ${this.missingKnowledge(language,context.tenant)}`);
        } else if(facet==='service_area'){
          const r=this.knowledgeService.retrieve(context.message.text,context.tenant,{limit:4,minScore:.14,minMargin:.02,minSemantic:.08,kinds:['document','faq_collection','business_profile']});
          parts.push(r.answerable?this.contextualKnowledgeAnswer(context,r)||this.extractiveAnswer(r):this.missingKnowledge(language,context.tenant));
        } else if(facet==='same_day'){
          const r=this.knowledgeService.retrieve('same day booking availability policy',context.tenant,{limit:4,minScore:.14,minMargin:.02,minSemantic:.08,kinds:['document','faq_collection','business_profile']});
          parts.push(r.answerable?`Same-day booking: ${this.extractiveAnswer(r)}`:`Same-day booking: ${this.missingKnowledge(language,context.tenant)}`);
        }
      }
      return this.result(parts.filter(Boolean).join('\n\n'),language,'multi_info_question','multi_facet_resolver');
    }
    if (forcedIntent === 'assistant.knowledge_question') {
      const requestedArea=context.intelligence?.entities?.requestedArea||null;
      const query=requestedArea?`service area serving locations coverage ${requestedArea}`:context.message.text;
      const retrieval=this.knowledgeService.retrieve(query,context.tenant,{limit:4,minScore:.16,minMargin:.025,minSemantic:.12,kinds:['document','faq_collection','business_profile']});
      if(retrieval.answerable){
        const policy=this.knowledgeService.groundedAnswer(context.message.text,retrieval);
        if(policy)return this.result(policy,language,'knowledge_answer','knowledge_policy_resolver');
        const contextual=this.contextualKnowledgeAnswer(context,retrieval);
        if(contextual)return this.result(contextual,language,'knowledge_answer','knowledge_contextual');
        const grounded=await this.groundedKnowledgeAnswer(context,language,retrieval);
        if(grounded)return this.result(grounded,language,'knowledge_answer','knowledge_retrieval');
      }
      if(retrieval.conflict){
        const reply=language==='roman_urdu'
          ? 'Mujhe approved business knowledge mein is sawal ke liye conflicting information mili hai. Main guess nahi karunga; team ko confirm karna hoga.'
          : 'I found conflicting approved business information for that question, so I won’t guess. The team needs to confirm which policy is current.';
        return this.result(reply,language,'knowledge_conflict','knowledge_conflict');
      }
      return this.result(this.missingKnowledge(language,context.tenant),language,'knowledge_missing','knowledge_abstention');
    }
    const detected = this.intentEngine.detect(context.message.text);
    const fact = this.knowledgeService.answer(detected.intent, context.tenant);

    if (this.isKnownIntent(detected.intent)) {
      if (fact) {
        const reply=this.responseEngine.reply({ intent: detected.intent, language, tenant: context.tenant, fact });
        return this.result(reply, language, detected.intent, detected.source);
      }
      if (this.needsFact(detected.intent)) {
        const retrieval=this.knowledgeService.retrieve(context.message.text,context.tenant);
        if(retrieval.answerable){
          const grounded=await this.groundedKnowledgeAnswer(context,language,retrieval);
          if(grounded)return this.result(grounded,language,"knowledge_answer","knowledge_retrieval");
        }
      }
      const reply=this.responseEngine.reply({ intent: this.needsFact(detected.intent) ? "missing" : detected.intent, language, tenant: context.tenant });
      return this.result(reply, language, detected.intent, detected.source);
    }

    const retrieval = this.knowledgeService.retrieve(context.message.text, context.tenant);
    if (retrieval.answerable) {
      const grounded = await this.groundedKnowledgeAnswer(context, language, retrieval);
      if (grounded) return this.result(grounded, language, "knowledge_answer", "knowledge_retrieval");
    }

    const llmReply = await this.safeLlmFallback(context, language);
    if (llmReply) return this.result(llmReply, language, "other", "llm_safe_fallback");

    return this.result(
      this.friendlyFallback(context,language),
      language,
      "other",
      "safe_fallback"
    );
  }

  friendlyFallback(context,language){
    const tenant=context.tenant||{},name=tenant.business?.name||tenant.name||'This business',domain=String(tenant.domain||'business').toLowerCase();
    if(language==='roman_urdu')return `Main aap ki baat poori tarah samajh nahi saka, lekin aap ka request yahin paused hai. ${name} ke ${humanDomain(domain)} products, services, timings, contact details, prices, booking ya order ke bare mein thori tafseel se batayein, phir main sahi jagah se help karunga.`;
    if(language==='urdu')return `میں آپ کی بات پوری طرح نہیں سمجھ سکا، لیکن آپ کی موجودہ درخواست محفوظ ہے۔ ${name} کے متعلق مطلوبہ سروس، پروڈکٹ، قیمت، بکنگ یا تبدیلی ذرا واضح کر دیں۔`;
    if(language==='arabic')return `لم أفهم طلبك بالكامل، لكن طلبك الحالي ما زال محفوظًا. يرجى توضيح الخدمة أو المنتج أو السعر أو الحجز أو التغيير المطلوب لدى ${name}.`;
    const examples={retail:'a product name, the type of item you want, or what you want to add, remove, or change in your order',grocery:'the fruit or grocery item, quantity, or the cart change you want',cleaning:'the cleaning service, property details, preferred date/time, or the booking change you want',real_estate:'the property reference, area, budget, or viewing/valuation request',healthcare:'the clinic service or appointment information you need',education:'the program, grade, class, or admission information you need'};
    return `I may be missing part of what you mean, but I’ve kept your current request safely paused. ${name} is a ${humanDomain(domain)} business; please tell me ${examples[domain]||'which business service, product, information, or request you mean'}, and I’ll respond using this tenant’s configured information.`;
  }

  async structuredInformation(context) {
    const entities = context.intelligence?.entities || {};
    const nluIntent = entities.nluIntent || '';
    if (['business.info','business.name','business.contact'].includes(nluIntent)) {
      const contextData=this.knowledgeService.getContext(context.tenant);
      const business=contextData.profilePublished?{...contextData.business,...contextData.identity}:{...contextData.identity,...contextData.business};
      if(nluIntent==='business.name')return business.name||context.tenant.name||null;
      if(nluIntent==='business.contact')return this.knowledgeService.contact(business.contact)||null;
      const contact=this.knowledgeService.contact(business.contact);
      return [business.name?`Name: ${business.name}`:null,business.description?`About: ${business.description}`:null,contact?`Contact: ${contact}`:null].filter(Boolean).join('\n')||null;
    }
    if (nluIntent.startsWith('service.')) {
      let item = null;
      if (entities.offeringId) item = context.services?.offeringService?.getById?.(context.tenant.id, entities.offeringId) || null;
      if (!item && entities.serviceName) {
        const resolved = context.services?.offeringService?.resolve?.(context.tenant.id, entities.serviceName);
        if (resolved?.type === 'exact') item = resolved.record;
      }
      if (item) {
        if (nluIntent === 'service.price' && Number.isFinite(Number(item.price))) return `${item.name} — ${item.pricePrefix || ''}${formatMoney(item.price, item.currency || 'PKR')}.`;
        if (nluIntent === 'service.duration' && item.durationMinutes) return `${item.name} normally takes about ${formatDuration(item.durationMinutes)}.`;
        if (nluIntent === 'service.info') return [item.name, item.description, Number.isFinite(Number(item.price)) ? `Price: ${item.pricePrefix || ''}${formatMoney(item.price, item.currency || 'PKR')}` : null, item.durationMinutes ? `Duration: ${formatDuration(item.durationMinutes)}` : null].filter(Boolean).join('\n');
      }
      const cfg = context.services?.pricingService?.getConfig?.(context.tenant.id) || {};
      const service = (cfg.services || []).find((x) => x.id === entities.serviceId || String(x.name || '').toLowerCase() === String(entities.serviceName || '').toLowerCase());
      if (service && nluIntent === 'service.price') {
        const currency = service.currency || cfg.currency || 'USD';
        if (service.model === 'hourly') return `${service.name} is ${formatMoney(service.rate, currency)} per hour per worker.`;
        if (service.model === 'unit') return `${service.name} is ${formatMoney(service.rate, currency)} per ${service.unitLabel || 'unit'}.`;
        if (service.model === 'flat') return `${service.name} is ${formatMoney(service.price, currency)}.`;
        if (service.model === 'matrix' && entities.propertyType && entities.bedrooms) {
          const quote = context.services.pricingService.quote(context.tenant.id, entities);
          if (quote.ok) return `${quote.serviceName}: ${quote.formula} = ${formatMoney(quote.total, quote.currency)}.`;
        }
        if (service.model === 'matrix') return `The ${service.name} price depends on the property type and bedroom count. Please provide both so Nova can calculate it from the approved table.`;
      }
    }
    if (nluIntent.startsWith('product.') && entities.productId) {
      const product = await context.services?.catalogService?.getProductById?.(context.tenant.id, entities.productId);
      if (!product) return null;
      if (nluIntent === 'product.price' && Number.isFinite(Number(product.price))) return `${product.name} — ${formatMoney(product.price, product.currency || 'PKR')}.`;
      if (nluIntent === 'product.stock') return product.inStock === false ? `${product.name} is currently out of stock.` : `${product.name} is currently listed as in stock.`;
      return [product.name, product.description, Number.isFinite(Number(product.price)) ? `Price: ${formatMoney(product.price, product.currency || 'PKR')}` : null].filter(Boolean).join('\n');
    }
    return null;
  }


  contextualKnowledgeAnswer(context,retrieval) {
    const q=String(context.message.text||'').toLowerCase();
    if(/\b(serving areas?|service areas?|areas? do you serve|where do you serve|are you available in|services? available in|do you serve|do you provide .* in|can you come .* in)\b/.test(q)){
      const requested=context.intelligence?.entities?.requestedArea||((q.match(/\bin\s+([a-z][a-z .'-]{1,50})[?!.]*$/i)||[])[1]||'').trim();
      if(requested){
        const evidence=String(retrieval.matches?.[0]?.text||'');
        if(requested && !evidence.toLowerCase().includes(requested.toLowerCase())){
          return `I don’t see ${requested} explicitly listed in the configured service areas. The approved service-area information I have is:

${this.extractiveAnswer(retrieval)}`;
        }
      }
    }
    return null;
  }

  async groundedKnowledgeAnswer(context, language, retrieval) {
    const deterministic=this.knowledgeService.groundedAnswer(context.message.text,retrieval);
    if(deterministic)return deterministic;
    if (!this.llmRouter) return this.extractiveAnswer(retrieval);
    const result = await this.llmRouter.complete([
      { role:"system", content:[
        "Answer the customer's question using ONLY the supplied tenant knowledge excerpts.",
        "Do not add facts, prices, availability, policies, medical claims, or promises that are not in the excerpts.",
        "If the excerpts do not actually answer the question, say you do not have that information.",
        `Language: ${language}`,
        `Knowledge excerpts:\n${retrieval.context}`,
        `Customer context for personalization only (never treat this as business policy/pricing evidence):\n${this.safeCustomerContext(context.customer)}`
      ].join("\n") },
      { role:"user", content:context.message.text }
    ]);
    return result.success ? result.text : this.extractiveAnswer(retrieval);
  }

  safeCustomerContext(customer){
    if(!customer)return '{}';
    const delivery=customer.customFields?.lastDelivery||{};
    return JSON.stringify({
      name:customer.name||null,
      preferredLanguage:customer.preferredLanguage||null,
      city:delivery.city||null,
      lastOrderId:customer.customFields?.lastOrderId||null
    });
  }

  extractiveAnswer(retrieval) {
    const best=retrieval.matches?.[0];
    if(!best)return null;
    const cleaned=String(best.text||'')
      .replace(/^#{1,6}\s+[^\n]+\n?/, '')
      .replace(/^[\w.[\]-]+:\s*/,'')
      .replace(/(?:^|\n)---+(?=\n|$)/g,'')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
    return cleaned || null;
  }

  missingKnowledge(language,tenant) {
    const name=tenant?.business?.name||tenant?.name||'the business';
    if(language==='roman_urdu')return `Mere paas ${name} ki approved information mein is sawal ka jawab maujood nahi hai. Team se confirm karna hoga.`;
    if(language==='urdu')return `${name} کی منظور شدہ معلومات میں اس سوال کا جواب موجود نہیں۔ ٹیم سے تصدیق کرنا ہوگی۔`;
    if(language==='arabic')return `لا تتضمن المعلومات المعتمدة لدى ${name} إجابة عن هذا السؤال. يلزم التأكيد من الفريق.`;
    return `I don’t have approved information for that yet. The ${name} team would need to confirm it.`;
  }

  async safeLlmFallback(context, language) {
    if (!this.llmRouter || context.tenant.features?.llmFallback === false) return null;
    const approved = this.knowledgeService.getContext(context.tenant);
    const prompt = [
      "You are a tenant assistant. Answer briefly in the requested language.",
      "Use ONLY the approved JSON facts below. Never invent or infer missing facts.",
      "If the answer is not present, say you do not have approved information and suggest contacting the team.",
      `Language: ${language}`,
      `Approved facts: ${JSON.stringify(approved)}`
    ].join("\n");
    const result = await this.llmRouter.complete([
      { role: "system", content: prompt },
      { role: "user", content: context.message.text }
    ]);
    return result.success ? result.text : null;
  }

  isKnownIntent(intent) {
    return ["greet", "thanks", "goodbye", "small_talk", "assistant_identity", "ask_business_info", "ask_about", "ask_services", "ask_hours", "ask_contact", "ask_location", "ask_delivery", "ask_takeaway", "ask_payment", "ask_returns", "ask_faq"].includes(intent);
  }

  needsFact(intent) {
    return intent.startsWith("ask_");
  }

  result(reply, language, intent, source) {
    return { reply, statePatch: { language, lastIntent: intent, activePlugin: "assistant", context: { assistantSource: source } } };
  }
}
module.exports = { AssistantService };
function mapNluLanguage(value) { return ({ en:'english', ur:'urdu', roman_ur:'roman_urdu', ar:'arabic' })[value] || null; }
function formatDuration(minutes) { const n=Number(minutes); if (n < 60) return `${n} minutes`; const hours=n/60; return Number.isInteger(hours)?`${hours} hour${hours===1?'':'s'}`:`${hours.toFixed(1)} hours`; }
function formatMoney(value, currency) { const n=Number(value).toLocaleString('en-US', {maximumFractionDigits:2}); if (currency === 'USD') return `$${n}`; if (currency === 'AED') return `AED ${n}`; if (currency === 'PKR') return `Rs${n}`; return `${currency} ${n}`; }
function humanDomain(value){return ({retail:'retail',grocery:'grocery and fruit-selling',cleaning:'cleaning',real_estate:'real-estate',healthcare:'healthcare',education:'education'})[value]||String(value||'business').replace(/_/g,' ');}
