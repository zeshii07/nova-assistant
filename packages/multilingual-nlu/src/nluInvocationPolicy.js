/**
 * Decides when Nova requests multilingual interpretation.
 *
 * Production `on` mode is adaptive: Nova runs deterministic understanding
 * first and invokes remote NLU only when the local result is unresolved or
 * semantically suspicious. The remote model is interpretation-only and never
 * receives execution authority.
 */
class NluInvocationPolicy {
  constructor({ strategy = 'adaptive', confidenceThreshold = 0.86, ambiguityMargin = 0.05 } = {}) {
    if (!['adaptive','primary'].includes(strategy)) throw new Error('NLU invocation strategy must be adaptive or primary');
    this.strategy = strategy;
    this.confidenceThreshold = confidenceThreshold;
    this.ambiguityMargin = ambiguityMargin;
  }

  evaluate({ choice = {}, pending = null, pendingValidation = null, correction = null, deterministicInterruption = null, message = null, messageFrame = null, localSemantic = null, semanticPolicy = null } = {}) {
    if(this.strategy==='primary')return decision(true,'primary_language_layer');
    const winner = choice.winner || null;
    if (!winner) return decision(true, 'no_deterministic_route');

    const localAccepted=Boolean(localSemantic?.accepted&&localSemantic?.primaryIntent);
    const localAligned=Boolean(semanticPolicy?.aligned);
    const strongWinner=Number(winner.confidence||0)>=.98;
    const genericWorkflowWinner=Boolean(pending&&winner.capabilityId===pending.capabilityId
      &&/\b(?:continue|workflow_input|checkout_input)\b/.test(String(winner.intent||'')));
    // A compound business-information question plus a validated name/phone/
    // email declaration is completely represented by Nova's shared message
    // frame. Persist the customer field, answer locally, and resume without a
    // remote call. A business-information-only compound question can still use
    // remote interpretation under the complex-message policy below.
    if (deterministicInterruption && pending && winner.capabilityId !== pending.capabilityId
      && winner.capabilityId==='assistant'
      && frameHas(messageFrame,'business.info')
      && frameHas(messageFrame,'customer.update')) {
      return decision(false, 'deterministic_interrupt');
    }
    // A scalar-looking reply belongs to the active validator even when it is
    // invalid (for example a three-digit phone number or impossible clock
    // value). Groq cannot make that business value valid and would add latency.
    if(genericWorkflowWinner&&pendingValidation?.valid===false&&isLocalScalarValidation(message?.text,pending?.pendingField)){
      return decision(false,'deterministic_confident');
    }
    if(genericWorkflowWinner&&pendingValidation?.valid===true&&isExplicitValidatedPendingValue(message?.text,pending?.pendingField)){
      return decision(false,'deterministic_confident');
    }
    if(localSemantic?.escalation?.recommended&&!localAligned){
      if(localSemantic.escalation.reason==='complex_multi_intent'&&(!strongWinner||genericWorkflowWinner))return decision(true,'complex_multi_intent');
      if(!strongWinner||genericWorkflowWinner)return decision(true,'local_semantic_uncertain');
    }
    if(localAccepted&&!localAligned&&semanticConflictWithWinner(localSemantic.primaryIntent.name,winner)){
      return decision(true,'semantic_route_conflict');
    }

    const confidence = Number(winner.confidence || 0);
    if (confidence < this.confidenceThreshold) return decision(true, 'low_confidence');

    if (hasSemanticRouteConflict(winner, choice.ordered, messageFrame)) {
      return decision(true, 'semantic_route_conflict');
    }

    if (isComplexMultiIntent(messageFrame)) {
      return decision(true, 'complex_multi_intent');
    }

    if(localAccepted&&localAligned&&!localSemantic?.escalation?.recommended){
      const locallyOriginated=/^local_semantic_/.test(String(winner.reason||''));
      return decision(false,locallyOriginated?'local_semantic_confident':'deterministic_confident');
    }

    if (deterministicInterruption && pending && winner.capabilityId !== pending.capabilityId) {
      return decision(false, 'deterministic_interrupt');
    }

    if (pending && winner.capabilityId === pending.capabilityId
      && !localSemantic
      && /[\u0600-\u06ff]/.test(String(message?.text || ''))) {
      return decision(true, 'multilingual_pending_utterance');
    }

    if (pending && winner.capabilityId === pending.capabilityId
      && pendingValidation?.valid === false
      && !localAccepted
      && /[\u0600-\u06ff]/.test(String(message?.text || ''))) {
      return decision(true, 'multilingual_pending_utterance');
    }

    if (isSocialOnlyWinnerWithBusinessRemainder(winner, choice.ordered, message?.text)) {
      return decision(true, 'social_prefix_with_unresolved_content');
    }

    // A generic correction cue says that something changed but does not tell
    // Nova which field. Language assistance is useful here; a field-specific
    // deterministic correction remains on the fast path.
    if (correction?.type === 'generic' && !correction.target) return decision(true, 'ambiguous_correction');

    // When an active workflow cannot validate the reply and no deterministic
    // interrupt was recognized, ask remote NLU to classify the utterance before the
    // workflow emits another validation error.
    if (pending && pendingValidation?.valid === false && !deterministicInterruption && /workflow_input$/.test(winner.intent || '')) {
      return decision(true, 'invalid_pending_value');
    }

    const second = (choice.ordered || []).find((candidate) =>
      candidate !== winner
      && !(winner.capabilityId!=='assistant'&&candidate.capabilityId==='assistant'&&/assistant\.(?:greet|small_talk|thanks|social)/.test(candidate.intent||''))
      && !isCompatibleSupportingCandidate(winner,candidate)
      && (candidate.intent !== winner.intent || candidate.capabilityId !== winner.capabilityId)
    );
    if (second && confidence - Number(second.confidence || 0) <= this.ambiguityMargin) {
      return decision(true, 'competing_deterministic_routes');
    }

    return decision(false, 'deterministic_confident');
  }
}

function frameHas(frame,intent){return (frame?.intents||[]).some(item=>item.intent===intent);}

function isCompatibleSupportingCandidate(winner,candidate){
  const primary=String(winner?.intent||''),support=String(candidate?.intent||'');
  // Offering details are evidence used by a booking request, not a competing
  // command. Sending this clear pair to remote NLU only adds latency.
  if(winner?.capabilityId==='booking'&&candidate?.capabilityId==='offering'
    &&/^booking\.(?:start|continue|add_item)$/.test(primary)
    &&/^offering\.(?:details|list|browse)$/.test(support))return true;
  return false;
}

function decision(invoke, reason) { return Object.freeze({ invoke, reason }); }

function isLocalScalarValidation(raw,field){
  if(!new Set(['phone','date','time','cleanerCount','duration','bedrooms','quantity']).has(String(field||'')))return false;
  return /^[+\d\s().:/-]{1,32}$/.test(String(raw||'').trim());
}

function isExplicitValidatedPendingValue(raw,field){
  const value=String(raw||'').trim();
  if(field==='time')return /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(value)||/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(value);
  if(['cleanerCount','duration','bedrooms','quantity','partySize','units'].includes(field))return /^(?:(?:ok|okay|yes|sure)\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar)(?:\s*(?:hours?|hrs?|cleaners?|people|persons?|units?))?$/i.test(value);
  if(field==='date')return /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(value)||/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(value);
  return false;
}

function isSocialOnlyWinnerWithBusinessRemainder(winner,ordered=[],raw=''){
  if(winner.capabilityId!=='assistant'||!/assistant\.(?:greet|small_talk|thanks|social)/.test(winner.intent||''))return false;
  if((ordered||[]).some((candidate)=>candidate.capabilityId!=='assistant'&&Number(candidate.confidence)>=0.86))return false;
  const text=String(raw||'').toLowerCase()
    .replace(/^\s*(?:hi|hello|hey|salam|salaam|assalam(?:[ -]?o[ -]?alaikum)?|aoa)\b[\s,!.:-]*/,'')
    .replace(/\b(?:thanks|thank you|how are you|how r u)\b/g,' ')
    .replace(/\s+/g,' ').trim();
  return text.split(' ').filter(Boolean).length>=3
    && /\d|\b(?:i|we|my|want|need|book|order|buy|clean|service|product|appointment|reservation|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|on)\b/.test(text);
}

module.exports = { NluInvocationPolicy, isSocialOnlyWinnerWithBusinessRemainder, isCompatibleSupportingCandidate };

function hasSemanticRouteConflict(winner, ordered = [], frame = null) {
  const frameIntents = new Set((frame?.intents || [])
    .filter((item) => Number(item.confidence || 0) >= 0.93)
    .map((item) => item.intent));
  if (!frameIntents.size) return false;
  const capability = String(winner?.capabilityId || '');
  const supports = {
    'booking.create':new Set(['booking', 'cleaning']),
    'order.create':new Set(['commerce', 'catalog']),
    'service.browse':new Set(['offering', 'cleaning', 'assistant']),
    'product.browse':new Set(['catalog']),
    'business.info':new Set(['assistant']),
    'availability.check':new Set(['availability', 'booking', 'cleaning'])
  };
  for (const intent of frameIntents) {
    const allowed = supports[intent];
    if (!allowed || allowed.has(capability)) continue;
    const hasBetterCandidate = (ordered || []).some((candidate) =>
      candidate !== winner
      && allowed.has(candidate.capabilityId)
      && Number(candidate.confidence || 0) >= 0.72
    );
    if (hasBetterCandidate || ['booking.create', 'order.create', 'product.browse'].includes(intent)) return true;
  }
  return false;
}

function isComplexMultiIntent(frame = null) {
  const intents = new Set((frame?.intents || [])
    .map((item) => item.intent)
    .filter((intent) => intent && !intent.startsWith('conversation.social')));
  if (intents.size >= 3) return true;
  return intents.has('conversation.correct') && [...intents].some((intent) =>
    /^(?:booking|order|availability|service|product|business)\./.test(intent)
  );
}

module.exports.hasSemanticRouteConflict = hasSemanticRouteConflict;
module.exports.isComplexMultiIntent = isComplexMultiIntent;
module.exports.isLocalScalarValidation = isLocalScalarValidation;

function semanticConflictWithWinner(intent,winner){
  const capability=String(winner?.capabilityId||'');
  const expected={
    'booking.create':new Set(['booking','cleaning']),'booking.modify':new Set(['booking','cleaning']),
    'booking.cancel':new Set(['booking','cleaning']),'booking.status':new Set(['booking','cleaning']),
    'availability.check':new Set(['availability','booking','cleaning']),
    'service.list':new Set(['offering','cleaning','assistant']),'service.info':new Set(['offering','cleaning','assistant']),
    'service.price':new Set(['pricing','offering','cleaning','assistant']),'service.duration':new Set(['offering','cleaning','assistant']),
    'product.list':new Set(['catalog']),'product.info':new Set(['catalog','assistant']),
    'product.price':new Set(['catalog','assistant']),'product.stock':new Set(['catalog','assistant']),
    'cart.view':new Set(['commerce']),'cart.add':new Set(['commerce','catalog']),
    'cart.remove':new Set(['commerce']),'cart.update':new Set(['commerce','catalog']),
    'order.create':new Set(['commerce','catalog']),'order.modify':new Set(['commerce']),
    'order.cancel':new Set(['commerce']),'order.return':new Set(['commerce']),
    'order.exchange':new Set(['commerce']),'order.status':new Set(['commerce']),
    'business.info':new Set(['assistant']),'business.name':new Set(['assistant']),
    'business.contact':new Set(['assistant']),'business.hours':new Set(['assistant','availability']),
    'business.location':new Set(['assistant']),'business.policy':new Set(['assistant']),
    'conversation.greeting':new Set(['assistant']),'conversation.thanks':new Set(['assistant']),
    'conversation.small_talk':new Set(['assistant'])
  }[intent];
  return Boolean(expected&&!expected.has(capability));
}

module.exports.semanticConflictWithWinner=semanticConflictWithWinner;
