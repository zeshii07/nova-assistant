const { normalizeText, numberFromText, normalizeWeekdayTypos, closestKeywordToken } = require('../../../packages/conversation-intelligence/src/text');
const { extractServiceConstraints } = require('../../../packages/conversation-intelligence/src/serviceConstraintExtractor');
const { TemporalSemanticExtractor, parseClock } = require('../../../packages/conversation-intelligence/src/temporalSemanticExtractor');
const { extractQueryFacets } = require('../../../packages/conversation-intelligence/src/queryFacetExtractor');
const { extractFieldAmendment } = require('../../../packages/conversation-intelligence/src/fieldAmendmentExtractor');
const { hasAcquisitionCue } = require('../../../packages/conversation-intelligence/src/acquisitionIntent');
const temporalExtractor=new TemporalSemanticExtractor();
class CleaningConversationAdapter {
  constructor(){this.capabilityId='cleaning';this.priority=85;}
  async analyze({ tenant, message, state, services, normalizedText, correction, interruption, clauseSemantics, temporal, messageFrame }) {
    const primaryText=clauseSemantics?.primaryText||message.text;
    normalizedText=normalizeWeekdayTypos(primaryText);
    const step=state.capabilityState?.cleaning?.step; const candidates=[]; let entities={}; const matches=[];
    const previous=state.capabilityState?.cleaning||{};
    const timeEntities={...extractTimeEntities(primaryText,temporal),...extractCleaningContext(message.text)};
    let pricingRequested=/\b(charge|charges|price|pricing|cost|rate|rates|quote|quotation|estimate|how much|kitna|kitni|kitne|kitny|kitnay|charges kya|charges kia)\b|(?:قیمت|چارجز|کتنے)/.test(normalizedText);
    const explicitBookingAction=/\b(book|schedule|reserve|arrange|place (?:a )?request|start (?:a )?(?:booking|request)|confirm (?:the )?(?:booking|service))\b/.test(normalizedText);
    const explicitTransactionLanguage=/\b(i want|i need|book|schedule|arrange|add|change|switch|replace|start (?:a )?(?:booking|request))\b/.test(normalizedText);
    const priceFollowUp=Boolean(previous.priceEnquiry?.serviceId)&&!explicitBookingAction&&!explicitTransactionLanguage&&(
      /\b(?:and|also|ok|okay)?\s*(?:what|how)\s+(?:about|for)\b/.test(normalizedText)
      || /\b(?:studio|apartment|flat|villa|bedrooms?|bhk|sofa|seater|curtains?|mattress|carpet|small|medium|large|king|queen|single)\b/.test(normalizedText)
    );
    if(priceFollowUp)pricingRequested=true;
    const constraints=extractServiceConstraints(primaryText);
    const policyFacets=extractQueryFacets(message.text).filter(x=>['cancellation','rescheduling','arrival','confirmation','safety','fragrance_free','pets'].includes(x));
    const discountRequested=/\b(discounts?|special offer|best price|price can you offer|what price can you offer|reduce|cheaper|kam kar|riayat|رعایت)\b/.test(normalizedText);
    const frameBooking=(messageFrame?.intents||[]).some(item=>item.intent==='booking.create');
    const structuredRequest=hasAcquisitionCue(normalizedText)||frameBooking
      || /\b(clean my|cleaned|cleaning chahiye|karwani hai|krani hai|karani hai|saaf krana|saaf karana|saaf karwana|can you do[\s\S]{0,50}(?:cleaning|clening|clenening|cleening|clning))\b/.test(normalizedText);
    // A pure price question is informational even when it includes workforce
    // and duration. Only explicit acquisition language may open a booking.
    if(pricingRequested&&!structuredRequest&&!explicitBookingAction)timeEntities.quoteOnly=true;
    const customQuoteWords=/\b(custom quote|custom quotation|custom estimate)\b/.test(normalizedText);

    // A quotation is durable conversation context, but it is not a booking.
    // When the customer explicitly accepts the last quote, route that exact
    // priced scope back into the deterministic booking workflow. Prefer the
    // latest interrupt quote over an older quote attached to the draft.
    const quoteAcceptance=/\b(?:add this service|book this|book it|book (?:these|both) services|book this (?:quote|quotation)|make (?:a )?booking for this (?:quote|quotation|service)|confirm this service|confirm (?:my|the) booking for this service|i want this service|go ahead|proceed)\b/.test(normalizedText);
    const latestQuotedService=previous.priceEnquiry?.quote||previous.quotedService||null;
    if(quoteAcceptance&&Array.isArray(previous.quotedServices)&&previous.quotedServices.length>1){
      entities={quotedServices:previous.quotedServices,quotedServiceRequirements:previous.quotedServiceRequirements||{},preserveWorkflow:Boolean(step)};
      candidates.push({intent:'cleaning.quote_bundle_accept',confidence:1,priority:195,entities,reason:'quoted_service_bundle_accept'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'quoted_service_bundle',score:1}]};
    }
    if(quoteAcceptance&&latestQuotedService&&(!step||latestQuotedService.operationalServiceId!==previous.serviceId||!/\bconfirm\b/.test(normalizedText))){
      entities={
        quotedService:latestQuotedService,
        quotedServiceRequirements:previous.priceEnquiry?.quote===latestQuotedService
          ? requestScope(previous.priceEnquiry)
          : previous.quotedServiceRequirements||{},
        addToExisting:/\badd this service\b/.test(normalizedText),
        preserveWorkflow:Boolean(step)
      };
      candidates.push({intent:'cleaning.quote_accept',confidence:1,priority:195,entities,reason:'quoted_service_accept'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'quoted_service',score:1}]};
    }

    // A generic apartment/villa request is not enough to choose the pricing
    // model. Keep every supplied field, ask Standard Cleaning vs Deep
    // Cleaning, and let the chosen model determine its required scope.
    const pendingBookingType=previous.pendingBookingType;
    const resolvedCleaningType=resolveCleaningType(normalizedText);
    if(pendingBookingType&&resolvedCleaningType){
      const deep=resolvedCleaningType==='deep';
      entities={...pendingBookingType.scope,...timeEntities,selectedCleaningType:deep?'deep':'standard'};
      candidates.push({intent:'cleaning.booking_type_selected',confidence:1,priority:198,entities,reason:'property_cleaning_booking_type_selected'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:deep?'deep_cleaning':'standard_cleaning',score:1}]};
    }
    if(pendingBookingType&&step==='cleaningType'&&!interruption){
      entities={...pendingBookingType.scope,...timeEntities,pendingCleaningType:true};
      candidates.push({intent:'cleaning.booking_type_clarification',confidence:1,priority:198,entities,reason:'property_cleaning_booking_type_still_missing'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_type_required',score:1}]};
    }

    // A customer can answer a quote-only cleaning-type clarification with a
    // short phrase such as "deep cleaning". Resume the pricing comparison,
    // not a booking workflow.
    const pendingPriceClarification=previous.pendingPriceClarification;
    if(pendingPriceClarification?.selectedCleaningType==='standard'&&timeEntities.durationHours&&timeEntities.cleanerCount){
      const propertyServiceId=pendingPriceClarification.propertyType==='villa'?'CLN009':'CLN008';
      entities={...pendingPriceClarification.scope,...timeEntities,propertyServiceId,otherServiceItems:pendingPriceClarification.otherServiceItems||[],pricingRequested:true};
      candidates.push({intent:'cleaning.standard_multi_service_quote',confidence:1,priority:190,entities,reason:'standard_cleaning_workforce_price_complete'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'standard_cleaning_total',score:1}]};
    }
    if(pendingPriceClarification&&resolvedCleaningType){
      const deep=resolvedCleaningType==='deep';
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const allServices=await scoped?.listServices?.()||[];
      const chosenId=deep
        ? pendingPriceClarification.propertyType==='villa'?'CLN011':'CLN010'
        : pendingPriceClarification.propertyType==='villa'?'CLN009':'CLN008';
      const chosen=allServices.find(service=>service.id===chosenId);
      const serviceItems=[...(chosen?[{serviceId:chosen.id,serviceName:chosen.name,score:110}]:[]),...(pendingPriceClarification.otherServiceItems||[])];
      entities={...pendingPriceClarification.scope,...timeEntities,serviceItems,selectedCleaningType:deep?'deep':'standard',pricingRequested:true};
      const intent=deep
        ? 'cleaning.multi_service_quote_request'
        : timeEntities.durationHours&&timeEntities.cleanerCount?'cleaning.standard_multi_service_quote':'cleaning.standard_price_details';
      if(!deep){entities.propertyServiceId=chosenId;entities.otherServiceItems=pendingPriceClarification.otherServiceItems||[];}
      candidates.push({intent,confidence:1,priority:190,entities,reason:'cleaning_type_price_clarified'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:serviceItems.map(item=>({type:'service',value:item.serviceName,canonical:item.serviceId,score:1}))};
    }
    const customQuoteAccept=(previous.customQuotePending && /^(?:yes|yeah|yep|ok|okay|sure)(?:[ ,]+please)?(?:[ ,]+(?:arrange it|proceed|do it|go ahead))?[.! ]*$|^(?:arrange it|please (?:arrange it|arrange|proceed|do it)|proceed|go ahead|bilkul|haan|han)[.! ]*$/.test(normalizedText)) || customQuoteWords;
    if(customQuoteAccept){
      const m=normalizedText.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/);
      entities={customQuote:true,propertyType:/\bvilla\b/.test(normalizedText)?'villa':/\b(apartment|flat|studio)\b/.test(normalizedText)?'apartment':previous.customQuotePending?.propertyType||null,bedrooms:m?Number(m[1]):previous.customQuotePending?.bedrooms||null};
      candidates.push({intent:'cleaning.custom_quote_request',confidence:1,entities,reason:'custom_quote_requested'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'custom_quote',score:1}]};
    }

    const requestHistory=/\b(?:show|view|tell|give|list|what(?:'s| is))\b[\s\S]{0,30}\bmy\b[\s\S]{0,30}\b(?:cleaning|service|services|request|requests|booking|bookings)\b[\s\S]{0,25}\b(?:details?|history|status)?\b/.test(normalizedText)
      || /\bmy\s+(?:cleaning\s+)?(?:request|booking)\s+(?:details?|status)\b/.test(normalizedText);
    if(requestHistory){
      entities={customerRequestHistory:true};
      candidates.push({intent:'cleaning.request_history',confidence:1,priority:180,entities,reason:'customer_cleaning_request_history'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'customer_history',value:'cleaning_requests',score:1}]};
    }

    // Profile lookup is a read-only CRM interruption. Do not compete with it
    // using a generic pending name/phone/address candidate.
    if(step&&/\b(?:show|view|tell|give)\b[\s\S]{0,20}\b(?:my )?(?:profile|customer profile|details)\b|\b(?:my profile|customer profile)\b/.test(normalizedText)){
      return {priority:this.priority,candidates:[],entities:{preserveWorkflow:true},vocabularyMatches:[{type:'interruption',value:'crm_profile',score:1}]};
    }

    const pendingFieldEdit=previous.pendingFieldEdit||null;
    // The normal name step can collect a name and optional email together.
    // Treat a declared name as an amendment only while another field is
    // pending, where it is a genuine interruption rather than that answer.
    const declaredName=step&&step!=='name'?services.engagementService?.parseDeclaredName?.(message.text):null;
    const explicitFieldAmendment=extractFieldAmendment(message.text,{allowedFields:['name','phone','email','address']})
      ||(declaredName?.valid?{field:'name',rawValue:declaredName.value,action:'replace',explicit:true}:null);
    const fieldAmendment=explicitFieldAmendment||(pendingFieldEdit
      ? {field:pendingFieldEdit.field,rawValue:message.text,action:'replace',explicit:true}
      : null);
    if(fieldAmendment&&(step||previous.lastRequestId||pendingFieldEdit)){
      entities={fieldAmendment,requestId:extractCleaningRequestId(message.text)||pendingFieldEdit?.requestId||previous.lastRequestId||null,preserveWorkflow:true};
      candidates.push({intent:'cleaning.customer_field_edit',confidence:1,priority:215,entities,reason:pendingFieldEdit?'pending_cleaning_field_edit_value':'explicit_cleaning_field_edit'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'customer_field_edit',value:fieldAmendment.field,score:1}]};
    }

    const referencedCustomerField=step
      ? ['name','phone','email','address'].find(field=>field!==step&&services.engagementService?.referencesStoredField?.(field,message.text))
      : null;
    if(referencedCustomerField){
      entities={field:referencedCustomerField,preserveWorkflow:true};
      candidates.push({intent:'cleaning.saved_field_reference',confidence:1,priority:216,entities,reason:'saved_customer_field_interrupt'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'saved_customer_field',value:referencedCustomerField,score:1}]};
    }

    // Submitted-request amendments have their own durable follow-up steps.
    // Route a bare follow-up value ("27" or "same 2 pm") back to the
    // submitted request instead of treating it as input for a new booking.
    if(step==='submitted_reschedule_date'||step==='submitted_reschedule_time'){
      const scheduleEditField=step==='submitted_reschedule_date'?'date':'time';
      entities={
        ...timeEntities,
        requestId:extractCleaningRequestId(message.text)||previous.editingRequestId||previous.lastRequestId||null,
        scheduleEditField,
        preserveWorkflow:true
      };
      const dateDay=extractExplicitDateDay(primaryText,{allowBare:scheduleEditField==='date'});
      if(dateDay)entities.dateDay=dateDay;
      candidates.push({intent:'cleaning.submitted_schedule_edit',confidence:1,priority:220,entities,reason:`pending_cleaning_submitted_reschedule_${scheduleEditField}`});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow_field',value:`submitted_reschedule_${scheduleEditField}`,score:1}]};
    }

    const dateChoices=extractWeekdayOptions(primaryText);
    if(step==='date'&&dateChoices.length>1){
      entities={dateOptions:dateChoices,startTime:timeEntities.startTime||null,time:timeEntities.time||null,preserveWorkflow:true};
      candidates.push({intent:'cleaning.date_choice_clarification',confidence:1,priority:220,entities,reason:'multiple_cleaning_date_choices'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:dateChoices.map(value=>({type:'date_option',value,score:1}))};
    }

    if(step==='date'&&(timeEntities.date||timeEntities.dateText||timeEntities.weekday)){
      entities={pendingField:'date',...timeEntities,preserveWorkflow:true};
      candidates.push({intent:'cleaning.workflow_input',confidence:1,priority:210,entities,reason:'active_cleaning_date_value'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow_field',value:'date',score:1}]};
    }

    if(step&&/\b(?:for )?how (?:much|many|long) (?:time|hours?)\b[\s\S]{0,30}\b(?:cleaner|cleaning|service|work)|\bhow long\b[\s\S]{0,25}\b(?:cleaner|cleaning|service|work)|\b(?:cleaner|cleaning)\b[\s\S]{0,25}\b(?:duration|take|work for)\b/.test(normalizedText)){
      entities={preserveWorkflow:true};
      candidates.push({intent:'cleaning.duration_info',confidence:1,priority:218,entities,reason:'cleaning_duration_information_interrupt'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'information',value:'cleaning_duration',score:1}]};
    }

    // The active field owns a clear answer.  This route is intentionally more
    // specific than generic workflow input so catalog/availability adapters or
    // remote NLU cannot reinterpret "OK 10 AM" as another command.
    const explicitScheduleEdit=/\b(?:reschedule|change|move|shift|replace|instead)\b[\s\S]{0,35}\b(?:time|hours?|date|day|start)\b|\b(?:better to|please)\s+start\s+at\b/.test(normalizedText);
    if(step==='time'&&timeEntities.startTime&&!explicitScheduleEdit){
      entities={pendingField:'time',...timeEntities,preserveWorkflow:true};
      candidates.push({intent:'cleaning.workflow_input',confidence:1,priority:205,entities,reason:'active_cleaning_time_value'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow_field',value:'time',score:1}]};
    }
    const expectedScalarPresent=(step==='cleanerCount'&&Boolean(timeEntities.cleanerCount||scalarPendingNumber(normalizedText)))
      ||(step==='duration'&&Boolean(timeEntities.durationHours||scalarPendingNumber(normalizedText)))
      ||(step==='bedrooms'&&Boolean(timeEntities.bedrooms??scalarPendingNumber(normalizedText)))
      ||(step==='units'&&Boolean(timeEntities.units??scalarPendingNumber(normalizedText)));
    if(step&&!['date','time','reschedule_time','address','name','phone','confirm'].includes(step)
      &&(timeEntities.date||timeEntities.dateText||timeEntities.weekday||timeEntities.startTime||timeEntities.timeFlexible)
      &&!expectedScalarPresent){
      entities={...timeEntities,preserveWorkflow:true};
      candidates.push({intent:'cleaning.schedule_edit',confidence:1,priority:204,entities,reason:'schedule_supplied_before_pending_scope'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow_field',value:'schedule',score:1}]};
    }

    const scheduleEdit=Boolean(previous.step||previous.serviceId) && (
      previous.step==='reschedule_time'
      || (correction?.type==='replace'&&correction.target==='startTime')
      || /\b(reschedule|change|move|shift)\b.*\b(time|hours?|date|day|start)\b/.test(normalizedText)
      || /\b(?:better to|please)\s+start\s+at\b/.test(normalizedText)
    );
    if(scheduleEdit){
      entities={...timeEntities,preserveWorkflow:true};
      if(correction?.type==='replace'&&correction.target==='startTime'&&correction.value){
        entities.startTime=correction.value;
        entities.time=correction.value;
        entities.correction=correction;
        delete entities.endTime;
        delete entities.durationHours;
      }
      // An explicit edit to the active transaction must outrank an accidental
      // knowledge hit such as business hours containing the same clock text.
      candidates.push({intent:'cleaning.schedule_edit',confidence:1,priority:180,entities,reason:'active_cleaning_schedule_edit'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_schedule_edit',score:1}]};
    }

    if(previous.step==='cancelSelection'){
      const requestId=extractCleaningRequestId(message.text);
      const choices=Array.isArray(previous.cancelChoices)?previous.cancelChoices:[];
      if(requestId&&choices.some(request=>request.id===requestId)){
        entities={requestId};
        candidates.push({intent:'cleaning.submitted_cancel_request',confidence:1,priority:200,entities,reason:'cleaning_cancel_selection'});
      }else{
        entities={requests:choices};
        candidates.push({intent:'cleaning.cancel_selection_required',confidence:1,priority:200,entities,reason:'cleaning_cancel_selection_invalid'});
      }
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_cancel_selection',score:1}]};
    }

    const submittedCancellation=!previous.step&&!/\b(?:don t|do not|won t|will not)\b[\s\S]{0,20}\bcancel\b/.test(normalizedText)&&!/\b(?:can i|could i|may i|how (?:can|do) i|if i cancel)\b|\bcancel(?:lation)?\b[\s\S]{0,30}\b(?:policy|fee|charge|possible|allowed)\b|\b(?:fee|charge)\b[\s\S]{0,30}\bcancel/.test(normalizedText)&&(
      /\b(?:cancel|stop)\b[\s\S]{0,45}\b(?:cleaning|request|booking|appointment|service)\b/.test(normalizedText)
      || /\b(?:cleaning|request|booking|appointment|service)\b[\s\S]{0,45}\b(?:cancel|stop|cancel kar)\b/.test(normalizedText)
      || Boolean(previous.lastRequestId)&&/\bcancel (?:it|this|that)\b/.test(normalizedText)
    );
    if(submittedCancellation){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const stored=scoped?await scoped.listRequests():[];
      const active=[...stored].filter(request=>!['completed','cancelled'].includes(request.status)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
      const requestedId=extractCleaningRequestId(message.text);
      const exact=requestedId?active.find(request=>request.id===requestedId):null;
      if(exact||active.length===1){
        entities={requestId:(exact||active[0]).id};
        candidates.push({intent:'cleaning.submitted_cancel_request',confidence:1,priority:195,entities,reason:'submitted_cleaning_cancel_request'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'submitted_cleaning_cancel_request',score:1}]};
      }
      if(active.length>1){
        entities={requests:active.map(request=>({id:request.id,serviceName:request.serviceName,date:request.preferredDate,time:request.preferredTime,status:request.status}))};
        candidates.push({intent:'cleaning.cancel_selection_required',confidence:1,priority:195,entities,reason:'multiple_cleaning_requests_to_cancel'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_cancel_selection_required',score:1}]};
      }
      entities={requestId:requestedId||null};
      candidates.push({intent:'cleaning.cancel_none',confidence:1,priority:195,entities,reason:'no_cleaning_request_to_cancel'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'no_cleaning_request_to_cancel',score:1}]};
    }

    // A submitted request is durable even though the interactive collection
    // state has gone idle. Explicit amendment language must therefore return
    // to Cleaning instead of falling through to business-hours/availability.
    const submittedEditVerb=/\b(?:change|reschedule|move|shift|update|edit)\b/.test(normalizedText);
    const submittedScheduleSubject=/\b(?:my\s+)?(?:cleaning\s+)?(?:request|service|booking|appointment)\b|\b(?:starting|start|service)\s+(?:date|day|time|hours?)\b|\bbooked\s+(?:for|at|on)\b/.test(normalizedText);
    let submittedRequestAvailable=Boolean(previous.lastRequestId);
    if(!previous.step&&submittedEditVerb&&submittedScheduleSubject&&!submittedRequestAvailable){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const stored=scoped?await scoped.listRequests():[];
      submittedRequestAvailable=stored.some(request=>!['completed','cancelled'].includes(request.status));
    }
    if(!previous.step && submittedRequestAvailable && submittedEditVerb && submittedScheduleSubject && (
      correction?.target==='startTime' || timeEntities.startTime || timeEntities.time || timeEntities.date || timeEntities.dateText || timeEntities.weekday || /\b(?:date|day|time|hours?|start)\b/.test(normalizedText)
    )){
      const mentionsDate=/\b(?:date|day)\b/.test(normalizedText);
      const mentionsTime=/\b(?:time|hours?|start|starting)\b/.test(normalizedText);
      entities={
        ...timeEntities,
        requestId:extractCleaningRequestId(message.text)||previous.lastRequestId||null,
        scheduleEditField:mentionsDate&&!mentionsTime?'date':mentionsTime&&!mentionsDate?'time':'schedule'
      };
      const dateDay=extractExplicitDateDay(primaryText);
      if(dateDay)entities.dateDay=dateDay;
      if(correction?.type==='replace'&&correction.target==='startTime'&&correction.value){
        entities.startTime=correction.value;entities.time=correction.value;entities.correction=correction;
        delete entities.endTime;delete entities.durationHours;
      }
      candidates.push({intent:'cleaning.submitted_schedule_edit',confidence:1,priority:190,entities,reason:'submitted_cleaning_schedule_edit'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'submitted_cleaning_schedule_edit',score:1}]};
    }

    const submittedServiceEdit=/\b(?:change|switch|replace|update|edit)\b[\s\S]{0,50}\b(?:to|service|request|booking|cleaning)\b/.test(normalizedText);
    if(!previous.step && submittedServiceEdit && /\b(?:deep\s*(?:home\s*)?clean(?:ing)?|standard\s*(?:home\s*)?clean(?:ing)?|sofa\s*clean(?:ing)?|carpet\s*clean(?:ing)?|office\s*clean(?:ing)?|move[ -]?(?:in|out)\s*clean(?:ing)?|hourly\s*cleaner)\b/.test(normalizedText)){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      if(!submittedRequestAvailable){const stored=scoped?await scoped.listRequests():[];submittedRequestAvailable=stored.some(request=>!['completed','cancelled'].includes(request.status));}
      if(!submittedRequestAvailable){/* A fresh service request continues below. */}
      else {
      const targetText=cleaningServiceSubjectText(primaryText);
      const changed=scoped?await scoped.findService(targetText):null;
      if(changed?.service){
        entities={serviceId:changed.service.id,serviceName:changed.service.name,requestId:previous.lastRequestId||null};
        candidates.push({intent:'cleaning.submitted_service_change',confidence:1,priority:190,entities,reason:'submitted_cleaning_service_change'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'submitted_cleaning_service_change',score:1}]};
      }
      }
    }

    const submittedRequirementKeys=['balconies','interiorWindows','insideRefrigerator','insideOven','washrooms','halls','requestedTasks','requiredEquipment','businessProvidesSupplies','businessProvidesEquipment','fragranceFree','petPresent','heavyPetHair'];
    if(!previous.step&&previous.lastRequestId&&/\b(?:add|include|remove|delete|change|update)\b/.test(normalizedText)&&submittedRequirementKeys.some(key=>timeEntities[key]!==undefined)){
      entities={...timeEntities,requestId:previous.lastRequestId};
      if(/\b(?:remove|delete)\b[\s\S]{0,30}\bbalcon/.test(normalizedText))entities.balconies=0;
      if(/\b(?:remove|delete)\b[\s\S]{0,30}\bwindows?/.test(normalizedText))entities.interiorWindows=0;
      candidates.push({intent:'cleaning.submitted_requirements_edit',confidence:1,priority:189,entities,reason:'submitted_cleaning_requirements_edit'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'submitted_cleaning_requirements_edit',score:1}]};
    }

    // Multi-service composition is valid at every collection step, not only on
    // the final review. "Sofa cleaning also" adds a line; it must not replace
    // an active office-cleaning request. The tenant repository supplies all
    // explicit matches, so this is not tied to a fixed list of service names.
    const explicitAdditiveServiceLanguage=/\b(add|also|both|include|plus|along with|as well as|another|second)\b/.test(normalizedText);
    const serviceHeads=[...normalizedText.matchAll(/\b(office|sofa|couch|carpet|mattress|chair|curtain|laundry|ac|duct|pest|disinfection|apartment|villa|commercial)\b/g)].map((match)=>match[1]);
    const dominantCompositeService=/\b(post renovation|post construction|move in|move out)\b/.test(normalizedText);
    const conjoinedDistinctServices=!dominantCompositeService&&/\band\b/.test(normalizedText)&&new Set(serviceHeads).size>1;
    const additiveServiceLanguage=explicitAdditiveServiceLanguage||conjoinedDistinctServices;
    if(step&&additiveServiceLanguage&&!pricingRequested){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const found=scoped?.findServices?await scoped.findServices(primaryText,{minScore:60}):[];
      const serviceItems=found.map(({service,score})=>({serviceId:service.id,serviceName:service.name,score}));
      if(serviceItems.some((item)=>item.serviceId!==previous.serviceId)){
        entities={...timeEntities,serviceItems,preserveWorkflow:true,pendingField:step};
        candidates.push({intent:'cleaning.additional_service_add',confidence:1,priority:185,entities,reason:'active_cleaning_additive_services'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:serviceItems.map((item)=>({type:'service',value:item.serviceName,canonical:item.serviceId,score:item.score/100}))};
      }
    }

    // Recurrence is a booking constraint, not a service name.
    if(constraints.recurrence){
      const action=/\b(book|booking|i want|i need|can i book|schedule|cleaner|maid|service|services)\b/.test(normalizedText);
      const quote=/\b(price|pricing|cost|charge|charges|rate|quote|quotation|estimate|how much|kitna|kitni|kitne)\b/.test(normalizedText);
      if(action||quote){
        const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
        const found=scoped?await scoped.findService(primaryText):null;
        const genericCleaner=/\b(cleaners?|maids?)\b/.test(normalizedText);
        entities={recurrence:constraints.recurrence,...timeEntities};
        const genericRecurrenceOnly=/\b(recurring|monthly|weekly|every (?:week|month))\b/.test(normalizedText)
          && !/\b(maid|cleaner|housekeeping|home|house|apartment|villa|office|sofa|carpet|deep|move[ -]?(?:in|out))\b/.test(normalizedText);
        if(found?.service && !found.service.hidden && (found.score||0)>20 && !genericRecurrenceOnly){entities.serviceId=found.service.id;entities.serviceName=found.service.name;}
        else if(genericCleaner){entities.serviceId='CLN-HOURLY';entities.serviceName='Hourly Cleaner Hire';entities.cleanerCount=entities.cleanerCount||1;}
        candidates.push({intent:quote?'cleaning.recurring_quote':'cleaning.recurring_request',confidence:1,entities,reason:quote?'recurring_cleaning_quote':'recurring_cleaning_booking'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'constraint',value:'recurrence',score:1}]};
      }
    }

    // A generic discount question belongs to configured pricing, even when no
    // individual cleaning service has been selected yet.
    if(discountRequested && !structuredRequest && !/\b(apartment|villa|flat|house|home cleaning|deep cleaning|sofa|couch|chair|cleaner|maid|hourly)\b/.test(normalizedText)){
      candidates.push({intent:'cleaning.discount_info',confidence:1,entities:{text:normalizedText},reason:'cleaning_discount_policy'});
      return {priority:this.priority,candidates,entities:{text:normalizedText},vocabularyMatches:[{type:'pricing',value:'discount',score:1}]};
    }
    if(previous.priceEnquiry?.serviceId&&(interruption?.type==='price_comment'||/\b(?:too high|too expensive|expensive|costly|mehnga|mehngi|mehngy|bohat zyada)\b/.test(normalizedText))){
      entities={serviceId:previous.priceEnquiry.serviceId,serviceName:previous.priceEnquiry.serviceName||null,preserveWorkflow:true};
      candidates.push({intent:'cleaning.price_comment',confidence:1,priority:165,entities,reason:'cleaning_price_concern'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'price_concern',score:1}]};
    }

    const emailOnly=String(message.text||'').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if(step&&step!=='name'&&emailOnly&&!/\+?\d[\d ()-]{8,}\d/.test(message.text)){
      entities={email:emailOnly[0].toLowerCase(),pendingField:step,preserveWorkflow:true};
      candidates.push({intent:'cleaning.optional_email_update',confidence:1,priority:175,entities,reason:'optional_email_during_cleaning_workflow'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'customer_field',value:'email',score:1}]};
    }

    if(step&&step!=='confirm'&&/\b(?:confirm|finalize|submit)\b/.test(normalizedText)){
      entities={pendingField:step,preserveWorkflow:true};
      candidates.push({intent:'cleaning.incomplete_confirmation',confidence:1,priority:188,entities,reason:'cleaning_confirmation_missing_required_fields'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'incomplete_confirmation',score:1}]};
    }

    const propertyContext=tenant.capabilities?.includes('cleaning') && (/\b(apartment|flat|studio|villa|vila|vill|house|home|bedroom|bedrooms|bhk|office)\b/.test(normalizedText)
      || Boolean(closestKeywordToken(normalizedText,['apartment','villa'],{maxDistance:2,minLength:4})));
    const cleaningDomain=/\b(clean|cleaned|cleaning|cleaners?|clenr|clnr|maids?|safai|sofas?|couches?|curtains?|drapes?|mattresses?|carpets?|rugs?|upholstery)\b/.test(normalizedText)
      || /صفائی|صاف/.test(normalizedText)
      ||Boolean(closestKeywordToken(normalizedText,['cleaning','cleaner','cleaned'],{maxDistance:2,minLength:5}))
      || (propertyContext && /\b(quote|quotation|estimate|what about|how about|price|cost|clean)\b/.test(normalizedText));
    const structuredQuote=priceFollowUp || discountRequested || /\b(quote|quotation|estimate|price|cost|charges?|how much|kitna|kitne|kitni|kitny|kitnay)\b|(?:قیمت|چارجز|کتنے)/.test(normalizedText);
    const propertyServiceQuestion=!step&&!structuredRequest&&!structuredQuote&&!resolveCleaningType(normalizedText)&&propertyContext&&cleaningDomain
      && /\b(?:do you|can you|could you|would you|is there|have you got)\b[\s\S]{0,45}\b(?:provide|offer|do|have|clean|cleaning|service|available)\b/.test(normalizedText);
    if(propertyServiceQuestion){
      const propertyType=/\b(?:villa|vila|vill|house|home)\b/.test(normalizedText)||closestKeywordToken(normalizedText,['villa'],{maxDistance:2,minLength:4})?'villa':'apartment';
      entities={...timeEntities,propertyType,pendingCleaningType:true,serviceAvailabilityQuestion:true};
      candidates.push({intent:'cleaning.booking_type_clarification',confidence:1,priority:198,entities,reason:'property_cleaning_availability_question'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'service_availability',value:`${propertyType}_cleaning`,score:1}]};
    }
    const propertyAlternative=propertyContext && (
      /\b(what about|how about|what for|and what for|instead|other)\b/.test(normalizedText)
      || /\band (?:a|the)\s+(?:(?:\d+|one|two|three|four|five)\s*(?:bedrooms?|bed|bhk)\s+)?(?:apartment|flat|studio|villa|vila|house|home|office)\b/.test(normalizedText)
    );

    // Requirements supplied during an active request are workflow updates,
    // not FAQ questions and not values for the pending customer-detail field.
    const requirementKeys=['balconies','interiorWindows','insideRefrigerator','insideOven','washrooms','halls','requestedTasks','requiredEquipment','businessProvidesSupplies','businessProvidesEquipment','fragranceFree','petPresent','heavyPetHair'];
    const wholeHomeDeepCorrection=/\b(?:bathroom|washroom|toilet)\b[\s\S]{0,30}\b(?:not|nahi|nahin|nhn)\b[\s\S]{0,45}\b(?:whole|entire|full|complete|pura|poora)\s+(?:ghar|home|house|property)\b/.test(normalizedText);
    const hasRequirementUpdate=step&&!pricingRequested&&!wholeHomeDeepCorrection&&requirementKeys.some(key=>timeEntities[key]!==undefined)
      && /\b(add|include|also|need|want|clean(?:ed|ing)?|bring|use|with)\b/.test(normalizedText);
    if(hasRequirementUpdate){
      entities={...timeEntities,pendingField:step,preserveWorkflow:true};
      candidates.push({intent:'cleaning.requirements_update',confidence:1,priority:147,entities,reason:'active_cleaning_requirements_update'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_requirements_update',score:1}]};
    }

    // Scope clarification outranks pending slot validation. A customer may say
    // "my office has two rooms" while we are waiting for a date. Preserve that
    // scope and continue the same workflow instead of validating it as a date.
    const scopeMention=step && /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:rooms?|shops?|floors?|workspaces?)\b|\b(full|complete|entire|whole|ground)\s+floor\b/.test(normalizedText);
    if(scopeMention && !pricingRequested){
      const m=normalizedText.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(rooms?|shops?|floors?|workspaces?)\b/);
      const scopeCount=m?numberFromText(m[1]):null;
      const scopeUnit=m?m[2]:null;
      entities={pendingField:step,scopeText:message.text,scopeCount,scopeUnit,preserveWorkflow:true};
      candidates.push({intent:'cleaning.scope_update',confidence:1,entities,reason:'scope_clarification_interrupts_pending_slot'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_scope_update',score:1}]};
    }

    // Price/quote questions about the currently selected service outrank a pending
    // date/time/name slot. Scope terms such as floor/shops/rooms make this a
    // quotation question, not a date value.
    if(step && pricingRequested){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const explicit=await scoped?.findService?.(cleaningServiceSubjectText(primaryText));
      let explicitService=explicit?.service&&(explicit.score||0)>=60?explicit.service:null;
      const allServices=await scoped?.listServices?.()||[];
      // A generic "deep cleaning" price interruption must not silently widen
      // an active Deep Apartment/Villa request back to Deep Home Cleaning.
      // Only an explicit property change is allowed to replace that scope.
      const activeService=allServices.find(service=>service.id===previous.serviceId)||null;
      const explicitPropertyChange=/\b(?:villa|vila|house|apartment|flat|studio)\b/.test(normalizedText);
      if(explicitService?.id==='CLN002'&&['CLN010','CLN011'].includes(activeService?.id)&&!explicitPropertyChange){
        explicitService=activeService;
      }
      const inheritedPriceService=!explicitService&&previous.priceEnquiry?.serviceId
        ? allServices.find(service=>service.id===previous.priceEnquiry.serviceId)
        : null;
      const quotedService=explicitService||inheritedPriceService||{id:previous.serviceId||null,name:previous.serviceName||null};
      const targetsCurrent=!explicitService||explicitService.id===previous.serviceId;
      const scopeInMessage=/\b(floor|floors|shops?|rooms?|workspaces?|square|sq\s*ft|area|complete|entire|whole|large|small|\d+\s*(?:seater|seat|chairs?|bedrooms?|bhk))\b/.test(normalizedText);
      const scope=scopeInMessage || (targetsCurrent&&Boolean(previous.scopeText));
      entities={
        ...(inheritedPriceService?requestScope(previous.priceEnquiry):{}),
        ...timeEntities,
        serviceId:quotedService.id,
        serviceName:quotedService.name,
        scopeText:scopeInMessage?message.text:(targetsCurrent?previous.scopeText:null),
        nonStandardScope:scope,
        quoteTargetsCurrent:targetsCurrent,
        preserveWorkflow:true
      };
      candidates.push({intent:'cleaning.active_quote_question',confidence:1,entities,reason:'pricing_question_interrupts_pending_slot'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'active_service_quote',score:1}]};
    }

    // A specific service change must outrank pending slot collection.
    // Example: while waiting for a date, "actually I want deep cleaning"
    // changes the selected service instead of being sent to the date validator.
    if(step && /\b(deep\s*(?:home\s*)?(?:clean(?:ing)?|clening|cleening|clning)|standard\s*(?:home\s*)?(?:clean(?:ing)?|clening|cleening|clning)|sofa\s*(?:clean(?:ing)?|clening)|carpet\s*(?:clean(?:ing)?|clening)|office\s*(?:clean(?:ing)?|clening)|move[ -]?(?:in|out)\s*(?:clean(?:ing)?|clening)|hourly\s*cleaner)\b/.test(normalizedText)){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const targetText=cleaningServiceSubjectText(primaryText);
      const changed=scoped?await scoped.findService(targetText):null;
      if(changed?.service){
        entities={serviceId:changed.service.id,serviceName:changed.service.name,...timeEntities,preserveExistingSlots:true};
        candidates.push({intent:'cleaning.service_change',confidence:1,entities,reason:'active_cleaning_service_change'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'service_change',score:1}]};
      }
    }

    // A property/service change outranks a pending date/time field. This keeps
    // "what about a 4 bedroom villa" from being validated as a date.
    if(propertyAlternative){
      let m=normalizedText.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/);if(m)timeEntities.bedrooms=Number(m[1]);
      if(/\b(villa|vila|vill)\b/.test(normalizedText)||closestKeywordToken(normalizedText,['villa'],{maxDistance:2,minLength:4}))timeEntities.propertyType='villa';else if(/\b(apartment|flat|studio)\b/.test(normalizedText)||closestKeywordToken(normalizedText,['apartment'],{maxDistance:2,minLength:6}))timeEntities.propertyType='apartment';
      const scopedService=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const explicitService=scopedService?await scopedService.findService(cleaningServiceSubjectText(primaryText)):null;
      if(explicitService?.service&&(explicitService.score||0)>=60){timeEntities.serviceId=explicitService.service.id;timeEntities.serviceName=explicitService.service.name;}
      entities={...timeEntities,text:normalizedText,pricingRequested:true};
      candidates.push({intent:'cleaning.structured_quote_request',confidence:1,entities,reason:'property_alternative_quote'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'property_alternative',score:1}]};
    }

    // Explicit staffing + duration is an hourly work model even when property
    // scope is also supplied. Do not silently replace it with a property matrix.
    const explicitWorkforce=/\b(?:cleaners?|maids?|workers?|people|persons?|person)\b/.test(normalizedText);
    if(!step && cleaningDomain && (pricingRequested||structuredRequest) && timeEntities.durationHours && timeEntities.cleanerCount && explicitWorkforce && new Set(serviceHeads).size<=1){
      entities={...timeEntities,policyFacets,pricingRequested:true,pricingModel:'hourly_cleaner'};
      candidates.push({intent:'cleaning.pricing_request',confidence:1,priority:structuredRequest?200:undefined,entities,reason:'explicit_hourly_staffing_quote'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'semantic_role',value:'duration_and_staffing',score:1},{type:'domain',value:'cleaning',score:1}]};
    }

    if(cleaningDomain && structuredRequest && !structuredQuote){
      const scopedService=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const multiMatches=additiveServiceLanguage&&scopedService?.findServices
        ? await scopedService.findServices(primaryText,{minScore:60})
        : [];
      if(multiMatches.length>1){
        entities={...timeEntities,serviceItems:multiMatches.map(({service,score})=>({serviceId:service.id,serviceName:service.name,score})),text:normalizedText};
        candidates.push({intent:'cleaning.multi_service_request',confidence:1,priority:132,entities,reason:'explicit_multi_service_cleaning_request'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:entities.serviceItems.map((item)=>({type:'service',value:item.serviceName,canonical:item.serviceId,score:item.score/100}))};
      }
      let explicitService=scopedService?await scopedService.findService(cleaningServiceSubjectText(primaryText)):null;
      if((!explicitService?.service||(explicitService.score||0)<60)&&previous.priceEnquiry?.serviceId){
        const servicesList=await scopedService?.listServices?.();
        const inherited=(servicesList||[]).find(service=>service.id===previous.priceEnquiry.serviceId);
        if(inherited)explicitService={service:inherited,score:100};
      }
      if(explicitService?.service && (explicitService.score||0)>=60){
        timeEntities.serviceId=explicitService.service.id;
        timeEntities.serviceName=explicitService.service.name;
      }
      let m=normalizedText.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/);if(m)timeEntities.bedrooms=Number(m[1]);
      if(/\b(villa|vila|vill)\b/.test(normalizedText)||closestKeywordToken(normalizedText,['villa'],{maxDistance:2,minLength:4}))timeEntities.propertyType='villa';else if(/\b(apartment|flat|studio)\b/.test(normalizedText)||closestKeywordToken(normalizedText,['apartment'],{maxDistance:2,minLength:6}))timeEntities.propertyType='apartment';
      const propertyCleaningTypeSpecified=Boolean(resolveCleaningType(normalizedText));
      const namesOnlyPropertyCleaning=!/\b(?:office|sofa|couch|carpet|rug|mattress|chair|curtain|laundry|ac|duct|pest|disinfection|kitchen|bathroom|window|balcony|floor|move[ -]?(?:in|out)|post[ -]?(?:renovation|construction))\b/.test(normalizedText);
      const discussedSpecificService=Boolean(state.capabilityState?.availability?.lastDiscussedServiceId);
      if(timeEntities.propertyType&&namesOnlyPropertyCleaning&&!propertyCleaningTypeSpecified&&!discussedSpecificService){
        entities={...timeEntities,text:normalizedText,pendingCleaningType:true};
        candidates.push({intent:'cleaning.booking_type_clarification',confidence:1,priority:198,entities,reason:'property_cleaning_booking_type_missing'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_type_required',score:1}]};
      }
      const genericPropertyService=explicitService?.service&&isGenericPropertyCleaningService(explicitService.service);
      const availabilityContext=state.capabilityState?.availability||{};
      const contextualContinuation=/^(?:so|then|okay|ok|alright|in that case)\b|\b(?:as discussed|same service|that service)\b/.test(normalizedText);
      const explicitlySpecificService=/\b(?:deep|standard|general|regular|routine|hourly|move[ -]?(?:in|out)|post[ -]?(?:renovation|construction)|office|sofa|couch|carpet|mattress|curtain|laundry)\b/.test(normalizedText);
      if(contextualContinuation&&!explicitlySpecificService&&availabilityContext.lastDiscussedServiceId&&(!explicitService?.service||genericPropertyService)){
        const inherited=(await scopedService?.listServices?.()||[]).find(service=>service.id===availabilityContext.lastDiscussedServiceId);
        if(inherited){
          explicitService={service:inherited,score:100};
          timeEntities.serviceId=inherited.id;
          timeEntities.serviceName=inherited.name;
        }
      }
      const resolvedGenericPropertyService=explicitService?.service&&isGenericPropertyCleaningService(explicitService.service);
      if(timeEntities.propertyType&&resolvedGenericPropertyService&&!propertyCleaningTypeSpecified){
        entities={...timeEntities,text:normalizedText,pendingCleaningType:true};
        candidates.push({intent:'cleaning.booking_type_clarification',confidence:1,priority:198,entities,reason:'property_cleaning_booking_type_missing'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_type_required',score:1}]};
      }
      if(timeEntities.propertyType||timeEntities.bedrooms||timeEntities.units||timeEntities.serviceVariant){
        entities={...timeEntities,text:normalizedText};
        const clearTransaction=isClearTransaction(normalizedText,timeEntities);
        candidates.push({
          intent:'cleaning.structured_service_request',
          confidence:clearTransaction?1:.99996,
          priority:clearTransaction?200:undefined,
          entities,
          reason:clearTransaction?'explicit_structured_cleaning_transaction':'structured_cleaning_service_request'
        });
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'service_request',value:'property_cleaning',score:1}]};
      }
    }
    if(cleaningDomain && structuredQuote&&!policyFacets.length){
      let m=normalizedText.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/);if(m)timeEntities.bedrooms=Number(m[1]);
      if(/\b(villa|vila)\b/.test(normalizedText))timeEntities.propertyType='villa';else if(/\b(apartment|flat)\b/.test(normalizedText))timeEntities.propertyType='apartment';
      const scopedService=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});

      // Price each explicitly mentioned service independently. A compound
      // question must never be reduced to the single highest-scoring match.
      const serviceSegments=String(primaryText).split(/\s+(?:and|nd|plus|along with|as well as)\s+|[,;&]+/i).map(value=>value.trim()).filter(Boolean);
      const segmented=[];
      for(const segment of serviceSegments){
        const furnitureSubject=/\b(?:sofa|couch|carpet|rug|mattress|chair|curtain|drape)\b/i.test(segment);
        const subject=furnitureSubject?segment.replace(/\b(?:deep|standard|general|regular|routine|hourly)\s+clean(?:ing)?\b/ig,' '):segment;
        const found=await scopedService?.findService?.(priceSubjectText(subject));
        const explicitHead=/\b(?:office|sofa|couch|carpet|mattress|chair|curtain|laundry|ac|duct|pest|apartment|villa|house|home)\b/i.test(segment);
        if(found?.service&&(found.score||0)>=(explicitHead?35:60)&&!segmented.some(entry=>entry.service.id===found.service.id))segmented.push(found);
      }
      const multipleServiceSubjects=segmented.length>1||new Set(serviceHeads).size>1;
      if(multipleServiceSubjects&&segmented.length>1){
        let serviceItems=segmented.map(({service,score})=>({serviceId:service.id,serviceName:service.name,score}));
        const propertyService=segmented.find(({service})=>/\b(?:villa|apartment|home) cleaning\b/i.test(service.name)&&!/^Deep\b/i.test(service.name));
        const cleaningTypeSpecified=/\b(?:deep|standard|general|regular|routine|hourly)\b/.test(normalizedText);
        if(propertyService&&/\bdeep\b/.test(normalizedText)){
          const deepName=timeEntities.propertyType==='villa'?'Deep Villa Cleaning':timeEntities.propertyType==='apartment'?'Deep Apartment Cleaning':'Deep Home Cleaning';
          const deepService=(await scopedService?.listServices?.()||[]).find(service=>service.name===deepName);
          if(deepService)serviceItems=serviceItems.map(item=>item.serviceId===propertyService.service.id?{serviceId:deepService.id,serviceName:deepService.name,score:100}:item);
        }
        entities={...timeEntities,serviceItems,text:normalizedText,pricingRequested:true};
        if(propertyService&&timeEntities.propertyType&&!cleaningTypeSpecified&&!discountRequested&&!/\bfixed\b/.test(normalizedText)){
          entities.ambiguousPropertyServiceId=propertyService.service.id;
          candidates.push({intent:'cleaning.price_type_clarification',confidence:1,priority:190,entities,reason:'property_cleaning_type_missing_in_compound_quote'});
        }else{
          candidates.push({intent:'cleaning.multi_service_quote_request',confidence:1,priority:190,entities,reason:'explicit_multi_service_cleaning_quote'});
        }
        return {priority:this.priority,candidates,entities,vocabularyMatches:serviceItems.map(item=>({type:'service',value:item.serviceName,canonical:item.serviceId,score:item.score/100}))};
      }

      let explicitService=scopedService?await scopedService.findService(cleaningServiceSubjectText(primaryText)):null;
      if((!explicitService?.service||(explicitService.score||0)<60)&&previous.priceEnquiry?.serviceId){
        const servicesList=await scopedService?.listServices?.();
        const inherited=(servicesList||[]).find(service=>service.id===previous.priceEnquiry.serviceId);
        if(inherited)explicitService={service:inherited,score:100};
      }
      if(explicitService?.service&&(explicitService.score||0)>=60){timeEntities.serviceId=explicitService.service.id;timeEntities.serviceName=explicitService.service.name;}
      if(!timeEntities.serviceName&&timeEntities.propertyType)timeEntities.serviceName=timeEntities.propertyType==='villa'?'Villa Cleaning':'Apartment Cleaning';
      m=normalizedText.match(/\b(\d+)\s*(?:seater|seat|chairs?|seats?)\b/);if(m)timeEntities.units=Number(m[1]);
      const genericPropertyService=explicitService?.service&&/\b(?:villa|apartment|home) cleaning\b/i.test(explicitService.service.name)&&!/^Deep\b/i.test(explicitService.service.name);
      if(timeEntities.propertyType&&genericPropertyService&&!discountRequested&&!/\bfixed\b/.test(normalizedText)&&!/\b(?:deep|standard|general|regular|routine|hourly)\b/.test(normalizedText)){
        entities={...timeEntities,serviceItems:[{serviceId:explicitService.service.id,serviceName:explicitService.service.name,score:explicitService.score}],ambiguousPropertyServiceId:explicitService.service.id,pricingRequested:true};
        candidates.push({intent:'cleaning.price_type_clarification',confidence:1,priority:190,entities,reason:'property_cleaning_type_missing'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'service',value:explicitService.service.name,canonical:explicitService.service.id,score:1}]};
      }
      if(timeEntities.propertyType||timeEntities.units||timeEntities.serviceVariant){
        entities={...timeEntities,text:normalizedText,pricingRequested:true};
        candidates.push({intent:discountRequested?'cleaning.discount_request':'cleaning.structured_quote_request',confidence:.99995,entities,reason:discountRequested?'cleaning_discount_request':'cleaning_structured_quote'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'structured_service_quote',score:1}]};
      }
      // A named service remains the pricing subject even when it has no
      // matrix/unit inputs. Without this boundary, "full house deep cleaning"
      // incorrectly falls into the generic hourly-cleaner path.
      if(explicitService?.service&&(explicitService.score||0)>=60){
        entities={
          ...timeEntities,
          serviceId:explicitService.service.id,
          serviceName:explicitService.service.name,
          scopeText:message.text,
          pricingRequested:true
        };
        candidates.push({intent:'cleaning.standalone_service_quote',confidence:1,priority:150,entities,reason:'explicit_cleaning_service_price_question'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'explicit_service_quote',canonical:explicitService.service.id,score:1}]};
      }
    }

    const genericCleaner=/\b(cleaners?|clenr|clnr|maids?)\b/.test(normalizedText);

    const explicitCleanerCount=/\b(?:\d{1,2}|one|two|three|four|five|ek|aik|do|teen|char|chaar)\s*(?:cleaners?|maids?|workers?|people|persons?|person)\b/.test(normalizedText);
    if(step==='cleanerCount'){
      const cleanerCount=timeEntities.cleanerCount||scalarPendingNumber(normalizedText);
      if(cleanerCount){
        entities={pendingField:step,cleanerCount,preserveWorkflow:true};
        if(timeEntities.durationHours)entities.durationHours=timeEntities.durationHours;
        candidates.push({intent:'cleaning.cleaner_count_update',confidence:1,priority:182,entities,reason:'active_standard_cleaning_cleaner_count'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaner_count',score:1}]};
      }
    }
    if(step && previous.serviceId==='CLN-HOURLY' && explicitCleanerCount && timeEntities.cleanerCount && !timeEntities.durationHours && /\b(actually|instead|only|just|i want|i need|mujhy|mujhe|chahiye|chahiyy|cleaners?|maids?)\b/.test(normalizedText)){
      entities={pendingField:step,cleanerCount:timeEntities.cleanerCount,preserveWorkflow:true};
      candidates.push({intent:'cleaning.cleaner_count_update',confidence:1,entities,reason:'active_hourly_cleaner_count_update'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaner_count_update',score:1}]};
    }

    if(step && genericCleaner && timeEntities.durationHours && /\b(actually|instead|only|just|i want|i need|mujhy|mujhe|chahiye|chahiyy)\b/.test(normalizedText)){
      entities={
        serviceId:'CLN-HOURLY',serviceName:'Hourly Cleaner Hire',
        durationHours:timeEntities.durationHours,
        cleanerCount:timeEntities.cleanerCount||1,
        preserveExistingSlots:true
      };
      candidates.push({intent:'cleaning.service_change',confidence:1,entities,reason:'active_hourly_cleaner_service_switch'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'hourly_cleaner_service_change',score:1}]};
    }

    if(cleaningDomain && pricingRequested && !timeEntities.durationHours){
      entities={...timeEntities,pricingRequested:true,pricingModel:'hourly_cleaner'};
      candidates.push({intent:'cleaning.quote_request',confidence:.999,entities,reason:'cleaning_quote_missing_duration'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'pricing',value:'hourly_cleaner_quote',score:1}]};
    }
    if(step && timeEntities.durationHours){
      entities={pendingField:step,...timeEntities};
      candidates.push({intent:'cleaning.duration_update',confidence:.9995,entities,reason:'active_cleaning_duration_update'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_duration_update',score:1}]};
    }
    if(step==='duration'){
      const durationHours=scalarPendingNumber(normalizedText);
      if(durationHours>=1&&durationHours<=24){
        entities={pendingField:'duration',durationHours,preserveWorkflow:true};
        candidates.push({intent:'cleaning.duration_update',confidence:1,priority:205,entities,reason:'active_cleaning_duration_scalar'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow_field',value:'duration',score:1}]};
      }
    }
    if (cleaningDomain && timeEntities.durationHours && (pricingRequested || genericCleaner)) {
      entities={...timeEntities,policyFacets, pricingRequested:true, pricingModel:'hourly_cleaner'};
      candidates.push({intent:'cleaning.pricing_request',confidence:.9993,entities,reason:'cleaning_duration_pricing'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'semantic_role',value:'duration',score:.9993},{type:'domain',value:'cleaning',score:.99}]};
    }
    if (/\b(what|which|show|list|tell me|do you have|do you offer|provide)\b[\s\S]{0,35}\b(cleaning )?services\b|\b(what cleaning services|cleaning services do you|services do you offer|kia cleaning services|kya cleaning services)\b|\b(?:ap|aap)\s+log\b[\s\S]{0,25}\b(?:kis kis|kon kon|kya kya|kia kia)\b[\s\S]{0,30}\b(?:cleaning|clening|safai)\b/.test(normalizedText)) {
      candidates.push({intent:'cleaning.service_list',confidence:.985,entities:{},reason:'cleaning_service_list_phrase'});
      return {priority:this.priority,candidates,entities:{},vocabularyMatches:[{type:'phrase',value:'cleaning services',score:.985}]};
    }
    if(step){
      entities={pendingField:step,...timeEntities};
      if(interruption && (!correction || correction.type==='generic')) return {priority:this.priority,candidates:[],entities:{...entities,interruption},vocabularyMatches:[{type:'workflow',value:'cleaning_paused',score:1}]};
      if(correction) candidates.push({intent:'cleaning.correction',confidence:.999,entities:{...entities,correction},reason:'cleaning_correction'});
      else candidates.push({intent:'cleaning.workflow_input',confidence:.996,entities,reason:'active_cleaning_workflow'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning',score:1}]};
    }
    const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
    if(!previous.step&&!previous.priceEnquiry&&!previous.quotedService&&/\b(?:book|schedule|reserve)\s+(?:it|this)\b/.test(normalizedText)&&!cleaningDomain){
      candidates.push({intent:'cleaning.service_explore',confidence:1,priority:205,entities:{},reason:'ungrounded_referential_cleaning_booking'});
      return {priority:this.priority,candidates,entities:{},vocabularyMatches:[{type:'clarification',value:'cleaning_service_required',score:1}]};
    }
    const found=scoped?await scoped.findService(primaryText):null;
    if(found?.service){
      if(structuredRequest&&timeEntities.propertyType&&isGenericPropertyCleaningService(found.service)&&!resolveCleaningType(normalizedText)){
        entities={...timeEntities,text:normalizedText,pendingCleaningType:true};
        candidates.push({intent:'cleaning.booking_type_clarification',confidence:1,priority:198,entities,reason:'matched_property_cleaning_type_missing'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'cleaning_type_required',score:1}]};
      }
      if(found.service.hidden){
        entities=extractTimeEntities(message.text);
        candidates.push({intent:'cleaning.service_explore',confidence:.97,entities,reason:'cleaning_hidden_operational_service'});
        matches.push({type:'domain',value:'cleaning',score:.97});
        return {priority:this.priority,candidates,entities,vocabularyMatches:matches};
      }
      const genericDomain = /\b(clean|cleaning|cleaners?|clenr|clnr|maids?|safai|صفائی|صاف)\b/.test(normalizedText);
      const specificHome = /\b(home|house|ghar|office|sofa|carpet|deep|move in|move out)\b/.test(normalizedText);
      if (genericDomain && (found.score || 0) <= 20 && !specificHome) {
        entities=extractTimeEntities(message.text);
        candidates.push({intent:'cleaning.service_explore',confidence:.97,entities,reason:'cleaning_generic_domain'});
        matches.push({type:'domain',value:'cleaning',score:.97});
      } else {
        entities={serviceId:found.service.id,serviceName:found.service.name,...timeEntities};
        const clearTransaction=isClearTransaction(normalizedText,timeEntities);
        candidates.push({
          intent:'cleaning.service_request',
          confidence:clearTransaction?1:Math.min(.99,.86+(found.score||0)/500),
          priority:clearTransaction?200:undefined,
          entities,
          reason:clearTransaction?'explicit_cleaning_service_transaction':'cleaning_service_match'
        });
        matches.push({type:'service',value:found.service.name,canonical:found.service.id,score:found.score});
      }
    } else if(/\b(clean|cleaning|cleaners?|clenr|clnr|maids?|safai|صفائی|صاف)\b/.test(normalizedText)) {
      entities=extractTimeEntities(message.text);
      candidates.push({intent:'cleaning.service_explore',confidence:.97,entities,reason:'cleaning_domain_vocabulary'});
      matches.push({type:'domain',value:'cleaning',score:.97});
    }
    return {priority:this.priority,candidates,entities,vocabularyMatches:matches};
  }
}
function extractCleaningRequestId(value){const match=String(value||'').toUpperCase().match(/\bCLN[-_][A-Z0-9]{4,16}\b/);return match?match[0].replace('_','-'):null;}
function extractTimeEntities(text,precomputed=null){
  const n=normalizeText(text); const entities={};
  const temporal=precomputed&&Object.keys(precomputed).length?precomputed:temporalExtractor.extract(text);
  if(temporal.dateReference)entities.date=temporal.dateReference;
  else if(temporal.dateText)entities.date=temporal.dateText;
  if(temporal.dateText)entities.dateText=temporal.dateText;
  if(temporal.weekday)entities.weekday=temporal.weekday;
  if(temporal.timeWindow)entities.timeWindow=temporal.timeWindow;
  if(temporal.startTime){entities.startTime=temporal.startTime;entities.time=temporal.startTime;}
  if(temporal.endTime)entities.endTime=temporal.endTime;
  if(temporal.durationHours)entities.durationHours=temporal.durationHours;
  if(isAnyAvailableTime(n)){
    entities.timeFlexible=true;
    entities.timePreference='any_available';
    entities.availabilityRequested=true;
  }
  const cleaners=n.match(/\b(\d{1,2}|one|two|three|four|five|ek|aik|do|teen|char|chaar)\s*(?:cleaners?|maids?|workers?|people|persons?|person)\b/);
  if(cleaners) entities.cleanerCount=numberFromText(cleaners[1]);
  else if(/\b(?:cleaner|maid|one person)\b/.test(n)) entities.cleanerCount=1;
  return entities;
}

function extractCleaningRequestId(value){
  const match=String(value||'').match(/\bCLN-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i);
  return match?match[0].toUpperCase():null;
}

function extractExplicitDateDay(value,{allowBare=false}={}){
  const source=String(value||'').trim();
  let match=source.match(/\b(?:date|day)\s*(?:to|on|for|is|=|:)?\s*(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if(!match&&allowBare)match=source.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+please)?[.! ]*$/i);
  const day=match?Number(match[1]):null;
  return day>=1&&day<=31?day:null;
}

function extractWeekdayOptions(value){
  const text=normalizeWeekdayTypos(value);
  const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  return days.filter(day=>new RegExp(`\\b${day}\\b`).test(text));
}

function isGenericPropertyCleaningService(service){
  return ['CLN008','CLN009'].includes(service?.id)
    || (/\b(?:apartment|villa|home) cleaning\b/i.test(service?.name||'')&&!/^Deep\b/i.test(service?.name||''));
}
function resolveCleaningType(value){
  const text=normalizeText(value);
  if(/\bdeep\b|گہری/.test(text))return 'deep';
  if(/\b(?:standard|stndrad|standrd|general|regular|routine|hourly)\b/.test(text))return 'standard';
  const fuzzy=closestKeywordToken(text,['standard','regular','routine','hourly'],{maxDistance:2,minLength:5});
  return fuzzy?'standard':null;
}
function scalarPendingNumber(value){
  const text=normalizeText(value).replace(/^(?:ok|okay|yes|sure|theek hai)\s+/,'').trim();
  if(!/^(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)$/.test(text))return null;
  return numberFromText(text);
}
function requestScope(source={}){
  const keys=['propertyType','propertyCount','propertyFloor','bedrooms','washrooms','balconies','interiorWindows','insideRefrigerator','insideOven','fragranceFree','petPresent','heavyPetHair','halls','cleaningType','requestedTasks','requiredEquipment','businessProvidesSupplies','businessProvidesEquipment','scopeText','durationHours','cleanerCount','units','serviceVariant'];
  const out={};
  for(const key of keys)if(source?.[key]!==undefined&&source?.[key]!==null)out[key]=source[key];
  return out;
}
function extractCleaningContext(text){
  const raw=String(text||'');const n=normalizeText(raw);const out={};
  const numberToken='(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)';
  let m=n.match(new RegExp(`\\b(${numberToken})\\s+(${numberToken})\\s*(?:bedrooms?|bed|bhk)\\s+(?:apartments?|flats?|villas?|houses?|homes?)\\b`));
  if(m){out.propertyCount=numberFromText(m[1]);out.bedrooms=numberFromText(m[2]);}
  else {
    m=n.match(new RegExp(`\\b(${numberToken})\\s*(?:bedrooms?|bed|bhk)\\b`));
    if(m)out.bedrooms=numberFromText(m[1]);
  }
  if(out.bedrooms==null){m=n.match(/(\d+|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس)\s*(?:کمروں?|کمرے|کمرہ)/);if(m)out.bedrooms=numberFromText(m[1]);}
  m=n.match(/\b(\d+)\s*(?:washrooms?|bathrooms?)\b/);if(m)out.washrooms=Number(m[1]);
  else if(out.bedrooms&&/\beach\s+(?:bedroom\s+)?(?:has|with)\s+(?:an\s+)?attached\s+(?:washroom|bathroom)\b/.test(n))out.washrooms=out.bedrooms;
  m=n.match(/\b(\d+)\s*(?:balcon(?:y|ies)|balconys|blcon(?:y|ies)|blconies|blcony)\b/);if(m)out.balconies=Number(m[1]);
  m=n.match(/\b(\d+)\s*(?:interior|inside|internal)\s+windows?\b/);if(m)out.interiorWindows=Number(m[1]);
  else {
    m=n.match(/\b(\d+)\s+windows?\b/);
    if(m&&!/\b(?:outside|exterior|external)\s+windows?\b/.test(n))out.interiorWindows=Number(m[1]);
  }
  m=n.match(/\b(\d+)\s*halls?\b/);if(m)out.halls=Number(m[1]);
  m=n.match(/\b(\d+)\s*(?:seater|seat|chairs?|seats?|metres?|meters?|m2|sqm)\b/);if(m)out.units=Number(m[1]);
  if(/\bextra[ -]?large\b|\bxl\b/.test(n))out.serviceVariant='extra-large';
  else if(/\bking(?: size)?\b/.test(n))out.serviceVariant='king';
  else if(/\bqueen(?: size)?\b/.test(n))out.serviceVariant='queen';
  else if(/\bcrib(?: size)?\b/.test(n))out.serviceVariant='crib';
  else if(/\bsingle(?: size)?\b/.test(n))out.serviceVariant='single';
  else if(/\bmedium\b/.test(n))out.serviceVariant='medium';
  else if(/\blarge\b/.test(n))out.serviceVariant='large';
  else if(/\bsmall\b/.test(n))out.serviceVariant='small';
  if(/\b(villa|vila)\b|ولا/.test(n))out.propertyType='villa';
  else if(/\b(apartment|flat|studio)\b|(?:فلیٹ|اپارٹمنٹ)/.test(n))out.propertyType='apartment';
  if(/\bstudio\b/.test(n)&&out.bedrooms==null)out.bedrooms=0;
  if(/\bupper floor\b/.test(n))out.propertyFloor='upper';
  if(/\b(?:inside|interior) (?:the )?refrigerator|\binside refrigerator cleaning\b/.test(n))out.insideRefrigerator=true;
  if(/\b(?:inside|interior) (?:the )?oven|\binside oven cleaning\b/.test(n))out.insideOven=true;
  if(/\bfragrance[ -]?free\b/.test(n))out.fragranceFree=true;
  if(/\b(cat|dog|pet)\b/.test(n))out.petPresent=true;
  if(/\b(no|isn'?t|isn t|is not|without)\b.{0,30}\bheavy pet hair\b|\bthere (?:is no|isn'?t|isn t) heavy pet hair\b/.test(n))out.heavyPetHair=false;
  else if(/\bheavy pet hair\b/.test(n))out.heavyPetHair=true;
  if(/\b(post renovation|after renovation|just been renovated|construction dust)\b/.test(n))out.cleaningType='post_renovation_deep_clean';
  const tasks=[];
  const rejectedBathroom=/\b(?:bathroom|washroom|toilet)\b[\s\S]{0,24}\b(?:not|nahi|nahin|nhn)\b|\b(?:not|nahi|nahin|nhn)\b[\s\S]{0,24}\b(?:bathroom|washroom|toilet)\b/.test(n);
  for(const [name,re] of Object.entries({floors:/\bfloors?\b/,washrooms:/\b(?:washrooms?|bathrooms?)\b/,doors:/\bdoors?\b/,windows:/\bwindows?\b/,balconies:/\b(?:balcon(?:y|ies)|balconys|blcon(?:y|ies)|blconies|blcony)\b/,constructionDust:/\bconstruction dust\b/}))if(re.test(n)&&!(name==='washrooms'&&rejectedBathroom))tasks.push(name);
  if(tasks.length)out.requestedTasks=tasks;
  const equipment=[];if(/\bvacuum cleaner\b/.test(n))equipment.push('vacuum cleaner');if(/\bmop\b/.test(n))equipment.push('mop');
  if(equipment.length)out.requiredEquipment=equipment;
  if(/\b(?:bring|including|include|with)\b.{0,40}\b(?:cleaning products?|cleaning supplies|supplies|materials)\b/.test(n))out.businessProvidesSupplies=true;
  if(/\b(?:bring|including|include|with)\b.{0,40}\bequipment\b/.test(n)||equipment.length)out.businessProvidesEquipment=true;
  if(/\b(?:already booked|booked several|returning customer|used your company before|existing customer)\b/.test(n))out.returningCustomerClaim=true;
  if(/\b(?:efficient|experienced|fast)\b/.test(n))out.staffPreference=/\befficient\b/.test(n)?'efficient':'experienced';
  if(/\b(?:confirm availability|check availability|are you available|availability|available option)\b/.test(n))out.availabilityRequested=true;
  const quoteOnly=/\b(?:before (?:booking|confirming) anything|before (?:you )?(?:book|confirm)|do not (?:book|confirm)|don t (?:book|confirm)|don't (?:book|confirm)|without (?:booking|confirming)|not (?:book(?:ing)?|confirm(?:ing)?) yet|check (?:availability|the options?) first)\b/.test(n);
  if(quoteOnly)out.quoteOnly=true;
  if(/\b(?:do not|don t|don't|never)\s+(?:reduce|change|replace|substitute)\b[\s\S]{0,50}\bwithout asking\b|\bwithout asking me\b/.test(n))out.noSubstitutionWithoutConsent=true;
  const dayOptions=[...n.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g)].map(match=>match[1]);
  if(dayOptions.length)out.preferredDateOptions=[...new Set(dayOptions)];
  const finishMatch=raw.match(/\b(?:finish(?:ed)?|done|complete(?:d)?)\s+by\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if(finishMatch)out.finishBy=parseClock(finishMatch[1],finishMatch[2],finishMatch[3])?.value||null;
  const clockOptions=[];
  for(const match of raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/gi)){
    const value=parseClock(match[1],match[2],match[3])?.value||null;
    if(value&&value!==out.finishBy)clockOptions.push(value);
  }
  if(clockOptions.length)out.preferredTimeOptions=[...new Set(clockOptions)];
  const location=raw.match(/(?:\blocation\s*:\s*|\baddress(?:\s+is)?\s*:?\s*|\bi live in\s+)([^.\n]+?)(?=\s+(?:thank you|thanks)\b|[.!?]|$)/i)
    || [...raw.matchAll(/\bat\s+(?=((?:(?:house|villa|building|apartment|flat|office|shop)\b[^.!?\n]{3,120}|\d{1,5}\s+[\p{L}][\p{L} .'-]{1,80}\s+(?:road|street|lane|avenue|block|phase)\b[^.!?\n]{0,60}))(?=\s+(?:and\s+)?(?:my\s+)?(?:name|phone|contact|email)\b|[.!?]|$))/giu)].at(-1);
  if(location)out.address=location[1].trim().replace(/[,;]+$/,'');
  const name=raw.match(/\b(?:my name is|name\s*:)\s*([\p{L}][\p{L} .'-]{1,70}?)(?=\s+(?:(?:and\s+)?(?:my\s+)?(?:phone|contact|number)|what is|what's|who are|can i|could i|i want|i need|i would|do you|please|but|because)\b|[.!?,;\n]|$)/iu);
  if(name)out.name=name[1].trim().replace(/\b\p{L}/gu,c=>c.toUpperCase());
  const phone=raw.match(/\b(?:phone|contact|number)\s*(?:is|:)?\s*(\+?[\d ()-]{10,22})/i);
  if(phone)out.phone=phone[1].trim();
  const email=raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if(email)out.email=email[0].toLowerCase();
  out.scopeText=raw.trim();
  return out;
}
function isAnyAvailableTime(text){
  const n=normalizeText(text);
  const available='(?:available|avaialable|avaiable|availble|avialable)';
  return new RegExp(`\\b(?:any|first|earliest)\\s+(?:${available}\\s+)?(?:time|slot)\\b|\\bwhenever\\s+(?:the\\s+)?(?:team|cleaners?|staff)?\\s*(?:is|are)?\\s*${available}\\b|\\b(?:jis|jo|kisi bhi)\\s+(?:time|waqt)\\b[\\s\\S]{0,30}\\b${available}\\b|\\b(?:team|cleaners?|staff)\\s+(?:(?:jis|jab|jo)\\s+)?(?:time|waqt)?\\s*${available}\\s+ho\\b|\\b${available}\\s+(?:time|slot)\\b`).test(n);
}
function isClearTransaction(text,entities={}){
  if(/\b(i want|i need|book|schedule|arrange|would like)\b/.test(text))return true;
  if(/\bcan you do\b[\s\S]{0,50}\b(?:cleaning|clening|clenening|cleening|clning)\b/.test(text))return true;
  // "Can I get ...?" is a service-availability question until the customer
  // also supplies a scheduling constraint. With a date/time it is actionable.
  return /\bcan i (?:get|have)\b/.test(text)&&Boolean(entities.date||entities.dateText||entities.weekday||entities.startTime||entities.time);
}
function priceSubjectText(value){
  const text=String(value||'');
  const contrast=text.split(/\b(?:but|instead(?:\s+of)?|rather than|not .{0,35}? but|nahi .{0,35}? balkay|nhn .{0,35}? balkay)\b/i).filter(part=>part.trim());
  return contrast.length>1?contrast.at(-1).trim():text;
}
function cleaningServiceSubjectText(value){
  const text=priceSubjectText(String(value||'')),n=normalizeText(text);
  if(/\b(?:post[ -]?renovation|after renovation|post[ -]?construction|construction dust)\b/.test(n))return 'post renovation cleaning';
  if(/\b(?:sofa|couch)\b/.test(n))return 'sofa cleaning';
  if(/\b(?:mattress|carpet|rug|curtain|drape|office|commercial|laundry|pest|duct)\b/.test(n)){
    const match=n.match(/\b(mattress|carpet|rug|curtain|drape|office|commercial|laundry|pest|duct)\b/);
    return `${match[1]} cleaning`;
  }
  if(/\bdeep\b|گہری/.test(n)){
    if(/\b(villa|vila)\b|ولا/.test(n))return 'deep villa cleaning';
    if(/\b(apartment|flat|studio)\b|(?:فلیٹ|اپارٹمنٹ)/.test(n))return 'deep apartment cleaning';
    return 'deep home cleaning';
  }
  const standardNegated=/\b(?:standard|general|regular|routine)\b[\s\S]{0,18}\b(?:not|nahi|nahin|nhn)\b|\b(?:not|nahi|nahin|nhn)\b[\s\S]{0,18}\b(?:standard|general|regular|routine)\b/.test(n);
  if(!standardNegated&&/\b(?:standard|stndrad|standrd|general|regular|routine|hourly)\b/.test(n))return 'standard home cleaning';
  return priceSubjectText(text);
}
module.exports={CleaningConversationAdapter,extractTimeEntities,extractCleaningContext,isAnyAvailableTime};
