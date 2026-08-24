const {toNovaEntities}=require('../../multilingual-nlu/src/nluDecisionPolicy');

/**
 * Stable contract between language providers and Nova's orchestrator.
 * It deliberately contains no executable function/tool name and grants the
 * model no write authority. Provider-specific output is normalized here so a
 * future provider can be swapped without changing business capabilities.
 */
class LanguageContractBuilder{
  build({nlu,pending=null}={}){
    if(!nlu?.validated||!nlu.interpretation)return null;
    const parsed=nlu.interpretation;
    const allowed=nlu.allowed||{serviceIds:[],productIds:[]};
    const entities=toNovaEntities(parsed,allowed);
    const serviceItems=normalizeServiceItems(parsed,allowed);
    const productItems=normalizeProductItems(parsed,allowed);
    if(serviceItems.length)entities.serviceItems=serviceItems;
    if(productItems.length){entities.productItems=productItems;entities.items=productItems;}
    const contract={
      contractVersion:'2.0',
      providerSchemaVersion:parsed.schema_version,
      language:{code:parsed.language,confidence:Number(parsed.confidence||0)},
      message:{
        type:parsed.message_type,
        actionSemantics:parsed.action_semantics||inferActionSemantics(parsed),
        certainty:parsed.certainty||inferCertainty(parsed),
        confidence:Number(parsed.confidence||0)
      },
      primaryIntent:{name:parsed.intent,confidence:Number(parsed.confidence||0)},
      intents:dedupeIntents([
        {name:parsed.intent,messageType:parsed.message_type,confidence:Number(parsed.confidence||0)},
        ...(parsed.intents||[]).map(item=>({name:item.intent,messageType:item.message_type,confidence:Number(item.confidence||0)}))
      ]),
      workflow:{
        relationship:parsed.workflow_relationship,
        active:pending?{capabilityId:pending.capabilityId,workflow:pending.workflow,pendingField:pending.pendingField||null}:null
      },
      entities,
      items:{services:serviceItems,products:productItems},
      customerFields:{...(parsed.customer_fields||{})},
      requestedInformation:[...(parsed.requested_information||[])],
      missingInformation:[...(parsed.missing_information||[])],
      corrections:(parsed.corrections||[]).map(item=>({...item})),
      ambiguities:[...(parsed.ambiguities||[])],
      authority:{interpretation:'ai_language_layer',execution:'nova_deterministic_core',mayExecute:false}
    };
    return deepFreeze(contract);
  }
}

function normalizeServiceItems(parsed,allowed){
  const input=parsed.service_items||[];
  const items=input.length?input:(parsed.entities?.service?[{
    service:parsed.entities.service,service_id:parsed.entities.service_id,
    quantity:parsed.entities.quantity,unit:parsed.entities.unit,
    service_variant:parsed.entities.service_variant,property_type:parsed.entities.property_type,
    bedrooms:parsed.entities.bedrooms,staff:parsed.entities.cleaner_count,
    duration_hours:parsed.entities.duration_hours,confidence:parsed.confidence
  }]:[]);
  return items.slice(0,12).map(item=>({
    serviceId:allowed.serviceIds?.includes(item.service_id)?item.service_id:null,
    serviceName:item.service||null,
    quantity:positiveNumber(item.quantity),
    unit:item.unit||null,
    serviceVariant:item.service_variant||null,
    propertyType:item.property_type||null,
    bedrooms:nonNegativeInteger(item.bedrooms),
    staff:positiveInteger(item.staff),
    durationHours:positiveNumber(item.duration_hours),
    confidence:Number(item.confidence||0)
  })).filter(item=>item.serviceId||item.serviceName);
}

function normalizeProductItems(parsed,allowed){
  const input=parsed.product_items||[];
  const items=input.length?input:(parsed.entities?.product?[{
    product:parsed.entities.product,product_id:parsed.entities.product_id,
    quantity:parsed.entities.quantity,unit:parsed.entities.unit,size:parsed.entities.size,
    color:parsed.entities.color,variant:parsed.entities.service_variant,confidence:parsed.confidence
  }]:[]);
  return items.slice(0,20).map(item=>({
    productId:allowed.productIds?.includes(item.product_id)?item.product_id:null,
    name:item.product||null,
    quantity:positiveInteger(item.quantity)||1,
    unit:item.unit||null,
    size:item.size||null,
    color:item.color||null,
    variant:item.variant||null,
    confidence:Number(item.confidence||0),
    source:'ai_language_contract'
  })).filter(item=>item.productId||item.name);
}

function inferActionSemantics(parsed){
  if(parsed.message_type==='question'||/^(?:service|product|business)\.|^availability\./.test(parsed.intent))return 'information_only';
  if(parsed.message_type==='confirmation'||parsed.intent==='conversation.confirm')return 'confirmation';
  if(parsed.message_type==='rejection'||parsed.intent==='conversation.reject')return 'rejection';
  if(/\.(?:modify|cancel|remove|update|return|exchange)$/.test(parsed.intent)||parsed.message_type==='correction')return 'change_request';
  if(/^(?:booking\.create|order\.create|cart\.add)$/.test(parsed.intent))return 'draft_request';
  return 'none';
}
function inferCertainty(parsed){return (parsed.ambiguities||[]).length?'ambiguous':Number(parsed.confidence||0)>=.9?'explicit':'implicit';}
function dedupeIntents(items){const seen=new Set();return items.filter(item=>{if(!item.name||seen.has(item.name))return false;seen.add(item.name);return true;});}
function positiveInteger(value){return Number.isInteger(value)&&value>0?value:null;}
function nonNegativeInteger(value){return Number.isInteger(value)&&value>=0?value:null;}
function positiveNumber(value){return Number.isFinite(value)&&value>0?Number(value):null;}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}

module.exports={LanguageContractBuilder,inferActionSemantics,inferCertainty,normalizeServiceItems,normalizeProductItems};
