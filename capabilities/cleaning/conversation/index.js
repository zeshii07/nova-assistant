const { normalizeText, numberFromText } = require('../../../packages/conversation-intelligence/src/text');
const { extractServiceConstraints } = require('../../../packages/conversation-intelligence/src/serviceConstraintExtractor');
const { TemporalSemanticExtractor, parseClock } = require('../../../packages/conversation-intelligence/src/temporalSemanticExtractor');
const { extractQueryFacets } = require('../../../packages/conversation-intelligence/src/queryFacetExtractor');
const temporalExtractor=new TemporalSemanticExtractor();
class CleaningConversationAdapter {
  constructor(){this.capabilityId='cleaning';this.priority=85;}
  async analyze({ tenant, message, state, services, normalizedText, correction, interruption, clauseSemantics, temporal }) {
    const primaryText=clauseSemantics?.primaryText||message.text;
    normalizedText=normalizeText(primaryText);
    const step=state.capabilityState?.cleaning?.step; const candidates=[]; let entities={}; const matches=[];
    const previous=state.capabilityState?.cleaning||{};
    const timeEntities={...extractTimeEntities(primaryText,temporal),...extractCleaningContext(message.text)};
    let pricingRequested=/\b(charge|charges|price|pricing|cost|rate|rates|quote|quotation|estimate|how much|kitna|kitni|kitne|charges kya|charges kia)\b/.test(normalizedText);
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
    const structuredRequest=/\b(i want|i need|book|schedule|add|clean my|cleaned|cleaning chahiye|karwani hai|krani hai|karani hai|saaf krana|saaf karana|saaf karwana)\b/.test(normalizedText);
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
    if(pendingPriceClarification&&/\b(?:deep|standard|general|regular|routine|hourly)\b/.test(normalizedText)){
      const deep=/\bdeep\b/.test(normalizedText);
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

    const submittedCancellation=!previous.step&&(
      /\b(?:cancel|stop)\b[\s\S]{0,45}\b(?:cleaning|request|booking|appointment|service)\b/.test(normalizedText)
      || /\b(?:cleaning|request|booking|appointment|service)\b[\s\S]{0,45}\b(?:cancel|stop|cancel kar)\b/.test(normalizedText)
      || Boolean(previous.lastRequestId)&&/\bcancel (?:it|this|that)\b/.test(normalizedText)
    );
    if(submittedCancellation){
      const scoped=services.cleaningService?.scope({tenant,capabilityId:'cleaning',customerId:message.customerId,conversationId:`${tenant.id}:${message.channel}:${message.customerId}`});
      const stored=scoped?await scoped.listRequests():[];
      const active=[...stored].filter(request=>!['completed','cancelled'].includes(request.status)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0];
      if(active){
        entities={requestId:previous.lastRequestId||active.id};
        candidates.push({intent:'cleaning.submitted_cancel_request',confidence:1,priority:195,entities,reason:'submitted_cleaning_cancel_request'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'submitted_cleaning_cancel_request',score:1}]};
      }
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
      entities={...timeEntities,requestId:previous.lastRequestId||null};
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

    const propertyContext=tenant.capabilities?.includes('cleaning') && /\b(apartment|flat|studio|villa|vila|house|home|bedroom|bedrooms|bhk|office)\b/.test(normalizedText);
    const cleaningDomain=/\b(clean|cleaned|cleaning|cleaners?|clenr|clnr|maids?|safai|sofas?|couches?|curtains?|drapes?|mattresses?|carpets?|rugs?|upholstery|صفائی|صاف)\b/.test(normalizedText)
      || (propertyContext && /\b(quote|quotation|estimate|what about|how about|price|cost|clean)\b/.test(normalizedText));
    const structuredQuote=priceFollowUp || discountRequested || /\b(quote|quotation|estimate|price|cost|charges?|how much|kitna|kitne|kitni)\b/.test(normalizedText);
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
      const explicitService=explicit?.service&&(explicit.score||0)>=60?explicit.service:null;
      const allServices=await scoped?.listServices?.()||[];
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
      if(/\b(villa|vila)\b/.test(normalizedText))timeEntities.propertyType='villa';else if(/\b(apartment|flat|studio)\b/.test(normalizedText))timeEntities.propertyType='apartment';
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
      candidates.push({intent:'cleaning.pricing_request',confidence:1,entities,reason:'explicit_hourly_staffing_quote'});
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
      if(/\b(villa|vila)\b/.test(normalizedText))timeEntities.propertyType='villa';else if(/\b(apartment|flat|studio)\b/.test(normalizedText))timeEntities.propertyType='apartment';
      if(timeEntities.propertyType||timeEntities.bedrooms||timeEntities.units||timeEntities.serviceVariant){
        entities={...timeEntities,text:normalizedText};
        const clearTransaction=isClearTransaction(normalizedText,timeEntities);
        candidates.push({
          intent:'cleaning.structured_service_request',
          confidence:clearTransaction?1:.99996,
          priority:clearTransaction?130:undefined,
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
    if (cleaningDomain && timeEntities.durationHours && (pricingRequested || genericCleaner)) {
      entities={...timeEntities,policyFacets, pricingRequested:true, pricingModel:'hourly_cleaner'};
      candidates.push({intent:'cleaning.pricing_request',confidence:.9993,entities,reason:'cleaning_duration_pricing'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'semantic_role',value:'duration',score:.9993},{type:'domain',value:'cleaning',score:.99}]};
    }
    if (/\b(what|which|show|list|tell me|do you have|do you offer|provide)\b[\s\S]{0,35}\b(cleaning )?services\b|\b(what cleaning services|cleaning services do you|services do you offer|kia cleaning services|kya cleaning services)\b/.test(normalizedText)) {
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
    const found=scoped?await scoped.findService(primaryText):null;
    if(found?.service){
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
          priority:clearTransaction?130:undefined,
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
  if(/\b(villa|vila)\b/.test(n))out.propertyType='villa';
  else if(/\b(apartment|flat|studio)\b/.test(n))out.propertyType='apartment';
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
  const location=raw.match(/(?:\blocation\s*:\s*|\bi live in\s+)([^.\n]+?)(?=\s+(?:thank you|thanks)\b|[.!?]|$)/i);
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
  if(/\bdeep\b/.test(n)){
    if(/\b(villa|vila)\b/.test(n))return 'deep villa cleaning';
    if(/\b(apartment|flat|studio)\b/.test(n))return 'deep apartment cleaning';
    return 'deep home cleaning';
  }
  const standardNegated=/\b(?:standard|general|regular|routine)\b[\s\S]{0,18}\b(?:not|nahi|nahin|nhn)\b|\b(?:not|nahi|nahin|nhn)\b[\s\S]{0,18}\b(?:standard|general|regular|routine)\b/.test(n);
  if(!standardNegated&&/\b(?:standard|general|regular|routine|hourly)\b/.test(n))return 'standard home cleaning';
  return priceSubjectText(text);
}
module.exports={CleaningConversationAdapter,extractTimeEntities,extractCleaningContext,isAnyAvailableTime};
