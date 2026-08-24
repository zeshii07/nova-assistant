const INFORMATION_INTENTS = new Set([
  'service.list', 'service.info', 'service.price', 'service.duration',
  'product.list', 'product.info', 'product.price', 'product.stock',
  'business.info', 'business.name', 'business.contact',
  'business.hours', 'business.location', 'business.policy'
]);

class NluDecisionPolicy {
  constructor({ minConfidence = 0.78, actionThreshold = 0.92, informationThreshold = 0.86 } = {}) {
    this.minConfidence = minConfidence;
    this.actionThreshold = actionThreshold;
    this.informationThreshold = informationThreshold;
  }

  apply({ tenant, deterministic, deterministicCandidates = [], nlu, pending = null, invocationReason = null }) {
    const base = deterministic || null;
    const arbitration=MODEL_ARBITRATION_REASONS.has(invocationReason);
    const primaryLanguageLayer=invocationReason==='primary_language_layer';
    if (!nlu?.validated || !nlu.interpretation) return result(base, base?.entities || {}, null, 'deterministic_only');
    const parsed = nlu.interpretation;
    const nluEntities = mergeMissing(toNovaEntities(parsed, nlu.allowed || {}),nlu.contract?.entities||{});
    const derivedInterruption = parsed.workflow_relationship === 'interrupt' && parsed.confidence >= this.informationThreshold
      ? { type:'business_question', source:'remote_nlu', intent:parsed.intent }
      : null;
    if (parsed.confidence < this.minConfidence) return arbitration
      ? result(null, nluEntities, null, 'ambiguous_unresolved')
      : result(base, base?.entities || {}, null, 'below_confidence_threshold');

    // Remote NLU may enrich an already deterministically selected workflow, but it
    // cannot replace values already extracted by deterministic code.
    if (pending && base?.capabilityId === pending.capabilityId && ['continue', 'replace'].includes(parsed.workflow_relationship)
      && parsed.message_type !== 'correction' && parsed.intent !== 'conversation.correct' && parsed.intent !== 'booking.modify') {
      return result({ ...base, entities:mergeMissing(base.entities, nluEntities), reason:`${base.reason}+remote_nlu_entity_enrichment` }, mergeMissing(base.entities, nluEntities), null, 'active_workflow_enriched');
    }
    if (pending && base?.capabilityId === pending.capabilityId && (parsed.message_type === 'correction' || parsed.intent === 'conversation.correct' || parsed.intent === 'booking.modify')) {
      const corrected=mergeCorrections(base.entities,nluEntities,parsed.corrections);
      const scheduleCorrection=base.capabilityId==='cleaning'&&(corrected.date||corrected.startTime||corrected.time);
      const selected={
        ...base,
        intent:scheduleCorrection?'cleaning.schedule_edit':base.intent,
        entities:corrected,
        reason:`${base.reason}+remote_nlu_correction_enrichment`
      };
      return result(selected, corrected, null, scheduleCorrection?'active_cleaning_schedule_correction':'active_workflow_correction_enriched');
    }

    // Remote NLU chooses semantic meaning only when Nova explicitly requested
    // arbitration, then Nova selects a matching deterministic candidate. The
    // model still cannot invent a capability
    // command: if the core did not independently produce the candidate, no
    // transactional route is created here.
    const aligned=(arbitration||primaryLanguageLayer) ? findModelAlignedCandidate(parsed,deterministicCandidates,pending) : null;
    const alignedThreshold=isTransactionalIntent(parsed.intent)?this.actionThreshold:this.minConfidence;
    if(aligned&&parsed.confidence>=alignedThreshold){
      const entities=mergeMissing(aligned.entities,nluEntities);
      const selected={...aligned,entities,reason:`${aligned.reason||'deterministic_candidate'}+remote_nlu_semantic_selection`};
      return result(selected,entities,derivedInterruption,'adaptive_deterministic_candidate');
    }

    // A high-confidence deterministic route remains authoritative outside an
    // active interrupt. This is the main false-action protection against a
    // model classification replacing a proven rule match.
    if (base?.confidence >= 0.98 && !pending && !arbitration) {
      return result({ ...base, entities:mergeMissing(base.entities, nluEntities) }, mergeMissing(base.entities, nluEntities), null, 'high_confidence_deterministic_preserved');
    }

    // Read-only catalog/cart routes may originate from the strict language
    // contract. Their capabilities still read current-tenant state and data.
    if(parsed.intent==='product.list'&&parsed.confidence>=this.informationThreshold&&tenant.capabilities?.includes('catalog')){
      const selected={capabilityId:'catalog',intent:'catalog.list',confidence:parsed.confidence,reason:'ai_language_read_only_catalog_list',entities:nluEntities};
      return result(selected,nluEntities,derivedInterruption,'read_only_catalog_route');
    }
    if(parsed.intent==='cart.view'&&parsed.confidence>=this.informationThreshold&&tenant.capabilities?.includes('commerce')){
      const selected={capabilityId:'commerce',intent:'commerce.cart.view',confidence:parsed.confidence,reason:'ai_language_read_only_cart_view',entities:nluEntities};
      return result(selected,nluEntities,derivedInterruption,'read_only_cart_route');
    }

    // Explicit product requests can start/update only a cart draft. The model
    // cannot place an order, reserve stock, charge money, or confirm checkout.
    const productItems=nlu.contract?.items?.products||nluEntities.productItems||[];
    const safeProductItems=productItems.filter(item=>item.productId&&Number(item.confidence||parsed.confidence)>=this.minConfidence);
    const actionSemantics=nlu.contract?.message?.actionSemantics||parsed.action_semantics||null;
    const linguisticCertainty=nlu.contract?.message?.certainty||parsed.certainty||((parsed.ambiguities||[]).length?'ambiguous':'explicit');
    if(['order.create','cart.add'].includes(parsed.intent)
      &&parsed.message_type==='request'
      &&actionSemantics==='draft_request'
      &&linguisticCertainty==='explicit'
      &&parsed.confidence>=this.actionThreshold
      &&safeProductItems.length
      &&tenant.capabilities?.includes('commerce')){
      const entities={...nluEntities,items:safeProductItems,ambiguous:[]};
      const selected={capabilityId:'commerce',intent:'commerce.multi_item_request',confidence:parsed.confidence,reason:'ai_language_validated_cart_draft',entities};
      return result(selected,entities,null,'cart_draft_started');
    }
    if(parsed.intent==='cart.remove'
      &&actionSemantics==='change_request'
      &&linguisticCertainty==='explicit'
      &&parsed.confidence>=this.actionThreshold
      &&safeProductItems.length
      &&tenant.capabilities?.includes('commerce')){
      const entities={...nluEntities,productIds:safeProductItems.map(item=>item.productId),removals:safeProductItems.map(item=>({productId:item.productId,quantity:item.quantity||1})),target:'auto'};
      const selected={capabilityId:'commerce',intent:'commerce.cart.remove_request',confidence:parsed.confidence,reason:'ai_language_validated_cart_change',entities};
      return result(selected,entities,null,'cart_change_requested');
    }

    // Read-only information interrupts are safe to originate. The assistant
    // still reads only current-tenant structured data or approved knowledge.
    if (INFORMATION_INTENTS.has(parsed.intent) && parsed.confidence >= this.informationThreshold && ['question', 'request'].includes(parsed.message_type)) {
      const structuredBusiness = ['business.info', 'business.name', 'business.contact'].includes(parsed.intent);
      const knowledge = parsed.intent.startsWith('business.') && !structuredBusiness;
      const selected = {
        capabilityId:'assistant',
        intent:knowledge ? 'assistant.knowledge_question' : 'assistant.nlu_information_question',
        confidence:parsed.confidence,
        reason:'remote_nlu_read_only_information_route',
        entities:{ ...nluEntities, nluIntent:parsed.intent, requestedInformation:[...parsed.requested_information] }
      };
      return result(selected, selected.entities, derivedInterruption, 'read_only_information_route');
    }

    if (parsed.intent === 'availability.check' && parsed.confidence >= this.informationThreshold && tenant.capabilities?.includes('availability') && parsed.message_type === 'question') {
      const selected = { capabilityId:'availability', intent:'availability.slot_question', confidence:parsed.confidence, reason:'remote_nlu_read_only_availability_route', entities:nluEntities };
      return result(selected, nluEntities, derivedInterruption, 'read_only_availability_route');
    }

    // Starting a draft is permitted only for an explicit, high-confidence
    // request. It never confirms or writes the final business record.
    if (parsed.intent === 'booking.create' && parsed.message_type === 'request'
      && (actionSemantics==null||actionSemantics==='draft_request')
      && linguisticCertainty!=='ambiguous'
      && parsed.confidence >= this.actionThreshold && !['interrupt', 'unrelated', 'cancel'].includes(parsed.workflow_relationship)) {
      if (tenant.capabilities?.includes('booking') && nluEntities.offeringId) {
        const selected = { capabilityId:'booking', intent:'booking.start', confidence:parsed.confidence, reason:'remote_nlu_high_confidence_booking_draft', entities:nluEntities };
        return result(selected, nluEntities, null, 'booking_draft_started');
      }
      if (tenant.capabilities?.includes('cleaning')) {
        const serviceItems=(nlu.contract?.items?.services||[]).filter(item=>item.serviceId);
        const entities=serviceItems.length?{...nluEntities,serviceItems}:nluEntities;
        const selected = { capabilityId:'cleaning', intent:serviceItems.length>1?'cleaning.multi_service_request':'cleaning.structured_service_request', confidence:parsed.confidence, reason:'remote_nlu_high_confidence_cleaning_draft', entities };
        return result(selected, entities, null, 'cleaning_draft_started');
      }
    }

    if(arbitration)return result(null,nluEntities,derivedInterruption,'ambiguous_unresolved');
    return result(base ? {...base,entities:mergeMissing(base.entities,nluEntities)} : null, mergeMissing(base?.entities,nluEntities), derivedInterruption, 'deterministic_route_preserved');
  }
}

function findModelAlignedCandidate(parsed,candidates=[],pending=null){
  const matches=(candidates||[]).filter((candidate)=>candidateMatchesIntent(parsed,candidate,pending));
  return matches.sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0))[0]||null;
}

function candidateMatchesIntent(parsed,candidate,pending){
  const intent=String(parsed?.intent||'');
  const capability=String(candidate?.capabilityId||'');
  const coreIntent=String(candidate?.intent||'');
  if(intent==='booking.create')return ['booking','cleaning'].includes(capability)&&/\b(?:start|structured_service_request|additional_service_add|add_item|request)\b/.test(coreIntent);
  if(intent==='booking.modify')return ['booking','cleaning'].includes(capability)&&/\b(?:modify|edit|correction|schedule|change|continue)\b/.test(coreIntent);
  if(intent==='booking.cancel')return ['booking','cleaning'].includes(capability)&&/cancel/.test(coreIntent);
  if(intent==='booking.status')return ['booking','cleaning'].includes(capability)&&/\b(?:status|history|details|list|request)\b/.test(coreIntent);
  if(intent==='availability.check')return capability==='availability';
  if(intent==='service.list')return ['offering','cleaning','assistant'].includes(capability)&&/\b(?:browse|list|services|ask_services|support)\b/.test(coreIntent);
  if(intent==='service.info')return ['offering','cleaning','assistant'].includes(capability)&&/\b(?:details|info|support|ask_about|knowledge)\b/.test(coreIntent);
  if(intent==='service.price')return ['pricing','offering','cleaning','assistant'].includes(capability)&&/\b(?:price|pricing|quote|details|knowledge)\b/.test(coreIntent);
  if(intent==='service.duration')return ['offering','cleaning','assistant'].includes(capability)&&/\b(?:duration|details|knowledge)\b/.test(coreIntent);
  if(intent==='product.list')return capability==='catalog'&&/\b(?:browse|list|family|catalog)\b/.test(coreIntent);
  if(/^product\.(?:info|price|stock)$/.test(intent))return capability==='catalog'&&/\b(?:details|price|stock|browse|match|select)\b/.test(coreIntent);
  if(intent==='cart.view')return capability==='commerce'&&/\b(?:cart|summary|view|review)\b/.test(coreIntent);
  if(/^cart\.(?:add|remove|update)$/.test(intent))return ['commerce','catalog'].includes(capability)&&(new RegExp(`\\b${intent.split('.')[1]}\\b`).test(coreIntent)||(intent==='cart.update'&&/\b(?:return|exchange)\b/.test(coreIntent)));
  if(intent==='order.create')return ['commerce','catalog'].includes(capability)&&/\b(?:add|start|select|details|order)\b/.test(coreIntent);
  if(intent==='order.modify')return capability==='commerce'&&/\b(?:modify|edit|change|update|return|exchange)\b/.test(coreIntent);
  if(intent==='order.cancel')return capability==='commerce'&&/cancel/.test(coreIntent);
  if(/^order\.(?:return|exchange)$/.test(intent))return capability==='commerce'&&/\b(?:return|exchange)\b/.test(coreIntent);
  if(intent==='order.status')return capability==='commerce'&&/\b(?:status|history|details|list)\b/.test(coreIntent);
  if(intent.startsWith('business.'))return capability==='assistant'&&/\b(?:business|contact|hours|location|knowledge|ask_|multi_info)\b/.test(coreIntent);
  if(intent==='customer.update')return capability==='crm';
  if(intent==='human.request'||intent==='complaint')return capability==='assistant';
  if(intent==='conversation.correct')return (!pending||capability===pending.capabilityId)&&/\b(?:correct|edit|change|modify|schedule)\b/.test(coreIntent);
  if(intent==='conversation.confirm')return (!pending||capability===pending.capabilityId)&&/\b(?:confirm|confirmation|checkout|review)\b/.test(coreIntent);
  if(intent==='conversation.reject')return (!pending||capability===pending.capabilityId)&&/\b(?:reject|decline|cancel|review)\b/.test(coreIntent);
  return false;
}

function isTransactionalIntent(intent){
  return /^(?:booking\.(?:create|modify|cancel)|cart\.(?:add|remove|update)|order\.(?:create|modify|cancel|return|exchange)|customer\.update|conversation\.(?:confirm|reject|correct))$/.test(String(intent||''));
}

function toNovaEntities(parsed, allowed) {
  const raw = parsed.entities || {};
  const serviceId = allowed.serviceIds?.includes(raw.service_id) ? raw.service_id : null;
  const productId = allowed.productIds?.includes(raw.product_id) ? raw.product_id : null;
  const out = {
    serviceId, serviceName:raw.service || null,
    offeringId:serviceId, offeringIds:serviceId ? [serviceId] : undefined,
    subject:raw.service || null,
    productId, productName:raw.product || null,
    date:raw.date_normalized || raw.date_text || null,
    dateText:raw.date_text || null,
    dateNormalizedHint:raw.date_normalized || null,
    time:raw.time_normalized || raw.time_text || null,
    startTime:raw.time_normalized || raw.time_text || null,
    timeText:raw.time_text || null,
    timeNormalizedHint:raw.time_normalized || null,
    endTime:raw.end_time_text || null,
    alternativeDate:raw.alternative_date_normalized || raw.alternative_date_text || null,
    alternativeDateText:raw.alternative_date_text || null,
    alternativeTime:raw.alternative_time_normalized || raw.alternative_time_text || null,
    alternativeTimeText:raw.alternative_time_text || null,
    durationHours:raw.duration_hours,
    staff:raw.staff,
    quantity:integerOrNull(raw.quantity),
    cleanerCount:integerOrNull(raw.cleaner_count),
    propertyType:raw.property_type,
    propertySize:raw.property_size,
    bedrooms:integerOrNull(raw.bedrooms),
    balconies:integerOrNull(raw.balconies),
    interiorWindows:integerOrNull(raw.interior_windows),
    washrooms:integerOrNull(raw.washrooms),
    halls:integerOrNull(raw.halls),
    address:raw.address,
    location:raw.location,
    recurrence:raw.recurrence,
    suppliesRequired:raw.supplies_required,
    equipmentRequired:raw.equipment_required,
    timeFlexible:raw.time_flexible,
    bookingId:raw.booking_id,
    orderId:raw.order_id,
    serviceVariant:raw.service_variant,
    size:raw.size,
    color:raw.color,
    unit:raw.unit,
    name:parsed.customer_fields?.name || null,
    phone:parsed.customer_fields?.phone || null,
    email:parsed.customer_fields?.email || null,
    requestedInformation:[...(parsed.requested_information || [])],
    nluIntents:[parsed.intent,...(parsed.intents || []).map((item)=>item.intent)].filter(Boolean),
    corrections:(parsed.corrections || []).map((x) => ({...x})),
    ambiguities:[...(parsed.ambiguities || [])]
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
}
function integerOrNull(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
function mergeMissing(primary = {}, secondary = {}) { const out = {...(primary || {})}; for (const [key, value] of Object.entries(secondary || {})) if (out[key] == null || out[key] === '') out[key] = value; return out; }
function mergeCorrections(primary = {}, secondary = {}, corrections = []) {
  const out=mergeMissing(primary,secondary);
  const mappings={
    date:['date'],time:['time','startTime'],start_time:['time','startTime'],starttime:['time','startTime'],
    end_time:['endTime'],endtime:['endTime'],duration:['durationHours'],duration_hours:['durationHours'],
    cleaner_count:['cleanerCount'],staff_count:['cleanerCount'],quantity:['quantity'],name:['name'],phone:['phone'],
    address:['address'],bedrooms:['bedrooms'],balconies:['balconies'],interior_windows:['interiorWindows']
  };
  for(const correction of corrections||[]){
    const field=String(correction.field||'').toLowerCase().replace(/[ -]+/g,'_');
    for(const key of mappings[field]||[]){
      const value=secondary?.[key]??correction.to;
      if(value!=null&&value!=='')out[key]=value;
    }
  }
  return out;
}
function result(selected, entities, interruption, decision) { return { selected:selected || null, entities:entities || {}, interruption, decision }; }

const MODEL_ARBITRATION_REASONS=new Set([
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

module.exports = { NluDecisionPolicy, toNovaEntities, mergeMissing, mergeCorrections, findModelAlignedCandidate, candidateMatchesIntent, isTransactionalIntent, MODEL_ARBITRATION_REASONS };
