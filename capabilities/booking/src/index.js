const {BaseCapability}=require('../../../packages/capability-sdk/src/baseCapability');
const {createCapabilityResult}=require('../../../packages/capability-sdk/src/capabilityResult');

class BookingCapability extends BaseCapability{
  async canHandle(context){
    const i=context.intelligence?.selected;
    if(i?.capabilityId==='booking')return {confidence:i.confidence||.97,reason:i.reason};
    return {confidence:0};
  }

  async execute(context){
    const booking=context.services.booking;
    const offering=context.services.offering;
    const engagement=context.services.engagement;
    const config=booking.getConfig();
    const previous=context.state.capabilityState?.booking||{};
    const selected=context.intelligence?.selected||{};
    const extracted=context.intelligence?.entities||{};

    if(selected.intent==='booking.cancel_request'){
      if(!previous.bookingId)return createCapabilityResult({handled:true,reply:'I could not find a completed booking in this conversation to cancel.',statePatch:{lastIntent:'booking_cancel_missing'}});
      const record=await booking.cancel(previous.bookingId,'customer_requested');
      const reply=`Booking ${record.id} has been cancelled. The reserved calendar capacity is now available again.`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CANCELLED',payload:{legacyText:reply,record}},statePatch:{activePlugin:'booking',pendingQuestion:null,lastIntent:'booking_cancelled',capabilityState:{booking:{...previous,status:'cancelled',metadata:{...(previous.metadata||{}),calendarStatus:'cancelled',cancelledAt:record.cancelledAt}}}}});
    }
    if(selected.intent==='booking.reschedule_request')return rescheduleResult(booking,previous,extracted,config);
    if(selected.intent==='booking.items_amendment_request'){
      const requested=(extracted.offeringIds||[]).map(id=>offering.getById(id)).filter(Boolean).map(item=>({id:item.id,name:item.name,type:item.type||'service',price:item.price??null,metadata:{durationMinutes:item.durationMinutes||null}}));
      const action=extracted.amendmentAction||'replace';
      const proposal={type:'items_amendment',action,items:requested,requestedAt:new Date().toISOString()};
      const persisted=previous.bookingId?await booking.proposeAmendment(previous.bookingId,proposal):null;
      const reply=`I saved a request to ${action} ${requested.map(item=>item.name).join(', ')}${previous.bookingId?` on booking ${previous.bookingId}`:''}. The original booked services remain unchanged until staff availability and business rules approve this amendment.${persisted?.revision?` Stored revision: ${persisted.revision}.`:''}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_ITEMS_AMENDMENT_REQUIRES_APPROVAL',payload:{legacyText:reply,proposal,bookingId:previous.bookingId||null,revision:persisted?.revision||null}},statePatch:{activePlugin:'booking',lastIntent:'booking_items_amendment_requires_approval',capabilityState:{booking:{...previous,metadata:{...(previous.metadata||{}),proposedItemsAmendment:proposal}}}}});
    }
    if(selected.intent==='booking.add_item_clarify'){
      const choices=extracted.offeringChoices||[];
      const reply=`I found more than one matching option. Which one would you like to add?\n${choices.map(x=>`• ${x.name}`).join('\n')}\n\nYour current ${config.mode==='reservation'?'reservation':'booking'} details are unchanged.`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_ITEM_CLARIFICATION',payload:{legacyText:reply,choices}},statePatch:{activePlugin:'booking',lastIntent:'booking_add_item_clarify',capabilityState:{booking:{...previous,metadata:{...(previous.metadata||{}),pendingOfferingChoices:choices}}}}});
    }

    let flow=engagement.normalizeState({
      kind:config.mode||'booking',status:previous.status||'collecting',items:previous.items||[],
      fields:previous.slots||previous.fields||{},pendingField:previous.pendingField||null,metadata:previous.metadata||{}
    },config);

    if(selected.intent==='booking.view'){
      const status=flow.status==='completed'?'Confirmed / received':flow.status==='ready'?'Ready for confirmation':'In progress';
      const ref=previous.bookingId?`\nReference: ${previous.bookingId}`:'';
      const reply=`📋 ${config.mode==='reservation'?'Reservation':'Booking'} summary\nStatus: ${status}${ref}\n${engagementSummary(flow,config)}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_VIEWED',payload:{legacyText:reply,engagement:flow}},statePatch:{activePlugin:'booking',lastIntent:'booking_viewed',capabilityState:{booking:previous}}});
    }

    mergeMetadata(flow,extracted);
    const offeringIds=unique(extracted.offeringIds||[extracted.offeringId].filter(Boolean));
    const addedNames=[];
    for(const offeringId of offeringIds){
      const item=offering.getById(offeringId);
      if(item&&!flow.items.some(x=>x.id===item.id)){
        flow=engagement.addItem(flow,{id:item.id,name:item.name,type:item.type||'service',price:item.price??null,metadata:{durationMinutes:item.durationMinutes||null,pricePrefix:item.pricePrefix||'',priceVariable:Boolean(item.pricePrefix)}},{quantity:1});
        addedNames.push(item.name);
      }
    }

    if(!flow.items.length&&config.defaultSubject&&(selected.intent||'').startsWith('booking.')){
      flow=engagement.addItem(flow,{id:`default:${slug(config.defaultSubject)}`,name:config.defaultSubject,type:'default_subject'},{quantity:1});
    }

    for(const [field,value] of Object.entries(extractSlots(extracted))){
      if(value==null||field==='offeringId'||field==='offeringIds'||field==='subject')continue;
      const parsed=engagement.parseField(field,String(value),fieldOptions(field,config));
      if(parsed.valid)flow.fields[field]=parsed.value;
    }

    if(extracted.email&&flow.pendingField&&!has(extracted[flow.pendingField])&&/^\s*(?:(?:my\s+)?email(?:\s+address)?\s*(?:is|=|:)?\s*)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*[.!]?\s*$/i.test(context.message.text)){
      const reply=`Thanks — I’ve saved ${flow.fields.email} as an optional email contact. ${engagement.prompt(flow.pendingField,config,context.language)}`;
      return collectingResult(config,flow,flow.pendingField,reply);
    }

    if((selected.intent==='booking.continue'||selected.intent==='booking.start')&&flow.pendingField&&flow.pendingField!=='confirmation'){
      const pending=flow.pendingField;
      if(!has(flow.fields[pending])){
        if(engagement.isFieldRefusal?.(context.message.text)){
          const reply=`I understand. ${pretty(pending)} is required to submit this ${config.mode==='reservation'?'reservation':'booking'} request. You can provide it, cancel the request, or ask for human support.`;
          return collectingResult(config,flow,pending,reply);
        }
        const parsed=engagement.parseField(pending,context.message.text,fieldOptions(pending,config));
        if(!parsed.valid)return collectingResult(config,flow,pending,`${parsed.message}\n${engagement.prompt(pending,config,context.language)}`);
        flow.fields[pending]=parsed.value;
      }
    }

    const scheduleIssue=validateBookingSchedule(context,flow);
    if(scheduleIssue){
      if(scheduleIssue.field==='date'){delete flow.fields.date;delete flow.fields.time;}
      else delete flow.fields.time;
      flow.status='collecting';flow.pendingField=scheduleIssue.field;
      const reply=`${scheduleIssue.message}\n${engagement.prompt(scheduleIssue.field,config,context.language)}`;
      return collectingResult(config,flow,scheduleIssue.field,reply);
    }

    if(selected.intent==='booking.confirm'&&previous.status==='ready'){
      let record;
      try{record=await booking.create(legacySlots(flow,config),{holdId:previous.metadata?.calendarHoldId||null});}
      catch(error){
        if(error.code==='CALENDAR_SLOT_UNAVAILABLE'||error.code==='CONFLICT'){
          delete flow.metadata.calendarHoldId;delete flow.metadata.calendarHoldExpiresAt;
          flow.status='collecting';flow.pendingField='time';
          const alternatives=formatAlternatives(error.alternatives||error.details?.alternatives||[]);
          const reply=`That slot was taken before confirmation.${alternatives} Please choose another time.`;
          return collectingResult(config,flow,'time',reply);
        }
        throw error;
      }
      flow.status='completed';flow.pendingField=null;
      flow.metadata.calendarEventId=record.calendarEventId||null;
      if(record.status==='confirmed'){flow.metadata.calendarStatus='confirmed';delete flow.metadata.calendarHoldId;delete flow.metadata.calendarHoldExpiresAt;}
      const label=record.status==='confirmed'?`${config.confirmedLabel||'Booking request received'} — slot confirmed`:(config.confirmedLabel||'Booking request received');
      const reply=`✅ ${label}\nReference: ${record.id}\n${engagementSummary(flow,config)}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CREATED',payload:{legacyText:reply,record,engagement:flow}},statePatch:{activePlugin:'booking',pendingQuestion:null,lastIntent:'booking_created',capabilityState:{booking:stateShape(flow,record.id)}},events:[{name:'booking.created.v1',payload:{bookingId:record.id}}]});
    }

    const missing=engagement.nextMissing(requiredFields(config),flow.fields);
    const notice=availabilityNotice(flow,config);
    if(notice)flow.metadata.availabilityNoticeShown=true;
    if(!missing){
      const slots=legacySlots(flow,config);
      const held=await booking.holdSlot?.(slots);
      if(held?.status==='unavailable'){
        flow.status='collecting';flow.pendingField='time';delete flow.fields.time;
        const alternatives=formatAlternatives(held.alternatives||[]);
        const reply=`That time is not available${alternatives}. Please choose another time.`;
        return collectingResult(config,flow,'time',reply);
      }
      if(held?.status==='held'){
        flow.metadata.calendarHoldId=held.hold.id;
        flow.metadata.calendarHoldExpiresAt=held.hold.expiresAt;
        flow.metadata.calendarStatus='held';
      }else flow.metadata.calendarStatus=held?.status||'unknown';
      flow.status='ready';flow.pendingField='confirmation';
      const intro=addedNames.length&&selected.intent==='booking.add_item'?`Added ${addedNames.join(', ')} 👍\n`:'';
      const liveNotice=held?.status==='held'?`I’ve temporarily held ${held.time}–${held.endTime} while you review the details.`:notice;
      const reply=`${liveNotice?`${liveNotice}\n\n`:''}${intro}${config.readyLabel||'Everything is ready.'}\n${engagementSummary(flow,config)}\n\n${config.confirmPrompt||'Confirm when you are ready.'}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_READY',payload:{legacyText:reply,engagement:flow}},statePatch:{activePlugin:'booking',pendingQuestion:'confirmation',lastIntent:'booking_ready',capabilityState:{booking:stateShape(flow)}}});
    }

    flow.status='collecting';flow.pendingField=missing;
    let basePrompt=engagement.prompt(missing,config,context.language);
    if(missing==='time'&&flow.metadata.timeWindow)basePrompt=`You chose the ${flow.metadata.timeWindow}; please give an exact time. ${basePrompt}`;
    const selectedIntro=addedNames.length?`${addedNames.join(', ')} selected 👍\n`:'';
    const currentSummary=engagementSummary(flow,config);
    const reply=`${notice?`${notice}\n\n`:''}${selectedIntro}${currentSummary?`${currentSummary}\n\n`:''}${basePrompt}`;
    return collectingResult(config,flow,missing,reply);
  }
}

async function rescheduleResult(booking,previous,extracted,config){
  const proposedChange={date:extracted.date||previous.slots?.date||null,time:extracted.time||null,constraint:extracted.afterTime?'after':null,requestedAt:new Date().toISOString()};
  const original=`${previous.slots?.date||'the original date'} at ${previous.slots?.time||'the original time'}`;
  const requested=`${proposedChange.date||'the same date'}${proposedChange.time?` after ${proposedChange.time}`:''}`;
  const persisted=previous.bookingId&&proposedChange.time?await booking.reschedule(previous.bookingId,proposedChange):previous.bookingId?await booking.proposeAmendment(previous.bookingId,proposedChange):null;
  if(persisted?.status==='rescheduled'){
    const updated=persisted.booking;
    const reply=`Updated — booking ${updated.id} is now confirmed for ${updated.slots.date} at ${updated.slots.time}.`;
    const slots={...(previous.slots||{}),date:updated.slots.date,time:updated.slots.time};
    return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_RESCHEDULED',payload:{legacyText:reply,record:updated,event:persisted.event}},statePatch:{activePlugin:'booking',lastIntent:'booking_rescheduled',capabilityState:{booking:{...previous,slots,metadata:{...(previous.metadata||{}),calendarEventId:updated.calendarEventId,calendarStatus:'confirmed'},status:'completed'}}}});
  }
  if(persisted?.status==='unavailable'){
    const alternatives=formatAlternatives(persisted.alternatives||[]);
    const reply=`That replacement slot is unavailable${alternatives}. Your original booking is unchanged (${original}).`;
    return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_RESCHEDULE_UNAVAILABLE',payload:{legacyText:reply,proposedChange,alternatives:persisted.alternatives||[]}},statePatch:{activePlugin:'booking',lastIntent:'booking_reschedule_unavailable',capabilityState:{booking:previous}}});
  }
  const revision=persisted?.revision?` The stored booking is now revision ${persisted.revision}.`:'';
  const reply=`I’ve saved the requested move to ${requested}, but I cannot confirm a replacement slot without a live scheduling source.${revision} Your original booking remains unchanged (${original}) until the new slot is approved.`;
  return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_RESCHEDULE_REQUIRES_LIVE_CHECK',payload:{legacyText:reply,proposedChange,originalBookingId:previous.bookingId||null,revision:persisted?.revision||null}},statePatch:{activePlugin:'booking',lastIntent:'booking_reschedule_requires_live_check',capabilityState:{booking:{...previous,metadata:{...(previous.metadata||{}),proposedChange,fallbackKeepOriginal:Boolean(extracted.fallbackKeepOriginal)}}}}});
}
function formatAlternatives(rows){if(!rows?.length)return '';return `. Available alternatives: ${rows.map(row=>`${row.date} at ${row.time}`).join(', ')}`;}
function collectingResult(config,flow,field,reply){return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_COLLECTING',payload:{legacyText:reply,engagement:flow,pendingField:field}},statePatch:{activePlugin:'booking',pendingQuestion:field,lastIntent:'booking_collecting',capabilityState:{booking:stateShape(flow)}}});}
function requiredFields(config){return (config.requiredFields||['subject','date','time','name','phone']).filter(x=>x!=='subject');}
function mergeMetadata(flow,e){
  const keys=['preferredEndTime','timeWindow','hairLength','referenceCode','priceRequested','durationRequested','availabilityRequested','closestTimeRequested'];
  for(const key of keys)if(e[key]!=null)flow.metadata[key]=e[key];
}
function availabilityNotice(flow,config){
  if(!flow.metadata.availabilityRequested||flow.metadata.availabilityNoticeShown)return '';
  if(config.mode==='reservation')return 'I cannot confirm live table availability or the closest time from the current source. I have captured your requested date, time, and party size without promising a slot.';
  return 'Live staff/provider availability still needs confirmation before this becomes a guaranteed slot.';
}
function engagementSummary(flow,config){
  const lines=[];
  if(flow.items.length===1)lines.push(`Subject: ${flow.items[0].name}`);
  else if(flow.items.length>1){lines.push('Selections:');for(const item of flow.items)lines.push(`• ${item.name}`);}
  const labels=config.labels||{};
  for(const [k,v] of Object.entries(flow.fields))if(k!=='subject'&&has(v))lines.push(`${labels[k]||pretty(k)}: ${v}`);
  if(flow.metadata.preferredEndTime)lines.push(`Preferred time window ends: ${flow.metadata.preferredEndTime}`);
  if(flow.metadata.hairLength)lines.push(`Hair length: ${flow.metadata.hairLength}`);
  if(flow.metadata.referenceCode)lines.push(`Reference: ${flow.metadata.referenceCode}`);
  const priced=flow.items.filter(x=>Number.isFinite(Number(x.price)));
  if(flow.metadata.priceRequested&&priced.length===flow.items.length&&priced.length){
    const total=priced.reduce((sum,x)=>sum+Number(x.price)*Number(x.quantity||1),0);
    const from=priced.some(x=>x.metadata?.pricePrefix);
    lines.push(`Estimated price: ${from?'From ':''}Rs${total.toLocaleString('en-US')}`);
    if(priced.some(x=>x.metadata?.priceVariable))lines.push('The final hair color price can vary with hair length.');
  }
  if(flow.metadata.durationRequested){
    const minutes=flow.items.reduce((sum,x)=>sum+Number(x.metadata?.durationMinutes||0)*Number(x.quantity||1),0);
    if(minutes)lines.push(`Estimated duration: ${formatDuration(minutes)}`);
  }
  return lines.join('\n');
}
function legacySlots(flow,config){return {subject:flow.items.map(x=>x.name).join(' + ')||config.defaultSubject||null,items:flow.items.map(x=>({id:x.id,name:x.name,type:x.type,quantity:x.quantity,price:x.price,metadata:x.metadata})),...flow.fields,...(flow.metadata.referenceCode?{referenceCode:flow.metadata.referenceCode}:{}),metadata:flow.metadata};}
function stateShape(flow,bookingId=null){return {status:flow.status,items:flow.items,slots:{...flow.fields,subject:flow.items.map(x=>x.name).join(' + ')||null,...(flow.metadata.referenceCode?{referenceCode:flow.metadata.referenceCode}:{})},pendingField:flow.pendingField,metadata:flow.metadata,...(bookingId?{bookingId}:{})};}
function extractSlots(e){const out={};for(const k of ['subject','date','time','name','phone','email','partySize','grade','durationHours','offeringId','offeringIds'])if(e[k]!=null)out[k]=e[k];return out;}
function fieldOptions(field,config){if(field==='phone')return {minDigits:config.phoneValidation?.minDigits||10,maxDigits:config.phoneValidation?.maxDigits||15};if(field==='date')return {allowPast:Boolean(config.allowPastDates)};if(field==='partySize')return {min:1,max:config.maxPartySize||100};return {};}
function formatDuration(minutes){const hours=Math.floor(minutes/60),rest=minutes%60;if(hours&&rest)return `${hours} hours ${rest} minutes`;if(hours)return `${hours} ${hours===1?'hour':'hours'}`;return `${rest} minutes`;}
function unique(values){return [...new Set(values.filter(Boolean))];}
function has(v){return v!==null&&v!==undefined&&v!=='';}
function pretty(s){return String(s).replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase());}
function slug(v){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function validateBookingSchedule(context,flow){
  if(!flow.fields.date)return null;
  const day=weekdayForDate(flow.fields.date),availability=context.services.availability;
  const operating=availability?.operatingDay?.(day);
  if(operating?.status==='closed')return {field:'date',message:`We’re closed on ${title(day)}. Please choose an open business day.`};
  if(flow.fields.time){
    const duration=Number(flow.fields.durationHours||0);
    const checked=availability?.validateTime?.(day,flow.fields.time,{durationMinutes:duration?duration*60:null,endTime:flow.metadata.preferredEndTime||null});
    if(checked?.valid===false)return {field:'time',message:checked.message};
  }
  return null;
}
function weekdayForDate(value){const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]))).getUTCDay()];}
function title(value){return String(value||'that day').replace(/^./,char=>char.toUpperCase());}
module.exports={Capability:BookingCapability,BookingCapability};
