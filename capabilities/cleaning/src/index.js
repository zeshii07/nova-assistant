const { BaseCapability } = require("../../../packages/capability-sdk/src/baseCapability");
const { createCapabilityResult } = require("../../../packages/capability-sdk/src/capabilityResult");
const { isConfirmation } = require("../../../packages/conversation-intelligence/src/confirmation");
const { numberFromText } = require("../../../packages/conversation-intelligence/src/text");

/** Service-request capability for cleaning businesses with deterministic live-calendar confirmation. */
class CleaningCapability extends BaseCapability {
  async canHandle(context) {
    const text = normalize(context.message.text);
    const state = context.state.capabilityState?.cleaning || {};
    const selected=context.intelligence?.selected?.capabilityId;
    if(selected && selected!=="cleaning") return {confidence:0,reason:"another_intent_owns_message"};
    if (state.step) return { confidence: 0.997, reason: "cleaning_active_flow" };
    if (/\b(clean|cleaning|deep clean|sofa|carpet|office clean|home clean|maid|safai|صفائی|صاف)\b/.test(text)) return { confidence: 0.98, reason: "cleaning_keyword" };
    if (/\b(services|service|what do you offer|what services|kia services|kya services)\b/.test(text) && context.tenant.capabilities?.includes("cleaning")) return { confidence: 0.94, reason: "cleaning_service_list" };
    return { confidence: 0 };
  }

  async execute(context) {
    const cleaning = context.services.cleaning;
    const engagement = context.services.engagement;
    if (!cleaning) throw new Error("Cleaning service is unavailable.");
    const language = detectLanguage(context.message.text, context.language);
    const text = normalize(context.message.text);
    const previous = context.state.capabilityState?.cleaning || {};

    if(context.intelligence?.selected?.intent==='cleaning.service_list'){
      const services=await cleaning.listServices();
      const reply=formatServices(services,language);
      return result(reply,language,{...previous,step:null},'cleaning_services_listed',{intent:'CLEANING_SERVICES_LISTED',payload:{legacyText:reply,preferLegacyText:true,serviceLines:services.map(service=>`• ${service.name} — ${formatPrice(service)}`).join('\n')}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.date_choice_clarification'){
      const options=context.intelligence?.entities?.dateOptions||[];
      const labels=options.map(title);
      const choice=labels.length===2?`${labels[0]} or ${labels[1]}`:labels.join(', ');
      const next={...previous,step:'date',pendingDateOptions:options,pendingDateChoiceTime:context.intelligence?.entities?.startTime||context.intelligence?.entities?.time||null};
      const reply=localized(language,
        `Both dates could work as preferences. Which one should I use for this request: ${choice}? I’ve kept ${next.pendingDateChoiceTime?`the requested time ${next.pendingDateChoiceTime}`:'the rest of your details'} while you choose.`,
        `Dono dates preference ho sakti hain. Is request ke liye ${choice} mein se kaunsi date use karun? ${next.pendingDateChoiceTime?`${next.pendingDateChoiceTime} ka time note hai`:'Baqi details safe hain'}.`,
        `دونوں تاریخیں ترجیح ہو سکتی ہیں۔ اس درخواست کے لیے ${choice} میں سے کون سا دن رکھوں؟ باقی تفصیلات محفوظ ہیں۔`);
      return result(reply,language,next,'cleaning_date_choice_required',{intent:'CLEANING_DATE_CHOICE_REQUIRED',payload:{legacyText:reply,pendingField:'date',dateOptions:options}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.duration_info'){
      const service=(await cleaning.listServices()).find(entry=>entry.id===previous.serviceId);
      const configuredDuration=Number(previous.durationHours||0);
      const reply=configuredDuration
        ? localized(language,
          `This request is currently set for ${configuredDuration} hour${configuredDuration===1?'':'s'}. Your booking details are still safe — ${promptFor(previous.step,language)}`,
          `Is request ke liye ${configuredDuration} ghantay note hain. Aapki booking details safe hain — ${promptFor(previous.step,language)}`,
          `اس درخواست کے لیے ${configuredDuration} گھنٹے درج ہیں۔ آپ کی بکنگ کی تفصیلات محفوظ ہیں۔ ${promptFor(previous.step,language)}`)
        : localized(language,
          `${service?.name||'This cleaning service'} has no fixed duration in the approved service data; how long it takes depends on the scope and the team will confirm it. Your request is still paused safely — ${promptFor(previous.step,language)}`,
          `${service?.name||'Is cleaning service'} ka fixed duration configured nahi hai; time scope par depend karta hai aur team confirm karegi. Aapki request safe paused hai — ${promptFor(previous.step,language)}`,
          `${service?.name||'اس صفائی کی سروس'} کا مقررہ دورانیہ درج نہیں؛ وقت کام کی نوعیت پر منحصر ہے اور ٹیم تصدیق کرے گی۔ آپ کی درخواست محفوظ ہے۔ ${promptFor(previous.step,language)}`);
      return result(reply,language,previous,'cleaning_duration_info',{intent:'CLEANING_DURATION_INFO',payload:{legacyText:reply,durationHours:configuredDuration||null,pendingField:previous.step}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.saved_field_reference'){
      const field=context.intelligence?.entities?.field;
      const saved=await savedCustomerDetails(cleaning,context);
      const next={...previous};
      if(field&&saved[field])next[field]=saved[field];
      const value=field&&next[field];
      const reply=value
        ? localized(language,
          `Yes — I’m using your saved ${customerFieldLabel(field)}: ${value}. ${promptFor(previous.step,language)}`,
          `Ji — aapka saved ${customerFieldLabel(field)} ${value} use ho raha hai. ${promptFor(previous.step,language)}`,
          `جی — آپ کا محفوظ ${customerFieldLabel(field)} ${value} استعمال ہو رہا ہے۔ ${promptFor(previous.step,language)}`)
        : localized(language,
          `I don’t have a saved ${customerFieldLabel(field)} yet. ${promptFor(previous.step,language)}`,
          `Aapka saved ${customerFieldLabel(field)} nahi mila. ${promptFor(previous.step,language)}`,
          `آپ کا محفوظ ${customerFieldLabel(field)} موجود نہیں۔ ${promptFor(previous.step,language)}`);
      return result(reply,language,next,'cleaning_saved_field_referenced',{intent:'CLEANING_SAVED_FIELD_REFERENCED',payload:{legacyText:reply,field,pendingField:previous.step,savedValueUsed:Boolean(value)}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.booking_type_clarification'){
      const semantic=context.intelligence?.entities||{};
      const scope={...(previous.pendingBookingType?.scope||{}),...requestFields(semantic)};
      const propertyLabel=scope.propertyType==='villa'?'villa/house':scope.propertyType==='apartment'?'apartment/flat':'property';
      const availabilityLead=semantic.serviceAvailabilityQuestion?'Yes — we provide cleaning for that property type. ':'';
      const reply=localized(language,
        `${availabilityLead}For your ${propertyLabel}, which cleaning type do you want?\n• Standard Cleaning — hourly; I’ll ask for the number of cleaners and hours\n• Deep Cleaning — scope-based; I’ll ask for the property size/bedroom count`,
        `${propertyLabel} ke liye kaunsi cleaning chahiye?\n• Standard Cleaning — hourly; cleaners aur hours chahiye honge\n• Deep Cleaning — scope-based; property size/bedrooms chahiye honge`,
        `${propertyLabel} کے لیے کون سی صفائی چاہیے؟\n• Standard Cleaning — فی گھنٹہ؛ کلینرز اور گھنٹے درکار ہوں گے\n• Deep Cleaning — سائز کے مطابق؛ بیڈ رومز کی تعداد درکار ہوگی`);
      const next={...previous,step:'cleaningType',pendingBookingType:{scope}};
      return result(reply,language,next,'cleaning_booking_type_clarification',{intent:'CLEANING_BOOKING_TYPE_CLARIFICATION',payload:{legacyText:reply,propertyType:scope.propertyType||null,pendingField:'cleaningType',choices:['Standard Cleaning','Deep Cleaning']}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.booking_type_selected'){
      const semantic={...(previous.pendingBookingType?.scope||{}),...(context.intelligence?.entities||{})};
      const deep=semantic.selectedCleaningType==='deep';
      const propertyType=semantic.propertyType||previous.pendingBookingType?.scope?.propertyType||null;
      const serviceId=deep
        ? propertyType==='villa'?'CLN011':'CLN010'
        : propertyType==='villa'?'CLN009':'CLN008';
      const actual=(await cleaning.listServices()).find(service=>service.id===serviceId);
      if(!actual){
        const reply='That cleaning type is not configured for this property. Please choose another configured cleaning service.';
        return result(reply,language,previous,'cleaning_booking_type_unconfigured',{intent:'CLEANING_SERVICE_UNAVAILABLE',payload:{legacyText:reply,serviceId}});
      }
      const requiredPricingFields=deep?['bedrooms']:['cleanerCount','durationHours'];
      let next=initialRequestState(context,engagement,{...semantic,propertyType,cleaningType:deep?'deep':'standard'}, {
        serviceId:actual.id,
        serviceName:deep?'Deep Cleaning':'Standard Cleaning',
        configuredServiceName:actual.name,
        pricingServiceId:actual.pricingServiceId||null,
        requiredPricingFields,
        pricingFirst:true,
        pendingBookingType:null
      });
      next.step=nextMissingStep(next);
      const priced=requiredPricingFields.every(field=>field==='cleanerCount'?Number(next.cleanerCount)>0:field==='durationHours'?Number(next.durationHours)>0:next[field]!==null&&next[field]!==undefined&&next[field]!=='');
      if(priced){
        const q=quoteConfiguredService(context,actual,next);
        if(q.ok){next.quotedService=q;next.total=q.total;next.currency=q.currency;}
      }
      const selectedLabel=deep?'Deep Cleaning':'Standard Cleaning';
      const propertyLabel=propertyType==='villa'?'villa/house':'apartment/flat';
      const quote=next.quotedService?.ok?` The configured estimate is ${currencyAmount(next.quotedService.total,next.quotedService.currency)}.`:'';
      const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
      const reply=localized(language,
        `${selectedLabel} selected for your ${propertyLabel}.${quote} ${capturedScheduleLine(next)}${prompt}`,
        `${propertyLabel} ke liye ${selectedLabel} select ho gayi hai.${quote} ${capturedScheduleLine(next)}${prompt}`,
        `${propertyLabel} کے لیے ${selectedLabel} منتخب ہو گئی ہے۔${quote} ${capturedScheduleLine(next)}${prompt}`);
      return result(reply,language,next,'cleaning_booking_type_selected',{intent:intentForStep(next.step),payload:{legacyText:reply,serviceId:actual.id,serviceName:selectedLabel,configuredServiceName:actual.name,pendingField:next.step,requiredPricingFields,quote:next.quotedService||null}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.cancel_none'){
      const reply='You do not have any active or confirmed cleaning bookings to cancel.';
      return result(reply,language,{lastRequestId:previous.lastRequestId||null},'cleaning_cancel_none',{intent:'CLEANING_CANCEL_NONE',payload:{legacyText:reply}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.cancel_selection_required'){
      const requests=context.intelligence?.entities?.requests||previous.cancelChoices||[];
      const lines=requests.map(request=>`• ${request.id} — ${request.serviceName||'Cleaning service'}${request.date?` on ${request.date}`:''}${request.time?` at ${request.time}`:''}`);
      const reply=`You have more than one active cleaning request. Which one should I cancel?\n${lines.join('\n')}\n\nSend the request ID so I cancel only the correct booking.`;
      return result(reply,language,{...previous,step:'cancelSelection',cancelChoices:requests},'cleaning_cancel_selection_required',{intent:'CLEANING_CANCEL_SELECTION_REQUIRED',payload:{legacyText:reply,pendingField:'cancelSelection',requests}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.submitted_cancel_request'){
      const semantic=context.intelligence?.entities||{};
      const request=await findEditableRequest(cleaning,semantic.requestId||previous.lastRequestId);
      if(!request){
        const reply='I could not find an active cleaning request for this customer to cancel.';
        return result(reply,language,previous,'cleaning_submitted_request_not_found',{intent:'CLEANING_REQUEST_NOT_FOUND',payload:{legacyText:reply}});
      }
      const cancellation=await cleaning.cancelRequest(request.id,'customer_requested');
      const cancelled=cancellation.requests||[];
      await context.services.crm?.recordActivity('cleaning.request_cancelled',{requestId:request.id,requestIds:cancelled.map(item=>item.id),calendarEventId:cancellation.event?.id||request.calendarEventId||null});
      const reply=cancelled.length>1
        ? `Your cleaning visit and its ${cancelled.length} linked service requests have been cancelled. The reserved calendar capacity is available again.`
        : `Cleaning request ${request.id} has been cancelled. The reserved calendar capacity is available again.`;
      return result(reply,language,{lastRequestId:request.id,lastRequestIds:cancelled.map(item=>item.id),lastRequestStatus:'cancelled'},'cleaning_submitted_cancelled',{intent:'CLEANING_REQUEST_CANCELLED',payload:{legacyText:reply,requestId:request.id,requestIds:cancelled.map(item=>item.id),calendarEventId:cancellation.event?.id||null}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.optional_email_update'){
      const raw=context.intelligence?.entities?.email||context.message.text;
      const parsed=engagement.parseField('email',raw);
      if(!parsed.valid)return result(parsed.message,language,previous,'cleaning_invalid_optional_email',{intent:'CLEANING_OPTIONAL_EMAIL_INVALID',payload:{legacyText:parsed.message,preferLegacyText:true,pendingField:previous.step}});
      await context.services.crm?.updateCustomer?.({email:parsed.value,preferredLanguage:language});
      const next={...previous,email:parsed.value};
      const prompt=previous.step==='confirm'?'If everything looks correct, say confirm.':promptFor(previous.step,language);
      const reply=`Thanks — I’ve saved ${parsed.value} as an optional email contact. ${prompt}`;
      return result(reply,language,next,'cleaning_optional_email_saved',{intent:'CLEANING_OPTIONAL_EMAIL_SAVED',payload:{legacyText:reply,preferLegacyText:true,email:parsed.value,pendingField:previous.step}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.customer_field_edit'){
      const semantic=context.intelligence?.entities||{};
      const amendment=semantic.fieldAmendment||{};
      const field=amendment.field;
      const allowed=new Set(['name','phone','email','address']);
      if(!allowed.has(field))return result('I can update the service name, address, phone, or optional email, but I need you to name the exact field.',language,previous,'cleaning_field_edit_unknown');
      const requestId=semantic.requestId||previous.pendingFieldEdit?.requestId||previous.lastRequestId||null;
      const resumeStep=previous.pendingFieldEdit?previous.pendingFieldEdit.resumeStep:(previous.step||null);
      const submittedEdit=previous.pendingFieldEdit?.submitted??Boolean(requestId&&!previous.step);
      const rawValue=amendment.rawValue;
      if(rawValue==null||String(rawValue).trim()===''){
        const next={...previous,step:'fieldEdit',pendingFieldEdit:{field,resumeStep,requestId,submitted:submittedEdit}};
        const reply=`What should I use as the new ${customerFieldLabel(field)}?`;
        return result(reply,language,next,'cleaning_field_edit_needs_value',{intent:'CLEANING_FIELD_EDIT_NEEDS_VALUE',payload:{legacyText:reply,pendingField:field}});
      }
      const options=field==='phone'?{minDigits:10,maxDigits:15}:{};
      const parsed=engagement.parseField(field,rawValue,options);
      if(!parsed.valid){
        const next={...previous,step:'fieldEdit',pendingFieldEdit:{field,resumeStep,requestId,submitted:submittedEdit}};
        const reply=`${parsed.message} The current ${customerFieldLabel(field)} has not been changed. Please provide the new ${customerFieldLabel(field)}.`;
        return result(reply,language,next,'cleaning_field_edit_invalid',{intent:'CLEANING_FIELD_EDIT_INVALID',payload:{legacyText:reply,pendingField:field,unchanged:true}});
      }
      let next={...previous,[field]:parsed.value};
      delete next.pendingFieldEdit;
      next.step=resumeStep==='fieldEdit'?nextMissingStep(next):resumeStep;
      if(next.step===field||!next.step)next.step=nextMissingStep(next);
      let updatedRequest=null;
      if(requestId&&submittedEdit){
        const request=await findEditableRequest(cleaning,requestId);
        if(!request)return result('I could not find an active cleaning request to update. Your saved details were not changed.',language,previous,'cleaning_field_edit_request_missing');
        updatedRequest=await cleaning.updateRequest(request.id,{[field]:parsed.value});
        next={lastRequestId:updatedRequest.id};
      }
      if(['name','phone','email'].includes(field))await context.services.crm?.updateCustomer?.({[field]:parsed.value,preferredLanguage:language});
      const continuation=next.step&&next.step!=='confirm'?` ${promptFor(next.step,language)}`:next.step==='confirm'?' If everything looks correct, say confirm.':'';
      const reply=`Updated — the ${customerFieldLabel(field)} is now ${parsed.value}.${updatedRequest?` Request ${updatedRequest.id} is now revision ${updatedRequest.revision}.`:''}${continuation}`;
      return result(reply,language,next,'cleaning_customer_field_updated',{intent:'CLEANING_CUSTOMER_FIELD_UPDATED',payload:{legacyText:reply,field,value:parsed.value,requestId:updatedRequest?.id||null,revision:updatedRequest?.revision||null,pendingField:next.step||null}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.request_history'){
      const requests=await cleaning.listRequests();
      if(!requests.length){
        const reply="I don’t see any cleaning requests for this customer in this tenant yet.";
        return result(reply,language,previous,'cleaning_requests_empty',{intent:'CLEANING_REQUESTS_EMPTY',payload:{legacyText:reply,count:0}});
      }
      const recent=[...requests].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,5);
      const lines=['Your cleaning request details:',...recent.map(request=>formatRequestHistoryLine(request))];
      const reply=lines.join('\n\n');
      return result(reply,language,previous,'cleaning_requests_viewed',{intent:'CLEANING_REQUESTS_VIEWED',payload:{legacyText:reply,count:recent.length,requestIds:recent.map(x=>x.id)}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.submitted_schedule_edit'){
      const semantic=context.intelligence?.entities||{};
      const request=await findEditableRequest(cleaning,semantic.requestId||previous.editingRequestId||previous.lastRequestId);
      if(!request){
        const reply='I could not find an active cleaning request for this customer to change. Ask to view your cleaning request history or start a new request.';
        return result(reply,language,previous,'cleaning_submitted_request_not_found',{intent:'CLEANING_REQUEST_NOT_FOUND',payload:{legacyText:reply}});
      }
      const requestedField=semantic.scheduleEditField||null;
      const suppliedDate=Boolean(semantic.date||semantic.dateText||semantic.weekday||semantic.dateDay);
      const suppliedTime=Boolean(semantic.startTime||semantic.time||semantic.timeFlexible);
      if(requestedField==='date'&&!suppliedDate){
        const reply=`I found request ${request.id}. What new service date would you prefer?`;
        const next={lastRequestId:request.id,editingRequestId:request.id,preferredDate:request.preferredDate,preferredTime:request.preferredTime,step:'submitted_reschedule_date'};
        return result(reply,language,next,'cleaning_submitted_reschedule_ask_date',{intent:'CLEANING_SUBMITTED_RESCHEDULE_ASK_DATE',payload:{legacyText:reply,requestId:request.id,pendingField:'submitted_reschedule_date'}});
      }
      if(requestedField==='time'&&!suppliedTime){
        const reply=`I found request ${request.id}. What new start time would you prefer?`;
        const next={lastRequestId:request.id,editingRequestId:request.id,preferredDate:request.preferredDate,preferredTime:request.preferredTime,step:'submitted_reschedule_time'};
        return result(reply,language,next,'cleaning_submitted_reschedule_ask_time',{intent:'CLEANING_SUBMITTED_RESCHEDULE_ASK_TIME',payload:{legacyText:reply,requestId:request.id,pendingField:'submitted_reschedule_time'}});
      }
      const rawDate=submittedDateInput(semantic,request.preferredDate)||previous.preferredDate||request.preferredDate;
      const preserveExistingTime=suppliedDate&&!suppliedTime;
      const rawTime=semantic.startTime||semantic.time||(preserveExistingTime?request.preferredTime:null);
      const retainFlexibleTime=preserveExistingTime&&request.timeFlexible;
      const checked=validateSchedule(context,engagement,{...semantic,timeFlexible:semantic.timeFlexible||retainFlexibleTime,date:rawDate,startTime:rawTime,durationHours:request.durationHours,endTime:semantic.endTime||request.endTime});
      if(checked.error){
        const next={lastRequestId:request.id,editingRequestId:request.id,preferredDate:checked.preferredDate||request.preferredDate,preferredTime:request.preferredTime,step:checked.errorField==='date'?'submitted_reschedule_date':'submitted_reschedule_time'};
        return result(`${checked.error} ${promptFor(checked.errorField,language)}`,language,next,'cleaning_submitted_schedule_invalid',{intent:'CLEANING_SUBMITTED_SCHEDULE_INVALID',payload:{legacyText:checked.error,pendingField:next.step}});
      }
      const preferredDate=checked.preferredDate||request.preferredDate;
      const startTime=checked.preferredTime;
      if(!startTime&&(semantic.timeFlexible||retainFlexibleTime)){
        const updated=await cleaning.updateRequest(request.id,{preferredDate,timeFlexible:true,timePreference:'any_available',preferredTime:null,endTime:null});
        const reply=`Updated request ${updated.id} — the team may assign any available start time${preferredDate?` on ${preferredDate}`:''}. No exact slot has been promised; live availability still needs confirmation.`;
        return result(reply,language,{lastRequestId:updated.id},'cleaning_submitted_schedule_flexible',{intent:'CLEANING_SUBMITTED_SCHEDULE_FLEXIBLE',payload:{legacyText:reply,requestId:updated.id,revision:updated.revision,preferredDate,timeFlexible:true,availabilityRequiresRecheck:true}});
      }
      if(!startTime){
        const reply=`I found request ${request.id}. What new start time would you prefer?`;
        return result(reply,language,{lastRequestId:request.id,step:'submitted_reschedule_time',editingRequestId:request.id,preferredDate,preferredTime:request.preferredTime},'cleaning_submitted_reschedule_ask_time',{intent:'CLEANING_SUBMITTED_RESCHEDULE_ASK_TIME',payload:{legacyText:reply,requestId:request.id,pendingField:'submitted_reschedule_time'}});
      }
      const duration=Number(request.durationHours||0);
      const endTime=duration?addHours(startTime,duration):(semantic.endTime||request.endTime||null);
      let updated;
      try{updated=await cleaning.updateRequest(request.id,{preferredDate,preferredTime:startTime,endTime});}
      catch(error){
        if(error.code==='CALENDAR_SLOT_UNAVAILABLE'){
          const alternatives=error.alternatives?.length?` Available alternatives: ${error.alternatives.map(row=>`${row.date} at ${row.time}`).join(', ')}.`:'';
          const reply=`That replacement time is unavailable.${alternatives} Request ${request.id} remains at ${displayTime(request)} on ${request.preferredDate}.`;
          return result(reply,language,{lastRequestId:request.id},'cleaning_submitted_reschedule_unavailable',{intent:'CLEANING_SUBMITTED_RESCHEDULE_UNAVAILABLE',payload:{legacyText:reply,requestId:request.id,alternatives:error.alternatives||[]}});
        }
        throw error;
      }
      await context.services.crm?.recordActivity('cleaning.request_updated',{requestId:updated.id,revision:updated.revision,preferredDate,preferredTime:startTime});
      const range=endTime?`${startTime}–${endTime}`:startTime;
      const reply=`Updated request ${updated.id} — the cleaning schedule is now ${preferredDate?`${preferredDate} at `:''}${range}.${updated.status==='confirmed'?' The replacement slot is confirmed.':' Live team availability must be checked again before this change is finally confirmed.'} The request ID, service, address, and customer details remain unchanged.`;
      return result(reply,language,{lastRequestId:updated.id},'cleaning_submitted_schedule_updated',{intent:'CLEANING_SUBMITTED_SCHEDULE_UPDATED',payload:{legacyText:reply,requestId:updated.id,revision:updated.revision,preferredDate,startTime,endTime,availabilityRequiresRecheck:true}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.submitted_service_change'){
      const semantic=context.intelligence?.entities||{};
      const request=await findEditableRequest(cleaning,semantic.requestId||previous.lastRequestId);
      if(!request){
        const reply='I could not find an active cleaning request for this customer to change. Ask to view your cleaning request history or start a new request.';
        return result(reply,language,previous,'cleaning_submitted_request_not_found',{intent:'CLEANING_REQUEST_NOT_FOUND',payload:{legacyText:reply}});
      }
      const service=(await cleaning.listServices()).find((entry)=>entry.id===semantic.serviceId);
      if(!service)return result('That cleaning service is not currently available, so I have not changed your saved request.',language,{lastRequestId:request.id},'cleaning_submitted_service_unavailable');
      const pricingReset={total:null,currency:null,hourlyRate:null,quotedService:null};
      if(service.priceType!=='hourly'){pricingReset.durationHours=null;pricingReset.cleanerCount=null;}
      let updated;
      try{updated=await cleaning.updateRequest(request.id,{serviceId:service.id,serviceName:service.name,...pricingReset});}
      catch(error){if(error.code==='CALENDAR_SLOT_UNAVAILABLE'){const alternatives=error.alternatives?.length?` Available alternatives: ${error.alternatives.map(row=>`${row.date} at ${row.time}`).join(', ')}.`:'';const reply=`${service.name} needs different calendar capacity and the current time cannot support that change.${alternatives} Request ${request.id} remains ${request.serviceName}.`;return result(reply,language,{lastRequestId:request.id},'cleaning_submitted_service_change_unavailable',{intent:'CLEANING_SUBMITTED_SERVICE_CHANGE_UNAVAILABLE',payload:{legacyText:reply,requestId:request.id,alternatives:error.alternatives||[]}});}throw error;}
      await context.services.crm?.recordActivity('cleaning.request_updated',{requestId:updated.id,revision:updated.revision,serviceId:updated.serviceId});
      const reply=`Updated request ${updated.id} — the service is now ${service.name}. Its date, time, address, and customer details remain unchanged. Pricing and live availability must be checked again before the amended request is finally confirmed.`;
      return result(reply,language,{lastRequestId:updated.id},'cleaning_submitted_service_updated',{intent:'CLEANING_SUBMITTED_SERVICE_UPDATED',payload:{legacyText:reply,requestId:updated.id,revision:updated.revision,serviceId:updated.serviceId,availabilityRequiresRecheck:true,pricingRequiresRecheck:true}});
    }

    if(context.intelligence?.selected?.intent==='cleaning.submitted_requirements_edit'){
      const semantic=context.intelligence?.entities||{};
      const request=await findEditableRequest(cleaning,semantic.requestId||previous.lastRequestId);
      if(!request)return result('I could not find an active cleaning request for this customer to change.',language,previous,'cleaning_submitted_request_not_found');
      const changes=requestFields(semantic);
      for(const key of ['date','dateText','weekday','startTime','endTime','durationHours','address','name','phone','quoteOnly'])delete changes[key];
      const updated=await cleaning.updateRequest(request.id,changes);
      const labels=cleaningRequirementLabels(changes);
      const reply=`Updated request ${updated.id} (revision ${updated.revision}) — its cleaning requirements now include ${labels.join(', ')}. The request history, schedule, address, and customer details remain intact. Pricing and availability must be rechecked if this changes the scope.`;
      return result(reply,language,{lastRequestId:updated.id},'cleaning_submitted_requirements_updated',{intent:'CLEANING_SUBMITTED_REQUIREMENTS_UPDATED',payload:{legacyText:reply,requestId:updated.id,revision:updated.revision,changes}});
    }

    if (context.intelligence?.selected?.intent === "cleaning.discount_info") {
      const cfg=context.services.pricing.getConfig();
      const active=(cfg.discounts||[]).filter(x=>x.enabled!==false);
      if(!active.length){
        const reply=localized(language,"There isn’t a configured cleaning discount right now.","Abhi koi configured cleaning discount available nahi hai.","اس وقت کوئی کنفیگرڈ کلیننگ ڈسکاؤنٹ دستیاب نہیں ہے۔");
        return result(reply,language,previous,"cleaning_discount_info",{intent:"CLEANING_DISCOUNT_UNAVAILABLE",payload:{legacyText:reply}});
      }
      const labels=active.map(d=>d.type==='percent'?`${d.value}%`:currencyAmount(d.value,cfg.currency||'USD')).join(', ');
      const reply=localized(language,`Configured discounts currently include ${labels} for eligible services. Tell me which service you want and I can check whether the discount applies to that quotation.`,`Configured discounts mein ${labels} eligible services ke liye available hain. Service ka naam bata dein, main check kar deta hoon discount us quote par apply hota hai ya nahi.`,`کنفیگرڈ ڈسکاؤنٹس میں ${labels} اہل سروسز کے لیے دستیاب ہیں۔ سروس کا نام بتائیں، میں چیک کر دوں گا کہ ڈسکاؤنٹ اس کوٹ پر لاگو ہوتا ہے یا نہیں۔`);
      return result(reply,language,previous,"cleaning_discount_info",{intent:"CLEANING_DISCOUNT_INFO",payload:{legacyText:reply,discounts:active}});
    }

    if (context.intelligence?.selected?.intent === "cleaning.recurring_quote") {
      const e=context.intelligence?.entities||{}, recurrence=e.recurrence;
      if(e.serviceId==='CLN-HOURLY'&&e.durationHours){
        const q=context.services.pricing.quote({serviceId:'hourly-cleaner',hours:e.durationHours,workers:e.cleanerCount||1,text:context.message.text});
        if(q.ok){
          const requirements=requirementLine(e);
          const history=e.returningCustomerClaim?' I’ve noted your returning-customer claim; any eligible offer must be verified against this tenant’s CRM history before it is applied.':'';
          const reply=`For ${recurrenceLabel(recurrence)} Hourly Cleaner Hire, each visit is ${currencyAmount(q.total,q.currency)} (${q.formula}).${requirements}${history} Recurring schedule availability still needs confirmation. If you want to continue, tell me your preferred days.`;
          return result(reply,language,{...previous,...requestFields(e),recurrence,serviceId:'CLN-HOURLY',serviceName:'Hourly Cleaner Hire',durationHours:e.durationHours,cleanerCount:e.cleanerCount||1,hourlyRate:q.subtotal/(e.durationHours*(e.cleanerCount||1)),total:q.total,currency:q.currency},"cleaning_recurring_quote",{intent:"CLEANING_RECURRING_QUOTE",payload:{legacyText:reply,...q,recurrence,requirements:requestFields(e)}});
        }
      }
      const cfg=context.services.pricing.getConfig(),hourly=(cfg.services||[]).find(x=>x.id==='hourly-cleaner');
      const hourlyText=hourly?` Hourly Cleaner Hire is ${currencyAmount(hourly.rate,hourly.currency||cfg.currency||'USD')} per hour per cleaner.`:'';
      const reply=`I can quote ${recurrenceLabel(recurrence)} cleaning, but recurring price depends on the service and visit details.${hourlyText} Tell me which cleaning service you want${hourly?' and, for hourly cleaner hire, how many hours per visit':''}.`;
      return result(reply,language,{...previous,recurrence},"cleaning_recurring_quote_needs_service",{intent:"CLEANING_RECURRING_QUOTE_NEEDS_DETAILS",payload:{legacyText:reply,recurrence}});
    }

    if (context.intelligence?.selected?.intent === "cleaning.recurring_request") {
      const e=context.intelligence?.entities||{},recurrence=e.recurrence;
      const base={...previous,...requestFields(e),recurrence,serviceId:e.serviceId||null,serviceName:e.serviceName||null,durationHours:e.durationHours||null,cleanerCount:e.cleanerCount||null};
      if(!base.serviceId){
        const reply=`Got it — you want ${recurrenceLabel(recurrence)} cleaning. Which service should repeat: Standard Home Cleaning, Deep Home Cleaning, or Hourly Cleaner Hire?`;
        return result(reply,language,{...base,step:'recurring_service'},"cleaning_recurring_ask_service",{intent:"CLEANING_RECURRING_ASK_SERVICE",payload:{legacyText:reply,recurrence}});
      }
      if(base.serviceId==='CLN-HOURLY'&&!base.durationHours){
        const reply=`Got it — ${recurrenceLabel(recurrence)} Hourly Cleaner Hire. How many hours should each visit be?`;
        return result(reply,language,{...base,step:'duration'},"cleaning_recurring_ask_duration",{intent:"CLEANING_RECURRING_ASK_DURATION",payload:{legacyText:reply,recurrence}});
      }
      const reply=`Got it — ${recurrenceLabel(recurrence)} ${base.serviceName||'cleaning'} requested. Which day or days do you prefer for the recurring visits?`;
      return result(reply,language,{...base,step:'recurring_days'},"cleaning_recurring_ask_days",{intent:"CLEANING_RECURRING_ASK_DAYS",payload:{legacyText:reply,recurrence}});
    }

    if(previous.step==='recurring_service'){
      const found=await cleaning.findService(context.message.text);
      if(!found?.service||(found.service.hidden&&found.service.id!=='CLN-HOURLY')){
        return result('Please choose Standard Home Cleaning, Deep Home Cleaning, or Hourly Cleaner Hire.',language,previous,'cleaning_recurring_invalid_service',{intent:'CLEANING_RECURRING_ASK_SERVICE',payload:{pendingField:'recurring_service'}});
      }
      const next={...previous,serviceId:found.service.id,serviceName:found.service.name,step:found.service.id==='CLN-HOURLY'?'duration':'recurring_days'};
      const reply=found.service.id==='CLN-HOURLY'?`Hourly Cleaner Hire selected. How many hours should each recurring visit be?`:`${found.service.name} selected. Which day or days do you prefer for the recurring visits?`;
      return result(reply,language,next,'cleaning_recurring_service_selected',{intent:found.service.id==='CLN-HOURLY'?'CLEANING_RECURRING_ASK_DURATION':'CLEANING_RECURRING_ASK_DAYS',payload:{legacyText:reply}});
    }

    if(previous.step==='recurring_days'){
      const days=parseDays(context.message.text);
      if(!days.length)return result('Tell me the preferred day or days, for example “Monday and Thursday”.',language,previous,'cleaning_recurring_invalid_days',{intent:'CLEANING_RECURRING_ASK_DAYS',payload:{pendingField:'recurring_days'}});
      const next={...previous,recurringDays:days,step:'time'};
      return result(promptFor('time',language),language,next,'cleaning_recurring_ask_time',{intent:'CLEANING_ASK_TIME',payload:{pendingField:'time',recurringDays:days}});
    }

    // A customer may compare/change the property while a date/time is pending.
    // Reinterpret the new property first instead of consuming it as the pending field.
    const propertyAlternative = context.intelligence?.selected?.intent!=="cleaning.service_change"
      && /\b(what about|how about|instead|other)\b/.test(text)
      && /\b(apartment|flat|studio|villa|house|home|bedroom|bedrooms|bhk)\b/.test(text);
    if(previous.step && propertyAlternative){
      const semantic={}; const m=text.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/); if(m) semantic.bedrooms=Number(m[1]);
      if(/\bvilla\b/.test(text)) semantic.propertyType='villa'; else if(/\b(apartment|flat|studio)\b/.test(text)) semantic.propertyType='apartment';
      const q=context.services.pricing.quote({...semantic,requestedOperationalServiceId:semantic.serviceId||null,text:context.message.text});
      if(q.ok){
        const reply=localized(language,`For a ${semantic.bedrooms||''} bedroom ${semantic.propertyType||'property'}, the configured estimate is ${currencyAmount(q.total,q.currency)}. If you want this instead, say “book this”.`,`Ji — ${semantic.bedrooms||''} bedroom ${semantic.propertyType||'property'} ka configured estimate ${currencyAmount(q.total,q.currency)} hai. Agar yehi chahiye to “book this” keh dein.`,`جی — ${semantic.bedrooms||''} بیڈ روم ${semantic.propertyType||'property'} کا تخمینہ ${currencyAmount(q.total,q.currency)} ہے۔ اگر یہی چاہیے تو “book this” کہیں۔`);
        return result(reply,language,{...previous,step:null,quotedService:q,quotedServiceRequirements:semantic,resumeSnapshot:previous},"cleaning_property_alternative_quote",{intent:"CLEANING_QUOTE_GENERATED",payload:{legacyText:reply,...q}});
      }
      const services=await cleaning.listServices();
      const fallbackId=semantic.propertyType==='villa'?'CLN009':semantic.propertyType==='apartment'?'CLN008':null;
      const actual=services.find((service)=>service.id===fallbackId);
      if(actual){
        const next={...previous,...semantic,serviceId:actual.id,serviceName:actual.name,step:previous.step};
        delete next.quotedService;delete next.customQuotePending;
        const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
        const reply=`Changed the request to ${actual.name} for the ${semantic.bedrooms!=null?`${semantic.bedrooms}-bedroom `:''}${semantic.propertyType}. ${formatPrice(actual)} is the configured rate. I kept the existing date, time, address and customer details. ${prompt}`;
        return result(reply,language,next,'cleaning_property_alternative_selected',{intent:'CLEANING_SERVICE_CHANGED',payload:{legacyText:reply,serviceId:actual.id,pendingField:next.step}});
      }
      const reply=localized(language,"That exact property size is not in the configured pricing table. I can arrange a custom quotation instead.","Is exact property size ki price configured nahi hai. Main custom quotation arrange karne mein help kar sakta hoon.","اس خاص پراپرٹی سائز کی قیمت کنفیگر نہیں ہے۔ میں کسٹم کوٹیشن کی درخواست تیار کر سکتا ہوں۔");
      return result(reply,language,{...previous,step:null,customQuotePending:makeCustomQuotePending(semantic,context.message.text,q.reason||"combination_not_priced")},"cleaning_property_alternative_unpriced",{intent:"CLEANING_CUSTOM_QUOTE_REQUIRED",payload:{legacyText:reply,...q}});
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.scope_update") {
      const e=context.intelligence?.entities||{};
      const service=(await cleaning.listServices()).find(x=>x.id===previous.serviceId);
      const next={...previous,scopeText:e.scopeText||context.message.text,scopeCount:e.scopeCount||null,scopeUnit:e.scopeUnit||null};
      const scopeLabel=e.scopeCount&&e.scopeUnit?`${e.scopeCount} ${e.scopeUnit}`:String(e.scopeText||context.message.text).trim();
      const reply=`Got it — I’ve noted the scope as ${scopeLabel}. ${service?`${service.name} is configured at ${formatPrice(service)}. `:''}${promptFor(previous.step,language)}`;
      return result(reply,language,next,"cleaning_scope_updated",{intent:"CLEANING_SCOPE_UPDATED",payload:{legacyText:reply,scopeText:next.scopeText,pendingField:previous.step}});
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.requirements_update") {
      const semantic=context.intelligence?.entities||{};
      const updates=requestFields(semantic);
      delete updates.scopeText;delete updates.date;delete updates.dateText;delete updates.weekday;
      delete updates.startTime;delete updates.endTime;delete updates.durationHours;
      const next={...previous,...updates,step:previous.step};
      if(previous.quotedService?.serviceId){
        const recalculated=context.services.pricing.quote({...next,serviceId:previous.quotedService.serviceId,requestedOperationalServiceId:previous.serviceId,text:context.message.text});
        if(recalculated.ok)next.quotedService=recalculated;
      }
      const labels=cleaningRequirementLabels(updates);
      const priceBoundary=unpricedAddOnBoundary(context,updates);
      const reply=`Updated 👍 I’ve added ${labels.join(', ')} to this cleaning request.${priceBoundary?` ${priceBoundary}`:''}\n\n${previous.step==='confirm'?'If everything looks correct, say confirm.':promptFor(previous.step,language)}`;
      return result(reply,language,next,"cleaning_requirements_updated",{intent:"CLEANING_REQUIREMENTS_UPDATED",payload:{legacyText:reply,requirements:updates,pendingField:previous.step}});
    }

    if (previous.step && context.intelligence?.selected?.intent === 'cleaning.incomplete_confirmation') {
      const serviceName=previous.serviceName||'this cleaning service';
      const reply=localized(language,
        `Sure — ${serviceName} is selected. ${promptFor(previous.step,language)}`,
        `Ji — ${serviceName} select hai. ${promptFor(previous.step,language)}`,
        `جی — ${serviceName} منتخب ہے۔ ${promptFor(previous.step,language)}`);
      return result(reply,language,previous,'cleaning_incomplete_confirmation',{intent:intentForStep(previous.step),payload:{legacyText:reply,pendingField:previous.step,missingRequiredField:previous.step}});
    }

    if (context.intelligence?.selected?.intent === 'cleaning.price_type_clarification') {
      const semantic=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const ambiguousId=semantic.ambiguousPropertyServiceId;
      const otherServiceItems=(semantic.serviceItems||[]).filter(item=>item.serviceId!==ambiguousId);
      const otherQuotes=[];
      for(const item of otherServiceItems){
        const service=allServices.find(entry=>entry.id===item.serviceId);
        if(!service)continue;
        const quote=quoteConfiguredService(context,service,semantic);
        if(quote.ok)otherQuotes.push(quote);
      }
      const deepService=allServices.find(service=>service.id===(semantic.propertyType==='villa'?'CLN011':'CLN010'));
      const deepQuote=deepService?quoteConfiguredService(context,deepService,semantic):null;
      const hourly=(context.services.pricing.getConfig()?.services||[]).find(service=>service.id==='hourly-cleaner');
      const currency=hourly?.currency||deepQuote?.currency||context.services.pricing.getConfig()?.currency||'AED';
      const propertyLabel=[semantic.bedrooms!=null?`${semantic.bedrooms}-bedroom`:null,semantic.propertyType||'property'].filter(Boolean).join(' ');
      const knownLines=otherQuotes.map(quote=>`• ${quoteLine(quote,semantic)}`);
      const choices=[
        `• Standard cleaning — ${currencyAmount(hourly?.rate||40,currency)} per hour per cleaner`,
        deepQuote?.ok?`• Deep cleaning — ${currencyAmount(deepQuote.total,deepQuote.currency)}`:'• Deep cleaning — price depends on the property size'
      ];
      const reply=`${knownLines.length?`${knownLines.join('\n')}\n\n`:''}For the ${propertyLabel}, would you like standard cleaning or deep cleaning?\n${choices.join('\n')}`;
      const pendingPriceClarification={
        propertyType:semantic.propertyType||null,
        bedrooms:semantic.bedrooms??null,
        scope:requestFields(semantic),
        otherServiceItems,
        knownQuotes:otherQuotes
      };
      const next={...previous,step:null,pendingPriceClarification,priceEnquiry:otherQuotes.length?{serviceId:otherQuotes.at(-1).operationalServiceId,serviceName:otherQuotes.at(-1).serviceName,...requestFields(semantic),quote:otherQuotes.at(-1)}:previous.priceEnquiry||null};
      delete next.quotedServices;
      return result(reply,language,next,'cleaning_price_type_clarification',{intent:'CLEANING_PRICE_TYPE_CLARIFICATION',payload:{legacyText:reply,propertyType:semantic.propertyType,bedrooms:semantic.bedrooms,knownQuotes:otherQuotes,standardHourlyRate:Number(hourly?.rate||40),deepQuote:deepQuote?.ok?deepQuote:null,noBookingCreated:true}});
    }

    if (context.intelligence?.selected?.intent === 'cleaning.standard_price_details') {
      const semantic=context.intelligence?.entities||{};
      const hourly=(context.services.pricing.getConfig()?.services||[]).find(service=>service.id==='hourly-cleaner');
      const currency=hourly?.currency||context.services.pricing.getConfig()?.currency||'AED';
      const allServices=await cleaning.listServices();
      const otherQuotes=[];
      for(const item of semantic.serviceItems||[]){
        const service=allServices.find(entry=>entry.id===item.serviceId);
        if(!service||service.priceType==='hourly')continue;
        const quote=quoteConfiguredService(context,service,semantic);
        if(quote.ok)otherQuotes.push(quote);
      }
      const lines=[`Standard cleaning is ${currencyAmount(hourly?.rate||40,currency)} per hour per cleaner.`,...otherQuotes.map(quote=>quoteSentence(quote,semantic))];
      const reply=`${lines.join(' ')} How many cleaners and how many hours should I use to calculate the standard-cleaning total?`;
      const next={...previous,step:null,pendingPriceClarification:{propertyType:semantic.propertyType||null,bedrooms:semantic.bedrooms??null,selectedCleaningType:'standard',scope:requestFields(semantic),otherServiceItems:(semantic.serviceItems||[]).filter(item=>!['CLN008','CLN009','CLN001','CLN-HOURLY'].includes(item.serviceId)),knownQuotes:otherQuotes}};
      return result(reply,language,next,'cleaning_standard_price_details',{intent:'CLEANING_STANDARD_PRICE_DETAILS',payload:{legacyText:reply,hourlyRate:Number(hourly?.rate||40),currency,knownQuotes:otherQuotes,noBookingCreated:true}});
    }

    if (context.intelligence?.selected?.intent === 'cleaning.standard_multi_service_quote') {
      const semantic=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const propertyService=allServices.find(service=>service.id===semantic.propertyServiceId)
        || allServices.find(service=>service.id===(semantic.propertyType==='villa'?'CLN009':'CLN008'));
      const hourly=context.services.pricing.quote({serviceId:'hourly-cleaner',hours:semantic.durationHours,workers:semantic.cleanerCount,text:'standard cleaning'});
      const standardQuote=hourly.ok?{...hourly,serviceName:propertyService?.name||'Standard Cleaning',operationalServiceId:propertyService?.id||'CLN001'}:null;
      const quotedServices=standardQuote?[standardQuote]:[];
      for(const item of semantic.otherServiceItems||[]){
        const service=allServices.find(entry=>entry.id===item.serviceId);
        if(!service)continue;
        const quote=quoteConfiguredService(context,service,semantic);
        if(quote.ok)quotedServices.push(quote);
      }
      if(!standardQuote){
        const reply='Please tell me both the number of cleaners and the number of hours so I can calculate the standard-cleaning total.';
        return result(reply,language,previous,'cleaning_standard_price_details',{intent:'CLEANING_STANDARD_PRICE_DETAILS',payload:{legacyText:reply,noBookingCreated:true}});
      }
      const lines=quotedServices.map(quote=>`• ${quote.operationalServiceId===propertyService?.id?`${semantic.cleanerCount} cleaners × ${semantic.durationHours} hours of standard cleaning — ${currencyAmount(quote.total,quote.currency)}`:quoteLine(quote,semantic)}`);
      const currencies=[...new Set(quotedServices.map(quote=>quote.currency))];
      const total=currencies.length===1?quotedServices.reduce((sum,quote)=>sum+Number(quote.total||0),0):null;
      const reply=`Here are the prices:\n${lines.join('\n')}${total!=null?`\nTotal: ${currencyAmount(total,currencies[0])}`:''}\n\nWould you like me to book these services?`;
      const next={...previous,step:null,quotedServices,quotedServiceRequirements:requestFields(semantic),priceEnquiry:{serviceId:quotedServices.at(-1).operationalServiceId,serviceName:quotedServices.at(-1).serviceName,...requestFields(semantic),quote:quotedServices.at(-1),quoteBundle:quotedServices},pendingPriceClarification:null};
      delete next.quotedService;
      return result(reply,language,next,'cleaning_standard_multi_service_quote',{intent:'CLEANING_MULTI_SERVICE_QUOTE_GENERATED',payload:{legacyText:reply,quotes:quotedServices,total,currency:currencies.length===1?currencies[0]:null,noBookingCreated:true}});
    }

    if (context.intelligence?.selected?.intent === 'cleaning.multi_service_quote_request') {
      const semantic=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const quotedServices=[];const missing=[];
      for(const item of semantic.serviceItems||[]){
        const service=allServices.find(entry=>entry.id===item.serviceId);
        if(!service||quotedServices.some(quote=>quote.operationalServiceId===service.id))continue;
        const quote=quoteConfiguredService(context,service,semantic);
        if(quote.ok)quotedServices.push(quote);
        else missing.push({serviceId:service.id,serviceName:service.name,missing:quote.missing||[],reason:quote.reason});
      }
      if(quotedServices.length){
        const lines=quotedServices.map(quote=>`• ${quoteLine(quote,semantic)}`);
        const currencies=[...new Set(quotedServices.map(quote=>quote.currency))];
        const total=currencies.length===1?quotedServices.reduce((sum,quote)=>sum+Number(quote.total||0),0):null;
        const scopeReview=missing.filter(item=>!(item.missing||[]).length);
        const missingFields=[...new Set(missing.flatMap(item=>item.missing||[]))];
        const missingParts=[];
        if(scopeReview.length)missingParts.push(`${scopeReview.map(item=>item.serviceName).join(' and ')} require${scopeReview.length===1?'s':''} a scope review for a custom quotation.`);
        if(missingFields.length)missingParts.push(`To price ${missing.filter(item=>(item.missing||[]).length).map(item=>item.serviceName).join(' and ')}, please tell me ${humanPricingFields(missingFields)}.`);
        const missingLine=missingParts.length?`\n\n${missingParts.join(' ')}`:'';
        const reply=`Here are the prices:\n${lines.join('\n')}${total!=null?`\nTotal: ${currencyAmount(total,currencies[0])}`:''}${missingLine}${!missing.length?'\n\nWould you like me to book these services?':''}`;
        const next={...previous,step:null,quotedServices,quotedServiceRequirements:requestFields(semantic),priceEnquiry:{serviceId:quotedServices.at(-1).operationalServiceId,serviceName:quotedServices.at(-1).serviceName,...requestFields(semantic),quote:quotedServices.at(-1),quoteBundle:quotedServices},pendingPriceClarification:null};
        delete next.quotedService;
        return result(reply,language,next,'cleaning_multi_service_quote',{intent:'CLEANING_MULTI_SERVICE_QUOTE_GENERATED',payload:{legacyText:reply,quotes:quotedServices,total,currency:currencies.length===1?currencies[0]:null,missing,noBookingCreated:true}});
      }
      const fields=[...new Set(missing.flatMap(item=>item.missing))];
      const reply=fields.length?`To calculate those prices, please tell me ${humanPricingFields(fields)}.`:'Those services need a scope review before an exact price can be given.';
      return result(reply,language,{...previous,step:null,pendingPriceClarification:null},'cleaning_multi_service_quote_missing',{intent:'CLEANING_MULTI_SERVICE_QUOTE_NEEDS_DETAILS',payload:{legacyText:reply,missing,noBookingCreated:true}});
    }

    if (context.intelligence?.selected?.intent === "cleaning.standalone_service_quote") {
      const e=context.intelligence?.entities||{};
      const service=(await cleaning.listServices()).find(x=>x.id===e.serviceId);
      if(service){
        const configured=formatPrice(service);
        const reply=service.priceType==='custom_quote'||service.price==null
          ? `${service.name} needs a scope review for an exact price. Tell me the property size and the areas that need cleaning, and I’ll prepare the quotation.`
          : `${service.name} is ${configured}.${service.priceType==='hourly'?' Tell me the number of cleaners and hours if you would like the total.':''}`;
        const next={...previous,priceEnquiry:{serviceId:service.id,serviceName:service.name,...requestFields(e)}};
        delete next.quotedService;delete next.quotedServiceRequirements;
        return result(reply,language,next,'cleaning_standalone_service_quote',{intent:'CLEANING_STANDALONE_SERVICE_QUOTE',payload:{legacyText:reply,serviceId:service.id,serviceName:service.name,priceText:configured,noBookingCreated:true}});
      }
    }

    if (context.intelligence?.selected?.intent === "cleaning.price_comment") {
      const serviceName=context.intelligence?.entities?.serviceName||previous.priceEnquiry?.serviceName||'that cleaning service';
      const reply=localized(language,
        `I understand — ${serviceName} may feel expensive. I can compare it with another service or check whether an approved discount is available.`,
        `Samajh sakta hoon — ${serviceName} ki price zyada lag sakti hai. Main doosri service se compare ya available approved discount check kar sakta hoon.`,
        `میں سمجھ سکتا ہوں کہ ${serviceName} کی قیمت زیادہ لگ سکتی ہے۔ میں دوسری سروس سے موازنہ یا دستیاب منظور شدہ ڈسکاؤنٹ چیک کر سکتا ہوں۔`);
      return result(reply,language,previous,'cleaning_price_comment',{intent:'CLEANING_PRICE_COMMENT',payload:{legacyText:reply,noBookingCreated:true}});
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.active_quote_question") {
      const e=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const service=allServices.find(x=>x.id===(e.serviceId||previous.serviceId));
      if(service){
        if((!e.serviceId||e.serviceId===previous.serviceId)&&(previous.additionalServices||[]).length){
          const rows=[];
          const primaryQuote=quoteConfiguredService(context,service,{...previous,...e});
          rows.push(primaryQuote.ok?`• ${quoteLine(primaryQuote,{...previous,...e})}`:`• ${service.name} — scope review required for a custom quotation`);
          for(const item of previous.additionalServices){
            const additional=allServices.find(entry=>entry.id===item.serviceId);
            if(!additional)continue;
            const quote=item.quotedService?.ok?item.quotedService:quoteConfiguredService(context,additional,{...previous,...item,...e});
            rows.push(quote.ok?`• ${quoteLine(quote,{...previous,...item,...e})}`:`• ${additional.name} — scope review required for a custom quotation`);
          }
          const reply=`Current request pricing:\n${rows.join('\n')}`;
          return result(reply,language,{...previous,priceEnquiry:{serviceId:service.id,serviceName:service.name,...requestFields(e)}} ,'cleaning_active_multi_quote_question',{intent:'CLEANING_ACTIVE_MULTI_QUOTE',payload:{legacyText:reply,noBookingChanged:true}});
        }
        const base=formatPrice(service);
        const priceEnquiry={serviceId:service.id,serviceName:service.name,...requestFields(e)};
        if(service.priceType==='custom_quote'||service.price==null){
          const reply=`${service.name} needs a scope review for an exact custom quotation. Tell me the property size and the areas that need cleaning.`;
          return result(reply,language,{...previous,priceEnquiry},'cleaning_active_quote_question',{intent:'CLEANING_ACTIVE_QUOTE',payload:{legacyText:reply,serviceName:service.name,noBookingChanged:true}});
        }
        const quoteInput={...requestFields(previous),...requestFields(e),serviceId:service.pricingServiceId||undefined,requestedOperationalServiceId:service.id,text:context.message.text};
        const q=context.services.pricing.quote(quoteInput);
        if(q.ok){
          const reply=quoteSentence(q,e,language);
          return result(reply,language,{...previous,priceEnquiry:{...priceEnquiry,quote:q}} ,'cleaning_active_quote_question',{intent:'CLEANING_ACTIVE_QUOTE',payload:{legacyText:reply,...q,noBookingChanged:true}});
        }
        const missing=(q.missing||[]);
        const reply=missing.length
          ? `${service.name} is ${base}. To calculate the exact price, tell me ${humanPricingFields(missing)}.`
          : `${service.name} is ${base}. That exact scope needs a custom quotation.`;
        return result(reply,language,{...previous,priceEnquiry},"cleaning_active_quote_question",{intent:"CLEANING_ACTIVE_QUOTE",payload:{legacyText:reply,serviceName:service.name,basePrice:base,noBookingChanged:true}});
      }
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.cleaner_count_update") {
      const cleanerCount=Number(context.intelligence?.entities?.cleanerCount||previous.cleanerCount||1);
      const durationHours=Number(context.intelligence?.entities?.durationHours||previous.durationHours||0);
      const q=context.services.pricing.quote({serviceId:'hourly-cleaner',hours:durationHours,workers:cleanerCount,text:context.message.text});
      const configured=(context.services.pricing.getConfig()?.services||[]).find((service)=>service.id==='hourly-cleaner');
      const rate=Number(previous.hourlyRate||configured?.rate||0);
      const next={...previous,cleanerCount,durationHours:durationHours||null,hourlyRate:rate,total:durationHours?(q.ok?q.total:durationHours*cleanerCount*rate):null,currency:q.currency||previous.currency||configured?.currency||'AED'};
      if(previous.step==='cleanerCount')next.step=nextMissingStep(next);
      const calculation=durationHours?`${cleanerCount} cleaner${cleanerCount===1?'':'s'} × ${durationHours} hours = ${currencyAmount(next.total,next.currency)}. `:`${cleanerCount} cleaner${cleanerCount===1?'':'s'} selected. `;
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning){
        const reply=`Updated 👍 ${calculation}\n\n${returning.reply}`;
        return result(reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:reply,preferLegacyText:true,cleanerCount,durationHours:durationHours||null,total:returning.state.total,pendingField:returning.state.step,savedDetailsUsed:true}});
      }
      const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
      const reply=`Updated 👍 ${calculation}${prompt}`;
      return result(reply,language,next,'cleaning_cleaner_count_updated',{intent:'CLEANING_CLEANER_COUNT_UPDATED',payload:{legacyText:reply,cleanerCount,durationHours:durationHours||null,total:next.total,pendingField:next.step}});
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.service_change") {
      const serviceId=context.intelligence?.entities?.serviceId;
      const service=(await cleaning.listServices()).find(x=>x.id===serviceId);
      if(service){
        const semantic=context.intelligence?.entities||{};
        const supplied=requestFields(context.intelligence?.entities||{});
        for(const key of ['scopeText','date','dateText','weekday','startTime','endTime','durationHours','cleanerCount'])delete supplied[key];
        const allServices=await cleaning.listServices();
        const oldService=allServices.find((item)=>item.id===previous.serviceId);
        let next={...previous,serviceId:service.id,serviceName:service.name};
        delete next.quotedService;
        delete next.quotedServices;
        delete next.customQuotePending;
        delete next.scopeText;
        delete next.scopeCount;
        delete next.scopeUnit;
        if(serviceScopeFamily(oldService)!==serviceScopeFamily(service)){
          for(const key of ['propertyType','bedrooms','washrooms','halls','units'])delete next[key];
        }
        next={...next,...supplied,...serviceRequirementState(service)};
        if(service.id==="CLN-HOURLY"){
          const durationHours=Number(semantic.durationHours||previous.durationHours||0);
          const cleanerCount=Number(semantic.cleanerCount||1);
          const q=context.services.pricing.quote({serviceId:"hourly-cleaner",hours:durationHours,workers:cleanerCount,text:context.message.text});
          const configured=(context.services.pricing.getConfig()?.services||[]).find((entry)=>entry.id==='hourly-cleaner');
          const rate=q.ok&&durationHours&&cleanerCount?q.subtotal/(durationHours*cleanerCount):Number(configured?.rate||0);
          next={...next,durationHours,cleanerCount,hourlyRate:rate,currency:q.currency||configured?.currency||'AED',total:q.ok?q.total:durationHours*cleanerCount*rate};
        }else{
          delete next.durationHours;delete next.cleanerCount;delete next.hourlyRate;delete next.total;delete next.currency;
          const configuredQuote=quoteConfiguredService(context,service,{...previous,...semantic,...supplied});
          if(configuredQuote.ok){next.quotedService=configuredQuote;next.total=configuredQuote.total;next.currency=configuredQuote.currency;}
        }
        next.step=nextMissingStep(next);
        const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
        const quote=service.id==="CLN-HOURLY"&&next.durationHours
          ? localized(language,
              ` ${next.cleanerCount} cleaner${next.cleanerCount===1?'':'s'} × ${next.durationHours} hours = ${currencyAmount(next.total,next.currency)}.`,
              ` ${next.cleanerCount} cleaner × ${next.durationHours} ghantay = ${currencyAmount(next.total,next.currency)}.`,
              ` ${next.cleanerCount} کلینر × ${next.durationHours} گھنٹے = ${currencyAmount(next.total,next.currency)}۔`)
          : next.quotedService?.ok?` ${quoteSentence(next.quotedService,next,language)}`:"";
        const reply=localized(language,
          `No problem 👍 I’ve changed the request to ${service.name}.${quote} ${prompt}`,
          `Theek hai 👍 Request ${service.name} par change kar di hai.${quote} ${prompt}`,
          `ٹھیک ہے 👍 درخواست ${service.name} پر تبدیل کر دی ہے۔${quote} ${prompt}`);
        return result(reply,language,next,"cleaning_service_changed",{intent:"CLEANING_SERVICE_CHANGED",payload:{legacyText:reply,serviceName:service.name,pendingField:next.step,durationHours:next.durationHours||null,cleanerCount:next.cleanerCount||null,total:next.total||null}});
      }
    }

    if (context.intelligence?.selected?.intent === "cleaning.schedule_edit") {
      const semantic=context.intelligence?.entities||{};
      const rawDate=semantic.date||semantic.dateText||semantic.weekday||previous.preferredDate||null;
      const rawTime=semantic.startTime||semantic.time||null;
      const checked=validateSchedule(context,engagement,{...semantic,date:rawDate,startTime:rawTime,durationHours:previous.durationHours,endTime:semantic.endTime});
      if(checked.error){
        const step=checked.errorField==='date'?'date':'reschedule_time';
        const next={...previous,preferredDate:checked.preferredDate||previous.preferredDate,step,rescheduleResumeStep:previous.rescheduleResumeStep||previous.step};
        return result(`${checked.error} ${promptFor(checked.errorField,language)}`,language,next,'cleaning_schedule_invalid',{intent:'CLEANING_SCHEDULE_INVALID',payload:{legacyText:checked.error,pendingField:step}});
      }
      const requestedDate=checked.preferredDate||previous.preferredDate||null;
      const startTime=checked.preferredTime;
      if(!startTime&&semantic.timeFlexible){
        const resumeStep=previous.rescheduleResumeStep||previous.step||nextMissingStep(previous);
        const next={...previous,preferredDate:requestedDate,preferredTime:null,startTime:null,endTime:null,timeFlexible:true,timePreference:'any_available',rescheduleResumeStep:null,step:resumeStep==='reschedule_time'?nextMissingStep({...previous,timeFlexible:true}):resumeStep};
        const prompt=next.step&&next.step!=='confirm'?` ${promptFor(next.step,language)}`:'';
        const reply=`Updated — I’ve recorded any available team time${requestedDate?` on ${requestedDate}`:''}. This is a flexible preference, not a confirmed slot; live availability still needs confirmation.${prompt}`;
        return result(reply,language,next,'cleaning_schedule_flexible',{intent:'CLEANING_SCHEDULE_FLEXIBLE',payload:{legacyText:reply,preferredDate:requestedDate,timeFlexible:true,pendingField:next.step}});
      }
      if(!startTime){
        const resumeStep=previous.step==='reschedule_time'?(previous.rescheduleResumeStep||nextMissingStep(previous)):previous.step;
        const next={...previous,preferredDate:requestedDate,rescheduleResumeStep:resumeStep||nextMissingStep(previous),step:'reschedule_time'};
        const dateLine=requestedDate?` for ${requestedDate}`:'';
        const reply=`Of course — I can change the service time${dateLine}. What new start time would you prefer? For example, 9:00 AM.`;
        return result(reply,language,next,'cleaning_reschedule_ask_time',{intent:'CLEANING_RESCHEDULE_ASK_TIME',payload:{legacyText:reply,preferredDate:requestedDate,pendingField:'reschedule_time'}});
      }
      const startTimeCorrection=semantic.correction?.target==='startTime';
      const duration=Number((startTimeCorrection?previous.durationHours:semantic.durationHours)||previous.durationHours||0);
      const endTime=startTimeCorrection
        ? (duration?addHours(startTime,duration):previous.endTime||null)
        : (semantic.endTime||(duration?addHours(startTime,duration):previous.endTime||null));
      const resumeStep=previous.rescheduleResumeStep||previous.step||nextMissingStep(previous);
      const restoredStep=resumeStep==='reschedule_time'?nextMissingStep(previous):resumeStep;
      const next={...previous,preferredDate:requestedDate,preferredTime:startTime,startTime,endTime,rescheduleResumeStep:null,step:restoredStep};
      const range=endTime?`${startTime}–${endTime}`:startTime;
      const prompt=restoredStep?promptFor(restoredStep,language):'';
      const reply=`Updated — the requested cleaning time is now ${range}${requestedDate?` on ${requestedDate}`:''}. Team availability still needs confirmation.${prompt?` ${prompt}`:''}`;
      return result(reply,language,next,'cleaning_schedule_updated',{intent:'CLEANING_SCHEDULE_UPDATED',payload:{legacyText:reply,preferredDate:requestedDate,startTime,endTime,pendingField:restoredStep}});
    }

    if (previous.step && context.intelligence?.selected?.intent === 'cleaning.additional_service_add') {
      const semantic=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const requested=(semantic.serviceItems||[])
        .map((entry)=>allServices.find((service)=>service.id===entry.serviceId))
        .filter(Boolean)
        .filter((service)=>service.id!==previous.serviceId);
      const current=Array.isArray(previous.additionalServices)?previous.additionalServices:[];
      const added=[];let additionalServices=[...current];
      for(const service of requested){
        const item=priceAdditionalService(context,service,{...previous,...semantic});
        if(!additionalServices.some((entry)=>entry.serviceId===item.serviceId)){
          additionalServices.push(item);added.push(item);
        }
      }
      if(!requested.length){
        const reply=`I could not identify a different configured service to add. Your current request is unchanged. ${promptFor(previous.step,language)}`;
        return result(reply,language,previous,'cleaning_additional_service_unresolved',{intent:'CLEANING_ADDITIONAL_SERVICE_UNRESOLVED',payload:{legacyText:reply,pendingField:previous.step}});
      }
      const next={...previous,additionalServices,step:previous.step};
      const totals=combinedServiceTotal(allServices,next);
      const listed=(added.length?added:requested.map((service)=>additionalServices.find((entry)=>entry.serviceId===service.id)).filter(Boolean))
        .map((item)=>`• ${item.serviceName}${item.total!=null?` — ${currencyAmount(item.total,item.currency)}${item.priceIsStartingFrom?' starting estimate':''}`:' — custom quotation required'}`)
        .join('\n');
      const status=added.length?'Added as additional service(s) to this cleaning request:':'Already included as additional service(s) in this cleaning request:';
      const prompt=previous.step==='confirm'?'If everything looks correct, say confirm.':promptFor(previous.step,language);
      const reply=`${status}\n${listed}\n\nThe original ${previous.serviceName||'cleaning service'}, schedule, and collected customer details remain unchanged.${totals.total!=null?` Current combined priced estimate: ${currencyAmount(totals.total,totals.currency)}${totals.hasCustomQuote?' plus custom-quoted service(s)':''}.`:totals.hasCustomQuote?' One or more services require a custom quotation.':''} ${prompt}`;
      return result(reply,language,next,added.length?'cleaning_additional_services_added':'cleaning_additional_services_duplicate',{
        intent:added.length?'CLEANING_ADDITIONAL_SERVICES_ADDED':'CLEANING_ADDITIONAL_SERVICES_ALREADY_INCLUDED',
        payload:{legacyText:reply,items:added,combinedTotal:totals.total,currency:totals.currency,pendingField:previous.step}
      });
    }

    if (!previous.step && context.intelligence?.selected?.intent === 'cleaning.multi_service_request') {
      const semantic=context.intelligence?.entities||{};
      const allServices=await cleaning.listServices();
      const selected=(semantic.serviceItems||[]).map((entry)=>allServices.find((service)=>service.id===entry.serviceId)).filter(Boolean);
      if(selected.length>1){
        const primary=selected[0];
        const base=initialRequestState(context,engagement,semantic,{serviceId:primary.id,serviceName:primary.name,scopeText:context.message.text});
        const additionalServices=selected.slice(1).map((service)=>priceAdditionalService(context,service,semantic));
        const next={...base,additionalServices};
        const lines=[`• ${primary.name} — ${formatPrice(primary)}`,...additionalServices.map((item)=>`• ${item.serviceName}${item.total!=null?` — ${currencyAmount(item.total,item.currency)}`:' — custom quotation required'}`)];
        const reply=`I’ve kept these as ${selected.length} separate services in one request:\n${lines.join('\n')}\n\n${capturedScheduleLine(next)}${promptFor(next.step,language)}`;
        return result(reply,language,next,'cleaning_multi_service_started',{intent:intentForStep(next.step),payload:{legacyText:reply,serviceIds:selected.map((service)=>service.id),pendingField:next.step}});
      }
    }

    if (context.intelligence?.selected?.intent === "cleaning.custom_quote_request") {
      const semantic=context.intelligence?.entities||{};
      const quoteContext={...(previous.customQuotePending||{}),...requestFields(semantic),propertyType:semantic.propertyType||previous.customQuotePending?.propertyType||null,bedrooms:semantic.bedrooms||previous.customQuotePending?.bedrooms||null,units:semantic.units||previous.customQuotePending?.units||null,confirmationMessage:context.message.text};
      const handoff=await context.services.handoffService?.create({
        tenantId:context.tenant.id,
        conversationId:context.conversationId||`${context.tenant.id}:${context.message.channel}:${context.message.customerId}`,
        customerId:context.message.customerId,
        reason:"custom_quotation_requested",
        context:{quoteRequest:quoteContext,activePlugin:"cleaning",capabilityState:context.state.capabilityState||{}}
      });
      const ref=handoff?.id?` Reference: ${handoff.id}.`:"";
      const property=[quoteContext.bedrooms?`${quoteContext.bedrooms}-bedroom`:null,quoteContext.propertyType].filter(Boolean).join(' ');
      const reply=localized(language,
        `Absolutely — I’ve created a custom quotation request${property?` for your ${property}`:''}.${ref} The team can review the exact requirements and provide the price.`,
        `Bilkul — custom quotation request${property?` ${property} ke liye`:''} create kar di hai.${ref} Team exact requirements check karke price confirm karegi.`,
        `جی بالکل — کسٹم کوٹیشن کی درخواست${property?` ${property} کے لیے`:''} بنا دی گئی ہے۔${ref} ٹیم تفصیلات دیکھ کر قیمت بتائے گی۔`);
      return result(reply,language,{...previous,step:null,customQuotePending:null,customQuoteHandoffId:handoff?.id||null},"cleaning_custom_quote_requested",{intent:"CLEANING_CUSTOM_QUOTE_REQUESTED",payload:{legacyText:reply,handoffId:handoff?.id||null,...quoteContext}});
    }

    if (context.intelligence?.selected?.intent === 'cleaning.quote_bundle_accept') {
      const quotedServices=context.intelligence?.entities?.quotedServices||previous.quotedServices||[];
      const requirements=context.intelligence?.entities?.quotedServiceRequirements||previous.quotedServiceRequirements||{};
      const allServices=await cleaning.listServices();
      const primaryQuote=quotedServices[0];
      const primaryService=allServices.find(service=>service.id===primaryQuote?.operationalServiceId);
      if(primaryQuote&&primaryService){
        const continuation=bookingContinuation(previous);
        const semantic={...requirements,...continuation,date:continuation.preferredDate||null,startTime:continuation.preferredTime||continuation.startTime||null};
        const base=initialRequestState(context,engagement,semantic,{serviceId:primaryService.id,serviceName:primaryService.name,quotedService:primaryQuote,total:primaryQuote.total,currency:primaryQuote.currency,...serviceRequirementState(primaryService)});
        const additionalServices=quotedServices.slice(1).map(quote=>({
          key:[quote.operationalServiceId,requirements.propertyType||'',requirements.bedrooms||'',requirements.units||''].join('|'),
          serviceId:quote.operationalServiceId,serviceName:quote.serviceName,propertyType:requirements.propertyType||null,
          bedrooms:requirements.bedrooms??null,units:requirements.units??null,total:quote.total,currency:quote.currency,
          formula:quote.formula,quotedService:quote,pricingStatus:'quoted',priceIsStartingFrom:false
        }));
        const next={...base,additionalServices,quotedServices:null,pendingPriceClarification:null,priceEnquiry:null};
        next.step=nextMissingStep(next);
        const reply=`Great — I’ve selected ${quotedServices.map(quote=>quote.serviceName).join(' and ')} for a combined estimate of ${currencyAmount(quotedServices.reduce((sum,quote)=>sum+Number(quote.total||0),0),quotedServices[0].currency)}. ${next.step==='confirm'?'Please check the details and confirm.':promptFor(next.step,language)}`;
        return result(reply,language,next,'cleaning_quoted_services_selected',{intent:intentForStep(next.step),payload:{legacyText:reply,serviceIds:quotedServices.map(quote=>quote.operationalServiceId),pendingField:next.step}});
      }
    }

    if (context.intelligence?.selected?.intent === "cleaning.quote_accept") {
      const q=context.intelligence?.entities?.quotedService||previous.priceEnquiry?.quote||previous.quotedService;
      if(!q)return result('Which quotation would you like to book?',language,previous,'cleaning_quote_missing',{intent:'CLEANING_QUOTE_MISSING',payload:{legacyText:'Which quotation would you like to book?'}});
      if(!q.operationalServiceId){
        const reply="I have the quotation, but this price entry is not linked to a bookable service yet. I can hand this to the team.";
        return result(reply,language,previous,"cleaning_quote_unlinked",{intent:"CLEANING_QUOTE_UNLINKED",payload:{legacyText:reply,...q}});
      }
      const allServices=await cleaning.listServices();
      const service=allServices.find(entry=>entry.id===q.operationalServiceId);
      const requirements=context.intelligence?.entities?.quotedServiceRequirements||(
        previous.priceEnquiry?.quote===q?requestFields(previous.priceEnquiry):previous.quotedServiceRequirements||{}
      );
      if(context.intelligence?.entities?.addToExisting&&previous.step&&previous.serviceId!==q.operationalServiceId&&service){
        const current=Array.isArray(previous.additionalServices)?previous.additionalServices:[];
        const item={...priceAdditionalService(context,service,requirements),total:q.total,currency:q.currency,formula:q.formula,quotedService:q,pricingStatus:'quoted'};
        const additionalServices=current.some(entry=>entry.serviceId===item.serviceId)?current:[...current,item];
        const next={...previous,additionalServices};
        const reply=`Added ${q.serviceName} at ${currencyAmount(q.total,q.currency)}. ${previous.step==='confirm'?'Please check the updated request and confirm.':promptFor(previous.step,language)}`;
        return result(reply,language,next,'cleaning_quoted_service_added',{intent:'CLEANING_ADDITIONAL_SERVICES_ADDED',payload:{legacyText:reply,item,pendingField:previous.step}});
      }
      const continuation=bookingContinuation(previous);
      const semantic={...requirements,...continuation,date:continuation.preferredDate||null,startTime:continuation.preferredTime||continuation.startTime||null};
      const next=initialRequestState(context,engagement,semantic,{serviceId:q.operationalServiceId,serviceName:q.serviceName,quotedService:q,total:q.total,currency:q.currency,...serviceRequirementState(service||{})});
      next.priceEnquiry=null;next.quotedServices=null;next.pendingPriceClarification=null;
      next.step=nextMissingStep(next);
      const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
      const reply=`Great — ${q.serviceName} is selected at ${currencyAmount(q.total,q.currency)}. ${prompt}`;
      return result(reply,language,next,"cleaning_quoted_service_selected",{intent:intentForStep(next.step),payload:{legacyText:reply,...q,pendingField:next.step}});
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.structured_service_request") {
      const semantic=context.intelligence?.entities||{};
      const q=context.services.pricing.quote({...semantic,requestedOperationalServiceId:semantic.serviceId||null,text:context.message.text});
      if(q.reason==='operational_service_conflict' && semantic.serviceId){
        const actual=(await cleaning.listServices()).find(x=>x.id===semantic.serviceId);
        const customQuoteFirst=actual?.priceType==='custom_quote'&&(semantic.cleaningType||(!semantic.date&&!semantic.dateText&&!semantic.weekday&&!semantic.startTime&&semantic.propertyType));
        if(actual&&!customQuoteFirst){
          const next=initialRequestState(context,engagement,semantic,{serviceId:actual.id,serviceName:actual.name,scopeText:context.message.text,...bookingRequirementState(actual)});
          const prompt=promptFor(next.step,language);
          const reply=localized(language,
            `${actual.name} selected. ${formatPrice(actual)} is the configured service price. I won’t apply a pricing table linked to a different service. ${capturedScheduleLine(next)}${prompt}`,
            `${actual.name} select ho gayi hai. Configured price ${formatPrice(actual)} hai. Main kisi doosri service ki pricing table apply nahi karunga. ${capturedScheduleLine(next)}${prompt}`,
            `${actual.name} منتخب ہو گئی ہے۔ قیمت ${formatPrice(actual)} ہے۔ دوسری سروس کی قیمت لاگو نہیں کی جائے گی۔ ${capturedScheduleLine(next)}${prompt}`);
          return result(reply,language,next,"cleaning_service_identity_preserved",{intent:intentForStep(next.step),payload:{legacyText:reply,serviceName:actual.name,priceText:formatPrice(actual),pendingField:next.step,requirements:requestFields(semantic)}});
        }
      }
      if(q.ok && q.operationalServiceId){
        const actual=(await cleaning.listServices()).find(service=>service.id===q.operationalServiceId);
        const next=initialRequestState(context,engagement,semantic,{serviceId:q.operationalServiceId,serviceName:q.serviceName,quotedService:q,...bookingRequirementState(actual||{})});
        const prompt=promptFor(next.step,language);
        const reply=localized(language,
          `Yes — I can prepare that ${q.serviceName} request. The configured estimate is ${currencyAmount(q.total,q.currency)}. ${capturedScheduleLine(next)}${prompt}`,
          `Ji bilkul — ${q.serviceName} request tayar ho sakti hai. Configured estimate ${currencyAmount(q.total,q.currency)} hai. ${capturedScheduleLine(next)}${prompt}`,
          `جی بالکل — ${q.serviceName} کی درخواست تیار ہو سکتی ہے۔ تخمینہ ${currencyAmount(q.total,q.currency)} ہے۔ ${capturedScheduleLine(next)}${prompt}`);
        return result(reply,language,next,"cleaning_structured_service_started",{intent:intentForStep(next.step),payload:{legacyText:reply,preferLegacyText:true,...q,pendingField:next.step,requirements:requestFields(semantic)}});
      }
      // A bookable tenant service may intentionally use custom pricing. Price
      // uncertainty must not erase the date/time/property fields or prevent the
      // request workflow from continuing.
      if(semantic.serviceId||semantic.propertyType){
        const services=await cleaning.listServices();
        const fallbackId=semantic.propertyType==='villa'?'CLN009':semantic.propertyType==='apartment'?'CLN008':null;
        const actual=services.find((service)=>service.id===(semantic.serviceId||fallbackId));
        if(actual){
          const hasSchedule=Boolean(semantic.date||semantic.dateText||semantic.weekday||semantic.startTime||semantic.time);
          const scopeReviewService=Boolean(semantic.cleaningType)||['CLN010','CLN011','CLN012'].includes(actual.id);
          if(['custom_quote','scope_based'].includes(actual.priceType)&&!hasSchedule&&scopeReviewService){
            const pending=makeCustomQuotePending({...semantic,serviceId:actual.id,serviceName:actual.name},context.message.text,'scope_review_required');
            const reply=`${actual.name} requires a custom quotation after the team reviews the scope; I will not invent a fixed price. If you want, say “arrange a custom quotation”.`;
            return result(reply,language,{...previous,step:null,customQuotePending:pending},'cleaning_structured_service_unpriced',{intent:'CLEANING_CUSTOM_QUOTE_REQUIRED',payload:{legacyText:reply,serviceId:actual.id,serviceName:actual.name,reason:'scope_review_required'}});
          }
          const next=initialRequestState(context,engagement,semantic,{serviceId:actual.id,serviceName:actual.name,scopeText:context.message.text,...bookingRequirementState(actual)});
          const priceNote=actual.priceType==='custom_quote'
            ? 'The final price requires a scope review; I will not invent it.'
            : actual.priceType==='scope_based'
              ? `${formatPrice(actual)}. The exact amount will be calculated from the property or item size.`
              : `${formatPrice(actual)} is the configured rate.`;
          const reply=`${actual.name} selected. ${priceNote} ${capturedScheduleLine(next)}${promptFor(next.step,language)}`;
          return result(reply,language,next,'cleaning_structured_custom_priced_service_started',{intent:intentForStep(next.step),payload:{legacyText:reply,preferLegacyText:true,serviceId:actual.id,pendingField:next.step,requirements:requestFields(semantic)}});
        }
      }
      const missing=(q.missing||[]).join(", ");
      const reply=localized(language,
        missing?`I can prepare this request, but I need the ${missing} to calculate the configured price.`:`That exact property/service combination is not in the configured pricing table. I can arrange a custom quotation instead.`,
        missing?`Request tayar ho sakti hai, lekin configured price nikalne ke liye ${missing} chahiye.`:`Is exact property/service combination ki price configured nahi hai. Main custom quotation ke liye request tayar kar sakta hoon.`,
        missing?`درخواست تیار ہو سکتی ہے، لیکن قیمت نکالنے کے لیے ${missing} درکار ہے۔`:`اس خاص پراپرٹی/سروس کی قیمت کنفیگر نہیں ہے۔ میں کسٹم کوٹیشن کی درخواست تیار کر سکتا ہوں۔`);
      return result(reply,language,{...previous,step:null,customQuotePending:makeCustomQuotePending(semantic,context.message.text,q.reason||"combination_not_priced")},"cleaning_structured_service_unpriced",{intent:"CLEANING_CUSTOM_QUOTE_REQUIRED",payload:{legacyText:reply,...q}});
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.discount_request") {
      const semantic=context.intelligence?.entities||{}, base=context.services.pricing.quote({...semantic,text:context.message.text});
      const d=context.services.pricing.discount({...semantic,text:context.message.text,quote:base});
      if(d.ok){
        const symbol=d.currency==="USD"?"$":d.currency==="PKR"?"Rs":d.currency==="AED"?"AED ":`${d.currency} `;
        const label=d.discount.type==="percent"?`${d.discount.value}%`:`${symbol}${d.discount.value}`;
        const reply=`Yes — the configured ${label} discount applies. Original: ${symbol}${d.quote.subtotal}. Discounted total: ${symbol}${d.total}.`;
        return result(reply,language,{},"cleaning_discount_applied",{intent:"CLEANING_DISCOUNT_APPLIED",payload:{legacyText:reply,...d}});
      }
      const reply="There isn’t a configured discount for this service right now.";
      return result(reply,language,{},"cleaning_discount_unavailable",{intent:"CLEANING_DISCOUNT_UNAVAILABLE",payload:{legacyText:reply,reason:d.reason}});
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.structured_quote_request") {
      const semantic=context.intelligence?.entities||{};
      const q=context.services.pricing.quote({...semantic,requestedOperationalServiceId:semantic.serviceId||null,text:context.message.text});
      if(q.ok){
        const reply=quoteSentence(q,semantic,language);
        const priceEnquiry={serviceId:q.operationalServiceId||semantic.serviceId||null,serviceName:q.serviceName,...requestFields(semantic),quote:q};
        return result(reply,language,{...previous,step:null,priceEnquiry,quotedService:q,quotedServiceRequirements:{...requestFields(semantic)}},"cleaning_structured_quote",{intent:"CLEANING_QUOTE_GENERATED",payload:{legacyText:reply,...q,noBookingCreated:true}});
      }
      const fixedPropertyPriceRequested=/\bfixed\b[\s\S]{0,20}\b(?:price|cost|rate|quote|quotation)\b|\b(?:price|cost|rate|quote|quotation)\b[\s\S]{0,20}\bfixed\b/.test(String(context.message.text||'').toLowerCase());
      if(fixedPropertyPriceRequested&&semantic.propertyType){
        const pending=makeCustomQuotePending(semantic,context.message.text,'fixed_property_price_not_configured');
        const reply="That property size does not have an approved fixed price. I can hand the scope to the team for a custom quotation instead.";
        return result(reply,language,{...previous,step:null,customQuotePending:pending},"cleaning_structured_quote_missing",{intent:"CLEANING_CUSTOM_QUOTE_REQUIRED",payload:{legacyText:reply,reason:'fixed_property_price_not_configured'}});
      }
      const missing=(q.missing||[]).join(", ");
      const reply=missing?`To calculate the price, please tell me ${humanPricingFields(q.missing||[])}.`:"That exact combination is not in the pricing table. I can hand this to the team for a custom quotation.";
      const priceEnquiry=semantic.serviceId?{serviceId:semantic.serviceId,serviceName:semantic.serviceName||null,...requestFields(semantic)}:previous.priceEnquiry||null;
      const nextState=missing?{...previous,priceEnquiry}:{...previous,step:null,priceEnquiry,customQuotePending:makeCustomQuotePending(semantic,context.message.text,q.reason||"combination_not_priced")};
      return result(reply,language,nextState,"cleaning_structured_quote_missing",{intent:missing?"CLEANING_QUOTE_NEEDS_DETAILS":"CLEANING_CUSTOM_QUOTE_REQUIRED",payload:{legacyText:reply,...q}});
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.quote_request") {
      const configured=(context.services.pricing.getConfig()?.services||[]).find((service)=>service.id==='hourly-cleaner');
      const rate=Number(configured?.rate||0),currency=configured?.currency||context.services.pricing.getConfig()?.currency||'AED';
      const price=currencyAmount(rate,currency);
      const reply=language==="roman_urdu"
        ? `Bilkul 😊 General cleaner hire ${price} per hour per cleaner hai. Quote calculate karne ke liye bata dein kitne cleaners aur kitne hours chahiye.`
        : `Sure 😊 General cleaner hire is ${price} per hour per cleaner. To calculate the quote, tell me how many cleaners you need and for how many hours.`;
      return result(reply,language,{},"cleaning_quote_needs_duration",{intent:"CLEANING_QUOTE_NEEDS_DURATION",payload:{legacyText:reply,hourlyRate:rate,currency}});
    }

    if (previous.step && context.intelligence?.selected?.intent === "cleaning.duration_update") {
      const semantic=context.intelligence?.entities||{};
      const duration=Number(semantic.durationHours||previous.durationHours||0);
      const cleanerCount=Number(semantic.cleanerCount||previous.cleanerCount||1);
      let next={...previous,durationHours:duration,cleanerCount};
      const selectedService=(await cleaning.listServices()).find((service)=>service.id===next.serviceId);
      if(selectedService?.priceType==="hourly"){
        const configured=(context.services.pricing.getConfig()?.services||[]).find((service)=>service.id==='hourly-cleaner');
        const rate=Number(next.hourlyRate||configured?.rate||0),currency=next.currency||configured?.currency||context.services.pricing.getConfig()?.currency||'AED';
        next={...next,hourlyRate:rate,currency,total:duration*cleanerCount*rate};
      }
      if(previous.step==="duration" && previous.recurrence){
        next={...next,step:"recurring_days"};
      } else if(previous.step==="date" && semantic.date){
        const parsed=engagement.parseField("date",semantic.date,{allowPast:false});
        if(parsed.valid) next={...next,preferredDate:parsed.value,step:"time"};
      }
      if(previous.step==='duration'&&!previous.recurrence)next.step=nextMissingStep(next);
      const amount=selectedService?.priceType==="hourly" ? ` ${cleanerCount} cleaner${cleanerCount===1?'':'s'} × ${duration} hours = ${currencyAmount(next.total,next.currency)}.` : "";
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning){
        const reply=`Updated 👍 Cleaning duration is ${duration} hours.${amount}\n\n${returning.reply}`;
        return result(reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:reply,preferLegacyText:true,durationHours:duration,cleanerCount,total:returning.state.total||null,pendingField:returning.state.step,savedDetailsUsed:true}});
      }
      const prompt=next.step==="recurring_days"?"Which day or days do you prefer for the recurring visits?":next.step==="time"?"What time would you prefer? For example, 9:00 AM or 14:30.":next.step==="date"?"What date would you prefer? Use DD/MM/YYYY, or say “tomorrow”.":next.step==="address"?"Please share the full service address.":next.step==="name"?"May I have your full name?":next.step==="phone"?"What is the best contact phone number to reach you on?":"If everything looks correct, say confirm.";
      const reply=`Updated 👍 Cleaning duration is ${duration} hours.${amount}\n\n${prompt}`;
      return result(reply,language,next,"cleaning_duration_updated",{intent:"CLEANING_DURATION_UPDATED",payload:{legacyText:reply,durationHours:duration,cleanerCount,total:next.total||null,pendingField:next.step}});
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.pricing_request") {
      const semantic=context.intelligence?.entities||{};
      const standardPropertyCleaning=Boolean(semantic.propertyType)||/\b(?:standard|general|regular|routine)\s+(?:home\s+)?clean(?:ing)?\b/.test(text);
      const customerServiceName=standardPropertyCleaning?'Standard Cleaning':'Hourly Cleaner Hire';
      const duration = Number(semantic.durationHours || 0);
      const cleanerCount = Number(semantic.cleanerCount || 1);
      const configured=context.services.pricing.quote({...semantic,serviceId:'hourly-cleaner',hours:duration,workers:cleanerCount,text:context.message.text});
      const hourlyConfig=(context.services.pricing.getConfig()?.services||[]).find((service)=>service.id==='hourly-cleaner');
      const rate = configured.ok?configured.subtotal/(duration*cleanerCount):Number(hourlyConfig?.rate||0);
      const currency = configured.currency||hourlyConfig?.currency||context.services.pricing.getConfig()?.currency||"AED";
      const total = configured.ok?configured.total:rate*duration*cleanerCount;
      const cleanerText = cleanerCount === 1 ? "1 cleaner" : `${cleanerCount} cleaners`;
      if(semantic.quoteOnly){
        const inquiry={
          ...requestFields(semantic),
          serviceId:'CLN-HOURLY',serviceName:customerServiceName,
          durationHours:duration,cleanerCount,hourlyRate:rate,currency,total,
          noSubstitutionWithoutConsent:Boolean(semantic.noSubstitutionWithoutConsent),
          createdAt:new Date().toISOString()
        };
        const reply=await quoteOnlyAvailabilityReply(context,inquiry);
        return result(reply,language,{pendingAvailabilityInquiry:inquiry},'cleaning_quote_availability_only',{
          intent:'CLEANING_QUOTE_AVAILABILITY_ONLY',
          payload:{legacyText:reply,total,currency,durationHours:duration,cleanerCount,noBookingCreated:true,availabilityInquiry:inquiry}
        });
      }
      const checked=validateSchedule(context,engagement,semantic);
      const preferredDate=checked.preferredDate;
      const preferredTime=checked.preferredTime;
      const address=semantic.address||null;
      const suppliedName=validatedSemanticField(engagement,'name',semantic.name),suppliedPhone=validatedSemanticField(engagement,'phone',semantic.phone,{minDigits:10,maxDigits:15});
      const suppliedEmail=validatedSemanticField(engagement,'email',semantic.email);
      const nextSeed={preferredDate,preferredTime,address,name:suppliedName,phone:suppliedPhone,email:suppliedEmail};
      const nextStep=nextMissingStep(nextSeed);
      let next={...requestFields(semantic),serviceId:"CLN-HOURLY",serviceName:customerServiceName,step:nextStep,preferredDate,preferredTime,startTime:preferredTime,endTime:checked.endTime,address,name:suppliedName,phone:suppliedPhone,email:suppliedEmail,scheduleError:checked.error||null,durationHours:duration,cleanerCount,hourlyRate:rate,currency,total,recurrence:null,recurringDays:null};
      const quote = language === "roman_urdu"
        ? `${customerServiceName}: ${cleanerText} ke liye ${duration} ghantay × ${currencyAmount(rate,currency)} per hour = ${currencyAmount(total,currency)}.`
        : `${customerServiceName}: ${cleanerText} × ${duration} hours × ${currencyAmount(rate,currency)} per hour = ${currencyAmount(total,currency)} total.`;
      const requirement=requirementLine(semantic);
      const availability=(semantic.availabilityRequested||preferredDate||preferredTime)?' Live team availability still needs confirmation.':'';
      const history=semantic.returningCustomerClaim?' Your previous-customer status and any eligible offer will be checked only against this tenant’s CRM history; no discount has been assumed in this total.':'';
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning)next=returning.state;
      const prompt=returning?returning.reply:promptFor(next.step,language);
      const addOnBoundary=unpricedAddOnBoundary(context,semantic);
      const policyNotes=await resolvePolicyNotes(context,semantic.policyFacets,{total,currency});
      const fullReply=`${quote}${requirement}${availability}${history}${addOnBoundary?`\n\n${addOnBoundary}`:''}${policyNotes.length?`\n\n${policyNotes.join('\n')}`:''}${checked.error?`\n\n${checked.error}`:''}${prompt?`\n\n${prompt}`:''}`;
      return result(fullReply, language, next, "cleaning_hourly_booking_started", {
        intent:"CLEANING_HOURLY_BOOKING_STARTED",
        payload:{legacyText:fullReply,durationHours:duration, cleanerCount, hourlyRatePerCleaner:rate, currency, total, preferredDate,preferredTime,address:next.address,pendingField:next.step,requirements:requestFields(semantic),savedDetailsUsed:Boolean(returning)}
      });
    }

    if (!previous.step && context.intelligence?.selected?.intent === "cleaning.service_explore") {
      const services = await cleaning.listServices();
      const durationHours = context.intelligence?.entities?.durationHours || null;
      await context.services.crm?.recordActivity("cleaning.services_viewed", { count: services.length, durationHours });
      const slotState = durationHours ? { durationHours } : {};
      const reply = durationHours ? formatServicesWithDuration(services, language, durationHours) : formatServices(services, language);
      return result(reply, language, slotState, "cleaning_services_listed", {
        intent: durationHours ? "CLEANING_SERVICES_WITH_DURATION" : "CLEANING_SERVICES_LISTED", payload: { legacyText:reply,preferLegacyText:true,durationHours, serviceLines: services.map((s) => `• ${s.name} — ${formatPrice(s)}`).join("\n") }
      });
    }

    if(previous.step==='serviceChoice'){
      const found=await cleaning.findService(context.message.text);
      const allowed=new Set(previous.serviceChoiceIds||[]);
      if(!found?.service||!allowed.has(found.service.id)){
        const choices=(await cleaning.listServices()).filter(service=>allowed.has(service.id));
        const reply=furnitureChoiceReply(choices,language);
        return result(reply,language,previous,'cleaning_service_choice_invalid',{intent:'CLEANING_SERVICE_CHOICE_REQUIRED',payload:{legacyText:reply,pendingField:'serviceChoice'}});
      }
      const semantic={...requestFields(previous),...(context.intelligence?.entities||{})};
      return startConfiguredService(context,cleaning,engagement,language,found.service,semantic,{});
    }

    if(previous.step==='propertyType'||previous.step==='bedrooms'||previous.step==='units'||previous.step==='serviceVariant'){
      const semantic=context.intelligence?.entities||{};
      const next={...previous};
      if(previous.step==='propertyType'){
        const raw=normalize(context.message.text);
        const propertyType=semantic.propertyType||(/\b(villa|vila|house|ghar|home)\b/.test(raw)?'villa':/\b(apartment|flat|studio)\b/.test(raw)?'apartment':null);
        if(!propertyType)return result(promptFor('propertyType',language),language,previous,'cleaning_invalid_property_type',{intent:'CLEANING_ASK_PROPERTY_TYPE',payload:{pendingField:'propertyType'}});
        next.propertyType=propertyType;
        if(/\bstudio\b/.test(raw))next.bedrooms=0;
      }else if(previous.step==='bedrooms'){
        const bedrooms=semantic.bedrooms??numberFromText(context.message.text);
        if(!Number.isInteger(Number(bedrooms))||Number(bedrooms)<0||Number(bedrooms)>20)return result(promptFor('bedrooms',language),language,previous,'cleaning_invalid_bedrooms',{intent:'CLEANING_ASK_BEDROOMS',payload:{pendingField:'bedrooms'}});
        next.bedrooms=Number(bedrooms);
      }else if(previous.step==='units'){
        const units=semantic.units??numberFromText(context.message.text);
        if(!Number.isFinite(Number(units))||Number(units)<1||Number(units)>100)return result(promptFor('units',language),language,previous,'cleaning_invalid_units',{intent:'CLEANING_ASK_UNITS',payload:{pendingField:'units'}});
        next.units=Number(units);
      }else{
        const variant=semantic.serviceVariant||extractServiceVariant(context.message.text);
        if(!variant)return result(promptFor('serviceVariant',language),language,previous,'cleaning_invalid_service_variant',{intent:'CLEANING_ASK_SERVICE_VARIANT',payload:{pendingField:'serviceVariant'}});
        next.serviceVariant=variant;
      }
      next.step=nextMissingStep(next);
      const q=next.pricingServiceId?context.services.pricing.quote({...next,serviceId:next.pricingServiceId,requestedOperationalServiceId:next.serviceId,text:context.message.text}):null;
      if(q?.ok){next.quotedService=q;next.total=q.total;next.currency=q.currency;}
      const quoteLine=q?.ok?` Configured estimate: ${currencyAmount(q.total,q.currency)}.`:q?.reason==='combination_not_priced'?' That exact size needs a custom quotation; no price has been invented.':'';
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning){
        const reply=`Got it.${quoteLine}\n\n${returning.reply}`;
        return result(reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:reply,preferLegacyText:true,pendingField:returning.state.step,quote:q?.ok?q:null,savedDetailsUsed:true}});
      }
      const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
      return result(`Got it.${quoteLine} ${prompt}`,language,next,`cleaning_${previous.step}_saved`,{intent:intentForStep(next.step),payload:{legacyText:`Got it.${quoteLine} ${prompt}`,preferLegacyText:Boolean(q?.ok),pendingField:next.step,quote:q?.ok?q:null}});
    }

    if (previous.step === "date") {
      const semantic=context.intelligence?.entities||{};
      const stored=engagement.referencesStoredField?.('date',context.message.text)
        ? (previous.resumeSnapshot?.preferredDate||previous.previousDetails?.preferredDate||null)
        : null;
      const dateInput=stored||semantic.date||semantic.dateText||semantic.weekday||context.message.text;
      const parsed=engagement.parseField("date",dateInput,{allowPast:false});
      if(!parsed.valid) return result(validationMessage("date",language,parsed.message),language,previous,"cleaning_invalid_date",{intent:"CLEANING_ASK_DATE",payload:{pendingField:"date"}});
      const day=weekdayForDate(parsed.value),operating=context.services.availability?.operatingDay?.(day);
      if(operating?.status==='closed'){
        const reply=`We’re closed on ${title(day)}. Please choose an open business day. ${promptFor('date',language)}`;
        return result(reply,language,previous,'cleaning_closed_date',{intent:'CLEANING_ASK_DATE',payload:{legacyText:reply,pendingField:'date',day}});
      }
      const suppliedTime=semantic.startTime||semantic.time||(
        engagement.referencesStoredField?.('time',context.message.text)
          ? previous.resumeSnapshot?.preferredTime||previous.previousDetails?.preferredTime||null
          : null
      )||previous.pendingDateChoiceTime||null;
      const next={...previous,preferredDate:parsed.value,scheduleError:null};
      delete next.pendingDateOptions;delete next.pendingDateChoiceTime;
      if(semantic.timeFlexible){
        next.preferredTime=null;next.startTime=null;next.endTime=null;
        next.timeFlexible=true;next.timePreference='any_available';
      }
      if(suppliedTime){
        const parsedTime=engagement.parseField('time',suppliedTime);
        if(!parsedTime.valid)return result(validationMessage('time',language,parsedTime.message),language,{...next,step:'time'},'cleaning_invalid_time',{intent:'CLEANING_ASK_TIME',payload:{pendingField:'time'}});
        const allowed=context.services.availability?.validateTime?.(day,parsedTime.value,{endTime:semantic.endTime||null,durationMinutes:Number(previous.durationHours||0)*60});
        if(allowed?.valid===false){const reply=`${allowed.message} ${promptFor('time',language)}`;return result(reply,language,{...next,step:'time'},'cleaning_time_outside_hours',{intent:'CLEANING_ASK_TIME',payload:{legacyText:reply,preferLegacyText:true,pendingField:'time',hours:allowed.hours}});}
        next.preferredTime=parsedTime.value;next.startTime=parsedTime.value;
      }
      next.step=nextMissingStep(next);
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning)return result(returning.reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:returning.reply,preferLegacyText:true,pendingField:returning.state.step,savedDetailsUsed:true}});
      const prompt=next.step==='address'?await savedAddressPrompt(cleaning,context,language):next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
      return result(prompt,language,next,`cleaning_ask_${next.step}`,{intent:intentForStep(next.step),payload:{legacyText:prompt,preferLegacyText:next.step==='address',pendingField:next.step}});
    }
    if (previous.step === "time") {
      const semantic=context.intelligence?.entities||{};
      if(semantic.timeFlexible||isAnyAvailableTime(context.message.text)){
        const next={...previous,preferredTime:null,startTime:null,endTime:null,timeFlexible:true,timePreference:'any_available',scheduleError:null};
        next.step=nextMissingStep(next);
        const returning=await savedCustomerTransition(cleaning,context,next,language);
        if(returning){
          const reply=localized(language,
            `Got it — I’ve recorded any available team time on ${next.preferredDate}. This does not confirm a slot; the team will assign and confirm an available start time.\n\n${returning.reply}`,
            `Theek hai — ${next.preferredDate} ko team ka koi bhi available time note kar liya hai. Exact slot team confirm karegi.\n\n${returning.reply}`,
            `ٹھیک ہے — ${next.preferredDate} کو ٹیم کا کوئی بھی دستیاب وقت نوٹ کر لیا ہے۔ ٹیم درست وقت کی تصدیق کرے گی۔\n\n${returning.reply}`);
          return result(reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:reply,pendingField:returning.state.step,timeFlexible:true,savedDetailsUsed:true}});
        }
        const prompt=next.step==='confirm'?'If everything looks correct, say confirm.':promptFor(next.step,language);
        const reply=localized(language,
          `Got it — I’ve recorded any available team time on ${next.preferredDate}. This does not confirm a slot; the team will assign and confirm an available start time. ${prompt}`,
          `Theek hai — ${next.preferredDate} ko team ka koi bhi available time note kar liya hai. Abhi exact slot confirm nahi hua; team available start time check karke confirm karegi. ${prompt}`,
          `ٹھیک ہے — ${next.preferredDate} کو ٹیم کا کوئی بھی دستیاب وقت نوٹ کر لیا ہے۔ درست وقت ابھی کنفرم نہیں ہوا؛ ٹیم دستیابی چیک کر کے بتائے گی۔ ${prompt}`);
        return result(reply,language,next,`cleaning_ask_${next.step}`,{intent:intentForStep(next.step),payload:{legacyText:reply,pendingField:next.step,timeFlexible:true}});
      }
      const parsed=engagement.parseField("time",context.message.text);
      if(!parsed.valid) return result(validationMessage("time",language,parsed.message),language,previous,"cleaning_invalid_time",{intent:"CLEANING_ASK_TIME",payload:{pendingField:"time"}});
      const day=weekdayForDate(previous.preferredDate);
      const allowed=context.services.availability?.validateTime?.(day,parsed.value,{durationMinutes:Number(previous.durationHours||0)*60,endTime:previous.endTime||null});
      if(allowed?.valid===false){const reply=`${allowed.message} ${promptFor('time',language)}`;return result(reply,language,previous,'cleaning_time_outside_hours',{intent:'CLEANING_ASK_TIME',payload:{legacyText:reply,preferLegacyText:true,pendingField:'time',hours:allowed.hours}});}
      const next={...previous,preferredTime:parsed.value,startTime:parsed.value,timeFlexible:false,timePreference:'exact',scheduleError:null,step:'address'};
      const returning=await savedCustomerTransition(cleaning,context,next,language);
      if(returning)return result(returning.reply,language,returning.state,'cleaning_saved_customer_review',{intent:intentForStep(returning.state.step),payload:{legacyText:returning.reply,preferLegacyText:true,pendingField:returning.state.step,savedDetailsUsed:true}});
      const addressPrompt=await savedAddressPrompt(cleaning,context,language);
      return result(addressPrompt,language,next,"cleaning_ask_address",{intent:"CLEANING_ASK_ADDRESS",payload:{legacyText:addressPrompt,preferLegacyText:true,pendingField:"address"}});
    }
    if (previous.step === "address") {
      let address=null;
      if(engagement.referencesStoredField?.('address',context.message.text))address=(await savedCustomerDetails(cleaning,context)).address;
      if(!address){
        const parsed=engagement.parseField("address",context.message.text,{minLength:3});
        if(!parsed.valid) return result(validationMessage("address",language,parsed.message),language,previous,"cleaning_invalid_address",{intent:"CLEANING_ASK_ADDRESS",payload:{pendingField:"address"}});
        address=parsed.value;
      }
      const saved=await savedCustomerDetails(cleaning,context);
      const next={...previous,address,name:previous.name||saved.name||null,phone:previous.phone||saved.phone||null,email:previous.email||saved.email||null};
      next.step=nextMissingStep(next);
      if(next.name||next.phone||next.email){
        const service=(await cleaning.listServices()).find(entry=>entry.id===next.serviceId);
        const reply=savedDetailsReview(service,next,language);
        return result(reply,language,next,next.step==='confirm'?'cleaning_saved_details_review':'cleaning_saved_details_partial',{intent:intentForStep(next.step),payload:{legacyText:reply,preferLegacyText:true,pendingField:next.step,savedDetailsUsed:true}});
      }
      return result(promptFor("name",language),language,{...next,step:"name"},"cleaning_ask_name",{intent:"CLEANING_ASK_NAME",payload:{pendingField:"name"}});
    }
    if (previous.step === "name") {
      if(engagement.referencesStoredField?.('name',context.message.text)){
        const stored=previous.name||previous.resumeSnapshot?.name||context.customer?.name||null;
        if(stored)return result(promptFor("phone",language),language,{...previous,name:stored,step:"phone"},"cleaning_stored_name_reused",{intent:"CLEANING_ASK_PHONE",payload:{pendingField:"phone",name:stored}});
        const reply=`I don’t have a saved name for this tenant yet. ${promptFor('name',language)}`;
        return result(reply,language,previous,"cleaning_stored_name_missing",{intent:"CLEANING_ASK_NAME",payload:{pendingField:"name"}});
      }
      if(engagement.isFieldRefusal?.(context.message.text)){
        const reply=`I understand. Your name is required to submit this service request. You can provide it, cancel the request, or ask for human support.`;
        return result(reply,language,previous,"cleaning_required_name_refused",{intent:"CLEANING_REQUIRED_FIELD_REFUSED",payload:{pendingField:"name"}});
      }
      const parsed=engagement.parseField("name",context.message.text);
      if(!parsed.valid) return result(validationMessage("name",language,parsed.message),language,previous,"cleaning_invalid_name",{intent:"CLEANING_ASK_NAME",payload:{pendingField:"name"}});
      const sharedEmail=context.intelligence?.messageFrame?.entities?.email||context.intelligence?.entities?.email||null;
      const email=validatedSemanticField(engagement,'email',sharedEmail)||previous.email||null;
      await context.services.crm?.updateCustomer?.({name:parsed.value,...(email?{email}:{}),preferredLanguage:language});
      const reply=`${email?`Thanks — I’ve saved your name as ${parsed.value} and your email as an optional contact. `:''}${promptFor("phone",language)}`;
      return result(reply,language,{...previous,name:parsed.value,email,step:"phone"},"cleaning_ask_phone",{intent:"CLEANING_ASK_PHONE",payload:{legacyText:reply,preferLegacyText:true,pendingField:"phone",email}});
    }
    if (previous.step === "phone") {
      if(engagement.referencesStoredField?.('phone',context.message.text)){
        const stored=previous.phone||previous.resumeSnapshot?.phone||context.customer?.phone||null;
        if(stored){
          const next={...previous,phone:stored,step:'confirm'};
          const service=(await cleaning.listServices()).find((x)=>x.id===next.serviceId);
          return result(summary(service,next,language),language,next,"cleaning_stored_phone_reused",{intent:"CLEANING_READY_TO_CONFIRM",payload:{pendingField:'confirm',phone:stored}});
        }
        const reply=`I don’t have a saved contact number for this tenant yet. ${promptFor('phone',language)}`;
        return result(reply,language,previous,"cleaning_stored_phone_missing",{intent:"CLEANING_ASK_PHONE",payload:{pendingField:"phone"}});
      }
      if(engagement.isFieldRefusal?.(context.message.text)){
        const reply=`I understand. A contact phone number is required to submit this cleaning request so the team can coordinate service and availability. You can provide it, cancel the request, or ask for human support.`;
        return result(reply,language,previous,"cleaning_required_phone_refused",{intent:"CLEANING_REQUIRED_FIELD_REFUSED",payload:{legacyText:reply,pendingField:"phone"}});
      }
      const suppliedPhone=context.intelligence?.messageFrame?.entities?.phone||context.intelligence?.entities?.phone||context.message.text;
      const parsed=engagement.parseField("phone",suppliedPhone,{minDigits:10,maxDigits:15});
      if(!parsed.valid){
        const reply=validationMessage("phone",language,parsed.message);
        return result(reply,language,previous,"cleaning_invalid_phone",{intent:"CLEANING_INVALID_PHONE",payload:{legacyText:reply}});
      }
      const sharedEmail=context.intelligence?.messageFrame?.entities?.email||context.intelligence?.entities?.email||null;
      const email=validatedSemanticField(engagement,'email',sharedEmail)||previous.email||null;
      await context.services.crm?.updateCustomer?.({phone:parsed.value,...(email?{email}:{}),preferredLanguage:language});
      const next={...previous,phone:parsed.value,email,step:"confirm"};
      const service=(await cleaning.listServices()).find((x)=>x.id===next.serviceId);
      const readyText=summary(service,next,language);
      const priceCurrency=next.currency||service?.currency||'AED';
      const priceText=service?.priceType==="hourly"
        ? `${next.cleanerCount||1} cleaner${(next.cleanerCount||1)===1?'':'s'} × ${next.durationHours||0} hours × ${currencyAmount(next.hourlyRate||service.price||0,priceCurrency)} = ${currencyAmount(next.total||((next.cleanerCount||1)*(next.durationHours||0)*(next.hourlyRate||service.price||0)),priceCurrency)}`
        : formatPrice(service);
      return result(readyText,language,next,"cleaning_ready",{
        intent:"CLEANING_READY_TO_CONFIRM",
        payload:{legacyText:readyText,preferLegacyText:true,serviceName:service?.name,priceText,preferredDate:next.preferredDate,preferredTime:next.preferredTime,address:next.address,name:next.name,phone:next.phone,additionalServices:next.additionalServices||[]}
      });
    }
    if (previous.step === "confirm") {
      if (isConfirm(text)) {
        let requestState=previous;
        let availability=previous.timeFlexible?{status:'unknown'}:await cleaning.holdSlot?.(previous);
        if(availability?.status==='unavailable'&&previous.alternativeTime){
          const alternative={...previous,preferredDate:previous.alternativeDate||previous.preferredDate,preferredTime:previous.alternativeTime,startTime:previous.alternativeTime};
          const alternativeAvailability=await cleaning.holdSlot?.(alternative);
          if(alternativeAvailability?.status==='held'){
            requestState={...alternative,preferredSlotUnavailable:true};
            availability=alternativeAvailability;
          }
        }
        if(availability?.status==='unavailable'){
          const alternatives=availability.alternatives?.length?` Available alternatives: ${availability.alternatives.map(row=>`${row.date} at ${row.time}`).join(', ')}.`:'';
          const reply=`That cleaning slot is no longer available.${alternatives} Please choose another time.`;
          return result(reply,language,{...previous,preferredTime:null,startTime:null,step:'time'},'cleaning_slot_unavailable',{intent:'CLEANING_SLOT_UNAVAILABLE',payload:{legacyText:reply,pendingField:'time',alternatives:availability.alternatives||[]}});
        }
        const inputs=[requestState];
        for(const item of requestState.additionalServices||[]){
          inputs.push({
            ...requestState,...item,
            preferredDate:requestState.preferredDate,preferredTime:requestState.preferredTime,
            address:requestState.address,name:requestState.name,phone:requestState.phone,email:requestState.email,
            durationHours:item.durationHours??null,cleanerCount:item.cleanerCount??null,hourlyRate:item.hourlyRate??null,
            recurrence:null,recurringDays:null,additionalServices:undefined,step:null
          });
        }
        const requests=await cleaning.createRequests(inputs,{holdId:availability?.status==='held'?availability.hold.id:null});
        const request=requests[0],requestIds=requests.map((entry)=>entry.id);
        await context.services.crm?.recordActivity("cleaning.request_created", { requestId:request.id,requestIds,serviceId:request.serviceId,count:requests.length });
        await context.services.memory?.appendHistory("cleaning.request_created", { requestId:request.id,requestIds,serviceId:request.serviceId,count:requests.length });
        const confirmationText=`${requestState.preferredSlotUnavailable?'Your first time was unavailable, so I used the alternative time you approved.\n':''}${confirmReply(requests, language, requestState)}`;
        return result(confirmationText, language, {lastRequestId:request.id,lastRequestIds:requestIds}, "cleaning_request_created", {
          intent: requests.length > 1 ? "CLEANING_REQUESTS_CREATED" : "CLEANING_REQUEST_CREATED",
          payload: { legacyText:confirmationText,requestId:request.id,requestIds,count:requests.length,serviceName:request.serviceName,preferredDate:request.preferredDate,preferredTime:request.preferredTime,phone:request.phone||previous.phone }
        }, [{ name:"cleaning.responded.v1",payload:{action:"request_created",requestId:request.id,requestIds,count:requests.length} }]);
      }
      if (isCancel(text)) return result(language === "roman_urdu" ? "Theek hai, cleaning request cancel kar di gayi hai." : "No problem, the cleaning request has been cancelled.", language, {}, "cleaning_cancelled");
      return result(language === "roman_urdu" ? "Agar details theek hain to 'confirm' keh dein, warna jo cheez change karni ho bata dein." : "If the details are correct, say 'confirm'. Otherwise tell me what you want to change.", language, previous, "cleaning_waiting_confirmation");
    }

    if (isListRequest(text)) {
      const services = await cleaning.listServices();
      await context.services.crm?.recordActivity("cleaning.services_viewed", { count: services.length });
      const durationHours=context.intelligence?.entities?.durationHours || previous.durationHours || null;
      return result(durationHours ? formatServicesWithDuration(services,language,durationHours) : formatServices(services, language), language, durationHours?{durationHours}:{}, "cleaning_services_listed", {
        intent: "CLEANING_SERVICES_LISTED",
        payload: { legacyText:durationHours?formatServicesWithDuration(services,language,durationHours):formatServices(services,language),preferLegacyText:true,durationHours, serviceLines: services.map((s) => `• ${s.name} — ${formatPrice(s)}`).join("\n") }
      });
    }

    const found = await cleaning.findService(text);
    if (!found.service) {
      const services = await cleaning.listServices();
      const durationHours=context.intelligence?.entities?.durationHours || previous.durationHours || null;
      return result(durationHours ? formatServicesWithDuration(services,language,durationHours) : formatServices(services, language), language, durationHours?{durationHours}:{}, "cleaning_services_listed", {
        intent: durationHours ? "CLEANING_SERVICES_WITH_DURATION" : "CLEANING_SERVICES_LISTED",
        payload: { legacyText:durationHours?formatServicesWithDuration(services,language,durationHours):formatServices(services,language),preferLegacyText:true,durationHours, serviceLines: services.map((s) => `• ${s.name} — ${formatPrice(s)}`).join("\n") }
      });
    }
    const service = found.service;
    const semantic=context.intelligence?.entities || {};
    if(service.selectionMode==='category_clarification'){
      const choices=(await cleaning.listServices()).filter(entry=>entry.id!==service.id&&!entry.hidden&&entry.category===service.selectionCategory);
      const next={...requestFields(semantic),step:'serviceChoice',serviceChoiceIds:choices.map(entry=>entry.id),serviceChoiceCategory:service.selectionCategory};
      const reply=furnitureChoiceReply(choices,language);
      return result(reply,language,next,'cleaning_service_choice_required',{intent:'CLEANING_SERVICE_CHOICE_REQUIRED',payload:{legacyText:reply,pendingField:'serviceChoice',choices:choices.map(entry=>entry.name)}});
    }
    return startConfiguredService(context,cleaning,engagement,language,service,semantic,previous);
  }
}

async function startConfiguredService(context,cleaning,engagement,language,service,semantic={},previous={}){
  const checked=validateSchedule(context,engagement,semantic);
  const next={
    ...requestFields(semantic),serviceId:service.id,serviceName:service.name,...serviceRequirementState(service),
    preferredDate:checked.preferredDate,preferredTime:checked.preferredTime,startTime:checked.preferredTime,endTime:checked.endTime,
    address:validatedSemanticField(engagement,'address',semantic.address),name:validatedSemanticField(engagement,'name',semantic.name),
    phone:validatedSemanticField(engagement,'phone',semantic.phone,{minDigits:10,maxDigits:15}),email:validatedSemanticField(engagement,'email',semantic.email),scheduleError:checked.error||null,
    durationHours:semantic.durationHours||previous.durationHours||null,cleanerCount:semantic.cleanerCount||previous.cleanerCount||(service.priceType==='hourly'?1:null)
  };
  if(service.priceType==='hourly'&&next.durationHours){
    const configured=(context.services.pricing.getConfig()?.services||[]).find(entry=>entry.id==='hourly-cleaner');
    next.hourlyRate=Number(configured?.rate||service.price||0);next.currency=configured?.currency||service.currency||'AED';
    next.total=Number(next.cleanerCount||1)*Number(next.durationHours)*next.hourlyRate;
  }
  next.step=nextMissingStep(next);
  await context.services.memory?.setPreference('lastCleaningService',service.id);
  await context.services.crm?.recordActivity('cleaning.service_selected',{serviceId:service.id});
  const openingPrice=service.priceType==='custom_quote'
    ? 'The final price requires a scope review; I will not invent it.'
    : service.priceType==='scope_based'
      ? `${formatPrice(service)}. The exact amount will be calculated from the property or item size.`
      : `${formatPrice(service)} is the configured service price.`;
  const returning=await savedCustomerTransition(cleaning,context,next,language);
  const finalState=returning?.state||next;
  const nextPrompt=returning?`\n\n${returning.reply}`:finalState.step==='confirm'?'If everything looks correct, say confirm.':promptFor(finalState.step,language);
  const openingReply=localized(language,
    `${service.name} selected. ${openingPrice} ${capturedScheduleLine(finalState)}${nextPrompt}`,
    `${service.name} select ho gayi hai. Configured price ${formatPrice(service)} hai. ${capturedScheduleLine(finalState)}${nextPrompt}`,
    `${service.name} منتخب ہو گئی ہے۔ قیمت ${formatPrice(service)} ہے۔ ${capturedScheduleLine(finalState)}${nextPrompt}`);
  return result(openingReply,language,finalState,'cleaning_service_selected',{intent:intentForStep(finalState.step),payload:{legacyText:openingReply,preferLegacyText:true,pendingField:finalState.step,serviceName:service.name,description:service.description,priceText:formatPrice(service),preferredDate:finalState.preferredDate,preferredTime:finalState.preferredTime,durationHours:finalState.durationHours,durationLine:finalState.durationHours?`Requested duration: ${finalState.durationHours} hour${finalState.durationHours===1?'':'s'}`:'',savedDetailsUsed:Boolean(returning)}});
}

function furnitureChoiceReply(choices,language){
  const lines=(choices||[]).map(service=>`• ${service.name} — ${formatPrice(service)}`);
  return localized(language,
    `Sure 😊 Which type of furniture should we clean?\n${lines.join('\n')}\n\nSend the furniture type; I’ll then collect its quantity or size and calculate the configured estimate.`,
    `Ji bilkul 😊 Kis furniture ki cleaning chahiye?\n${lines.join('\n')}\n\nFurniture type bata dein; phir quantity ya size lekar configured estimate calculate karunga.`,
    `جی بالکل 😊 کس فرنیچر کی صفائی چاہیے؟\n${lines.join('\n')}\n\nفرنیچر کی قسم بتائیں؛ پھر مقدار یا سائز لے کر تخمینہ نکالا جائے گا۔`);
}
function result(reply, language, cleaningState, lastIntent, responseModel = null, events = []) {
  return createCapabilityResult({ handled: true, reply, confidence: 0.99, responseModel, statePatch: { language, activePlugin: "cleaning", lastIntent, capabilityState: { cleaning: cleaningState } }, events });
}
function localized(language,english,roman,urdu){ return language==="urdu"?urdu:language==="roman_urdu"?roman:english; }
function customerFieldLabel(field){return ({name:'customer name',phone:'contact phone number',email:'email address',address:'service address'})[field]||field;}
async function savedCustomerDetails(cleaning,context){
  const customer=context.customer||{};
  const requests=await cleaning.listRequests();
  const recent=[...requests].filter(request=>request.address||request.name||request.phone||request.email)
    .sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0]||{};
  return {
    name:customer.name||recent.name||null,
    phone:customer.phone||recent.phone||null,
    email:customer.email||recent.email||null,
    address:customer.customFields?.primaryAddress||recent.address||null
  };
}
async function savedAddressPrompt(cleaning,context,language){
  const saved=await savedCustomerDetails(cleaning,context);
  if(!saved.address)return promptFor('address',language);
  return localized(language,
    `Your previous service address is: ${saved.address}\n\nSay “use my previous address” to reuse it, or send the new full service address.`,
    `Aapka pichla service address hai: ${saved.address}\n\nDobara use karna ho to “previous address use karo” kahein, warna naya complete address bhej dein.`,
    `آپ کا پچھلا سروس ایڈریس ہے: ${saved.address}\n\nدوبارہ استعمال کرنے کے لیے کہیں ”پچھلا ایڈریس استعمال کریں“، ورنہ نیا مکمل پتہ بھیج دیں۔`);
}
async function savedCustomerTransition(cleaning,context,state,language){
  if(state.step!=='address')return null;
  const saved=await savedCustomerDetails(cleaning,context);
  // Address is the first required customer-detail field. Only skip its prompt
  // when an actual tenant-scoped saved address exists; otherwise the customer
  // is asked for the genuinely missing value.
  if(!saved.address)return null;
  const next={
    ...state,
    address:state.address||saved.address,
    name:state.name||saved.name||null,
    phone:state.phone||saved.phone||null,
    email:state.email||saved.email||null,
    savedDetailsOffered:true
  };
  next.step=nextMissingStep(next);
  const service=(await cleaning.listServices()).find(entry=>entry.id===next.serviceId);
  return {state:next,reply:savedDetailsReview(service,next,language)};
}
function savedDetailsReview(service,state,language){
  const next=state.step==='confirm'
    ? localized(language,
      'Say “keep all details the same” or “confirm” to continue. To update anything, say “change the name, phone, email, or address to …”.',
      'Sab details same rakhne ke liye “keep all details the same” ya “confirm” kahein. Update ke liye name, phone, email, ya address batayein.',
      'تمام تفصیلات وہی رکھنے کے لیے ”keep all details the same“ یا ”confirm“ کہیں۔ تبدیلی کے لیے نام، فون، ای میل یا ایڈریس بتائیں۔')
    : promptFor(state.step,language);
  const intro=localized(language,'I found your saved customer details and will reuse them for this request unless you update them:','Aapki saved customer details mil gayi hain; agar aap update na karein to isi request mein reuse hongi:','آپ کی محفوظ کسٹمر تفصیلات مل گئی ہیں؛ تبدیلی نہ کرنے کی صورت میں یہی استعمال ہوں گی:');
  const review=service?summary(service,state,language).replace(/\n\n(?:If everything looks correct, please confirm\.|Agar sab theek hai to confirm kar dein\.)$/,''):'';
  return `${intro}\n\n${review}\n\n${next}`.trim();
}
const REQUEST_FIELDS=['propertyType','propertyCount','propertyFloor','bedrooms','washrooms','balconies','interiorWindows','insideRefrigerator','insideOven','fragranceFree','petPresent','heavyPetHair','halls','cleaningType','requestedTasks','requiredEquipment','businessProvidesSupplies','businessProvidesEquipment','returningCustomerClaim','staffPreference','availabilityRequested','quoteOnly','noSubstitutionWithoutConsent','preferredDateOptions','preferredTimeOptions','alternativeDate','alternativeTime','finishBy','address','name','phone','email','scopeText','date','dateText','weekday','startTime','endTime','timeFlexible','timePreference','durationHours','cleanerCount','units','serviceVariant','policyFacets'];
function requestFields(source={}){
  const out={};
  for(const key of REQUEST_FIELDS)if(source[key]!==undefined&&source[key]!==null)out[key]=source[key];
  return out;
}
function makeCustomQuotePending(semantic,message,reason){
  return {...requestFields(semantic),propertyType:semantic.propertyType||null,bedrooms:semantic.bedrooms||null,units:semantic.units||null,serviceId:semantic.serviceId||null,serviceName:semantic.serviceName||null,originalMessage:String(message||''),reason};
}
function requirementLine(semantic={}){
  const parts=[];
  if(semantic.businessProvidesSupplies)parts.push('cleaning supplies/products');
  if(semantic.businessProvidesEquipment)parts.push(semantic.requiredEquipment?.length?semantic.requiredEquipment.join(' and '):'cleaning equipment');
  return parts.length?` I’ve noted that the cleaning team should bring ${[...new Set(parts)].join(' plus ')}.`:'';
}
function cleaningRequirementLabels(semantic={}){
  const labels=[];
  if(semantic.balconies)labels.push(`${semantic.balconies} balcon${semantic.balconies===1?'y':'ies'}`);
  if(semantic.interiorWindows)labels.push(`${semantic.interiorWindows} interior window${semantic.interiorWindows===1?'':'s'}`);
  if(semantic.washrooms)labels.push(`${semantic.washrooms} washroom${semantic.washrooms===1?'':'s'}`);
  if(semantic.halls)labels.push(`${semantic.halls} hall${semantic.halls===1?'':'s'}`);
  if(semantic.insideRefrigerator)labels.push('inside refrigerator cleaning');
  if(semantic.insideOven)labels.push('inside oven cleaning');
  if(semantic.fragranceFree)labels.push('fragrance-free products');
  if(semantic.petPresent)labels.push(semantic.heavyPetHair===false?'a pet without heavy pet hair':'a pet');
  if(semantic.businessProvidesSupplies)labels.push('team-provided cleaning supplies');
  if(semantic.businessProvidesEquipment)labels.push('team-provided equipment');
  return [...new Set(labels.length?labels:['the requested cleaning requirements'])];
}
function nextMissingStep(state={}){
  if(state.pricingFirst){
    for(const field of state.requiredPricingFields||[]){
      if(field==='cleanerCount'&&!Number(state.cleanerCount))return 'cleanerCount';
      if(field==='durationHours'&&!Number(state.durationHours))return 'duration';
      if(field==='propertyType'&&!state.propertyType)return 'propertyType';
      if(field==='bedrooms'&&(state.bedrooms===null||state.bedrooms===undefined||state.bedrooms===''))return 'bedrooms';
      if(field==='units'&&!Number(state.units))return 'units';
      if(field==='serviceVariant'&&!state.serviceVariant)return 'serviceVariant';
    }
  }
  if(!state.preferredDate)return 'date';
  if(!state.preferredTime&&!state.startTime&&!state.timeFlexible)return 'time';
  for(const field of state.requiredPricingFields||[]){
    if(field==='cleanerCount'&&!Number(state.cleanerCount))return 'cleanerCount';
    if(field==='durationHours'&&!Number(state.durationHours))return 'duration';
    if(field==='propertyType'&&!state.propertyType)return 'propertyType';
    if(field==='bedrooms'&&(state.bedrooms===null||state.bedrooms===undefined||state.bedrooms===''))return 'bedrooms';
    if(field==='units'&&!Number(state.units))return 'units';
    if(field==='serviceVariant'&&!state.serviceVariant)return 'serviceVariant';
  }
  if(!state.address)return 'address';
  if(!state.name)return 'name';
  if(!state.phone)return 'phone';
  return 'confirm';
}
function submittedDateInput(semantic={},anchorDate=null){
  const supplied=semantic.date||semantic.dateText||semantic.weekday||null;
  if(supplied)return supplied;
  const day=Number(semantic.dateDay||0);
  const parts=String(anchorDate||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!day||!parts)return null;
  return `${String(day).padStart(2,'0')}/${parts[2]}/${parts[3]}`;
}
function initialRequestState(context,engagement,semantic={},extra={}){
  const checked=validateSchedule(context,engagement,semantic);
  const next={
    ...requestFields(semantic),
    ...extra,
    preferredDate:checked.preferredDate,
    preferredTime:checked.preferredTime,
    startTime:checked.preferredTime,
    endTime:checked.endTime,
    address:validatedSemanticField(engagement,'address',semantic.address),
    name:validatedSemanticField(engagement,'name',semantic.name),
    phone:validatedSemanticField(engagement,'phone',semantic.phone,{minDigits:10,maxDigits:15}),
    email:validatedSemanticField(engagement,'email',semantic.email),
    scheduleError:checked.error||null
  };
  next.step=nextMissingStep(next);
  return next;
}
function capturedScheduleLine(state={}){
  const warning=state.scheduleError?`${state.scheduleError} `:'';
  if(!state.preferredDate&&!state.preferredTime&&!state.timeFlexible)return warning;
  if(state.timeFlexible)return `${warning}I’ve noted ${state.preferredDate?`the date ${state.preferredDate} and `:''}any available team time. `;
  const range=state.preferredTime?(state.endTime?`${state.preferredTime}–${state.endTime}`:state.preferredTime):null;
  return `${warning}I’ve noted ${state.preferredDate?`the date ${state.preferredDate}`:''}${state.preferredDate&&range?' and ':''}${range?`the time ${range}`:''}. `;
}

function validateSchedule(context,engagement,semantic={}){
  const rawDate=semantic.date||semantic.dateText||semantic.weekday||null;
  const rawTime=semantic.startTime||semantic.time||null;
  let preferredDate=null,preferredTime=null,endTime=semantic.endTime||null;
  if(rawDate){
    const parsed=engagement?.parseField?.('date',rawDate,{allowPast:false});
    if(!parsed?.valid)return {preferredDate:null,preferredTime:null,endTime:null,error:parsed?.message||'That date is not valid.',errorField:'date'};
    preferredDate=parsed.value;
    const day=weekdayForDate(preferredDate),operating=context.services.availability?.operatingDay?.(day);
    if(operating?.status==='closed')return {preferredDate:null,preferredTime:null,endTime:null,error:`We’re closed on ${title(day)}. Please choose an open business day.`,errorField:'date'};
  }
  if(rawTime){
    const parsed=engagement?.parseField?.('time',rawTime);
    if(!parsed?.valid)return {preferredDate,preferredTime:null,endTime:null,error:parsed?.message||'That time is not valid.',errorField:'time'};
    preferredTime=parsed.value;
    if(preferredDate){
      const allowed=context.services.availability?.validateTime?.(weekdayForDate(preferredDate),preferredTime,{endTime,durationMinutes:Number(semantic.durationHours||0)*60});
      if(allowed?.valid===false)return {preferredDate,preferredTime:null,endTime:null,error:allowed.message,errorField:'time'};
    }
  }
  return {preferredDate,preferredTime,endTime,error:null,errorField:null};
}
function validatedSemanticField(engagement,field,value,options={}){if(value==null||String(value).trim()==='')return null;const parsed=engagement?.parseField?.(field,value,options);return parsed?.valid?parsed.value:null;}
function weekdayForDate(value){const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]))).getUTCDay()];}
function title(value){return String(value||'that day').replace(/^./,char=>char.toUpperCase());}
async function quoteOnlyAvailabilityReply(context,inquiry){
  const cleanerText=`${inquiry.cleanerCount} cleaner${inquiry.cleanerCount===1?'':'s'}`;
  const quote=`${cleanerText} × ${inquiry.durationHours} hours × ${currencyAmount(inquiry.hourlyRate,inquiry.currency)} per hour = ${currencyAmount(inquiry.total,inquiry.currency)} total.`;
  const days=inquiry.preferredDateOptions?.length?inquiry.preferredDateOptions:[inquiry.weekday].filter(Boolean);
  const times=inquiry.preferredTimeOptions?.length?inquiry.preferredTimeOptions:[inquiry.startTime].filter(Boolean);
  const rows=[];
  for(const day of days){
    const operating=context.services.availability?.operatingDay?.(day)||{status:'unknown'};
    const label=String(day).replace(/^./,value=>value.toUpperCase());
    if(operating.status==='closed'){rows.push(`${label}: closed.`);continue;}
    if(operating.status==='open'){
      const options=times.length?times.join(' then '):'the requested times';
      rows.push(`${label}: open ${operating.hours}; check ${options} in that order. Exact ${cleanerText} availability still requires the live staff schedule.`);
      continue;
    }
    rows.push(`${label}: business hours or live staff availability are not configured well enough to confirm this option.`);
  }
  const deadlines=[];
  if(inquiry.finishBy&&times.length){
    const compliant=times.filter(time=>{
      const end=addHours(time,inquiry.durationHours);return end&&end<=inquiry.finishBy;
    });
    if(compliant.length===times.length)deadlines.push(`The requested starts would finish by ${inquiry.finishBy} for a ${inquiry.durationHours}-hour visit.`);
    else if(compliant.length)deadlines.push(`Only ${compliant.join(', ')} would finish by ${inquiry.finishBy}.`);
    else deadlines.push(`None of those start times would finish by ${inquiry.finishBy}; choose an earlier start.`);
  }
  const staffing=inquiry.noSubstitutionWithoutConsent
    ? `I will keep the requirement at ${cleanerText}; Nova will not reduce or substitute that count without your approval.`
    : '';
  return [quote,'Availability check (before booking):',...rows,...deadlines,staffing,'No booking has been created, and I have not started collecting address or customer details. Choose an option only after staff availability is confirmed.'].filter(Boolean).join('\n');
}
function intentForStep(step){return ({cleaningType:'CLEANING_ASK_TYPE',cleanerCount:'CLEANING_ASK_CLEANER_COUNT',duration:'CLEANING_ASK_DURATION',propertyType:'CLEANING_ASK_PROPERTY_TYPE',bedrooms:'CLEANING_ASK_BEDROOMS',units:'CLEANING_ASK_UNITS',serviceVariant:'CLEANING_ASK_SERVICE_VARIANT',date:'CLEANING_ASK_DATE',time:'CLEANING_ASK_TIME',address:'CLEANING_ASK_ADDRESS',name:'CLEANING_ASK_NAME',phone:'CLEANING_ASK_PHONE',confirm:'CLEANING_REVIEW'})[step]||'CLEANING_WORKFLOW_CONTINUE';}
function unpricedAddOnBoundary(context,semantic={}){
  const requested=[];
  if(semantic.balconies)requested.push(`${semantic.balconies} balcon${semantic.balconies===1?'y':'ies'}`);
  if(semantic.interiorWindows)requested.push(`${semantic.interiorWindows} interior windows`);
  if(semantic.insideRefrigerator)requested.push('inside refrigerator');
  if(semantic.insideOven)requested.push('inside oven');
  if(!requested.length)return '';
  const configuredKeys=new Set((context.services.pricing.getConfig()?.addOns||[]).map(x=>x.inputKey).filter(Boolean));
  const needed=[];if(semantic.balconies)needed.push('balconies');if(semantic.interiorWindows)needed.push('interiorWindows');if(semantic.insideRefrigerator)needed.push('insideRefrigerator');if(semantic.insideOven)needed.push('insideOven');
  if(needed.every(x=>configuredKeys.has(x)))return '';
  return `${requested.join(', ')} are noted in the requested scope, but they do not have separate published add-on prices. The amount above covers the configured hourly cleaning only; the team will confirm whether the requested extras affect the final total.`;
}
async function resolvePolicyNotes(context,facets=[],quote={}){
  const service=context.services.knowledgeService;if(!service||!facets?.length)return [];
  const labels={cancellation:'Cancellation',rescheduling:'Rescheduling',arrival:'Arrival',confirmation:'Confirmation',safety:'Safety',fragrance_free:'Fragrance-free products',pets:'Pet surcharge'};
  const notes=[];
  for(const facet of [...new Set(facets)]){
    const searchQuery=policySearchQuery(facet,context.message.text);
    const retrieval=service.retrieve(searchQuery,context.tenant,{limit:8,minScore:.08,minMargin:.01,minSemantic:.03,kinds:['document','faq_collection','business_profile']});
    let answer=service.groundedAnswer(context.message.text,retrieval,{focus:facet});
    if(!answer){
      const matches=service.search(searchQuery,context.tenant,{limit:12,minScore:0,minSemantic:0,kinds:['document','faq_collection','business_profile']});
      answer=service.groundedAnswer(context.message.text,{matches},{focus:facet});
    }
    if(!answer)continue;
    if(facet==='cancellation'&&quote.total!=null){
      const pct=Number((answer.match(/(\d+(?:\.\d+)?)%/)||[])[1]||0);
      if(pct)answer+=` On the current structured quote of ${currencyAmount(quote.total,quote.currency)}, that percentage would be ${currencyAmount(quote.total*pct/100,quote.currency)}; it must be recalculated if the final booked total changes.`;
    }
    notes.push(`${labels[facet]||facet}: ${answer}`);
  }
  return notes;
}
function policySearchQuery(facet,original){
  const terms={cancellation:'cancellation policy fee notice hours before scheduled start',rescheduling:'rescheduling policy fee hours before scheduled start',arrival:'arrival time policy normal window minutes late',confirmation:'booking confirmation quote reference confirmed time window',safety:'safety limitations high-rise exterior window not offered',fragrance_free:'fragrance-free products notice hours before arrival',pets:'pet-hair surcharge heavy pet hair simply having a pet'};
  return terms[facet]||facet;
}
function addHours(time,hours){
  const m=String(time||'').match(/^(\d{2}):(\d{2})$/);if(!m)return null;
  const minutes=(Number(m[1])*60+Number(m[2])+Math.round(Number(hours)*60))%(24*60);
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
function promptFor(field,language){
  const en={cleaningType:'Would you like Standard Cleaning or Deep Cleaning?',cleanerCount:'How many cleaners do you need?',date:'What date would you prefer? Use DD/MM/YYYY, or say “tomorrow”.',time:'What time would you prefer? For example, 9:00 AM or 14:30, or say “any available time”.',address:'Please share the full service address, including the building/house and area.',name:'May I have your full name?',phone:'What is the best contact phone number to reach you on? You may also include an email address as an optional contact.',duration:'How many hours should each visit be?',propertyType:'Is the property an apartment or a villa/house?',bedrooms:'How many bedrooms does the property have? Say 0 for a studio.',units:'What is the furniture or carpet size/quantity (for example, 3-seater or 6 metres)?',serviceVariant:'What size is it (for example, single/queen/king or small/medium/large)?',recurring_days:'Which day or days do you prefer for the recurring visits?',recurring_service:'Which cleaning service should repeat?'};
  const ru={cleaningType:'Standard Cleaning chahiye ya Deep Cleaning?',cleanerCount:'Kitne cleaners chahiye?',date:'Kis date ko service chahiye? DD/MM/YYYY likhein, ya “tomorrow” keh dein.',time:'Kis time service chahiye? Misal: 9:00 AM, 14:30, ya “jo time available ho”.',address:'Service ka poora address bata dein.',name:'Aap ka poora naam bata dein.',phone:'Aap se rabta karne ke liye sahi contact number bata dein.',duration:'Har visit kitne ghantay ki honi chahiye?',propertyType:'Property apartment hai ya villa/house?',bedrooms:'Property mein kitne bedrooms hain? Studio ke liye 0 kahen.',units:'Furniture ya carpet ka size/quantity bata dein, misal 3-seater ya 6 metres.',serviceVariant:'Size bata dein, misal single/queen/king ya small/medium/large.'};
  const ur={cleaningType:'Standard Cleaning چاہیے یا Deep Cleaning؟',cleanerCount:'کتنے کلینرز چاہیے؟',date:'سروس کس تاریخ کو چاہیے؟ DD/MM/YYYY لکھیں، یا “tomorrow” کہیں۔',time:'سروس کس وقت چاہیے؟ مثال: 9:00 AM یا 14:30۔',address:'سروس کا مکمل پتہ بتائیں۔',name:'اپنا پورا نام بتائیں۔',phone:'رابطے کے لیے درست فون نمبر بتائیں۔',duration:'ہر وزٹ کتنے گھنٹے کا ہونا چاہیے؟',propertyType:'پراپرٹی اپارٹمنٹ ہے یا ولا/گھر؟',bedrooms:'پراپرٹی میں کتنے بیڈ روم ہیں؟ اسٹوڈیو کے لیے 0 کہیں۔',units:'فرنیچر یا کارپٹ کا سائز/تعداد بتائیں۔',serviceVariant:'سائز بتائیں، مثلاً سنگل، کوئین، کنگ، چھوٹا، درمیانہ یا بڑا۔'};
  return (language==='urdu'?ur:language==='roman_urdu'?ru:en)[field]||'';
}
function validationMessage(field,language,fallback){
  if(language==='roman_urdu'){const m={date:'Yeh date samajh nahi aayi. DD/MM/YYYY likhein, ya “tomorrow” keh dein.',time:'Yeh time valid nahi lag raha. Misal: 9:00 AM ya 14:30.',address:'Yeh poora address nahi lag raha. Service ka complete address bhej dein.',name:'Sirf apna poora naam bhej dein, misal “Zeeshan Ahmad”.',phone:'Yeh phone number valid nahi hai. 10-15 digits ka sahi contact number bhej dein, misal 03012345678.'};return m[field]||fallback;}
  if(language==='urdu'){const m={date:'یہ تاریخ سمجھ نہیں آئی۔ DD/MM/YYYY لکھیں، یا “tomorrow” کہیں۔',time:'یہ وقت درست نہیں لگ رہا۔ مثال: 9:00 AM یا 14:30۔',address:'یہ مکمل پتہ نہیں لگ رہا۔ سروس کا مکمل پتہ بھیجیں۔',name:'صرف اپنا پورا نام بھیجیں، مثال “Zeeshan Ahmad”۔',phone:'یہ فون نمبر درست نہیں ہے۔ 10-15 ہندسوں کا درست نمبر بھیجیں، مثال 03012345678۔'};return m[field]||fallback;}
  return fallback;
}
function updateFlow(context, next, intent, payload, language, english, roman) { return result(language === "roman_urdu" ? roman : english, language, next, intent.toLowerCase(), { intent, payload }); }
function normalize(value) { return String(value || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim(); }
function detectLanguage(text, fallback) { if (/[\u0600-\u06ff]/.test(text)) return "urdu"; if (/\b(aap|ap|mujhe|chahiye|hai|kia|kya|safai|karwana|karwani|ghar|ka|ki|mein)\b/i.test(text)) return "roman_urdu"; return fallback || "english"; }
function isListRequest(text) { return /\b(services|service list|what do you offer|what services|which services|show services|list services|do you have services|do you provide services|kia services|kya services|cleaning services|صفائی کی سروس)\b/.test(text); }
function isConfirm(text) { return isConfirmation(text) || /\b(yes|haan|han|theek|book it|kar dein|kardo|done|keep (?:all )?(?:the )?(?:details )?(?:the )?same|use (?:all |my |the )?(?:saved|previous|existing)?\s*details|اوکے|ہاں)\b/.test(text); }
function isCancel(text) { return /\b(cancel|no|nahi|nahin|never mind|rehne dein|نہیں|کینسل)\b/.test(text); }
function currencyAmount(value,currency){const symbol=currency==="USD"?"$":currency==="PKR"?"Rs":currency==="AED"?"AED ":`${currency||""} `;return `${symbol}${Number(value||0).toLocaleString("en-US",{minimumFractionDigits:Number(value)%1?2:0,maximumFractionDigits:2})}`;}
function quoteConfiguredService(context,service,semantic={}){
  const quote=context.services.pricing.quote({
    ...requestFields(semantic),
    serviceId:service.pricingServiceId||undefined,
    requestedOperationalServiceId:service.id,
    text:`${service.name} ${semantic.scopeText||''}`.trim()
  });
  // Standard cleaning is an hourly pricing rule shared by several operational
  // services (villa, apartment, office). A configured pricing-service ID may
  // therefore differ from the selected operational service ID. Quote the
  // shared hourly rule without forcing an artificial ID conflict, but preserve
  // the actual operational service selected for the booking draft.
  if(!quote.ok&&service.priceType==='hourly'&&semantic.durationHours){
    const hourly=context.services.pricing.quote({
      serviceId:service.pricingServiceId||'hourly-cleaner',
      hours:semantic.durationHours,
      workers:semantic.cleanerCount||1,
      text:service.name
    });
    if(hourly.ok)return {...hourly,serviceName:service.name,operationalServiceId:service.id};
  }
  return quote;
}
function quoteSentence(quote,semantic={},language='english'){
  const amount=currencyAmount(quote.total,quote.currency);
  const units=Number(semantic.units||0),bedrooms=semantic.bedrooms;
  if(quote.operationalServiceId==='CLN003'&&units)return appendQuoteAddOns(localized(language,
    `Sure 😊 Cleaning a ${units}-seater sofa costs ${amount}.`,
    `Ji bilkul 😊 ${units}-seater sofa cleaning ki price ${amount} hai.`,
    `جی بالکل 😊 ${units} سیٹر صوفے کی صفائی کی قیمت ${amount} ہے۔`),quote);
  if(quote.operationalServiceId==='CLN011'&&bedrooms!=null)return appendQuoteAddOns(localized(language,
    `Sure 😊 Deep cleaning for a ${bedrooms}-bedroom villa costs ${amount}.`,
    `Ji bilkul 😊 ${bedrooms}-bedroom villa ki deep cleaning ${amount} hai.`,
    `جی بالکل 😊 ${bedrooms} بیڈ روم ولا کی ڈیپ کلیننگ کی قیمت ${amount} ہے۔`),quote);
  if(quote.operationalServiceId==='CLN010'&&bedrooms!=null){
    const englishLabel=Number(bedrooms)===0?'a studio apartment':`a ${bedrooms}-bedroom apartment`;
    const romanLabel=Number(bedrooms)===0?'studio apartment':`${bedrooms}-bedroom apartment`;
    const urduLabel=Number(bedrooms)===0?'اسٹوڈیو اپارٹمنٹ':`${bedrooms} بیڈ روم اپارٹمنٹ`;
    return appendQuoteAddOns(localized(language,
      `Sure 😊 Deep cleaning for ${englishLabel} costs ${amount}.`,
      `Ji bilkul 😊 ${romanLabel} ki deep cleaning ${amount} hai.`,
      `جی بالکل 😊 ${urduLabel} کی ڈیپ کلیننگ کی قیمت ${amount} ہے۔`),quote);
  }
  const sentence=localized(language,
    `Sure 😊 ${quote.serviceName} costs ${amount}.`,
    `Ji bilkul 😊 ${quote.serviceName} ki price ${amount} hai.`,
    `جی بالکل 😊 ${quote.serviceName} کی قیمت ${amount} ہے۔`);
  return appendQuoteAddOns(sentence,quote);
}
function appendQuoteAddOns(sentence,quote={}){
  if(quote.addOns?.length){
    const details=quote.addOns.map(item=>`${item.quantity} × ${currencyAmount(item.rate,quote.currency)} ${item.name}`).join(' plus ');
    sentence+=` This includes ${details}.`;
  }
  return sentence;
}
function quoteLine(quote,semantic={},language='english'){return quoteSentence(quote,semantic,language).replace(/\.$/,'');}
function bookingContinuation(state={}){
  const keys=['preferredDate','preferredTime','startTime','endTime','timeFlexible','timePreference','address','name','phone','email'];
  const out={};
  for(const key of keys)if(state[key]!==undefined&&state[key]!==null)out[key]=state[key];
  return out;
}
function formatPrice(service={}) {
  if(service.priceType==='custom_quote'||service.price==null)return 'Custom quote after scope review';
  const amount=currencyAmount(service.price,service.currency||'PKR');
  if(service.priceType==='hourly')return `${amount} per hour per cleaner`;
  if(service.priceType==='per_item')return `${amount} per ${service.unitLabel||'item'}`;
  if(service.priceType==='scope_based')return `From ${amount}; exact price depends on the configured size/scope`;
  return service.priceType === "starting_from" ? `From ${amount}` : amount;
}
function humanPricingFields(fields=[]){
  const labels={propertyType:'whether it is an apartment or villa/house',bedrooms:'the bedroom count',units:'the seating size or measured size',serviceVariant:'the item size'};
  const values=(fields||[]).map(field=>labels[field]||String(field).replace(/([A-Z])/g,' $1').toLowerCase());
  if(values.length<=1)return values[0]||'the required scope';
  return `${values.slice(0,-1).join(', ')} and ${values.at(-1)}`;
}
function serviceScopeFamily(service={}){
  const name=String(service.name||'').toLowerCase();
  if(/\b(sofa|couch|chair|mattress|carpet|rug|curtain|furniture|upholstery)\b/.test(name))return 'furniture';
  if(/\b(office|commercial|workplace)\b/.test(name))return 'business';
  if(/\blaundry\b/.test(name))return 'laundry';
  if(/\b(ac|duct|pest)\b/.test(name))return 'maintenance';
  return 'property';
}
function serviceRequirementState(service={}){
  const requiredPricingFields=Array.isArray(service.requiredPricingFields)?[...service.requiredPricingFields]:[];
  return {
    requiredPricingFields,
    pricingServiceId:service.pricingServiceId||null,
    pricingFirst:Boolean(service.pricingFirst||service.category==='Furniture cleaning')
  };
}
function bookingRequirementState(service={}){
  const base=serviceRequirementState(service);
  if(['CLN001','CLN008','CLN009','CLN-HOURLY'].includes(service.id)||service.priceType==='hourly'){
    return {...base,requiredPricingFields:['cleanerCount','durationHours'],pricingFirst:true};
  }
  if(['CLN010','CLN011'].includes(service.id))return {...base,requiredPricingFields:['bedrooms'],pricingFirst:true};
  return base;
}
function extractServiceVariant(value){
  const text=normalize(value);
  if(/\bextra[ -]?large\b|\bxl\b/.test(text))return 'extra-large';
  for(const variant of ['king','queen','crib','single','medium','large','small'])if(new RegExp(`\\b${variant}\\b`).test(text))return variant;
  return null;
}
function formatServices(services, language) {
  const visible=(services||[]).filter((s)=>!s.hidden);
  const grouped=new Map();
  for(const service of visible){const category=service.category||'Other services';if(!grouped.has(category))grouped.set(category,[]);grouped.get(category).push(service);}
  const lines=[...grouped.entries()].map(([category,items])=>`${category}:\n${items.map((s)=>`• ${s.name} — ${formatPrice(s)}`).join('\n')}`).join('\n\n');
  if (language === "roman_urdu") return `Ji bilkul 😊 Hamari cleaning services:\n\n${lines}\n\nJo service chahiye uska naam bata dein.`;
  if (language === "urdu") return `جی بالکل 😊 ہماری صفائی کی خدمات:\n\n${lines}\n\nجو سروس چاہیے اس کا نام بتا دیں۔`;
  return `Here are our cleaning services:\n\n${lines}\n\nTell me which service you need.`;
}
function formatServicesWithDuration(services, language, durationHours) {
  const base=formatServices(services,language);
  if(language==='roman_urdu') return `${durationHours} ghantay ki duration note kar li hai 👍\n\n${base}`;
  if(language==='urdu') return `${durationHours} گھنٹے کی مدت نوٹ کر لی ہے 👍\n\n${base}`;
  return `Got it 👍 I’ve noted that you need cleaning for ${durationHours} hours.\n\n${base}`;
}
function serviceReply(service, language, nextPrompt = null) {
  if (language === "roman_urdu") return `${service.name} available hai 😊\n${service.description}\nPrice: ${formatPrice(service)}\n\n${nextPrompt||'Date 24/02/2026 jaisay format mein dein, ya “tomorrow” keh dein.'}`;
  if (language === "urdu") return `${service.name} دستیاب ہے۔\n${service.description}\nقیمت: ${formatPrice(service)}\n\n${nextPrompt||'تاریخ 24/02/2026 کی شکل میں لکھیں، یا “tomorrow” کہیں۔'}`;
  return `${service.name} is available.\n${service.description}\nPrice: ${formatPrice(service)}\n\n${nextPrompt||'What date would you prefer? For example, 24/02/2026, or say “tomorrow”.'}`;
}
function summary(service, state, language) {
  const priceLine=state.quotedService ? `Quoted price: ${currencyAmount(state.quotedService.total,state.quotedService.currency)}` : service?.priceType==="hourly"
    ? (state.durationHours?`${state.cleanerCount||1} cleaner${(state.cleanerCount||1)===1?'':'s'} × ${state.durationHours} hours × ${currencyAmount(state.hourlyRate||service.price||0,state.currency||service.currency||'AED')} = ${currencyAmount(state.total||((state.cleanerCount||1)*state.durationHours*(state.hourlyRate||service.price||0)),state.currency||service.currency||'AED')}`:formatPrice(service))
    : formatPrice(service || { price: 0 });
  const recurrenceLine=state.recurrence?`\nRecurrence: ${recurrenceLabel(state.recurrence)}${state.recurringDays?.length?` (${state.recurringDays.join(', ')})`:''}`:'';
  const requirements=cleaningRequirementLabels(state);
  const hasRequirements=['balconies','interiorWindows','washrooms','halls','insideRefrigerator','insideOven','fragranceFree','petPresent','businessProvidesSupplies','businessProvidesEquipment'].some(key=>state[key]!==undefined&&state[key]!==null&&state[key]!==false);
  const additional=(state.additionalServices||[]).length?`\nAdditional services:\n${state.additionalServices.map((item)=>`• ${item.serviceName}${item.total!=null?` — ${currencyAmount(item.total,item.currency)}`:' — custom quotation required'}`).join('\n')}`:'';
  const base = `${service?.name || "Cleaning service"}\n${priceLine}${additional}${state.durationHours?`\nRequested duration: ${state.durationHours} hour${state.durationHours===1?'':'s'}`:''}${hasRequirements?`\nRequirements: ${requirements.join(', ')}`:''}${recurrenceLine}\nDate: ${state.preferredDate}\nTime: ${displayTime(state)}\nAddress: ${state.address}${state.name?`\nName: ${state.name}`:''}${state.phone?`\nPhone: ${state.phone}`:''}${state.email?`\nEmail (optional): ${state.email}`:''}`;
  return language === "roman_urdu" ? `Cleaning request summary:\n\n${base}\n\nAgar sab theek hai to confirm kar dein.` : `Cleaning request summary:\n\n${base}\n\nIf everything looks correct, please confirm.`;
}
function confirmReply(requests, language, state={}) {
  const list=Array.isArray(requests)?requests:[requests];
  const lines=list.map((request,index)=>{
    const extra=index>0?(state.additionalServices||[])[index-1]:null;
    return `• ${extra?additionalServiceLabel(extra):request.serviceName} — ${request.id}`;
  }).join('\n');
  if(list.length===1){
    const request=list[0];
    const confirmed=request.status==='confirmed';
    if (language === "roman_urdu") return `✅ Aapki cleaning ${confirmed?'booking confirm ho gayi hai':'request receive ho gayi hai'}.\nRequest ID: ${request.id}\n${request.serviceName}\nDate: ${request.preferredDate}\nTime: ${displayTime(request)}${confirmed?'':`\n\nTeam availability verify karke final confirmation degi.`}`;
    return `✅ Your cleaning ${confirmed?'booking is confirmed':'request has been received'}.\nRequest ID: ${request.id}\n${request.serviceName}\nDate: ${request.preferredDate}\nTime: ${displayTime(request)}${confirmed?'':`\n\nThe team will verify availability and send the final confirmation.`}`;
  }
  const first=list[0];
  const confirmed=list.every(request=>request.status==='confirmed');
  if(language==='roman_urdu')return `✅ Aapki ${list.length} cleaning requests ${confirmed?'confirm ho gayi hain':'receive ho gayi hain'}.\n${lines}\nDate: ${first.preferredDate}\nTime: ${first.preferredTime}${confirmed?'':`\n\nTeam har request ki availability verify karke final confirmation degi.`}`;
  return `✅ Your ${list.length} cleaning requests ${confirmed?'are confirmed':'have been received'}.\n${lines}\nDate: ${first.preferredDate}\nTime: ${first.preferredTime}${confirmed?'':`\n\nThe team will verify availability for each request and send the final confirmation.`}`;
}
function formatRequestHistoryLine(request){
  const scope=[request.bedrooms?`${request.bedrooms}-bedroom`:null,request.propertyType].filter(Boolean).join(' ');
  const price=request.total!=null&&request.currency?`\nEstimate: ${currencyAmount(request.total,request.currency)}`:'';
  return `• ${request.serviceName}${scope?` — ${scope}`:''}\nRequest ID: ${request.id}\nStatus: ${request.status||'requested'}${request.revision>1?`\nRevision: ${request.revision}`:''}\nDate: ${request.preferredDate||'Not set'}\nTime: ${displayTime(request)}${request.address?`\nAddress: ${request.address}`:''}${price}`;
}
function displayTime(state={}){return state.timeFlexible||state.timePreference==='any_available'?'Any available team time':state.preferredTime||state.startTime||'Not set';}
function isAnyAvailableTime(value){
  const text=normalize(value);
  const available='(?:available|avaialable|avaiable|availble|avialable)';
  return new RegExp(`\\b(?:any|first|earliest)\\s+(?:${available}\\s+)?(?:time|slot)\\b|\\bwhenever\\s+(?:the\\s+)?(?:team|cleaners?|staff)?\\s*(?:is|are)?\\s*${available}\\b|\\b(?:jis|jo|kisi bhi)\\s+(?:time|waqt)\\b[\\s\\S]{0,30}\\b${available}\\b|\\b(?:team|cleaners?|staff)\\s+(?:(?:jis|jab|jo)\\s+)?(?:time|waqt)?\\s*${available}\\s+ho\\b|\\b${available}\\s+(?:time|slot)\\b`).test(text);
}
async function findEditableRequest(cleaning,preferredId){
  const requests=await cleaning.listRequests();
  const modifiable=requests.filter((request)=>!['completed','cancelled'].includes(request.status));
  if(preferredId){const exact=modifiable.find((request)=>request.id===preferredId);if(exact)return exact;}
  return [...modifiable].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0]||null;
}
function additionalServiceLabel(item={}){
  const property=[item.propertyCount>1?`${item.propertyCount} ×`:null,item.bedrooms?`${item.bedrooms}-bedroom`:null,item.propertyType].filter(Boolean).join(' ');
  return property?`${property} cleaning`:(item.serviceName||'Additional cleaning service');
}

function priceAdditionalService(context,service,semantic={}){
  const quote=context.services.pricing.quote({...semantic,serviceName:service.name,requestedOperationalServiceId:service.id,text:service.name});
  const propertyCount=Number(semantic.propertyCount||quote.propertyCount||1);
  const quoted=quote.ok&&quote.operationalServiceId===service.id;
  const hourlyTotal=service.priceType==='hourly'&&semantic.durationHours
    ? Number(semantic.durationHours)*Number(semantic.cleanerCount||1)*Number(service.price||0)*propertyCount
    : null;
  const total=quoted?quote.total:hourlyTotal!=null?hourlyTotal:(service.priceType!=='custom_quote'&&service.priceType!=='hourly'&&service.price!=null?Number(service.price):null);
  const currency=quoted?quote.currency:(service.currency||context.services.pricing.getConfig()?.currency||'AED');
  return {
    key:[service.id,semantic.propertyType||'',semantic.bedrooms||'',semantic.units||'',propertyCount].join('|'),
    serviceId:service.id,serviceName:service.name,propertyType:semantic.propertyType||null,
    propertyCount,bedrooms:semantic.bedrooms||null,units:semantic.units||null,total,currency,
    formula:quoted?quote.formula:hourlyTotal!=null?`${semantic.cleanerCount||1} × ${semantic.durationHours} hours × ${currencyAmount(service.price,currency)}`:null,quotedService:quoted?quote:null,
    pricingStatus:quoted?'quoted':total!=null?'catalog_estimate':'custom_quote',
    priceIsStartingFrom:service.priceType==='starting_from'
  };
}
function combinedServiceTotal(services,state={}){
  const primary=services.find((service)=>service.id===state.serviceId);
  let primaryTotal=state.total??state.quotedService?.total;
  if(primaryTotal==null&&primary?.priceType==='hourly'&&state.durationHours)primaryTotal=Number(state.cleanerCount||1)*Number(state.durationHours)*Number(state.hourlyRate||primary.price||0);
  if(primaryTotal==null&&primary?.priceType!=='custom_quote'&&primary?.price!=null)primaryTotal=Number(primary.price);
  const priced=[...(primaryTotal!=null?[{total:Number(primaryTotal),currency:state.currency||state.quotedService?.currency||primary?.currency}]:[]),...(state.additionalServices||[]).filter((item)=>item.total!=null)];
  const currencies=[...new Set(priced.map((item)=>item.currency).filter(Boolean))];
  const hasCustomQuote=(primary?.priceType==='custom_quote'&&primaryTotal==null)||(state.additionalServices||[]).some((item)=>item.total==null);
  return {total:currencies.length<=1&&priced.length?priced.reduce((sum,item)=>sum+Number(item.total||0),0):null,currency:currencies[0]||primary?.currency||null,hasCustomQuote};
}

function recurrenceLabel(r){if(!r)return 'recurring';if(r.frequency==='weekly'&&r.occurrencesPerWeek>1)return `${r.occurrencesPerWeek} times per week`;if(r.frequency==='weekly')return 'weekly';if(r.frequency==='biweekly')return 'every two weeks';if(r.frequency==='monthly')return 'monthly';if(r.frequency==='daily')return 'daily';return 'recurring';}
function parseDays(raw){const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];const t=String(raw||'').toLowerCase();return days.filter(d=>new RegExp(`\\b${d}\\b`).test(t));}

function parseDateInput(raw){
 const v=String(raw||'').trim().toLowerCase();
 if(/^(today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(v))return v;
 let natural=v.match(/^(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?$/i);
 if(natural){const months=['january','february','march','april','may','june','july','august','september','october','november','december'];const d=+natural[1],mo=months.indexOf(natural[2].toLowerCase())+1,y=+(natural[3]||new Date().getFullYear());if(validDate(y,mo,d))return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;}
 let m=v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
 if(m){const d=+m[1],mo=+m[2],y=+m[3];if(validDate(y,mo,d))return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;}
 m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
 if(m){const y=+m[1],mo=+m[2],d=+m[3];if(validDate(y,mo,d))return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;}
 return null;
}
function validDate(y,m,d){if(y<2000||m<1||m>12||d<1||d>31)return false;const x=new Date(Date.UTC(y,m-1,d));return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d;}
function parseTimeInput(raw){
 const v=String(raw||'').trim().toLowerCase();
 let m=v.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
 if(m){const h=+m[1],min=+(m[2]||0);if(h>=1&&h<=12&&min<=59)return `${h}${m[2]?':'+String(min).padStart(2,'0'):''} ${m[3]}`;}
 m=v.match(/^(\d{1,2}):(\d{2})$/);
 if(m&&+m[1]<=23&&+m[2]<=59)return `${String(+m[1]).padStart(2,'0')}:${m[2]}`;
 return null;
}

module.exports = { Capability: CleaningCapability, CleaningCapability };
