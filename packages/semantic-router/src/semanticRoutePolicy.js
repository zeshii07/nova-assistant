const {candidateMatchesIntent}=require('../../multilingual-nlu/src/nluDecisionPolicy');

/**
 * Uses local semantic probability only to arbitrate among commands Nova's
 * deterministic adapters already know how to execute. It may originate a
 * small set of read-only routes, but never a transaction or confirmation.
 */
class SemanticRoutePolicy{
  constructor({selectionThreshold=.82,selectionMargin=.08}={}){
    this.selectionThreshold=selectionThreshold;
    this.selectionMargin=selectionMargin;
  }

  apply({choice={winner:null,ordered:[]},route=null,tenant=null,pending=null,messageFrame=null}={}){
    if(!route?.used)return result(choice,'router_off',false);
    if(!route.accepted||!route.primaryIntent)return result(choice,route.escalation?.reason||'local_uncertain',false);
    const primary=route.primaryIntent;
    const ordered=[...(choice.ordered||[])];
    const aligned=ordered.filter(candidate=>candidateMatchesLocalIntent(primary.name,candidate,pending))
      .sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0))[0]||null;
    const winnerAligned=choice.winner&&candidateMatchesLocalIntent(primary.name,choice.winner,pending);

    const weakWinner=!choice.winner||Number(choice.winner.confidence||0)<.8;
    const genericFallback=isReplaceableGenericFallback(choice.winner);
    if(aligned&&(winnerAligned||weakWinner||genericFallback)){
      const selected={...aligned,reason:`${aligned.reason||'deterministic_candidate'}+local_semantic_router`};
      return result({
        ...choice,winner:selected,
        ordered:[selected,...ordered.filter(candidate=>candidate!==aligned)],
        needsLlm:false
      },winnerAligned?'local_confirmed_deterministic_route':'local_reordered_deterministic_route',true);
    }

    const safe=readOnlyCandidate(primary.name,route,tenant,messageFrame);
    const replaceGeneric=isReplaceableGenericFallback(choice.winner)
      &&primary.confidence>=this.selectionThreshold-.1
      &&primary.margin>=this.selectionMargin;
    if(safe&&(!choice.winner||replaceGeneric)){
      return result({winner:safe,ordered:[safe,...ordered],needsLlm:false},replaceGeneric?'local_read_only_replaced_generic_fallback':'local_read_only_route',true);
    }
    return result(choice,aligned?'local_below_selection_threshold':'local_no_aligned_candidate',false);
  }
}

function isReplaceableGenericFallback(winner){
  if(!winner)return false;
  return winner.capabilityId==='assistant'
    &&Number(winner.confidence||0)<.9
    &&/^(?:knowledge_question_abstention|assistant_fallback|no_approved_answer)$/.test(String(winner.reason||''));
}

function candidateMatchesLocalIntent(intent,candidate,pending){
  if(intent==='conversation.greeting')return candidate?.capabilityId==='assistant'&&/assistant\.(?:greet|social|small_talk)/.test(candidate?.intent||'');
  if(intent==='conversation.thanks')return candidate?.capabilityId==='assistant'&&/assistant\.(?:thanks|social)/.test(candidate?.intent||'');
  if(intent==='conversation.small_talk')return candidate?.capabilityId==='assistant'&&/assistant\.(?:small_talk|social|greet)/.test(candidate?.intent||'');
  return candidateMatchesIntent({intent},candidate,pending);
}

function readOnlyCandidate(intent,route,tenant,messageFrame){
  const capabilities=new Set(tenant?.capabilities||[]);
  const entities={...(messageFrame?.entities||{}),semanticIntent:intent,localSemanticConfidence:route.primaryIntent?.confidence};
  const bestMatch=route.tenantMatches?.[0];
  if(bestMatch?.kind==='product')Object.assign(entities,{productId:bestMatch.id,productName:bestMatch.name});
  if(bestMatch?.kind==='service')Object.assign(entities,{serviceId:bestMatch.id,offeringId:bestMatch.id,offeringIds:[bestMatch.id],serviceName:bestMatch.name,subject:bestMatch.name});
  if(intent==='product.list'&&capabilities.has('catalog'))return candidate('catalog','catalog.list',route,entities,'local_semantic_read_only_catalog');
  if(intent==='cart.view'&&capabilities.has('commerce'))return candidate('commerce','commerce.cart.view',route,entities,'local_semantic_read_only_cart');
  if(intent==='service.list'){
    if(capabilities.has('cleaning'))return candidate('cleaning','cleaning.service_explore',route,entities,'local_semantic_read_only_cleaning_services');
    if(capabilities.has('offering'))return candidate('offering','offering.browse',route,entities,'local_semantic_read_only_offerings');
  }
  if(intent==='availability.check'&&capabilities.has('availability'))return candidate('availability','availability.slot_question',route,entities,'local_semantic_read_only_availability');
  if(/^business\.(?:info|name|contact)$/.test(intent)&&capabilities.has('assistant')){
    return candidate('assistant','assistant.nlu_information_question',route,{...entities,nluIntent:intent,requestedInformation:requestedInformation(intent)},'local_semantic_read_only_business_info');
  }
  return null;
}

function candidate(capabilityId,intent,route,entities,reason){
  return {capabilityId,intent,confidence:Math.min(.94,Math.max(.9,Number(route.primaryIntent?.confidence||0))),priority:70,entities,reason};
}
function requestedInformation(intent){
  return [{
    'business.info':'business_info','business.name':'business_name','business.contact':'business_contact'
  }[intent]||'other'];
}
function result(choice,decision,aligned){return {choice,decision,aligned};}

module.exports={SemanticRoutePolicy,candidateMatchesLocalIntent,readOnlyCandidate,isReplaceableGenericFallback};
