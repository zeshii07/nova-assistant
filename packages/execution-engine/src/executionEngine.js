const { createConversationId } = require("../../shared/src/ids");
const { createInitialState, applyStatePatch } = require("../../state/src/stateSchema");
const { createCapabilityContext } = require("../../capability-sdk/src/capabilityContext");
const { createCapabilityResult } = require("../../capability-sdk/src/capabilityResult");
const { appendGoalHistory, transitionGoal } = require("../../conversation-intelligence/src/goal-engine");

/** Coordinates tenant, state, conversation intelligence, capability routing, humanization, events, replay and persistence. */
class ExecutionEngine {
  constructor({ tenantRepository, stateRepository, capabilityRouter, eventBus, logger, defaultTenantId, services = {}, humanizationEngine = null, socialIntelligenceEngine = null, conversationIntelligenceEngine = null, replayService = null }) {
    Object.assign(this, { tenantRepository, stateRepository, capabilityRouter, eventBus, logger, defaultTenantId, services, humanizationEngine, socialIntelligenceEngine, conversationIntelligenceEngine, replayService });
  }

  async process(message) {
    const processStarted = performance.now();
    const tenantId = message.tenantId || this.defaultTenantId;
    const tenant = this.tenantRepository.getById(tenantId);
    const conversationId = createConversationId(tenantId, message.channel, message.customerId);
    let state = await this.stateRepository.get(conversationId);
    if (!state) state = createInitialState({ tenantId, conversationId, channel: message.channel, customerId: message.customerId, language: tenant.defaultLanguage });
    const stateBefore = structuredClone(state);

    const logger = this.logger.child({ tenantId, conversationId });
    let customer = this.services.crmService
      ? await this.services.crmService.ensureCustomer({ tenantId, customerId: message.customerId, channel: message.channel, preferredLanguage: state.language })
      : { id: message.customerId };

    // Identity capture is cross-cutting, not a competing business workflow.
    // Save only an explicitly declared, centrally validated name, then continue
    // routing the rest of the same sentence normally.
    const declaredName=this.services.engagementService?.parseDeclaredName?.(message.text);
    if(declaredName?.valid && this.services.crmService){
      customer=await this.services.crmService.updateCustomerProfile({tenantId,customerId:message.customerId,name:declaredName.value});
    }

    let intelligence = null;
    if (this.conversationIntelligenceEngine) {
      try {
        intelligence = await this.conversationIntelligenceEngine.analyze({ tenant, message, state, services: this.services });
      } catch (error) {
        logger.error("conversation_intelligence.failed", { error:error.message, stack:error.stack });
        intelligence = null;
      }
    }

    // Shared customer fields are cross-cutting. Persist validated values even
    // when the same sentence's primary intent belongs to Booking, Cleaning,
    // Catalog, Commerce, or another future capability.
    const sharedCustomer=intelligence?.messageFrame?.entities||{};
    const profilePatch={};
    for(const key of ['name','phone','email']){
      if(typeof sharedCustomer[key]!=='string'||!sharedCustomer[key].trim())continue;
      const options=key==='phone'?{minDigits:10,maxDigits:15}:{};
      const parsed=this.services.engagementService?.parseField?.(key,sharedCustomer[key],options);
      if(parsed?.valid)profilePatch[key]=parsed.value;
    }
    if(Object.keys(profilePatch).length&&this.services.crmService){
      try{customer=await this.services.crmService.updateCustomerProfile({tenantId,customerId:message.customerId,...profilePatch});}
      catch(error){logger.warn('shared_customer_fields.sync_failed',{error:error.message});}
    }

    await this.eventBus.publish("message.received.v1", { tenantId, conversationId, message }, { source: "execution-engine" });

    // Highest-priority global commands never enter a business workflow.
    if (intelligence?.globalCommand) {
      const response = await this.#handleGlobalCommand({ intelligence, tenant, message, state, conversationId, customer, logger, stateBefore, processStarted });
      return response;
    }

    if(intelligence?.requiresClarification){
      const reply=clarificationReply({
        text:message.text,
        language:state.language,
        tenant,
        workflow:intelligence.workflow?.current,
        reason:intelligence.clarificationReason
      });
      return this.#finalize({
        tenant,message,conversationId,customer,state,stateBefore,capabilityId:'system',intelligence,logger,processStarted,
        result:createCapabilityResult({handled:true,reply,responseModel:{intent:'CONVERSATION_CLARIFICATION_REQUIRED',payload:{legacyText:reply,reason:intelligence.clarificationReason}},statePatch:{lastIntent:'conversation_clarification_required'}})
      });
    }

    const routingContext = createCapabilityContext({
      tenant, message, state, conversationId, customer,
      services: { ...this.services, events: this.eventBus },
      logger, intelligence
    });

    const match = await this.capabilityRouter.resolve(routingContext);
    if (!match) {
      const name=tenant.business?.name||tenant.name||'This business';
      const domain=String(tenant.domain||'business').replace(/_/g,' ');
      const reply = `I may be missing part of what you mean, but I have not changed or submitted anything. ${name} is a ${domain} business; please mention the product, service, business information, booking, order, or change you need, and I’ll route it to the correct tenant capability.`;
      return this.#finalize({ tenant, message, conversationId, customer, state, stateBefore, capabilityId:null, result:createCapabilityResult({handled:true,reply}), intelligence, logger, processStarted });
    }

    const scopedServices = {};
    for (const [serviceName, service] of Object.entries(this.services || {})) {
      if (!service || typeof service.scope !== "function") continue;
      const publicName = serviceName.endsWith("Service") ? serviceName.slice(0, -7) : serviceName;
      scopedServices[publicName] = service.scope({ tenant, capabilityId: match.capability.id, customerId: message.customerId, conversationId });
    }
    const executionContext = createCapabilityContext({
      tenant, message, state, conversationId, customer,
      services: { ...this.services, events: this.eventBus, ...scopedServices },
      logger, intelligence
    });

    let result;
    try {
      result = createCapabilityResult(await match.capability.execute(executionContext));
    } catch (error) {
      logger.error("capability.execute_failed", { capabilityId: match.capability.id, error: error.message });
      result = createCapabilityResult({ handled: true, reply: "Sorry, I could not complete that request right now.", metadata: { error: "capability_execution_failed" } });
    }

    await this.services.customerDataBridge?.sync({
      tenantId:tenant.id,
      customerId:message.customerId,
      channel:message.channel,
      language:result?.statePatch?.language||state.language,
      result
    });

    return this.#finalize({ tenant, message, conversationId, customer, state, stateBefore, capabilityId:match.capability.id, result, intelligence, logger, processStarted, executionContext });
  }

  async #handleGlobalCommand({ intelligence, tenant, message, state, conversationId, customer, logger, stateBefore, processStarted }) {
    const command = intelligence.globalCommand.type;
    let reply;
    let patch = {};
    if (command === "cancel") {
      const holdId=state.capabilityState?.booking?.metadata?.calendarHoldId;
      if(holdId)await this.services.calendarService?.releaseHold?.({tenantId:tenant.id,customerId:message.customerId,holdId,reason:"conversation_cancelled"});
      reply = state.language === "roman_urdu" ? "Theek hai 👍 Current request/order cancel kar diya hai. Agar galti se cancel hua ho to 'undo' keh dein." : state.language === "urdu" ? "ٹھیک ہے 👍 موجودہ درخواست منسوخ کر دی گئی ہے۔ اگر غلطی سے منسوخ ہوا ہو تو واپس بحال کر سکتے ہیں۔" : "No problem 👍 I’ve cancelled the current request/order. If that was a mistake, just say ‘undo’ and I can restore it.";
      const cancelledSnapshot = { goal:state.context?.goal || null, capabilityState:structuredClone(state.capabilityState || {}), cancelledAt:new Date().toISOString() };
      patch = { activePlugin:null, pendingQuestion:null, mode:"chatting", lastIntent:"conversation_cancelled", context:{ ...(state.context||{}), lastCancelled:cancelledSnapshot, goal:null }, capabilityState:{ ...(state.capabilityState || {}), catalog:{}, commerce:{}, cleaning:{}, booking:{}, offering:{} } };
    } else if (command === "undo_cancel") {
      const snap=state.context?.lastCancelled;
      if (snap?.goal) {
        reply = state.language === "roman_urdu" ? "Bilkul 👍 Aapka pichla order/request restore kar diya hai. Jahan chhoda tha wahan se continue karte hain." : "Sure 👍 I restored your previous order/request. We can continue from where you left off.";
        patch = { lastIntent:"conversation_cancel_undone", context:{...(state.context||{}), goal:snap.goal, lastCancelled:null}, capabilityState:snap.capabilityState || {} };
      } else {
        reply = state.language === "roman_urdu" ? "Restore karne ke liye koi recent cancelled request nahi mili." : "I don’t have a recent cancelled request to restore.";
        patch = { lastIntent:"conversation_cancel_undo_missing" };
      }
    } else if (command === "reset") {
      reply = state.language === "roman_urdu" ? "Theek hai, hum fresh start karte hain 😊 Aap ko kis cheez mein madad chahiye?" : state.language === "urdu" ? "ٹھیک ہے، ہم نئے سرے سے شروع کرتے ہیں 😊 آپ کو کس چیز میں مدد چاہیے؟" : "Sure — let’s start fresh 😊 How can I help you?";
      patch = { activePlugin:null, pendingQuestion:null, mode:"chatting", lastIntent:"conversation_reset", context:{ goal:null, goalHistory:[], recentTurns:[] }, capabilityState:{} };
    } else {
      const handoff=await this.services?.handoffService?.create({
        tenantId:tenant.id,conversationId,customerId:message.customerId,reason:"customer_requested",
        context:{message:message.text,activePlugin:state.activePlugin||null,pendingQuestion:state.pendingQuestion||null,goal:state.context?.goal||null,capabilityState:state.capabilityState||{}}
      });
      const ref=handoff?.id ? ` Reference: ${handoff.id}.` : "";
      reply = state.language === "roman_urdu"
        ? `Human support request create kar di gayi hai.${ref} Aapka current conversation context bhi handover ke sath rahega.`
        : `Your human-support request has been created.${ref} I’ll keep the current conversation context attached to the handoff.`;
      patch = { lastIntent:"human_handoff_requested", context:{...(state.context||{}),handoff:{id:handoff?.id||null,status:"open"}} };
    }
    const result = createCapabilityResult({ handled:true, reply, statePatch:patch, metadata:{globalCommand:command} });
    return this.#finalize({ tenant, message, conversationId, customer, state, stateBefore, capabilityId:"system", result, intelligence, logger, processStarted });
  }

  async #finalize({ tenant, message, conversationId, customer, state, stateBefore, capabilityId, result, intelligence, logger, processStarted, executionContext = null }) {
    let nextGoal = intelligence?.globalCommand ? (result.statePatch?.context?.goal ?? null) : (intelligence?.goal?.nextGoal ?? state.context?.goal ?? null);
    const responseIntent = result.responseModel?.intent || null;
    if (nextGoal && responseIntent === 'COMMERCE_ORDER_CREATED') nextGoal = transitionGoal(nextGoal, { status:'completed', stage:'completed' });
    if (nextGoal && ['CLEANING_REQUEST_CREATED','CLEANING_REQUESTS_CREATED'].includes(responseIntent)) nextGoal = transitionGoal(nextGoal, { status:'completed', stage:'completed' });
    const goalHistory = intelligence?.goal?.transition
      ? appendGoalHistory(state, { ...intelligence.goal.transition, goalId: nextGoal?.id || intelligence?.goal?.current?.id || null })
      : (state.context?.goalHistory || []);
    const replaceCapabilityState = intelligence?.globalCommand?.type === "reset";
    // Conversation memory window: keep the last 6 customer turns + the
    // capability/intent that handled each. PII is NOT stored here — only
    // the customer's message text (already shown to the user) and the
    // capability/intent label. This lets the remote NLU resolver resolve
    // pronouns like "book it again" or "the same time as last week" without
    // leaking customer contact data to the provider.
    const MAX_RECENT_TURNS = 6;
    const previousTurns = Array.isArray(state.context?.recentTurns) ? state.context.recentTurns : [];
    const recentTurns = [...previousTurns, { text: message.text, capabilityId: capabilityId || null, intent: intelligence?.selected?.intent || null, at: new Date().toISOString() }].slice(-MAX_RECENT_TURNS);
    state = applyStatePatch(state, {
      ...result.statePatch,
      capabilityState: replaceCapabilityState
        ? (result.statePatch.capabilityState || {})
        : { ...(state.capabilityState || {}), ...(result.statePatch.capabilityState || {}) },
      context: { ...state.context, ...(result.statePatch.context || {}), goal: nextGoal, goalHistory, lastMessage: message.text, lastCapability: capabilityId, conversationIntelligence: summarizeIntelligence(intelligence), recentTurns }
    });
    await this.stateRepository.save(state);

    for (const event of result.events) await this.eventBus.publish(event.name, event.payload || {}, { tenantId:tenant.id, conversationId, capabilityId });
    let experience = null;
    if (this.humanizationEngine) {
      const context = executionContext || createCapabilityContext({ tenant, message, state, conversationId, customer, services:{...this.services,events:this.eventBus}, logger, intelligence });
      try {
        experience = await this.humanizationEngine.humanize({ capabilityId: capabilityId || "system", result, context });
        result.reply = experience.text;
        if (this.socialIntelligenceEngine) {
          result.reply = this.socialIntelligenceEngine.polish(result.reply, { social:intelligence?.social || {}, language:experience.language || state.language, capabilityId, selectedIntent:intelligence?.selected?.intent || null, messageText:message.text, relationship:experience.relationship });
        }
        if (experience.language && state.language !== experience.language) {
          state = applyStatePatch(state, { language: experience.language });
          await this.stateRepository.save(state);
        }
      } catch (error) {
        logger.error("experience_render.failed", { capabilityId, error:error.message, stack:error.stack });
        experience = null;
      }
    }
    // When a user temporarily interrupts an active workflow with a business
    // question, preserve the workflow and gently resume it after answering.
    const activeWorkflow = intelligence?.workflow?.current;
    const resumeSocialConfirmation=intelligence?.interruption?.type==='social'&&['confirm','confirmation'].includes(activeWorkflow?.pendingField);
    const resumeProfileQuestion=capabilityId==='crm'&&intelligence?.selected?.intent==='crm.ask_name';
    if ((intelligence?.interruption||resumeProfileQuestion) && activeWorkflow && capabilityId !== activeWorkflow.capabilityId && (intelligence?.interruption?.type !== "social"||resumeSocialConfirmation||resumeProfileQuestion)) {
      const resume = resumePrompt(activeWorkflow, state.language);
      if (resume && !result.reply.includes(resume)) result.reply = `${result.reply}\n\n${resume}`;
    }

    // Lead extraction is passive and cross-cutting. It observes the validated
    // result after state persistence, but cannot execute a booking/order or
    // manufacture contact data. Failures are isolated from the customer reply.
    if(this.services.leadService){
      const latestCustomer=await this.services.crmService?.getCustomer?.(tenant.id,message.customerId)||customer;
      await this.services.leadService.observe({tenantId:tenant.id,conversationId,customerId:message.customerId,channel:message.channel,message,customer:latestCustomer,capabilityId,intelligence,result,state});
    }

    await this.eventBus.publish("message.processed.v1", { tenantId:tenant.id, conversationId, capabilityId }, { source:"execution-engine" });
    const timingMs = Number((performance.now()-processStarted).toFixed(3));
    logger.info("execution.completed", { capabilityId, confidence:intelligence?.selected?.confidence || result.confidence, timingMs });

    let replayId = null;
    if (this.replayService) {
      try {
        const replay = await this.replayService.record({
          tenantId:tenant.id, conversationId, customerId:message.customerId, channel:message.channel,
          message:{ text:message.text, id:message.messageId || null }, stateBefore, intelligence,
          capabilityId, responseModel:result.responseModel, reply:result.reply, experience:experience ? { intent:experience.semantic?.intent, language:experience.language, relationship:experience.relationship } : null,
          stateAfter:state, performance:{ totalMs:timingMs, intelligenceMs:intelligence?.timingMs || 0 }
        });
        replayId = replay.id;
      } catch (error) {
        logger.error("replay.record_failed", { capabilityId, error:error.message });
      }
    }
    return { conversationId, reply:result.reply, state, capabilityId, intelligence, replayId, experience:experience ? { intent:experience.semantic.intent, language:experience.language, relationship:experience.relationship } : null };
  }
}
function summarizeIntelligence(value){ if(!value)return null; return { selected:value.selected,entities:value.entities,messageFrame:value.messageFrame,workflow:value.workflow,goal:value.goal ? { current:value.goal.current,nextGoal:value.goal.nextGoal,transition:value.goal.transition,override:value.goal.override } : null,correction:value.correction,interruption:value.interruption,globalCommand:value.globalCommand,requiresClarification:value.requiresClarification,clarificationReason:value.clarificationReason,nlu:value.nlu ? {used:value.nlu.used,validated:value.nlu.validated,mode:value.nlu.mode,strategy:value.nlu.strategy,deterministicFallback:value.nlu.deterministicFallback,executionAuthority:value.nlu.executionAuthority,model:value.nlu.model,promptVersion:value.nlu.promptVersion,decision:value.nlu.decision,invocationReason:value.nlu.invocationReason,error:value.nlu.error,httpStatus:value.nlu.httpStatus,providerMessage:value.nlu.providerMessage,providerErrorType:value.nlu.providerErrorType,providerRequestId:value.nlu.providerRequestId,latencyMs:value.nlu.latencyMs,languageContract:value.nlu.languageContract}:null}; }
function clarificationReply({text,language,tenant,workflow}){
  const name=tenant?.business?.name||tenant?.name||'this business';
  const domain=String(tenant?.domain||'business').replace(/_/g,' ');
  const pending=workflow?.pendingField;
  const directPrompt=resumePrompt(workflow,language);
  if(pending&&directPrompt){
    if(language==='roman_urdu')return `Yeh ${friendlyField(pending)} ki valid value nahi lagi. Aap ka current draft safe hai. ${directPrompt}`;
    if(language==='urdu')return `یہ ${friendlyField(pending)} کی درست قدر نہیں لگی۔ آپ کا موجودہ ڈرافٹ محفوظ ہے۔ ${directPrompt}`;
    if(language==='arabic')return `لا تبدو هذه قيمة صحيحة للحقل المطلوب. ما زالت مسودتك محفوظة. ${directPrompt}`;
    return `That doesn’t look like a valid ${friendlyField(pending)}. Your current draft is still safe. ${directPrompt}`;
  }
  const continuation=pending?` Your current ${workflow.capabilityId||'request'} draft is still safe; I still need ${friendlyField(pending)} when you are ready.`:'';
  if(language==='arabic')return `لم أفهم الطلب بالكامل، لذلك لم أغيّر أو أرسل أي شيء. يرجى ذكر الخدمة أو المنتج والإجراء المطلوب بوضوح.${pending?' ما زال طلبك الحالي محفوظًا.':''}`;
  if(language==='urdu'||(/[\u0600-\u06ff]/.test(String(text||''))&&language!=='arabic'))return `میں درخواست پوری طرح سمجھ نہیں سکا، اس لیے میں نے کچھ تبدیل یا جمع نہیں کیا۔ براہِ کرم ${name} سے متعلق سروس، پروڈکٹ یا مطلوبہ تبدیلی واضح کر دیں۔${pending?' آپ کا موجودہ ڈرافٹ محفوظ ہے۔':''}`;
  if(language==='roman_urdu')return `Main request poori tarah samajh nahi saka, is liye maine kuch change ya submit nahi kiya. ${name} ki service/product aur jo action chahiye woh saaf likh dein.${pending?' Aap ka current draft mehfooz hai.':''}`;
  return `I’m not fully sure which ${domain} request you mean, so I haven’t changed or submitted anything. Please name the service or product and the action you want.${continuation}`;
}
function friendlyField(value){return String(value||'the next detail').replace(/([A-Z])/g,' $1').replace(/_/g,' ').toLowerCase();}
function resumePrompt(workflow, language) {
  const field = workflow?.pendingField==='confirm'?'confirmation':workflow?.pendingField;
  if (!field) return null;
  const serviceWorkflow=['booking','cleaning','offering'].includes(workflow?.capabilityId);
  const english = serviceWorkflow
    ? { name:"To continue your request, what full name should I use?", phone:"To continue your request, what contact number should I use?", city:"To continue your request, which city applies?", address:"To continue your request, please share the full service address.", landmark:"To continue your request, share a nearby landmark or say 'skip'.", paymentMethod:"To continue your request, choose a payment method.", date:"To continue your request, what date would you prefer?", time:"To continue your request, what time would you prefer?", confirmation:"If everything looks right, you can confirm when you're ready." }
    : { name:"To continue, what name should I use for delivery?", phone:"To continue, what is your delivery phone number?", city:"To continue, which city should we deliver to?", address:"To continue, please share the full delivery address.", landmark:"To continue, share a nearby landmark or say 'skip'.", paymentMethod:"To continue, choose a payment method.", date:"To continue your request, what date would you prefer?", time:"To continue your request, what time would you prefer?", confirmation:"If everything looks right, you can confirm when you're ready." };
  const roman = serviceWorkflow
    ? { name:"Request continue karne ke liye poora naam bata dein.", phone:"Request continue karne ke liye contact number bata dein.", city:"Request continue karne ke liye city bata dein.", address:"Request continue karne ke liye service ka full address bata dein.", landmark:"Request continue karne ke liye landmark bata dein ya skip likhein.", paymentMethod:"Request continue karne ke liye payment method bata dein.", date:"Request continue karne ke liye date bata dein.", time:"Request continue karne ke liye time bata dein.", confirmation:"Jab ready hon to request confirm kar dein." }
    : { name:"Order continue karne ke liye delivery ka naam bata dein.", phone:"Order continue karne ke liye delivery phone number bata dein.", city:"Order continue karne ke liye city bata dein.", address:"Order continue karne ke liye full address bata dein.", landmark:"Order continue karne ke liye landmark bata dein ya skip likhein.", paymentMethod:"Order continue karne ke liye payment method bata dein.", date:"Request continue karne ke liye date bata dein.", time:"Request continue karne ke liye time bata dein.", confirmation:"Jab ready hon to request confirm kar dein." };
  const map = language === "roman_urdu" ? roman : english;
  if (field === "size_or_quantity") return language === "roman_urdu" ? "Product selection continue karne ke liye size ya quantity bata dein." : "To continue the product selection, tell me the size or quantity.";
  return map[field] || null;
}
module.exports = { ExecutionEngine };
