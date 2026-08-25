const { normalizeText } = require('./text');
const { acquisitionIntent } = require('./acquisitionIntent');

/**
 * Domain-neutral representation of one customer message.
 *
 * It records every conversational act and extracts only shared fields whose
 * meaning does not depend on a tenant domain. Domain adapters can add richer
 * entities, but they may not erase these already supplied customer fields.
 */
class UniversalMessageFrame {
  analyze({ text, clauseSemantics = null, temporal = null } = {}) {
    const raw=String(text||'').trim();
    const clauses=(clauseSemantics?.clauses?.length?clauseSemantics.clauses:[{index:0,text:raw,normalizedText:normalizeText(raw),modality:'asserted'}]);
    const entities=extractSharedEntities(raw,temporal||{});
    const intents=[];
    for(const clause of clauses){
      for(const intent of detectClauseIntents(clause.text))intents.push({...intent,clauseIndex:clause.index,modality:clause.modality||'asserted',source:'deterministic_frame'});
    }
    if(entities.name||entities.phone||entities.email)intents.push({intent:'customer.update',confidence:1,clauseIndex:null,modality:'asserted',source:'deterministic_frame'});
    const unique=dedupeIntents(intents);
    return {
      version:'1.0',
      clauseCount:clauses.length,
      intents:unique,
      entities,
      hasMultipleIntents:new Set(unique.map((item)=>item.intent).filter((intent)=>!intent.startsWith('conversation.social'))).size>1,
      primaryIntent:choosePrimary(unique),
      resolvedIntents:[]
    };
  }
}

function extractSharedEntities(raw,temporal={}){
  const out={};
  if(temporal.dateReference)out.date=temporal.dateReference;
  else if(temporal.dateText)out.date=temporal.dateText;
  else if(temporal.weekday)out.date=temporal.weekday;
  if(temporal.dateText)out.dateText=temporal.dateText;
  if(temporal.weekday)out.weekday=temporal.weekday;
  if(temporal.startTime){out.time=temporal.startTime;out.startTime=temporal.startTime;}
  if(temporal.endTime)out.endTime=temporal.endTime;
  if(temporal.durationHours)out.durationHours=temporal.durationHours;
  if(temporal.timeWindow)out.timeWindow=temporal.timeWindow;

  const name=String(raw).match(/\b(?:my name is|my nme is|name\s*(?:is|:)|call me|mera (?:name|naam))\s+([\p{L}][\p{L} .'-]{1,70}?)(?=\s+(?:and\s+)?(?:my\s+)?(?:phone|contact|number|email|address)\b|\s+(?:and|but|also)\s+(?:i|we|can|please)\b|\s+(?:what|who|where|when|why|how|do|does|is|are|can|could|will|would)\b|[,.!?;\n]|$)/iu);
  if(name&&!/^(?:kia|kya)\s+hai$/i.test(name[1].trim()))out.name=titleCase(name[1].trim());
  const phone=String(raw).match(/(?:\b(?:phone|contact|number|mobile)\s*(?:is|:|=)?\s*)?(\+?\d[\d ()-]{8,20}\d)\b/i);
  if(phone){const digits=phone[1].replace(/\D/g,'');if(digits.length>=10&&digits.length<=15)out.phone=phone[1].trim().replace(/[ ()-]/g,'');}
  const email=String(raw).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);if(email)out.email=email[0].toLowerCase();
  const address=String(raw).match(/\b(?:service|delivery|home)?\s*address\s*(?:is|:|=)\s*(.{5,180}?)(?=\s+(?:and\s+)?(?:my\s+)?(?:phone|contact|name|email)\b|[;\n]|$)/i)
    ||String(raw).match(/\b(?:deliver|send|come)\s+to\s+(.{5,180}?)(?=\s+(?:on|at)\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)|[;\n]|$)/i);
  if(address)out.address=address[1].trim().replace(/[,.]+$/,'');
  return out;
}

function detectClauseIntents(value){
  const n=normalizeText(value),out=[];
  add(out,/^(hi|hello|hey|salam|salaam|assalam|aoa|السلام)\b/.test(n),'conversation.social.greeting',.99);
  add(out,/\b(thanks|thank you|shukriya|شکریہ)\b/.test(n),'conversation.social.gratitude',.98);
  add(out,/\b(actually|i meant|change|replace|instead|make that|not .* but)\b/.test(n),'conversation.correct',.96);
  add(out,/\b(cancel|never mind|stop this|cancel kar|منسوخ)\b/.test(n),'conversation.cancel',.98);
  add(out,/^(confirm|yes confirm|go ahead|proceed|done)\b/.test(n),'conversation.confirm',.99);
  add(out,/\b(what is my name|what's my name|show my profile|my profile|my details)\b/.test(n),'customer.info',.98);
  add(out,/\b(contact details?|phone number|email address|business name|company name|about (?:your|the) business)\b/.test(n),'business.info',.96);
  add(out,/\b(are you available|availability|available on|available at|free slot|open slot)\b/.test(n),'availability.check',.96);
  add(out,/\b(price|cost|charges?|rate|how much|quotation|quote|estimate)\b/.test(n),'information.price',.94);
  add(out,/\b(what services|which services|services do you offer|what do you provide)\b/.test(n),'service.browse',.95);
  add(out,/\b(?:do you|can you|could you)\s+(?:offer|provide|have|do)\b.*\b(?:service|clean|cleaning|hair|treatment|appointment|lesson|class|repair|removal)\b/.test(n),'service.browse',.94);
  add(out,/\b(what products|which products|show products|list products|what do you sell)\b/.test(n),'product.browse',.95);
  const acquisition=acquisitionIntent(n);
  add(out,acquisition.requested&&acquisition.service,'booking.create',.96);
  add(out,acquisition.requested&&acquisition.product,'order.create',.96);
  return out;
}

function mergeUniversalEntities(shared={},specific={}){
  const out={...(shared||{})};
  for(const [key,value] of Object.entries(specific||{})){
    if(value===undefined||value==='')continue;
    if(value===null){if(!(key in out))out[key]=null;continue;}
    if(Array.isArray(value)&&Array.isArray(out[key]))out[key]=[...new Set([...out[key],...value])];
    else out[key]=value;
  }
  return out;
}
function appendResolvedIntents(frame,candidates=[],nlu=null){
  const deterministic=(candidates||[]).map((item)=>({intent:item.intent,capabilityId:item.capabilityId,confidence:Number(item.confidence||0),source:'capability_adapter'}));
  const model=nlu ? [
    {intent:nlu.intent,message_type:nlu.message_type,confidence:Number(nlu.confidence||0),source:'remote_nlu',primary:true},
    ...(nlu.intents||[]).map((item)=>({...item,source:'remote_nlu'}))
  ] : [];
  return dedupeIntents([...(frame?.intents||[]),...deterministic,...model]);
}
function dedupeIntents(items){
  const seen=new Set(),out=[];
  for(const item of items){const key=`${item.intent}|${item.capabilityId||''}|${item.clauseIndex??''}`;if(!item.intent||seen.has(key))continue;seen.add(key);out.push(item);}
  return out;
}
function choosePrimary(intents){
  const order=['conversation.cancel','conversation.correct','booking.create','order.create','availability.check','information.price','business.info','service.browse','product.browse','customer.update','customer.info','conversation.confirm','conversation.social.greeting','conversation.social.gratitude'];
  return order.find((intent)=>intents.some((item)=>item.intent===intent))||null;
}
function add(out,condition,intent,confidence){if(condition)out.push({intent,confidence});}
function titleCase(value){return String(value).replace(/\b\p{L}/gu,(char)=>char.toUpperCase());}

module.exports={UniversalMessageFrame,extractSharedEntities,detectClauseIntents,mergeUniversalEntities,appendResolvedIntents};
