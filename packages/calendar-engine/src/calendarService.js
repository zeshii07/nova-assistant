const crypto = require("crypto");
const { parseHoursRange, parseTimeMinutes } = require("../../service-availability/src/serviceAvailabilityEngine");
const { ValidationError, NotFoundError, ConflictError } = require("../../shared/src/errors");
const { assertCalendarProvider } = require("./calendarProviderContract");

class CalendarService {
  constructor({ configRepository, repository, hoursProvider = null, eventBus = null, providers = {}, clock = () => process.env.NOVA_TEST_NOW ? new Date(process.env.NOVA_TEST_NOW) : new Date() }) {
    Object.assign(this, { configRepository, repository, hoursProvider, eventBus, clock });
    this.locks = new Map();
    this.providers = new Map();
    for (const [name, provider] of Object.entries(providers || {})) this.registerProvider(name, provider);
  }

  registerProvider(name, provider) { this.providers.set(String(name).toLowerCase(), assertCalendarProvider(provider)); return this; }

  scope({ tenant, customerId, conversationId }) {
    const tenantId = tenant.id;
    return Object.freeze({
      config: () => this.getConfig(tenantId),
      check: (input) => this.check({ tenantId, ...input }),
      hold: (input) => this.hold({ tenantId, customerId, conversationId, ...input }),
      releaseHold: (holdId, reason) => this.releaseHold({ tenantId, customerId, holdId, reason }),
      confirmHold: (input) => this.confirmHold({ tenantId, customerId, ...input }),
      listEvents: () => this.listEvents({ tenantId, customerId }),
      reschedule: (input) => this.reschedule({ tenantId, customerId, ...input }),
      cancel: (input) => this.cancel({ tenantId, customerId, ...input })
    });
  }

  getConfig(tenantId) { return this.configRepository.load(tenantId); }

  async check(input) {
    const config = this.getConfig(input.tenantId);
    if (!config.enabled || config.provider === "disabled") return { status: "unknown", source: "calendar_disabled" };
    const slot = this.#normalizeSlot(input, config);
    if (slot.error) return slot.error;
    const hoursIssue = this.#hoursIssue(input.tenantId, slot);
    if (hoursIssue) return hoursIssue;
    const dateIssue = this.#dateIssue(slot, config);
    if (dateIssue) return dateIssue;
    if (config.provider !== "local") {
      const provider=this.providers.get(config.provider);
      return provider ? provider.check(providerInput(input,slot),structuredClone(config)) : { status: "unknown", source: "provider_not_connected", provider: config.provider };
    }
    const state = this.repository.readState(input.tenantId);
    this.#expire(state);
    const result = this.#availability(state, slot, input.excludeEventId || null);
    if (!result.available) {
      const alternatives = this.#alternatives(state, slot, config, input.excludeEventId || null);
      return { status: "unavailable", source: "local_calendar", reason: "capacity_conflict", alternatives, ...publicSlot(slot), remainingCapacity: result.remainingCapacity };
    }
    return { status: "available", source: "local_calendar", ...publicSlot(slot), remainingCapacity: result.remainingCapacity };
  }

  async hold(input) {
    return this.#locked(input.tenantId, async () => {
      const config = this.getConfig(input.tenantId);
      if (!config.enabled) return { status: "unknown", source:"calendar_disabled" };
      const slot = this.#normalizeSlot(input, config);
      if (slot.error) return slot.error;
      const hoursIssue = this.#hoursIssue(input.tenantId, slot);
      if (hoursIssue) return hoursIssue;
      const dateIssue = this.#dateIssue(slot, config);
      if (dateIssue) return dateIssue;
      if (config.provider !== "local") {
        const provider=this.providers.get(config.provider);
        return provider ? provider.hold(providerInput(input,slot),structuredClone(config)) : { status:"unknown", source:"provider_not_connected", provider:config.provider };
      }
      const state = this.repository.readState(input.tenantId);
      this.#expire(state);
      const idempotencyKey = input.idempotencyKey || fingerprint([input.customerId, input.conversationId, slot.localDate, slot.startMinutes, slot.endMinutes, slot.poolId, slot.capacityRequired, slot.serviceIds]);
      const existingId = state.idempotency[`hold:${idempotencyKey}`];
      const existing = existingId ? state.holds[existingId] : null;
      if (existing?.status === "active" && new Date(existing.expiresAt) > this.clock()) return { status: "held", source: "local_calendar", hold: structuredClone(existing), ...publicSlot(slot), remainingCapacity: this.#availability(state, slot, input.excludeEventId || null, existing.id).remainingCapacity };
      for (const hold of Object.values(state.holds)) {
        if (hold.tenantId === input.tenantId && hold.conversationId === input.conversationId && hold.customerId === input.customerId && hold.status === "active") {
          hold.status = "released"; hold.releaseReason = "superseded"; hold.releasedAt = this.#now();
        }
      }
      const available = this.#availability(state, slot, input.excludeEventId || null);
      if (!available.available) {
        this.repository.writeState(input.tenantId, state);
        return { status: "unavailable", source: "local_calendar", reason: "capacity_conflict", alternatives: this.#alternatives(state, slot, config, input.excludeEventId || null), ...publicSlot(slot), remainingCapacity: available.remainingCapacity };
      }
      const id = makeId("HLD");
      const createdAt = this.#now();
      const expiresAt = new Date(this.clock().getTime() + config.holdTtlSeconds * 1000).toISOString();
      const hold = { id, tenantId: input.tenantId, customerId: input.customerId || null, conversationId: input.conversationId || null, status: "active", provider: "local", serviceIds: slot.serviceIds, subject: input.subject || null, ...storedSlot(slot), idempotencyKey, createdAt, expiresAt, confirmedAt: null, releasedAt: null, releaseReason: null };
      state.holds[id] = hold;
      state.idempotency[`hold:${idempotencyKey}`] = id;
      this.#audit(state, "slot.held", { holdId: id, customerId: input.customerId || null, localDate: slot.localDate, localTime: slot.localTime });
      this.repository.writeState(input.tenantId, state);
      await this.#emit("calendar.slot.held.v1", hold);
      return { status: "held", source: "local_calendar", hold: structuredClone(hold), ...publicSlot(slot), remainingCapacity: available.remainingCapacity - slot.capacityRequired };
    });
  }

  async releaseHold({ tenantId, customerId = null, holdId, reason = "released" }) {
    const config=this.getConfig(tenantId);
    if(config.provider!=="local"){
      const provider=this.providers.get(config.provider);
      return provider ? provider.releaseHold({tenantId,customerId,holdId,reason},structuredClone(config)) : {status:"unknown",source:"provider_not_connected",provider:config.provider};
    }
    return this.#locked(tenantId, async () => {
      const state = this.repository.readState(tenantId); this.#expire(state);
      const hold = state.holds[holdId];
      if (!hold || hold.tenantId !== tenantId || customerId && hold.customerId !== customerId) return null;
      if (hold.status !== "active") return structuredClone(hold);
      hold.status = "released"; hold.releaseReason = String(reason); hold.releasedAt = this.#now();
      this.#audit(state, "slot.released", { holdId, reason }); this.repository.writeState(tenantId, state);
      await this.#emit("calendar.slot.released.v1", hold); return structuredClone(hold);
    });
  }

  async confirmHold({ tenantId, customerId = null, holdId, referenceType = "booking", referenceId, subject = null, metadata = {}, eventType = "appointment", work = null }) {
    const config=this.getConfig(tenantId);
    if(config.provider!=="local"){
      const provider=this.providers.get(config.provider);
      return provider ? provider.confirmHold({tenantId,customerId,holdId,referenceType,referenceId,subject,metadata:structuredClone(metadata || {}),eventType,work},structuredClone(config)) : {status:"unknown",source:"provider_not_connected",provider:config.provider};
    }
    return this.#locked(tenantId, async () => {
      const state = this.repository.readState(tenantId); this.#expire(state);
      const hold = state.holds[holdId];
      if (!hold || hold.tenantId !== tenantId || customerId && hold.customerId !== customerId) throw new NotFoundError("Calendar hold was not found for this customer and tenant.");
      if (hold.status === "confirmed" && hold.eventId && state.events[hold.eventId]) return { event: structuredClone(state.events[hold.eventId]), result: null, idempotent: true };
      if (hold.status !== "active") throw new ConflictError("The calendar hold is no longer active. Check availability again.", { holdStatus: hold.status });
      const result = work ? await work() : null;
      const id = makeId("EVT"), now = this.#now();
      const event = { id, tenantId, customerId: customerId || hold.customerId || null, type: eventType, status: "confirmed", provider: "local", referenceType, referenceId: referenceId || result?.id || null, subject: subject || hold.subject || null, serviceIds: hold.serviceIds || [], localDate: hold.localDate, localTime: hold.localTime, endLocalTime: hold.endLocalTime, startAt: hold.startAt, endAt: hold.endAt, timezone: hold.timezone, poolId: hold.poolId, capacityRequired: hold.capacityRequired, metadata: structuredClone(metadata || {}), revision: 1, createdAt: now, updatedAt: now, timeline: [{ action: "confirmed", at: now }] };
      state.events[id] = event;
      hold.status = "confirmed"; hold.confirmedAt = now; hold.eventId = id;
      this.#audit(state, "event.confirmed", { eventId: id, holdId, referenceType, referenceId: event.referenceId });
      this.repository.writeState(tenantId, state);
      await this.#emit("calendar.event.confirmed.v1", event);
      return { event: structuredClone(event), result, idempotent: false };
    });
  }

  async reschedule({ tenantId, customerId = null, eventId, date, time, durationMinutes = null, capacityRequired = null, serviceIds = null, reason = null, work = null }) {
    const configured=this.getConfig(tenantId);
    if(configured.provider!=="local"){
      const slot=this.#normalizeSlot({tenantId,date,time,durationMinutes,capacityRequired,serviceIds},configured);
      if(slot.error)throw new ValidationError(slot.error.message || "A valid date and time are required.",slot.error);
      const hoursIssue=this.#hoursIssue(tenantId,slot),dateIssue=this.#dateIssue(slot,configured);
      if(hoursIssue||dateIssue)throw new ValidationError((hoursIssue||dateIssue).message,hoursIssue||dateIssue);
      const provider=this.providers.get(configured.provider);
      return provider ? provider.reschedule({tenantId,customerId,eventId,...providerInput({date,time,durationMinutes,capacityRequired,serviceIds},slot),reason,work},structuredClone(configured)) : {status:"unknown",source:"provider_not_connected",provider:configured.provider};
    }
    return this.#locked(tenantId, async () => {
      const config = this.getConfig(tenantId), state = this.repository.readState(tenantId); this.#expire(state);
      const event = state.events[eventId];
      this.#assertEvent(event, tenantId, customerId);
      if (event.status !== "confirmed") throw new ConflictError(`Calendar event cannot be moved while it is ${event.status}.`);
      const slot = this.#normalizeSlot({ tenantId, date, time, durationMinutes: durationMinutes || minutesBetween(event.startAt, event.endAt), capacityRequired: capacityRequired || event.capacityRequired, serviceIds: serviceIds || event.serviceIds }, config);
      if (slot.error) throw new ValidationError(slot.error.message || "A valid date and time are required.", slot.error);
      const hoursIssue = this.#hoursIssue(tenantId, slot), dateIssue = this.#dateIssue(slot, config);
      if (hoursIssue || dateIssue) throw new ValidationError((hoursIssue || dateIssue).message, hoursIssue || dateIssue);
      const available = this.#availability(state, slot, eventId);
      if (!available.available) return { status: "unavailable", alternatives: this.#alternatives(state, slot, config, eventId), ...publicSlot(slot) };
      const result = work ? await work() : null, before = pickSchedule(event), now = this.#now();
      Object.assign(event, storedSlot(slot), { serviceIds: slot.serviceIds, revision: Number(event.revision || 1) + 1, updatedAt: now });
      event.timeline = [...(event.timeline || []), { action: "rescheduled", at: now, before, after: pickSchedule(event), reason: reason || null }];
      this.#audit(state, "event.rescheduled", { eventId, before, after: pickSchedule(event), reason }); this.repository.writeState(tenantId, state);
      await this.#emit("calendar.event.rescheduled.v1", event); return { status: "rescheduled", event: structuredClone(event), result };
    });
  }

  async cancel({ tenantId, customerId = null, eventId, reason = null, work = null }) {
    const config=this.getConfig(tenantId);
    if(config.provider!=="local"){
      const provider=this.providers.get(config.provider);
      return provider ? provider.cancel({tenantId,customerId,eventId,reason,work},structuredClone(config)) : {status:"unknown",source:"provider_not_connected",provider:config.provider};
    }
    return this.#locked(tenantId, async () => {
      const state = this.repository.readState(tenantId), event = state.events[eventId]; this.#assertEvent(event, tenantId, customerId);
      if (event.status === "cancelled") return { status: "cancelled", event: structuredClone(event), result: null, idempotent: true };
      const result = work ? await work() : null, now = this.#now();
      event.status = "cancelled"; event.cancelledAt = now; event.cancellationReason = reason || null; event.revision = Number(event.revision || 1) + 1; event.updatedAt = now;
      event.timeline = [...(event.timeline || []), { action: "cancelled", at: now, reason: reason || null }];
      this.#audit(state, "event.cancelled", { eventId, reason }); this.repository.writeState(tenantId, state);
      await this.#emit("calendar.event.cancelled.v1", event); return { status: "cancelled", event: structuredClone(event), result };
    });
  }

  async createBlock({ tenantId, date, time, durationMinutes, capacityRequired = 1, poolId = null, subject = "Blocked time", actorId = null }) {
    const held = await this.hold({ tenantId, customerId: `control-plane:${actorId || "system"}`, conversationId: makeId("BLOCK"), date, time, durationMinutes, capacityRequired, poolId, subject });
    if (held.status !== "held") return held;
    const confirmed = await this.confirmHold({ tenantId, holdId: held.hold.id, referenceType: "calendar_block", referenceId: actorId || "system", subject, metadata: { actorId }, eventType:"block" });
    return { status: "confirmed", event: confirmed.event };
  }

  listEvents({ tenantId, customerId = null, includeCancelled = false }) {
    const config=this.getConfig(tenantId);
    if(config.provider!=="local"){
      const provider=this.providers.get(config.provider);
      return provider ? provider.listEvents({tenantId,customerId,includeCancelled},structuredClone(config)) : [];
    }
    const state = this.repository.readState(tenantId); this.#expire(state);
    return Object.values(state.events).filter((event) => event.tenantId === tenantId && (!customerId || event.customerId === customerId) && (includeCancelled || event.status !== "cancelled")).sort((left, right) => String(left.startAt).localeCompare(String(right.startAt))).map((event) => structuredClone(event));
  }

  listHolds({ tenantId, activeOnly = true }) {
    const state = this.repository.readState(tenantId); this.#expire(state);
    return Object.values(state.holds).filter((hold) => hold.tenantId === tenantId && (!activeOnly || hold.status === "active")).map((hold) => structuredClone(hold));
  }

  provider() { return { check: (input) => this.check(input) }; }

  #normalizeSlot(input, config) {
    const localDate = normalizeDate(input.date || input.localDate), startMinutes = parseTimeMinutes(input.time || input.localTime);
    if (!localDate || startMinutes == null) return { error: { status: "needs_date_time", source: "local_calendar", message: "A valid date and start time are required for a live availability check." } };
    const serviceIds = unique(input.serviceIds || [input.serviceId].filter(Boolean));
    const rule = config.serviceRules.find((item) => serviceIds.includes(item.serviceId)) || null;
    const pool = input.poolId ? config.resourcePools.find((item) => item.id === input.poolId && item.active) : config.resourcePools.find((item) => item.active && item.serviceIds.some((id) => serviceIds.includes(id))) || config.resourcePools.find((item) => item.id === rule?.poolId && item.active) || config.resourcePools.find((item) => item.active);
    if (!pool) return { error: { status: "unknown", source: "calendar_no_resource_pool", message: "No active calendar resource pool is configured." } };
    const durationMinutes = positive(input.durationMinutes, rule?.durationMinutes || config.defaultDurationMinutes);
    const capacityRequired = positive(input.capacityRequired, rule?.capacityRequired || 1);
    if (capacityRequired > pool.capacity) return { error: { status: "unavailable", source: "local_calendar", reason: "capacity_exceeded", message: `This request needs ${capacityRequired} capacity units, but '${pool.name}' has ${pool.capacity}.`, alternatives: [] } };
    const endMinutes = startMinutes + durationMinutes;
    if (endMinutes > 24 * 60) return { error: { status: "invalid_time", source: "local_calendar", message: "The requested duration runs past the end of the day." } };
    const localTime = formatMinutes(startMinutes), endLocalTime = formatMinutes(endMinutes), timezone = config.timezone;
    return { localDate, localTime, endLocalTime, startMinutes, endMinutes, durationMinutes, capacityRequired, poolId: pool.id, poolName: pool.name, poolCapacity: pool.capacity, serviceIds, timezone, startAt: zonedToIso(localDate, localTime, timezone), endAt: zonedToIso(localDate, endLocalTime, timezone) };
  }

  #hoursIssue(tenantId, slot) {
    if (!this.hoursProvider || !slot.localDate) return null;
    const day = weekday(slot.localDate), hours = this.hoursProvider.check({ tenantId, day });
    if (hours.status === "closed") return { status: "closed", source: "business_hours", day, message: `The business is closed on ${title(day)}.` };
    if (hours.status !== "open") return null;
    const range = parseHoursRange(hours.hours);
    if (range && (slot.startMinutes < range.open || slot.endMinutes > range.close)) return { status: "unavailable", source: "business_hours", reason: "outside_business_hours", day, hours: hours.hours, message: `That time is outside business hours (${hours.hours}).`, alternatives: [] };
    return null;
  }

  #dateIssue(slot, config) {
    const start = new Date(slot.startAt), now = this.clock();
    if (!Number.isFinite(start.getTime())) return { status: "invalid_date", source: "local_calendar", message: "The requested local date/time could not be normalized." };
    if (start.getTime() < now.getTime() + config.minLeadMinutes * 60000) return { status: "unavailable", source: "local_calendar", reason: "minimum_lead_time", message: `This slot needs at least ${config.minLeadMinutes} minutes of notice.`, alternatives: [] };
    if (start.getTime() > now.getTime() + config.maxAdvanceDays * 86400000) return { status: "unavailable", source: "local_calendar", reason: "maximum_advance_window", message: `Slots can be booked up to ${config.maxAdvanceDays} days ahead.`, alternatives: [] };
    return null;
  }

  #availability(state, slot, excludeEventId = null, excludeHoldId = null) {
    let used = 0;
    for (const event of Object.values(state.events)) if (event.status === "confirmed" && event.id !== excludeEventId && event.poolId === slot.poolId && overlaps(event, slot)) used += Number(event.capacityRequired || 1);
    for (const hold of Object.values(state.holds)) if (hold.status === "active" && hold.id !== excludeHoldId && hold.poolId === slot.poolId && overlaps(hold, slot)) used += Number(hold.capacityRequired || 1);
    const remainingCapacity = Math.max(0, slot.poolCapacity - used);
    return { available: remainingCapacity >= slot.capacityRequired, remainingCapacity };
  }

  #alternatives(state, slot, config, excludeEventId = null) {
    const results = [], step = config.slotIntervalMinutes, day = weekday(slot.localDate), hours = this.hoursProvider?.check?.({ tenantId: state.tenantId, day }), range = parseHoursRange(hours?.hours) || { open: 0, close: 24 * 60 };
    for (let distance = step; distance <= 4 * 60 && results.length < 3; distance += step) {
      for (const minutes of [slot.startMinutes + distance, slot.startMinutes - distance]) {
        if (minutes < range.open || minutes + slot.durationMinutes > range.close) continue;
        const candidate = { ...slot, startMinutes: minutes, endMinutes: minutes + slot.durationMinutes, localTime: formatMinutes(minutes), endLocalTime: formatMinutes(minutes + slot.durationMinutes) };
        candidate.startAt = zonedToIso(candidate.localDate, candidate.localTime, candidate.timezone); candidate.endAt = zonedToIso(candidate.localDate, candidate.endLocalTime, candidate.timezone);
        if (this.#availability(state, candidate, excludeEventId).available && !results.some((row) => row.time === candidate.localTime)) results.push({ date: candidate.localDate, time: candidate.localTime, endTime: candidate.endLocalTime });
        if (results.length >= 3) break;
      }
    }
    return results;
  }

  #expire(state) { const now = this.clock(); for (const hold of Object.values(state.holds)) if (hold.status === "active" && new Date(hold.expiresAt) <= now) { hold.status = "expired"; hold.releasedAt = this.#now(); hold.releaseReason = "expired"; } }
  #assertEvent(event, tenantId, customerId) { if (!event || event.tenantId !== tenantId || customerId && event.customerId !== customerId) throw new NotFoundError("Calendar event was not found for this customer and tenant."); }
  #audit(state, action, metadata) { state.audit.push({ id: makeId("CAL-AUD"), tenantId: state.tenantId, action, metadata: structuredClone(metadata || {}), at: this.#now() }); if (state.audit.length > 2000) state.audit = state.audit.slice(-2000); }
  #now() { return this.clock().toISOString(); }
  async #emit(name, payload) { await this.eventBus?.publish(name, payload, { source: "calendar-engine" }); }
  async #locked(tenantId, work) { const previous = this.locks.get(tenantId) || Promise.resolve(); let release; const next = new Promise((resolve) => { release = resolve; }); const queued = previous.then(() => next); this.locks.set(tenantId, queued); await previous; try { return await work(); } finally { release(); if (this.locks.get(tenantId) === queued) this.locks.delete(tenantId); } }
}

function normalizeDate(value) { const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!match) return null; const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]), date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${match[1]}/${match[2]}/${match[3]}` : null; }
function weekday(value) { const [day, month, year] = value.split("/").map(Number); return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]; }
function zonedToIso(date, time, timezone) { const [day, month, year] = date.split("/").map(Number), [hour, minute] = time.split(":").map(Number); let guess = Date.UTC(year, month - 1, day, hour, minute); for (let index = 0; index < 3; index += 1) { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])); const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute); guess += Date.UTC(year, month - 1, day, hour, minute) - rendered; } return new Date(guess).toISOString(); }
function overlaps(record, slot) { return record.localDate === slot.localDate && parseTimeMinutes(record.localTime) < slot.endMinutes && parseTimeMinutes(record.endLocalTime) > slot.startMinutes; }
function storedSlot(slot) { return { localDate: slot.localDate, localTime: slot.localTime, endLocalTime: slot.endLocalTime, startAt: slot.startAt, endAt: slot.endAt, timezone: slot.timezone, poolId: slot.poolId, capacityRequired: slot.capacityRequired }; }
function publicSlot(slot) { return { date: slot.localDate, time: slot.localTime, endTime: slot.endLocalTime, startAt: slot.startAt, endAt: slot.endAt, timezone: slot.timezone, durationMinutes: slot.durationMinutes, poolId: slot.poolId, poolName: slot.poolName, capacityRequired: slot.capacityRequired }; }
function providerInput(input,slot){return {...structuredClone(input),...publicSlot(slot),date:slot.localDate,time:slot.localTime,durationMinutes:slot.durationMinutes,capacityRequired:slot.capacityRequired,serviceIds:[...slot.serviceIds],poolId:slot.poolId};}
function pickSchedule(record) { return { localDate: record.localDate, localTime: record.localTime, endLocalTime: record.endLocalTime, startAt: record.startAt, endAt: record.endAt, timezone: record.timezone, poolId: record.poolId, capacityRequired: record.capacityRequired }; }
function formatMinutes(value) { const minutes = ((Number(value) % 1440) + 1440) % 1440; return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function minutesBetween(start, end) { return Math.max(1, Math.round((new Date(end) - new Date(start)) / 60000)); }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback; }
function unique(values) { return [...new Set((values || []).filter(Boolean).map(String))]; }
function title(value) { return String(value || "").replace(/^./, (character) => character.toUpperCase()); }
function makeId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

module.exports = { CalendarService, normalizeDate, zonedToIso, weekday };
