const {normalizeText}=require('../../../packages/conversation-intelligence/src/text');
const {isConfirmation}=require('../../../packages/conversation-intelligence/src/confirmation');

class BookingConversationAdapter{
 constructor(){this.capabilityId='booking';}
 async analyze({tenant,message,state,services,normalizedText,domain,clauseSemantics,temporal}){
   const b=services.bookingService,o=services.offeringService,e=services.engagementService;
   if(!b||!o)return null;
   const config=b.getConfig(tenant.id);if(!config.enabled)return null;
   const primaryRaw=clauseSemantics?.primaryText||message.text;
   const text=normalizeText(primaryRaw)||normalizedText||normalizeText(message.text);
   const fullText=normalizedText||normalizeText(message.text);
   const active=state.capabilityState?.booking;
   const entities=extract(text,primaryRaw,config,e,temporal);
   const offerings=o.list(tenant.id);
   const mentioned=mentionedOfferings(text,offerings);
   if(mentioned.length){
     entities.offeringIds=mentioned.map(x=>x.id);
     entities.offeringId=mentioned[0].id;
     entities.subject=mentioned.map(x=>x.name).join(' + ');
   }
   const resolved=o.resolve(tenant.id,text);
   if(!mentioned.length&&resolved.type==='exact'){
     entities.offeringIds=[resolved.record.id];entities.offeringId=resolved.record.id;entities.subject=resolved.record.name;
   }

   const menuFirst=isMenuFirstRequest(fullText,clauseSemantics);
   if(menuFirst&&!active)return null;

   if(active?.status==='completed'&&mentioned.length&&/\b(?:change|switch|replace|add|include|remove|delete)\b/.test(fullText)){
     const action=/\b(?:remove|delete)\b/.test(fullText)?'remove':/\b(?:add|include)\b/.test(fullText)?'add':'replace';
     entities.amendmentAction=action;
     return pack('booking.items_amendment_request',.99985,entities,'completed_booking_items_amendment');
   }

   if(active?.status==='completed'&&/\b(?:cancel|stop)\b.*\b(?:booking|appointment|reservation|lesson|session)\b|\bcancel (?:it|this)\b/.test(fullText))return pack('booking.cancel_request',.9999,{},'completed_booking_cancel_request');

   if(active?.status==='completed'&&isRescheduleRequest(fullText)){
     if(/\bsame day\b/.test(fullText)&&active.slots?.date)entities.date=active.slots.date;
     entities.fallbackKeepOriginal=/\bif (?:nothing|no slot|none).*(?:keep|retain).*(?:original|current)\b/.test(fullText);
     entities.afterTime=/\bafter\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(fullText);
     return pack('booking.reschedule_request',.9998,entities,'completed_booking_reschedule_request');
   }

   if(tenant.capabilities?.includes('catalog')&&services.catalogService&&resolved.type!=='exact'){
     const catalogResult=await services.catalogService.search(tenant.id,text);
     if(catalogResult?.product)return null;
   }
   if(active&&/\b(show|view|see|open|what(?:'s| is) in)\s+(my\s+)?(appointment|booking|request|cart|selections?)\b|\bmy (appointment|booking|request|selections?)\b/.test(text))
     return pack('booking.view',.9998,{},'booking_view');

   const addVerb=active&&/\b(also|too|another|add|include|bhi|aur)\b/.test(fullText);
   if(addVerb){
     const newMentioned=mentioned.filter(item=>!((active.items||[]).some(x=>x.id===item.id)));
     if(newMentioned.length===1){
       entities.offeringId=newMentioned[0].id;entities.offeringIds=[newMentioned[0].id];entities.subject=newMentioned[0].name;
       return pack('booking.add_item',.999,entities,'booking_add_another_offering');
     }
     if(!newMentioned.length){
       const choices=partialOfferingChoices(fullText,offerings).filter(item=>!((active.items||[]).some(x=>x.id===item.id)));
       if(choices.length>1)return pack('booking.add_item_clarify',.9992,{offeringChoices:choices.map(x=>({id:x.id,name:x.name}))},'booking_add_item_ambiguous');
       if(choices.length===1)return pack('booking.add_item',.999,{offeringId:choices[0].id,offeringIds:[choices[0].id],subject:choices[0].name},'booking_add_item_partial_exact');
     }
   }

   const newSubjectRequest=active&&/\b(do you offer|do you have|can i get|can i have|i want|i need|different service|another service|other service)\b/.test(text)
     && !mentioned.length && !resolved.record?.id && !isSafePendingValue(active.pendingField,message.text,text);
   if(newSubjectRequest)return {priority:95,candidates:[],entities:{interruption:{type:'new_subject'}},vocabularyMatches:[{type:'workflow',value:'booking_paused_for_new_subject',score:1}]};
   if(active?.status==='collecting')fillPending(entities,active.pendingField,message.text,text,services,tenant,e);
   const informational=/^(how|what|which|tell me|do you)\b/.test(text)&&!/\b(can i|i want|i need|book|reserve|admit my|admitted)\b/.test(text);
   const bookingTrigger=!informational&&(matchesAny(text,[...(domain?.semantics?.bookingTerms||[]),...(config.triggerTerms||[])])||(Boolean(entities.date||entities.time||entities.partySize||entities.grade)&&Boolean(entities.subject||active)));
   if(active?.status==='ready'&&isConfirmation(message.text))return pack('booking.confirm',.999,entities,'booking_confirmation');
   if(active?.status==='collecting'||active?.status==='ready')return pack('booking.continue',.995,entities,'active_booking_workflow');
   if(bookingTrigger)return pack('booking.start',entities.offeringIds?.length ? .997 : .99,entities,'generic_booking_trigger');
   return null;
 }
}

function extract(text,raw,config,engagement,temporal={}){
 const e={};
 const date=engagement?.parseField?.('date',raw,{allowPast:Boolean(config.allowPastDates)});if(date?.valid)e.date=date.value;
 const time=engagement?.parseField?.('time',raw);if(time?.valid)e.time=time.value;
 const party=text.match(/\b(?:for\s+)?(\d+)\s*(?:people|persons|guests|seats)\b/);if(party)e.partySize=Number(party[1]);
 const grade=text.match(/\b(?:grade|class)\s*(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:grade|class)\b/);if(grade)e.grade=grade[1]||grade[2];
 const duration=text.match(/\b(\d+)\s*(?:hours?|hrs?)\b/);if(duration)e.durationHours=Number(duration[1]);
 const named=String(raw||'').match(/\b(?:for\s+the\s+name|under\s+the\s+name|name\s+is|my\s+name\s+is)\s+([\p{L}][\p{L} .'-]{1,60}?)(?=\s+(?:on|for|at|date|time|and|my phone)\b|[,.!?;]|$)/iu);
 if(named){const parsed=engagement?.parseField?.('name',named[1]);if(parsed?.valid)e.name=parsed.value;}
 const phone=String(raw||'').match(/(?:phone|number|contact)(?:\s+(?:is|=))?\s*(\+?\d[\d\s-]{8,18}\d)\b/i);
 if(phone){const parsed=engagement?.parseField?.('phone',phone[1],{minDigits:10,maxDigits:15});if(parsed?.valid)e.phone=parsed.value;}
 const email=String(raw||'').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
 if(email){const parsed=engagement?.parseField?.('email',email[0]);if(parsed?.valid)e.email=parsed.value;}
 const reference=String(raw||'').match(/\b(?:property|listing)\s+(?:reference|ref|number|#)\s*[:#-]?\s*([a-z]{1,10}[- ]?\d{1,12})\b|\b(?:reference|ref)\s*[:#-]?\s*([a-z]{1,10}[- ]?\d{1,12})\b/i);
 if(reference)e.referenceCode=String(reference[1]||reference[2]).toUpperCase().replace(/\s+/g,'-');
 if(config.defaultSubject&&matchesAny(text,config.defaultSubjectTerms||[]))e.subject=config.defaultSubject;
 if(temporal?.endTime)e.preferredEndTime=temporal.endTime;
 if(temporal?.timeWindow)e.timeWindow=temporal.timeWindow;
 const hair=String(raw||'').match(/\bhair\s+(?:is|length\s+is)\s+([\p{L}]+(?:[- ]length)?)\b/iu);if(hair)e.hairLength=hair[1].toLowerCase();
 e.priceRequested=/\b(price|cost|estimate|estimated|how much|total)\b/.test(text);
 e.durationRequested=/\b(how long|duration|take)\b/.test(text);
 e.availabilityRequested=/\b(do you have space|available|availability|free|slot|closest available)\b/.test(text);
 e.closestTimeRequested=/\bclosest available time\b/.test(text);
 return e;
}

function fillPending(e,field,raw,text,services,tenant,engagement){
 if(!field||field==='confirmation')return;
 if(field==='subject'&&!e.subject){const resolved=services.offeringService.resolve(tenant.id,text);if(resolved.type==='exact'){e.offeringId=resolved.record.id;e.offeringIds=[resolved.record.id];e.subject=resolved.record.name;}return;}
 if(e[field]!=null)return;
 const parsed=engagement?.parseField?.(field,raw,field==='phone'?{minDigits:10,maxDigits:15}:{});if(parsed?.valid)e[field]=parsed.value;
}
function mentionedOfferings(text,items){
 return items.map(item=>{
   const positions=[item.name,...(item.aliases||[])].map(term=>text.indexOf(normalizeText(term))).filter(index=>index>=0);
   return {item,index:positions.length?Math.min(...positions):-1};
 }).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index).map(x=>x.item);
}
function partialOfferingChoices(text,items){
 const ignored=new Set(['add','include','also','too','another','the','to','my','order','booking','reservation','appointment','please']);
 const tokens=normalizeText(text).split(' ').filter(x=>x.length>=4&&!ignored.has(x));
 return items.filter(item=>{
   const identity=normalizeText([item.name,...(item.aliases||[])].join(' '));
   return tokens.some(token=>hasPhrase(identity,token));
 });
}
function hasPhrase(text,term){return Boolean(term)&&(` ${text} `).includes(` ${term} `);}
function isMenuFirstRequest(text,clauses){
 const conditionalReservation=(clauses?.secondaryIntents||[]).some(x=>x.type==='future_consideration'&&/\b(reserve|reservation|book a table)\b/i.test(x.text));
 return conditionalReservation&&/\bfirst\b/.test(text)&&/\b(menu|dishes?|chicken|pasta|prices?)\b/.test(text);
}
function isRescheduleRequest(text){return /\b(reschedule|move|change|shift)\b.*\b(appointment|booking|reservation|time|date|day|hours?)\b|\bmove my (?:appointment|booking|reservation)\b/.test(text);}
function isSafePendingValue(field,raw,text){
 if(field==='name')return /^[\p{L} .'-]{2,70}$/u.test(String(raw).trim())||/\b(?:use|my)\s+name\b/i.test(String(raw));
 if(field==='phone'){const d=String(raw).replace(/\D/g,'');return d.length>=10&&d.length<=15;}
 if(field==='time')return /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(String(raw))||/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(String(raw));
 if(field==='date')return /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(String(raw))||/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{4})?\b/.test(String(raw))||/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(String(raw));
 if(field==='partySize'||field==='grade')return /\b\d{1,2}\b/.test(text);
 return false;
}
function matchesAny(t,terms){return terms.some(x=>t.includes(normalizeText(x)));}
function pack(intent,confidence,entities,reason){return {priority:95,entities,candidates:[{intent,confidence,entities,reason}]};}
module.exports={BookingConversationAdapter,mentionedOfferings,partialOfferingChoices,isMenuFirstRequest};
