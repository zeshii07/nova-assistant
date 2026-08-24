const { normalizeText } = require('./text');
const { GlobalCommandEngine } = require('./globalCommandEngine');
const { CorrectionEngine } = require('./correctionEngine');
const { InterruptionEngine } = require('./interruptionEngine');
const { ConversationStack } = require('./conversationStack');
const { ConfidenceEngine } = require('./confidenceEngine');
const { ValidationEngine } = require('./validationEngine');
const { GoalResolver } = require('./goal-engine');
const { UniversalSemanticEngine } = require('./universalSemanticEngine');
const { WorkflowOwnershipEngine } = require('./workflowOwnershipEngine');
const { ClauseSemanticEngine } = require('./clauseSemanticEngine');
const { TemporalSemanticExtractor } = require('./temporalSemanticExtractor');
const { UniversalMessageFrame, mergeUniversalEntities, appendResolvedIntents } = require('./universalMessageFrame');

class ConversationIntelligenceEngine {
  constructor({ adapterRegistry, llmInterpreter = null, nluInterpreter = null, aiLanguageLayer = null, semanticRouter = null, semanticRoutePolicy = null, nluDecisionPolicy = null, nluInvocationPolicy = null, logger = null, socialIntelligenceEngine = null, domainResolver = null } = {}) {
    this.adapterRegistry = adapterRegistry;
    this.llmInterpreter = llmInterpreter;
    this.nluInterpreter = nluInterpreter;
    this.aiLanguageLayer = aiLanguageLayer;
    this.semanticRouter = semanticRouter;
    this.semanticRoutePolicy = semanticRoutePolicy;
    this.nluDecisionPolicy = nluDecisionPolicy;
    this.nluInvocationPolicy = nluInvocationPolicy;
    this.logger = logger;
    this.globalCommands = new GlobalCommandEngine();
    this.corrections = new CorrectionEngine();
    this.interruptions = new InterruptionEngine();
    this.stack = new ConversationStack();
    this.confidence = new ConfidenceEngine();
    this.validation = new ValidationEngine();
    this.goals = new GoalResolver();
    this.social = socialIntelligenceEngine;
    this.universal = new UniversalSemanticEngine();
    this.domainResolver = domainResolver;
    this.workflowOwnership = new WorkflowOwnershipEngine();
    this.clauses = new ClauseSemanticEngine();
    this.temporal = new TemporalSemanticExtractor();
    this.messageFrames = new UniversalMessageFrame();
  }

  async analyze({ tenant, message, state, services = {} }) {
    const started = performance.now();
    const normalizedText = normalizeText(message.text);
    const social = this.social?.analyze(message.text) || {};
    const semantic = this.universal.analyze(message.text);
    const clauseSemantics = this.clauses.analyze(message.text);
    const temporal = this.temporal.extract(clauseSemantics.primaryText);
    const messageFrame = this.messageFrames.analyze({text:message.text,clauseSemantics,temporal});
    const domain = this.domainResolver?.resolve({ tenant, semantic }) || { domainId:tenant.domain || 'universal', semantic };
    const unsupportedDomain = detectUnsupportedDomain(normalizedText, tenant);
    const workflowStack = this.stack.snapshot(state);
    let globalCommand = this.globalCommands.detect(message.text);
    if(globalCommand?.type==='cancel'&&state.capabilityState?.booking?.status==='completed'&&/\b(?:cancel|stop)\b.*\b(?:booking|appointment|reservation|lesson|session)\b|\bcancel (?:it|this)\b/i.test(message.text))globalCommand=null;
    if(globalCommand?.type==='cancel'&&state.capabilityState?.cleaning?.lastRequestId&&/\b(?:cancel|stop)\b.*\b(?:cleaning|request|booking|appointment|service)\b|\b(?:cleaning|request|booking|appointment|service)\b.*\b(?:cancel|stop)\b|\bcancel (?:it|this|that)\b/i.test(message.text))globalCommand=null;
    const correction = this.corrections.detect(message.text, state);
    const deterministicInterruption = this.interruptions.detect(message.text, state);
    const pending = workflowStack[workflowStack.length - 1] || null;
    const pendingValidation = pending ? this.validation.validatePending({ field: pending.pendingField, message: message.text }) : { valid:true };

    // Nova's lightweight statistical router runs locally before capability
    // adapters. It recognizes paraphrased intent and conversation meaning,
    // but has no execution authority. Keep its result separate from the
    // deterministic message frame: feeding probabilistic labels back into
    // adapter extraction can turn a useful hint into a self-fulfilling route.
    let localSemantic=null;
    if(this.semanticRouter){
      try{
        localSemantic=await this.semanticRouter.analyze({tenant,message,state,services,pending,messageFrame,clauseSemantics,temporal});
        annotateMessageFrameWithLocalSemantic(messageFrame,localSemantic);
      }catch(error){
        this.logger?.error?.('conversation_semantic_router.failed',{error:error.message});
        localSemantic={used:true,accepted:false,decision:'failed',primaryIntent:null,intents:[],escalation:{recommended:true,reason:'local_router_failed'},error:error.message,timingMs:0};
      }
    }

    // The language model is interpretation-only. In `primary` strategy it
    // runs before adapters so they receive a strict linguistic contract. In
    // `adaptive` strategy Nova keeps the deterministic fast path and requests
    // the model only for uncertain/conflicting language.
    const nluEnabled = Boolean(this.aiLanguageLayer?.isEnabled?.(tenant) ?? this.nluInterpreter?.isEnabled?.(tenant));
    const nluStrategy=nluEnabled?(this.aiLanguageLayer?.strategyFor?.(tenant)||this.aiLanguageLayer?.strategy||this.nluInvocationPolicy?.strategy||'adaptive'):'off';
    let nlu = null;
    let nluInvocation = nluEnabled ? {invoke:false,reason:'not_evaluated'} : { invoke:false, reason:'mode_off' };
    const invokeNlu = async () => {
      try {
        if(this.aiLanguageLayer)return await this.aiLanguageLayer.interpret({tenant,message,state,services,pending});
        return await this.nluInterpreter.interpret({ tenant, message, state, services, pending });
      } catch (error) {
        this.logger?.error('conversation_remote_nlu.failed', { error:error.message });
        return { used:true, validated:false, interpretation:null, error:'interpreter_failed', mode:this.nluInterpreter?.mode || 'on' };
      }
    };
    if(nluEnabled&&nluStrategy==='primary'){
      nluInvocation={invoke:true,reason:'primary_language_layer'};
      nlu=await invokeNlu();
      enrichMessageFrameFromLanguageContract(messageFrame,nlu?.contract,nlu?.interpretation);
    }
    const candidates = [];
    const vocabularyMatches = [];
    const entityCandidates = [];
    for (const adapter of this.adapterRegistry.list()) {
      if (!tenant.capabilities?.includes(adapter.capabilityId)) continue;
      try {
        const analysis = await adapter.analyze({ tenant, message, state, services, normalizedText, correction, interruption:deterministicInterruption, pending, domain, clauseSemantics, temporal, messageFrame, nluInterpretation:nlu?.interpretation || null });
        if (!analysis) continue;
        for (const item of analysis.vocabularyMatches || []) vocabularyMatches.push({ capabilityId:adapter.capabilityId, ...item });
        if (analysis.entities && Object.keys(analysis.entities).length) entityCandidates.push({ capabilityId:adapter.capabilityId, entities:mergeUniversalEntities(messageFrame.entities,analysis.entities) });
        for (const candidate of analysis.candidates || []) candidates.push({ capabilityId:adapter.capabilityId, priority:analysis.priority || 0, ...candidate, entities:mergeUniversalEntities(messageFrame.entities,candidate.entities) });
      } catch (error) {
        this.logger?.error('conversation_adapter.failed', { capabilityId:adapter.capabilityId, error:error.message });
      }
    }

    const initialChoice = this.confidence.choose(candidates);
    const semanticPolicy=this.semanticRoutePolicy?.apply?.({choice:initialChoice,route:localSemantic,tenant,pending,messageFrame})||{choice:initialChoice,decision:'not_configured',aligned:false};
    const choice = prioritizeDeterministicInterrupt({
      choice:semanticPolicy.choice,
      pending,
      pendingValidation,
      interruption:deterministicInterruption,
      messageFrame
    });
    let nluPolicy = { selected:choice.winner, entities:choice.winner?.entities || {}, interruption:null, decision:'not_configured' };
    if(nluEnabled&&nluStrategy!=='primary'){
      nluInvocation=this.nluInvocationPolicy?.evaluate?.({ choice, pending, pendingValidation, correction, deterministicInterruption, clauseSemantics, message, messageFrame, localSemantic, semanticPolicy }) || { invoke:choice.needsLlm, reason:choice.needsLlm?'low_confidence':'deterministic_confident' };
      if(nluInvocation.invoke){nlu=await invokeNlu();enrichMessageFrameFromLanguageContract(messageFrame,nlu?.contract,nlu?.interpretation);}
    }
    if (nluEnabled && nluInvocation.invoke && this.nluDecisionPolicy) {
      nluPolicy = this.nluDecisionPolicy.apply({ tenant, deterministic:choice.winner, deterministicCandidates:choice.ordered, nlu, pending, invocationReason:nluInvocation.reason });
    }
    let llm = null;
    if (!nluPolicy.selected && choice.needsLlm && this.llmInterpreter && tenant.features?.llmFallback) {
      try { llm = await this.llmInterpreter.interpret({ tenant, message, state, candidates, entityCandidates }); }
      catch (error) { this.logger?.error('conversation_llm_interpreter.failed', { error:error.message }); }
    }
    let selected = llm?.validated ? llm.interpretation : nluPolicy.selected;
    const interruption = deterministicInterruption || nluPolicy.interruption || null;
    selected = this.workflowOwnership.resolve({state,message,selected,interruption});
    if (unsupportedDomain) { selected = { capabilityId:'assistant', intent:'assistant.unsupported_capability', confidence:.9996, reason:'unsupported_tenant_capability', entities:{ domain:unsupportedDomain } }; }

    let entities = mergeUniversalEntities(messageFrame.entities,selected?.entities || nluPolicy.entities || entityCandidates.find((e) => e.capabilityId === selected?.capabilityId)?.entities || {});
    if(selected)selected={...selected,entities};
    const goal = globalCommand
      ? { current: state?.context?.goal || null, nextGoal: null, transition: { type:`goal.${globalCommand.type}` }, override:null }
      : await this.goals.resolve({ tenant, message, state, services, selected, entities });
    if (goal.override) { selected = goal.override; entities = goal.override.entities || entities; }

    const modelArbitration=new Set([
      'no_deterministic_route',
      'low_confidence',
      'competing_deterministic_routes',
      'social_prefix_with_unresolved_content',
      'ambiguous_correction',
      'invalid_pending_value',
      'semantic_route_conflict',
      'complex_multi_intent',
      'local_semantic_uncertain'
    ]);
    const weakDeterministicSelection=!selected||Number(selected.confidence||0)<.8;
    const unresolvedArbitration=nluInvocation.invoke&&modelArbitration.has(nluInvocation.reason)
      && (nluPolicy.decision==='ambiguous_unresolved'||weakDeterministicSelection)
      && !(nluInvocation.reason==='complex_multi_intent'&&selected&&Number(selected.confidence||0)>=.95);
    // When remote NLU is off, preserve the legacy capability router as a second
    // deterministic matcher (CRM commands and pending-field validation use
    // it). A provider timeout/rate limit must not disable a valid deterministic
    // owner: the selected core capability still validates the value safely.
    // Clarification remains mandatory when there is no core route or the model
    // returned a validated-but-unresolved ambiguity.
    const requiresClarification=!globalCommand&&!unsupportedDomain&&(
      unresolvedArbitration||(!selected&&nluEnabled&&nluInvocation.invoke)
    );

    messageFrame.resolvedIntents=appendResolvedIntents(messageFrame,choice.ordered,nlu?.interpretation);
    messageFrame.primaryResolvedIntent=selected?{capabilityId:selected.capabilityId,intent:selected.intent,confidence:selected.confidence}:null;
    const analysis = {
      version:'2.0', normalizedText, semantic, clauseSemantics, temporal, messageFrame, domain, social, unsupportedDomain, globalCommand, correction, interruption, deterministicInterruption, goal,
      requiresClarification,clarificationReason:requiresClarification?(unresolvedArbitration?nluInvocation.reason:'no_resolved_route'):null,
      workflow:{ stack:workflowStack, current:pending },
      validation:{ pending:pendingValidation },
      vocabularyMatches,
      candidates:choice.ordered,
      entities,
      selected: selected || null,
      forcedCapabilityId: selected?.capabilityId || null,
      semanticRouter:{
        used:Boolean(localSemantic?.used),accepted:Boolean(localSemantic?.accepted),decision:localSemantic?.decision||'not_configured',
        engine:localSemantic?.engine||null,model:localSemantic?.model||null,language:localSemantic?.language||null,
        primaryIntent:localSemantic?.primaryIntent||null,intents:localSemantic?.intents||[],
        message:localSemantic?.message||null,workflow:localSemantic?.workflow||null,
        tenantMatches:localSemantic?.tenantMatches||[],ambiguity:localSemantic?.ambiguity||[],
        complexity:localSemantic?.complexity||null,escalation:localSemantic?.escalation||null,
        authority:localSemantic?.authority||{execution:'nova_deterministic_core',mayExecute:false},
        policyDecision:semanticPolicy.decision,alignedDeterministicCandidate:Boolean(semanticPolicy.aligned),
        error:localSemantic?.error||null,timingMs:localSemantic?.timingMs||0
      },
      nlu:{
        used:Boolean(nlu?.used), validated:Boolean(nlu?.validated), mode:nlu?.mode || this.nluInterpreter?.mode || 'off',
        strategy:nluStrategy,
        deterministicFallback:Boolean(nluEnabled&&nluInvocation.invoke&&!nlu?.validated&&choice.winner),
        executionAuthority:'nova_deterministic_core',
        model:nlu?.model || null, promptVersion:nlu?.promptVersion || null, interpretation:nlu?.interpretation || null,
        languageContract:nlu?.contract || null,
        decision:nluPolicy.decision, invocationReason:nluInvocation.reason,
        error:nlu?.error || null, httpStatus:nlu?.httpStatus || null,
        providerMessage:nlu?.providerMessage || null, providerErrorType:nlu?.providerErrorType || null,
        providerRequestId:nlu?.providerRequestId || null, latencyMs:nlu?.latencyMs || 0
      },
      llm:{ used:Boolean(llm), validated:Boolean(llm?.validated), interpretation:llm?.interpretation || null },
      timingMs:Number((performance.now()-started).toFixed(3))
    };
    return analysis;
  }
}
module.exports = { ConversationIntelligenceEngine };

/**
 * AI fields are hints, never authority. They are installed as the shared
 * frame first and the local deterministic extraction is layered over them, so
 * a proven date/time/name/product match always wins a disagreement.
 */
function enrichMessageFrameFromLanguageContract(frame,contract,interpretation){
  if(!frame||!contract)return frame;
  frame.entities=mergeUniversalEntities(contract.entities||{},frame.entities||{});
  const aiIntents=(contract.intents||[]).map(item=>({
    intent:item.name,
    confidence:Number(item.confidence||0),
    clauseIndex:null,
    modality:contract.message?.certainty==='ambiguous'?'ambiguous':'asserted',
    source:'ai_language_contract',
    messageType:item.messageType
  }));
  frame.intents=dedupeFrameIntents([...(frame.intents||[]),...aiIntents]);
  frame.hasMultipleIntents=new Set(frame.intents.map(item=>item.intent).filter(intent=>intent&&!intent.startsWith('conversation.social'))).size>1;
  frame.languageContractVersion=contract.contractVersion;
  frame.aiPrimaryIntent=interpretation?.intent||contract.primaryIntent?.name||null;
  return frame;
}

function dedupeFrameIntents(items){
  const seen=new Set(),out=[];
  for(const item of items){const key=`${item.intent}|${item.clauseIndex??''}`;if(!item.intent||seen.has(key))continue;seen.add(key);out.push(item);}
  return out;
}

module.exports.enrichMessageFrameFromLanguageContract=enrichMessageFrameFromLanguageContract;

function annotateMessageFrameWithLocalSemantic(frame,route){
  if(!frame||!route?.used)return frame;
  // Telemetry only. The local classifier is consulted later by the semantic
  // route policy and Groq escalation policy; adapters continue to see only
  // facts extracted by Nova's deterministic language engines.
  frame.localSemanticPrimaryIntent=route.primaryIntent?.name||null;
  frame.localSemanticAccepted=Boolean(route.accepted);
  frame.detectedLanguage=route.language||null;
  return frame;
}

module.exports.annotateMessageFrameWithLocalSemantic=annotateMessageFrameWithLocalSemantic;

/**
 * A validated side question must not be swallowed by the active workflow's
 * generic `continue` candidate. This happens before model invocation so clear
 * interrupts remain on Nova's fast deterministic path.
 */
function prioritizeDeterministicInterrupt({choice,pending,pendingValidation,interruption,messageFrame}){
  if(!pending||interruption?.type!=='business_question'||pendingValidation?.valid!==false)return choice;
  const preciseOwner=(choice?.ordered||[]).find((candidate)=>
    candidate.capabilityId===pending.capabilityId
    && Number(candidate.confidence||0)>=.95
    && !/\b(?:continue|workflow_input|checkout_input)\b/.test(String(candidate.intent||''))
  );
  if(preciseOwner)return {
    ...choice,
    winner:preciseOwner,
    ordered:[preciseOwner,...(choice.ordered||[]).filter((candidate)=>candidate!==preciseOwner)],
    needsLlm:false
  };
  // The owner may already have a precise read-only answer that intentionally
  // preserves its draft (for example cleaning.active_quote_question). Only a
  // generic workflow-input candidate should be displaced by a side question.
  if(choice?.winner?.capabilityId===pending.capabilityId
    &&!/\b(?:continue|workflow_input|checkout_input)\b/.test(String(choice.winner.intent||'')))return choice;
  const frameIntents=new Set((messageFrame?.intents||[]).map((item)=>item.intent));
  const alternatives=(choice?.ordered||[]).filter((candidate)=>
    candidate.capabilityId!==pending.capabilityId
    && isReadOnlyInterruptCandidate(candidate,frameIntents)
  ).sort((a,b)=>interruptSpecificity(b)-interruptSpecificity(a)||Number(b.confidence||0)-Number(a.confidence||0));
  const winner=alternatives[0]||null;
  if(!winner)return choice;
  return {
    ...choice,
    winner,
    ordered:[winner,...(choice.ordered||[]).filter((candidate)=>candidate!==winner)],
    needsLlm:false
  };
}

function interruptSpecificity(candidate){
  if(['availability','offering','catalog','pricing'].includes(candidate?.capabilityId))return 3;
  if(candidate?.capabilityId==='crm')return 2;
  return 1;
}

function isReadOnlyInterruptCandidate(candidate,frameIntents){
  if(Number(candidate?.confidence||0)<.86)return false;
  const intent=String(candidate?.intent||'');
  if(/^assistant\.(?:ask_business_info|ask_about|ask_services|ask_hours|ask_contact|ask_location|ask_delivery|ask_takeaway|ask_payment|ask_returns|ask_faq|multi_info_question|knowledge_question|nlu_information_question)$/.test(intent))return true;
  if(candidate.capabilityId==='availability'&&/\b(?:arrival|hours|slot|availability|support|same_day|day_service)\b/.test(intent))return true;
  if(frameIntents.has('service.browse')&&['offering','cleaning'].includes(candidate.capabilityId)&&/\b(?:browse|list|details|services?|unavailable|support)\b/.test(intent))return true;
  if(frameIntents.has('product.browse')&&candidate.capabilityId==='catalog')return true;
  if(frameIntents.has('information.price')&&['pricing','offering','assistant'].includes(candidate.capabilityId)&&/\b(?:price|pricing|details|knowledge)\b/.test(intent))return true;
  return false;
}

module.exports.prioritizeDeterministicInterrupt=prioritizeDeterministicInterrupt;
module.exports.isReadOnlyInterruptCandidate=isReadOnlyInterruptCandidate;

function detectUnsupportedDomain(text, tenant) {
  if (!tenant.capabilities?.includes('cleaning') && /\b(cleaner|cleaning|maid|deep clean|office clean|house clean|safai|صفائی)\b/.test(text)) return 'cleaning service';
  return null;
}
