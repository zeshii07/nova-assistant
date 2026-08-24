const {BaseCapability}=require('../../../packages/capability-sdk/src/baseCapability');
const {createCapabilityResult}=require('../../../packages/capability-sdk/src/capabilityResult');
class AvailabilityCapability extends BaseCapability{
 async canHandle(c){const i=c.intelligence?.selected;return i?.capabilityId==='availability'?{confidence:i.confidence||.99,reason:i.reason}:{confidence:0};}
 async execute(c){
  const a=c.services.availability,i=c.intelligence?.selected||{},e=c.intelligence?.entities||{},text=c.message.text;
  if(i.intent==='availability.arrival_question'){
    return out('Arrival is based on the confirmed booking time. I can’t promise an exact arrival until the date/time and live scheduling are confirmed.','AVAILABILITY_ARRIVAL_REQUIRES_CONFIRMED_BOOKING',{});
  }
  if(i.intent==='availability.weekend_hours'){
    const sat=a.operatingDay('saturday'),sun=a.operatingDay('sunday');
    return out(`Weekend hours: ${dayLine('Saturday',sat)} ${dayLine('Sunday',sun)}`,'AVAILABILITY_WEEKEND_HOURS',{saturday:sat,sunday:sun});
  }
  if(i.intent==='availability.hours_for_day'){
    const r=a.operatingDay(e.day);
    if(r.status==='open')return out(`Yes — we’re open on ${title(e.day)}, ${r.hours}.`,'AVAILABILITY_BUSINESS_OPEN',{...r});
    if(r.status==='closed')return out(`No — we’re closed on ${title(e.day)}.`,'AVAILABILITY_BUSINESS_CLOSED',{...r});
    return out("I don't have a reliable opening-hours entry for that day yet.",'AVAILABILITY_HOURS_UNKNOWN',{...r});
  }
  if(i.intent==='availability.day_service_question'){
    const days=e.day?[e.day]:(e.weekend?['saturday','sunday']:[]);
    const rows=days.map(day=>({day,...a.operatingDay(day)}));
    if(rows.length===1){
      const r=rows[0],support=a.serviceSupport(text,{allowGeneric:true}),label=support.supported?(support.label||'that service'):'the requested service';
      if(r.status==='closed')return out(`No — we’re closed on ${title(r.day)}, so ${label} can’t be scheduled that day.`,'AVAILABILITY_DAY_SERVICE_CLOSED',{...r,...support});
      if(r.status==='open')return out(`We’re open on ${title(r.day)}, ${r.hours}, and we provide ${label}. Exact staff/provider availability still needs a live calendar/scheduling check before I confirm a slot.`,'AVAILABILITY_DAY_SERVICE_REQUIRES_LIVE_CHECK',{...r,...support});
    }
    return out(`For the weekend: ${rows.map(r=>dayLine(title(r.day),r)).join(' ')}`,'AVAILABILITY_WEEKEND_SERVICE_STATUS',{rows});
  }
  if(i.intent==='availability.same_day_question'){
    // The conversation adapter has already normalized variants such as
    // "same dy bookigs" into this intent. Use the canonical policy query for
    // retrieval instead of sending those spelling errors to the evidence ranker.
    const retrieval=c.services.knowledgeService?.retrieve('same day booking availability policy',c.tenant,{limit:3,minScore:.14,minSemantic:.1,kinds:['document','faq_collection','business_profile']});
    if(retrieval?.answerable)return out(clean(retrieval.matches[0]?.text),'AVAILABILITY_SAME_DAY_POLICY',{sourceId:retrieval.matches[0]?.sourceId||null});
    return out('I don’t have a configured same-day policy to promise that. Exact same-day availability needs a live scheduling check.','AVAILABILITY_SAME_DAY_UNKNOWN',{});
  }
  if(i.intent==='availability.unconfigured_service_policy'){
    const retrieval=e.retrieval;
    if(retrieval?.answerable){const policy=clean(retrieval.matches[0]?.text);return out(`${policy}\n\nThat item is not configured as a standalone bookable service, so I won’t create a booking for it until the business maps it to an offering or add-on.`,'AVAILABILITY_SERVICE_POLICY_ONLY',{sourceId:retrieval.matches[0]?.sourceId||null});}
  }
  if(i.intent==='availability.service_support'){
    const r=a.serviceSupport(text);
    if(r.supported)return out(`Yes — we provide ${r.label||'that service'}. I can help you get a quote or make a booking request.`,'AVAILABILITY_SERVICE_SUPPORTED',{...r});
    return out("No — I don’t see that specific service in this business’s configured services right now.",'AVAILABILITY_SERVICE_UNSUPPORTED',{...r});
  }
  if(i.intent==='availability.multi_service_support'){
    const services=(e.services||[]).filter(item=>item?.label);
    if(services.length){
      const lines=services.map(item=>`• ${item.label}`).join('\n');
      return out(`Yes — we provide all of these services:\n\n${lines}\n\nI can explain the options, prepare a quote, or start a booking request for one or more of them.`, 'AVAILABILITY_MULTIPLE_SERVICES_SUPPORTED',{services});
    }
  }
  if(i.intent==='availability.slot_question'){
    const support=a.serviceSupport(text,{allowGeneric:true});
    if(!support.supported)return out("I don’t see that specific service in the configured services, so I can’t offer a slot for it.",'AVAILABILITY_SERVICE_UNSUPPORTED',{...support});
    const parsedDate=c.services.engagement?.parseField?.('date',e.date||e.day||text,{allowPast:false});
    const parsedTime=c.services.engagement?.parseField?.('time',e.time||e.startTime||text);
    const date=parsedDate?.valid?parsedDate.value:null,time=parsedTime?.valid?parsedTime.value:null,day=e.day||e.weekday;
    if(!date&&!day)return out(`Yes — ${support.label||'that service'} is offered. Tell me the day/date and preferred time, and I’ll check the live calendar.`,'AVAILABILITY_NEEDS_DAY',{...support});
    if(!time)return out(`What time should I check for ${support.label||'that service'} on ${date||title(day)}?`,'AVAILABILITY_NEEDS_TIME',{...support,date,day});
    const r=await a.slot({day,date,time,text,serviceId:support.serviceId,durationMinutes:e.durationHours?Number(e.durationHours)*60:null,capacityRequired:e.partySize||e.cleanerCount||1});
    if(r.status==='closed')return out(`We’re closed on ${date||title(day)}, so that service can’t be booked then.`,'AVAILABILITY_SLOT_CLOSED',{...r,...support});
    if(r.status==='available')return out(`Yes — ${support.label||'that service'} is available on ${r.date||date} at ${r.time||time}.`,'AVAILABILITY_SLOT_AVAILABLE',{...r,...support});
    if(r.status==='unavailable')return out(`${r.message||'That slot isn’t available.'}${alternatives(r.alternatives)} I can help you choose another time.`,'AVAILABILITY_SLOT_UNAVAILABLE',{...r,...support});
    if(r.status==='requires_live_check')return out(`We’re open on ${title(e.day)}, ${r.hours}, and we provide ${support.label||'that service'}. Exact staff/provider availability still needs a live calendar or scheduling check before I confirm a slot.`,'AVAILABILITY_REQUIRES_LIVE_CHECK',{...r,...support});
    return out(`We provide ${support.label||'that service'}, but I don’t have a live availability source connected yet.`,'AVAILABILITY_UNKNOWN',{...support});
  }
  return out("I couldn't determine availability from the configured sources.",'AVAILABILITY_UNKNOWN',{});
 }
}
function alternatives(rows){return rows?.length?` Available alternatives: ${rows.map(row=>`${row.date} at ${row.time}`).join(', ')}.`:'';}
function clean(v){return String(v||'').replace(/^---+|---+$/g,'').trim();}
function dayLine(day,r){if(r.status==='open')return `${day}: open ${r.hours}.`;if(r.status==='closed')return `${day}: closed.`;return `${day}: hours not configured.`;}
function title(v){return String(v||'').replace(/^./,x=>x.toUpperCase());}
function out(reply,intent,payload){
 const serviceId=payload?.serviceId||null,label=payload?.label||null;
 const availabilityState={lastIntent:intent.toLowerCase(),lastDiscussedDay:payload?.day||payload?.date||null};
 if(serviceId){availabilityState.lastDiscussedServiceId=serviceId;availabilityState.lastDiscussedServiceName=label;}
 return createCapabilityResult({handled:true,reply,responseModel:{intent,payload:{legacyText:reply,...payload}},statePatch:{activePlugin:'availability',lastIntent:intent.toLowerCase(),capabilityState:{availability:availabilityState}}});
}
module.exports={Capability:AvailabilityCapability,AvailabilityCapability};
