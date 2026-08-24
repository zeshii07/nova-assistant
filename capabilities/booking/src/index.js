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

    if(selected.intent==='booking.customer_field_edit'){
      const amendment=extracted.fieldAmendment||{};
      const field=amendment.field;
      if(!['name','phone','email'].includes(field))return createCapabilityResult({handled:true,reply:'Tell me whether you want to change the booking name, phone, or optional email.',statePatch:{activePlugin:'booking',capabilityState:{booking:previous}}});
      const rawValue=amendment.rawValue;
      const metadata={...(previous.metadata||{})};
      if(rawValue==null||String(rawValue).trim()===''){
        metadata.pendingFieldEdit={field,resumePendingField:previous.pendingField||null};
        const reply=`What should I use as the new ${pretty(field)}?`;
        return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_FIELD_EDIT_NEEDS_VALUE',payload:{legacyText:reply,pendingField:field}},statePatch:{activePlugin:'booking',lastIntent:'booking_field_edit_needs_value',capabilityState:{booking:{...previous,metadata}}}});
      }
      const parsed=engagement.parseField(field,rawValue,fieldOptions(field,config));
      if(!parsed.valid){
        metadata.pendingFieldEdit={field,resumePendingField:metadata.pendingFieldEdit?.resumePendingField||previous.pendingField||null};
        const reply=`${parsed.message} The existing ${pretty(field).toLowerCase()} has not been changed. Please provide the new ${pretty(field).toLowerCase()}.`;
        return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_FIELD_EDIT_INVALID',payload:{legacyText:reply,pendingField:field,unchanged:true}},statePatch:{activePlugin:'booking',lastIntent:'booking_field_edit_invalid',capabilityState:{booking:{...previous,metadata}}}});
      }
      const resumePendingField=metadata.pendingFieldEdit?.resumePendingField||previous.pendingField||null;
      delete metadata.pendingFieldEdit;
      if(previous.status==='completed'&&previous.bookingId){
        const record=await booking.updateDetails(previous.bookingId,{[field]:parsed.value});
        const reply=`Updated — booking ${record.id} now uses ${parsed.value} for ${pretty(field).toLowerCase()}. Revision: ${record.revision}.`;
        return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CUSTOMER_FIELD_UPDATED',payload:{legacyText:reply,bookingId:record.id,field,value:parsed.value,revision:record.revision}},statePatch:{activePlugin:'booking',lastIntent:'booking_customer_field_updated',capabilityState:{booking:{...previous,slots:{...(previous.slots||{}),[field]:parsed.value},metadata}}}});
      }
      const flow=engagement.normalizeState({kind:config.mode||'booking',status:previous.status||'collecting',items:previous.items||[],fields:{...(previous.slots||previous.fields||{}),[field]:parsed.value},pendingField:resumePendingField,metadata},config);
      const missing=engagement.nextMissing(requiredFields(config),flow.fields);
      flow.pendingField=missing||'confirmation';flow.status=missing?'collecting':'ready';
      const continuation=missing?engagement.prompt(missing,config,context.language):(config.confirmPrompt||'If everything is correct, say confirm.');
      const reply=`Updated — the ${pretty(field).toLowerCase()} is now ${parsed.value}. ${continuation}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CUSTOMER_FIELD_UPDATED',payload:{legacyText:reply,field,value:parsed.value,pendingField:flow.pendingField}},statePatch:{activePlugin:'booking',lastIntent:'booking_customer_field_updated',capabilityState:{booking:stateShape(flow)}}});
    }

    if(selected.intent==='booking.cancel_none'){
      const reply=`You do not have any active or confirmed ${config.mode==='reservation'?'reservations':'bookings'} to cancel.`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CANCEL_NONE',payload:{legacyText:reply}},statePatch:{activePlugin:'booking',lastIntent:'booking_cancel_none',capabilityState:{booking:{}}}});
    }
    if(selected.intent==='booking.cancel_selection_required'){
      const bookings=extracted.bookings||previous.metadata?.cancelChoices||[];
      const reply=`You have more than one active ${config.mode==='reservation'?'reservation':'booking'}. Which one should I cancel?\n${bookings.map(record=>`• ${record.id} — ${record.subject||'Booking'}${record.date?` on ${record.date}`:''}${record.time?` at ${record.time}`:''}`).join('\n')}\n\nSend the reference so I cancel only the correct one.`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_CANCEL_SELECTION_REQUIRED',payload:{legacyText:reply,bookings}},statePatch:{activePlugin:'booking',lastIntent:'booking_cancel_selection_required',capabilityState:{booking:{status:'cancel_selection',pendingField:'bookingId',metadata:{cancelChoices:bookings}}}}});
    }
    if(selected.intent==='booking.cancel_request'){
      const bookingId=extracted.bookingId||previous.bookingId;
      if(!bookingId)return createCapabilityResult({handled:true,reply:'I could not find an active booking for this customer to cancel.',statePatch:{lastIntent:'booking_cancel_missing'}});
      const record=await booking.cancel(bookingId,'customer_requested');
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
      if(engagement.referencesStoredDetails?.(context.message.text)||engagement.referencesStoredField?.(pending,context.message.text)){
        const saved=await savedBookingFields(context);
        const patch=engagement.referencesStoredDetails?.(context.message.text)?saved:{...(saved[pending]?{[pending]:saved[pending]}:{})};
        for(const [field,value]of Object.entries(patch))if(requiredFields(config).includes(field)&&has(value))flow.fields[field]=value;
        if(!Object.keys(patch).length){
          const reply=`I do not have saved details for this business yet. ${engagement.prompt(pending,config,context.language)}`;
          return collectingResult(config,flow,pending,reply);
        }
      }
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
      let slots=legacySlots(flow,config);
      let held=await booking.holdSlot?.(slots);
      if(held?.status==='unavailable'&&flow.metadata.alternativeTime){
        const alternativeSlots={...slots,date:flow.metadata.alternativeDate||slots.date,time:flow.metadata.alternativeTime};
        const alternativeHeld=await booking.holdSlot?.(alternativeSlots);
        if(alternativeHeld?.status==='held'){
          flow.fields.date=alternativeSlots.date;
          flow.fields.time=alternativeSlots.time;
          flow.metadata.preferredSlotUnavailable=true;
          slots=alternativeSlots;
          held=alternativeHeld;
        }
      }
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
      const liveNotice=held?.status==='held'
        ?`${flow.metadata.preferredSlotUnavailable?'Your first choice was unavailable, so I checked your alternative. ':''}I’ve temporarily held ${held.time}–${held.endTime} while you review the details.`
        :notice;
      const reply=`${liveNotice?`${liveNotice}\n\n`:''}${intro}${config.readyLabel||'Everything is ready.'}\n${engagementSummary(flow,config)}\n\n${config.confirmPrompt||'Confirm when you are ready.'}`;
      return createCapabilityResult({handled:true,reply,responseModel:{intent:'GENERIC_BOOKING_READY',payload:{legacyText:reply,engagement:flow}},statePatch:{activePlugin:'booking',pendingQuestion:'confirmation',lastIntent:'booking_ready',capabilityState:{booking:stateShape(flow)}}});
    }

    flow.status='collecting';flow.pendingField=missing;
    let basePrompt=engagement.prompt(missing,config,context.language);
    if(missing==='time'&&flow.metadata.timeWindow)basePrompt=`You chose the ${flow.metadata.timeWindow}; please give an exact time. ${basePrompt}`;
    const selectedIntro=addedNames.length?`${addedNames.join(', ')} selected 👍\n`:'';
    const currentSummary=engagementSummary(flow,config);
    const saved=await savedBookingFields(context);
    const reusable=['name','phone','email','city','address','landmark'].includes(missing)&&has(saved[missing]);
    const savedOffer=reusable?`I found these saved details:\n${Object.entries(saved).filter(([field])=>requiredFields(config).includes(field)).map(([field,value])=>`• ${pretty(field)}: ${value}`).join('\n')}\n\nSay “use my saved details” to reuse them, or provide a new ${pretty(missing).toLowerCase()}.` : basePrompt;
    const reply=`${notice?`${notice}\n\n`:''}${selectedIntro}${currentSummary?`${currentSummary}\n\n`:''}${savedOffer}`;
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
async function savedBookingFields(context){
  // The Execution Engine already loaded the tenant-scoped customer record.
  // Reading it here avoids adding CRM permissions to every config-only tenant.
  const customer=context.customer||{};
  const location=customer.customFields?.lastKnownLocation||customer.customFields?.lastDelivery||{};
  const values={name:customer.name||null,phone:customer.phone||null,email:customer.email||null,city:location.city||null,address:location.address||customer.customFields?.primaryAddress||null,landmark:location.landmark||null};
  return Object.fromEntries(Object.entries(values).filter(([,value])=>has(value)));
}
function mergeMetadata(flow,e){
  const keys=['preferredEndTime','alternativeTime','alternativeDate','timeWindow','hairLength','referenceCode','priceRequested','durationRequested','availabilityRequested','closestTimeRequested'];
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
