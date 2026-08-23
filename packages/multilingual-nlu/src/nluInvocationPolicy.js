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
    if (strategy !== 'adaptive') throw new Error('NLU invocation strategy must be adaptive');
    this.strategy = 'adaptive';
    this.confidenceThreshold = confidenceThreshold;
    this.ambiguityMargin = ambiguityMargin;
  }

  evaluate({ choice = {}, pending = null, pendingValidation = null, correction = null, deterministicInterruption = null, message = null, messageFrame = null } = {}) {
    const winner = choice.winner || null;
    if (!winner) return decision(true, 'no_deterministic_route');

    const confidence = Number(winner.confidence || 0);
    if (confidence < this.confidenceThreshold) return decision(true, 'low_confidence');

    if (hasSemanticRouteConflict(winner, choice.ordered, messageFrame)) {
      return decision(true, 'semantic_route_conflict');
    }

    if (isComplexMultiIntent(messageFrame)) {
      return decision(true, 'complex_multi_intent');
    }

    if (deterministicInterruption && pending && winner.capabilityId !== pending.capabilityId) {
      return decision(false, 'deterministic_interrupt');
    }

    if (pending && winner.capabilityId === pending.capabilityId && /[\u0600-\u06ff]/.test(String(message?.text || ''))) {
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
