const { createCleaningRequest } = require("../../cleaning-sdk/src");

/** Cleaning domain service. Owns service discovery and service-request records. */
class CleaningService {
  constructor({ serviceRepository, requestRepository, permissionService, eventBus, logger, calendarService = null }) {
    Object.assign(this, { serviceRepository, requestRepository, permissionService, eventBus, logger, calendarService });
  }
  scope({ tenant, capabilityId, customerId, conversationId }) {
    const owner = this;
    const assert = (action) => this.permissionService.assert(tenant, capabilityId, action);
    return Object.freeze({
      listServices: async () => { assert("read"); return this.serviceRepository.loadServices(tenant.id).filter((s) => s.active !== false); },
      findService: async (query) => {
        assert("read");
        const services = this.serviceRepository.loadServices(tenant.id).filter((s) => s.active !== false);
        return bestServiceMatch(services, query);
      },
      findServices: async (query, options = {}) => {
        assert("read");
        const services = this.serviceRepository.loadServices(tenant.id).filter((s) => s.active !== false);
        return rankedServiceMatches(services, query, options);
      },
      checkAvailability: async (input) => {
        assert("read");
        if (!this.calendarService) return { status:"unknown", source:"calendar_not_connected" };
        return this.calendarService.check({ tenantId:tenant.id, ...cleaningCalendarInput(input) });
      },
      holdSlot: async (input) => {
        assert("request.create");
        if (!this.calendarService) return { status:"unknown", source:"calendar_not_connected" };
        return this.calendarService.hold({ tenantId:tenant.id, customerId, conversationId, ...cleaningCalendarInput(input), subject:input.serviceName || "Cleaning service" });
      },
      releaseHold: async (holdId, reason) => this.calendarService?.releaseHold({ tenantId:tenant.id, customerId, holdId, reason }),
      cancelRequest: async (requestId, reason = "customer_requested") => {
        assert("request.update");
        const requests = await owner.requestRepository.listByCustomer(tenant.id, customerId);
        const existing = requests.find((request) => request.id === requestId);
        if (!existing) throw new Error("Cleaning request was not found for this customer and tenant.");
        if (existing.status === "cancelled") return { requests:[existing], event:null, idempotent:true };
        if (existing.status === "completed") {
          const error = new Error("A completed cleaning request cannot be cancelled.");
          error.code = "CLEANING_REQUEST_NOT_MODIFIABLE";
          throw error;
        }
        // Multi-service cleaning lines share one visit/calendar event. Cancelling
        // that visit must cancel every linked line so transaction history and
        // resource capacity cannot disagree.
        const linked = existing.calendarEventId
          ? requests.filter((request) => request.calendarEventId === existing.calendarEventId && !["completed","cancelled"].includes(request.status))
          : [existing];
        const cancelledAt = new Date().toISOString();
        const cancelled = linked.map((request) => ({
          ...request,
          status:"cancelled",
          cancelledAt,
          cancellationReason:String(reason),
          revision:Number(request.revision || 1) + 1,
          updatedAt:cancelledAt,
          timeline:[...(request.timeline || []),{ action:"cancelled", at:cancelledAt, reason:String(reason) }]
        }));
        const save = async () => {
          const saved=[];
          for (const request of cancelled) saved.push(await owner.requestRepository.save(request));
          return saved;
        };
        let saved=cancelled,event=null,idempotent=false;
        if (existing.calendarEventId && owner.calendarService) {
          const operation=await owner.calendarService.cancel({ tenantId:tenant.id, customerId, eventId:existing.calendarEventId, reason, work:save });
          event=operation.event;saved=operation.result || await save();idempotent=Boolean(operation.idempotent);
        } else saved=await save();
        for (const request of saved) await owner.eventBus?.publish("cleaning.request.cancelled.v1", { tenantId:tenant.id, customerId, requestId:request.id, calendarEventId:existing.calendarEventId || null, reason }, { source:"cleaning-engine", capabilityId });
        return { requests:saved, event, idempotent };
      },
      createRequest: async (input, options = {}) => {
        assert("request.create");
        const rows=await createRequests([input],options);
        return rows[0];
      },
      createRequests: async (inputs, options = {}) => { assert("request.create"); return createRequests(inputs,options); },
      updateRequest: async (requestId, patch = {}) => {
        assert("request.update");
        const requests = await this.requestRepository.listByCustomer(tenant.id, customerId);
        const existing = requests.find((request) => request.id === requestId);
        if (!existing) throw new Error("Cleaning request was not found for this customer and tenant.");
        if (["completed", "cancelled"].includes(existing.status)) {
          const error = new Error(`Cleaning request cannot be changed while it is ${existing.status}.`);
          error.code = "CLEANING_REQUEST_NOT_MODIFIABLE";
          throw error;
        }
        if (patch.serviceId) {
          const service = this.serviceRepository.loadServices(tenant.id).find((entry) => entry.id === patch.serviceId && entry.active !== false);
          if (!service) throw new Error("Cleaning service is not available.");
          patch = { ...patch, serviceName: service.name };
        }
        const protectedKeys = new Set(["id", "tenantId", "customerId", "createdAt", "timeline", "revision"]);
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          if (!protectedKeys.has(key) && value !== undefined && JSON.stringify(existing[key]) !== JSON.stringify(value)) changes[key] = value;
        }
        if (!Object.keys(changes).length) return existing;
        const updatedAt = new Date().toISOString();
        const request = {
          ...existing,
          ...changes,
          revision: Number(existing.revision || 1) + 1,
          updatedAt,
          timeline: [
            ...(Array.isArray(existing.timeline) ? existing.timeline : []),
            { action: "updated", at: updatedAt, changes: structuredClone(changes) }
          ]
        };
        let saved=request;
        const calendarRelevant=existing.calendarEventId&&owner.calendarService&&["preferredDate","preferredTime","serviceId","durationHours","cleanerCount","timeFlexible"].some((key)=>key in changes);
        if(calendarRelevant&&request.timeFlexible){
          const pending={...request,status:"requested",calendarEventId:null,calendarProvider:null};
          const operation=await owner.calendarService.cancel({tenantId:tenant.id,customerId,eventId:existing.calendarEventId,reason:"changed_to_flexible_time",work:()=>owner.requestRepository.save(pending)});
          saved=operation.result||pending;
        }else if(calendarRelevant){
          const operation=await owner.calendarService.reschedule({tenantId:tenant.id,customerId,eventId:existing.calendarEventId,...cleaningCalendarInput(request),reason:"customer_requested",work:()=>owner.requestRepository.save(request)});
          if(operation.status==='unavailable'){
            const error=new Error("The requested replacement cleaning slot is unavailable.");error.code="CALENDAR_SLOT_UNAVAILABLE";error.alternatives=operation.alternatives||[];throw error;
          }
          saved=operation.result||request;
        }else saved=await owner.requestRepository.save(request);
        await this.eventBus?.publish("cleaning.request.updated.v1", { tenantId: tenant.id, customerId, requestId, revision: request.revision, changes }, { source: "cleaning-engine", capabilityId });
        return saved;
      },
      listRequests: async () => { assert("read"); return this.requestRepository.listByCustomer(tenant.id, customerId); }
    });

    async function createRequests(inputs, { holdId = null } = {}) {
      const configured = owner.serviceRepository.loadServices(tenant.id).filter((service) => service.active !== false);
      const createdAt = new Date().toISOString();
      const requests = (inputs || []).map((input, index) => {
        const service = configured.find((entry) => entry.id === input.serviceId);
        if (!service) throw new Error("Cleaning service is not available.");
        return createCleaningRequest({ ...input, id:`CLN-${Date.now().toString(36).toUpperCase()}-${index}-${Math.random().toString(36).slice(2,7).toUpperCase()}`, tenantId:tenant.id, customerId, serviceName:service.name, status:holdId?"confirmed":"requested", createdAt });
      });
      const save = async () => { for (const request of requests) await owner.requestRepository.save(request); return requests; };
      let saved = requests, event = null;
      if (holdId && owner.calendarService) {
        const committed = await owner.calendarService.confirmHold({ tenantId:tenant.id, customerId, holdId, referenceType:"cleaning_request", referenceId:requests[0]?.id || null, subject:requests.map((request) => request.serviceName).join(" + "), metadata:{ requestIds:requests.map((request) => request.id) }, work:save });
        event = committed.event; saved = committed.result || requests;
        saved = await Promise.all(saved.map((request) => owner.requestRepository.save({ ...request, calendarEventId:event.id, calendarProvider:event.provider, updatedAt:new Date().toISOString() })));
      } else await save();
      for (const request of saved) await owner.eventBus?.publish(holdId?"cleaning.request.confirmed.v1":"cleaning.request.created.v1", { tenantId:tenant.id, customerId, requestId:request.id, serviceId:request.serviceId, calendarEventId:event?.id || null }, { source:"cleaning-engine", capabilityId });
      return saved;
    }
  }
}

function cleaningCalendarInput(input = {}) {
  const durationMinutes = Number(input.durationHours || 0) * 60 || null;
  const serviceIds = [input.serviceId, ...(input.additionalServices || []).map((item) => item.serviceId)].filter(Boolean);
  const capacityRequired = Math.max(1, Number(input.cleanerCount || 1));
  return { date:input.preferredDate || input.date, time:input.preferredTime || input.startTime || input.time, durationMinutes, capacityRequired, serviceIds };
}
function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff ]+/g, " ")
    // Treat common English inflections as one service identity. This lets a
    // tenant configure "deep cleaning" once while customers naturally say
    // "deep clean" or "deep cleaned" without falling back to routine service.
    .replace(/\b(?:clean(?:ing|ed|s)?|clening|cleening|clning|clen)\b/g, "clean")
    .replace(/\s+/g, " ")
    .trim();
}
function bestServiceMatch(services, query) {
  const [best] = rankedServiceMatches(services, query, { minScore:20, limit:1 });
  return best || { service:null, score:0 };
}
/**
 * Return every explicitly mentioned service, not just the single highest hit.
 * Conversation orchestration uses this for additive requests such as
 * "office cleaning and a 3-seater sofa cleaning". Low, generic "cleaning"
 * token matches remain available to the legacy single-service resolver but
 * callers can require minScore >= 60 for explicit multi-service identity.
 */
function rankedServiceMatches(services, query, { minScore=20, limit=50 } = {}) {
  const q=normalize(query);if(!q)return [];
  return (services||[]).map((service)=>({service,score:scoreService(service,q)}))
    .filter((entry)=>entry.score>=minScore)
    .sort((a,b)=>b.score-a.score||String(a.service.name).localeCompare(String(b.service.name)))
    .slice(0,limit);
}
function scoreService(service,q){
  const name=normalize(service.name);
  const identities=[service.name,...(service.aliases||[])].map(normalize);
  const tags=(service.tags||[]).map(normalize);
  let current=0;
  for(const phrase of identities){
    if(!phrase)continue;
    if(hasPhrase(q,phrase)){
      const specificity=Math.min(9,phrase.split(' ').filter(Boolean).length);
      current=Math.max(current,phrase===name?100:80+specificity);
    }
    else{
      const words=phrase.split(' ').filter((word)=>word.length>2);
      const hits=words.filter((word)=>new RegExp(`\\b${escapeRegExp(word)}\\b`).test(q)).length;
      current=Math.max(current,hits*20);
    }
  }
  for(const tag of tags)if(tag&&hasPhrase(q,tag))current=Math.max(current,20);
  // A generic request such as "clean my house" must not become a specialised
  // deep or move service merely because those aliases also contain house/clean.
  if(tags.includes('deep')&&!/\b(deep|complete|full|detailed|post renovation|post construction|construction dust|move in|move out|moving|end of tenancy)\b/.test(q))current=Math.min(current,20);
  if(/\bmove in\b|\bmove out\b/.test(name)&&!/\bmove in\b|\bmove out\b|\bmoving\b/.test(q))current=Math.min(current,20);
  // A generic whole-property deep-clean request must not fall into a
  // specialised bathroom/kitchen service merely because every deep service
  // shares the word "deep". Specialised services require their own subject.
  const specialties=[
    [/\b(?:bathroom|washroom|toilet)\b/,/\b(?:bathroom|washroom|toilet)\b/],
    [/\bkitchen\b/,/\bkitchen\b/],
    [/\b(?:sofa|couch|upholstery)\b/,/\b(?:sofa|couch|upholstery)\b/],
    [/\b(?:carpet|rug)\b/,/\b(?:carpet|rug)\b/],
    [/\bmattress\b/,/\bmattress\b/],
    [/\b(?:curtain|drape)\b/,/\b(?:curtain|drape)\b/]
  ];
  for(const [serviceSubject,querySubject] of specialties){
    if(serviceSubject.test(name)&&!querySubject.test(q))current=Math.min(current,15);
  }
  const rejectsBathroom=/\b(?:bathroom|washroom|toilet)\b[\s\S]{0,24}\b(?:nahi|nahin|nhn|not)\b|\b(?:not|nahi|nahin|nhn)\b[\s\S]{0,24}\b(?:bathroom|washroom|toilet)\b/.test(q);
  if(rejectsBathroom&&/\b(?:bathroom|washroom|toilet)\b/.test(name))current=0;
  const wholeHome=/\b(?:whole|entire|full|complete|pura|poora)\s+(?:ghar|home|house|property)\b|\b(?:ghar|home|house|property)\s+(?:deep\s+)?clean\b/.test(q);
  if(wholeHome&&name==='deep home clean'&&/\bdeep\b/.test(q))current=Math.max(current,98);
  const genericDeep=/\bdeep\b/.test(q)&&!/\b(?:apartment|flat|studio|villa|bathroom|washroom|toilet|kitchen|sofa|couch|carpet|rug|mattress|curtain|renovation|construction|move in|move out)\b/.test(q);
  if(genericDeep&&name==='deep home clean')current=Math.max(current,92);
  const specialisedPropertyScope=/\b(?:post renovation|post construction|construction dust|move in|move out|moving|end of tenancy)\b/.test(q);
  if(!specialisedPropertyScope&&/\bdeep\b/.test(q)&&/\bvilla\b/.test(q)&&name==='deep villa clean')current=Math.max(current,110);
  if(!specialisedPropertyScope&&/\bdeep\b/.test(q)&&/\b(?:apartment|flat|studio)\b/.test(q)&&name==='deep apartment clean')current=Math.max(current,110);
  if(/\bstandard\b/.test(q)&&/\bclean\b/.test(q)&&name==='standard home clean')current=Math.max(current,105);
  return current;
}
function hasPhrase(query,phrase){return (` ${query} `).includes(` ${phrase} `);}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
module.exports = { CleaningService, bestServiceMatch, rankedServiceMatches };
