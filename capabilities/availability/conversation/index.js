const {normalizeText,normalizeWeekdayTypos}=require('../../../packages/conversation-intelligence/src/text');
const {extractServiceConstraints}=require('../../../packages/conversation-intelligence/src/serviceConstraintExtractor');
class AvailabilityConversationAdapter{
 constructor(){this.capabilityId='availability';this.priority=105;}
 async analyze({tenant,message,services,state,temporal={}}){
  if(!tenant.capabilities?.includes('availability'))return empty(this.priority);
  const text=normalizeWeekdayTypos(message.text),constraints=extractServiceConstraints(message.text),constraintText=constraints.text;
  // "Are you available in Sharjah?" asks about geographic coverage, not a
  // calendar slot. Let the tenant-knowledge path answer it from approved service
  // areas instead of asking for a fake service name.
  const locationCoverageQuestion=/\b(?:are you available|do you (?:serve|provide|offer)|can you (?:serve|come|provide)|services? available)\s+(?:services?\s+)?in\s+[\p{L}][\p{L} .'-]{1,60}[?!.]*$/iu.test(message.text);
  if(locationCoverageQuestion&&!constraints.day&&!constraints.weekend&&!constraints.sameDay&&!/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(text))return empty(this.priority);
  const pricingQuestion=/\b(price|pricing|cost|charge|charges|rate|quote|quotation|estimate|how much|discount|best price|riayat)\b/.test(text);
  const recurrence=constraints.recurrence;
  if(recurrence)return empty(this.priority); // recurrence is a booking/workflow concern, not a fake service name
  const discussedService=state?.capabilityState?.availability?.lastDiscussedServiceId||null;
  const contextualContinuation=Boolean(discussedService)
    &&/^(?:so|then|okay|ok|alright|in that case)\b/.test(text)
    &&/\b(?:can|could|would) you\b[\s\S]{0,35}\b(?:come|clean|arrange|send)\b/.test(text);
  if(contextualContinuation)return empty(this.priority);

  // A detailed service request that already supplies property/staff scope and
  // a requested date/time belongs to the transactional workflow. Availability
  // can validate the slot later; it must not replace the request with a generic
  // opening-hours answer merely because a weekday was mentioned.
  const detailedCleaningRequest=/\b(i want|i need|i would like|i'd like|can i get|can i have|please book|book|schedule|arrange)\b/.test(text)
    && /\b(clean|cleaned|cleaning|cleaners?|maids?)\b/.test(text)
    && /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:bedrooms?|bhk|cleaners?|maids?)\b|\b(apartment|flat|villa|house|home)\b/.test(text)
    && (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)
      ||/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(text)
      ||/\b(?:for|from)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*hours?\b/.test(text)
      ||/\b(?:balcon(?:y|ies)|windows?|washrooms?|supplies|equipment)\b/.test(text));
  if(detailedCleaningRequest)return empty(this.priority);

  // "I want to view/book/arrange X on Saturday at 3" is a booking draft with
  // an availability constraint, not an opening-hours-only question. Booking
  // captures every supplied field and remains unconfirmed until the customer
  // explicitly approves it; its response can still state that live checking
  // is required.
  const explicitAppointmentRequest=/\b(i want|i need|i would like|i'd like|book|schedule|arrange|reserve|request)\b/.test(text)
    && /\b(view|viewing|appointment|consultation|visit|meeting|reservation|session|lesson|treatment|valuation)\b/.test(text)
    && (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)||/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(text));
  if(explicitAppointmentRequest)return empty(this.priority);

  const openQuestion=/\b(are you open|open on|closed on|working on|work on|opening hours)\b/.test(text);
  const genericDayService=Boolean(constraints.day||constraints.weekend) && /\b(service|services|cleaning|appointment|booking|bookings|come|available)\b/.test(constraintText);
  const availabilityQuestion=!pricingQuestion && /\b(are you available|is .{0,80} available|available on|availability|slot|free on|free at|can i get .* on|can i book .* on)\b/.test(constraintText);
  const exactTimeQuestion=/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at|around)\s+\d{1,2}(?::\d{2})?\b/.test(text);
  const transactionalServiceRequest=/\b(i want|i need|i would like|i'd like|please book|book|schedule|arrange)\b/.test(text)
    && !/\bi want to (?:know|check|ask)\b/.test(text)
    && /\b(clean|cleaning|service|appointment|consultation|lesson|repair|treatment|massage|haircut|grooming|visit|meeting)\b/.test(text)
    && exactTimeQuestion;
  if(transactionalServiceRequest)return empty(this.priority);
  const policyChangeQuestion=/\b(cancel|cancellation|cancelled|canceled|reschedule|rescheduling|move (?:my|the) (?:booking|appointment))\b/.test(text);
  const sameDayQuestion=!policyChangeQuestion&&constraints.sameDay && /\b(book|booking|bookings|service|cleaning|available|availability|come)\b/.test(constraintText);
  const arrivalQuestion=/\b(?:when|what time|how soon)\b.*\b(?:cleaner|provider|staff|technician|driver|teacher|doctor)\b.*\b(?:arrive|arrival|come|reach)\b|\b(?:when|what time)\b.*\b(?:arrive|arrival)\b/.test(text);

  if(arrivalQuestion)return out('availability.arrival_question',{...constraints,text},1,'service_arrival_question');
  if(openQuestion&&constraints.weekend&&!constraints.day)return out('availability.weekend_hours',{...constraints,text},1,'weekend_hours_question');
  if(openQuestion&&constraints.day)return out('availability.hours_for_day',{...constraints,text},1,'day_hours_question');
  if(sameDayQuestion)return out('availability.same_day_question',{...constraints,text},1,'same_day_availability_constraint');
  // An exact date/time availability question must reach the live calendar.
  // Opening-hours answers are useful only when the customer has not supplied
  // a concrete slot to check.
  if(availabilityQuestion&&exactTimeQuestion)return out('availability.slot_question',{...constraints,...scheduleEntities(temporal),text},1,'exact_live_slot_question',220);
  if(genericDayService)return out('availability.day_service_question',{...constraints,text},.999995,'day_service_constraint');
  if(availabilityQuestion)return out('availability.slot_question',{...constraints,text},.99999,'service_slot_question');

  const listQuestion=/\b(what|which|list|show)\b.*\bservices?\b|\bservices?\b.*\b(do you offer|do you provide|available)\b/.test(text);
  const explicitSupport=/\b(can you|are you able to|do you provide|do you offer)\b/.test(text);
  const contextualCanI=/\b(can i get|can i have|can i book|cn i get|cn i have|cn i book)\b/.test(text)
    && (/\b(cleaned|studio|apartment|flat|villa)\b/.test(text)||/\b(?:can|cn) i book\b/.test(text));
  const serviceQuestion=!pricingQuestion&&!listQuestion&&(explicitSupport||contextualCanI)
    &&/\b(clean|cleaned|cleaning|service|session|consultation|lesson|appointment|repair|treatment|massage|haircut|grooming|visit|meeting|booking)\b/.test(text);

  if(serviceQuestion&&services?.availabilityService){
    const a=services.availabilityService.scope({tenant}),supports=a.serviceSupports(text),support=a.serviceSupport(text);
    const bookingPhrase=/\b(?:can|cn) i book|\bbook (?:a|the|my|this)\b|\bschedule\b/.test(text);
    if(!bookingPhrase&&supports.length>1){
      return out('availability.multi_service_support',{...constraints,text,services:supports.map(item=>({serviceId:item.serviceId,label:item.label}))},.999995,'multiple_supported_services_question');
    }
    if(support?.supported){
      if(bookingPhrase)return empty(this.priority); // actual booking/service workflow owns explicit booking actions
      return out('availability.service_support',{...constraints,text},.99999,'specific_supported_service_question');
    }
    const retrieval=services.knowledgeService?.retrieve(text,tenant,{limit:3,minScore:.14,minSemantic:.1,kinds:['document','faq_collection','business_profile']});
    if(retrieval?.answerable)return out('availability.unconfigured_service_policy',{...constraints,text,retrieval},.99999,'knowledge_explains_unconfigured_service');
    return out('availability.service_support',{...constraints,text},.99997,'specific_service_support_question');
  }
  return empty(this.priority);
}
}
function scheduleEntities(temporal={}){
 const out={};
 if(temporal.dateReference)out.date=temporal.dateReference;
 else if(temporal.dateText)out.date=temporal.dateText;
 if(temporal.dateText)out.dateText=temporal.dateText;
 if(temporal.weekday)out.weekday=temporal.weekday;
 if(temporal.startTime){out.startTime=temporal.startTime;out.time=temporal.startTime;}
 if(temporal.endTime)out.endTime=temporal.endTime;
 if(temporal.durationHours)out.durationHours=temporal.durationHours;
 return out;
}
function empty(priority){return {priority,candidates:[],entities:{},vocabularyMatches:[]};}
function out(intent,entities,confidence,reason,candidatePriority=null){const candidate={intent,confidence,entities,reason};if(candidatePriority!=null)candidate.priority=candidatePriority;return {priority:105,candidates:[candidate],entities,vocabularyMatches:[{type:'availability',value:intent,score:1}]};}
module.exports={AvailabilityConversationAdapter};
