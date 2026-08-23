const { createId } = require("../../shared/src/ids");
const { fingerprint } = require("../../shared/src/idempotency");
const { NotFoundError, ConflictError } = require("../../shared/src/errors");

class BookingService {
  constructor({ configRepository, repository, eventBus = null, calendarService = null }) { Object.assign(this, { configRepository, repository, eventBus, calendarService }); }

  scope({ tenant, customerId, conversationId }) {
    const tenantId = tenant.id;
    return Object.freeze({
      getConfig: () => this.getConfig(tenantId),
      create: (slots, options = {}) => this.create({ tenantId, customerId, conversationId, slots, ...options }),
      list: () => this.repository.list(tenantId, customerId),
      checkAvailability: (slots) => this.checkAvailability({ tenantId, slots }),
      holdSlot: (slots, options = {}) => this.holdSlot({ tenantId, customerId, conversationId, slots, ...options }),
      releaseHold: (holdId, reason) => this.calendarService?.releaseHold({ tenantId, customerId, holdId, reason }),
      proposeAmendment: (bookingId, change) => this.proposeAmendment({ tenantId, customerId, bookingId, change }),
      reschedule: (bookingId, change) => this.reschedule({ tenantId, customerId, bookingId, change }),
      cancel: (bookingId, reason) => this.cancel({ tenantId, customerId, bookingId, reason })
    });
  }

  getConfig(tenantId) { return this.configRepository.load(tenantId) || {}; }

  async checkAvailability({ tenantId, slots }) {
    if (!this.calendarService) return { status: "unknown", source: "calendar_not_connected" };
    return this.calendarService.check({ tenantId, ...calendarInput(slots, this.getConfig(tenantId)) });
  }

  async holdSlot({ tenantId, customerId, conversationId, slots, idempotencyKey = null }) {
    if (!this.calendarService) return { status: "unknown", source: "calendar_not_connected" };
    return this.calendarService.hold({ tenantId, customerId, conversationId, ...calendarInput(slots, this.getConfig(tenantId)), subject: slots.subject || null, idempotencyKey });
  }

  async create({ tenantId, customerId, conversationId, slots, holdId = null }) {
    const idempotencyKey = fingerprint("booking", { customerId, conversationId, slots });
    const existing = await this.repository.findByIdempotencyKey?.(tenantId, idempotencyKey);
    if (existing) return existing;
    let held = null;
    if (this.calendarService) {
      if (holdId) held = { status: "held", hold: { id: holdId } };
      else held = await this.holdSlot({ tenantId, customerId, conversationId, slots, idempotencyKey: `booking:${idempotencyKey}` });
      if (held?.status === "unavailable") { const error = new ConflictError("The selected calendar slot is no longer available.", held); error.code = "CALENDAR_SLOT_UNAVAILABLE"; error.alternatives = held.alternatives || []; throw error; }
    }
    const live = held?.status === "held";
    const createdAt = new Date().toISOString();
    const record = { id: createId("BKG"), tenantId, customerId, conversationId, status: live ? "confirmed" : "requested", slots: structuredClone(slots), idempotencyKey, revision: 1, calendarEventId: null, calendarProvider: live ? "local" : null, timeline: [{ action: live ? "confirmed" : "created", at: createdAt }], createdAt, updatedAt: createdAt };
    let saved;
    if (live) {
      const committed = await this.calendarService.confirmHold({ tenantId, customerId, holdId: held.hold.id, referenceType: "booking", referenceId: record.id, subject: slots.subject || null, metadata: { conversationId }, work: () => this.repository.create(record) });
      saved = committed.result || record;
      if (!saved.calendarEventId) {
        saved = { ...saved, calendarEventId: committed.event.id, calendarProvider: committed.event.provider, updatedAt: new Date().toISOString() };
        saved = await this.repository.save(saved);
      }
    } else saved = await this.repository.create(record);
    if (saved.id !== record.id) return saved;
    await this.eventBus?.publish(live ? "booking.confirmed.v1" : "booking.created.v1", saved, { source: "booking-engine" });
    return saved;
  }

  async proposeAmendment({ tenantId, customerId, bookingId, change }) {
    const record = await this.#customerBooking(tenantId, customerId, bookingId);
    if (["completed", "cancelled"].includes(record.status)) { const error = new Error(`Booking cannot be changed while it is ${record.status}.`); error.code = "BOOKING_NOT_MODIFIABLE"; throw error; }
    const updatedAt = new Date().toISOString(), proposal = { ...structuredClone(change), status: "pending_availability", requestedAt: change.requestedAt || updatedAt };
    const updated = { ...record, revision: Number(record.revision || 1) + 1, updatedAt, proposedChanges: [...(record.proposedChanges || []), proposal], timeline: [...(record.timeline || []), { action: "amendment_proposed", at: updatedAt, proposal }] };
    const saved = await this.repository.save(updated);
    await this.eventBus?.publish("booking.amendment.proposed.v1", { tenantId, customerId, bookingId, revision: saved.revision, proposal }, { source: "booking-engine" });
    return saved;
  }

  async reschedule({ tenantId, customerId, bookingId, change }) {
    const record = await this.#customerBooking(tenantId, customerId, bookingId);
    if (!record.calendarEventId || !this.calendarService) return this.proposeAmendment({ tenantId, customerId, bookingId, change });
    const nextSlots = { ...record.slots, ...(change.date ? { date: change.date } : {}), ...(change.time ? { time: change.time } : {}) };
    const operation = await this.calendarService.reschedule({ tenantId, customerId, eventId: record.calendarEventId, ...calendarInput(nextSlots, this.getConfig(tenantId)), reason: change.reason || "customer_requested", work: async () => {
      const now = new Date().toISOString(), before = structuredClone(record.slots);
      return this.repository.save({ ...record, slots: nextSlots, revision: Number(record.revision || 1) + 1, updatedAt: now, timeline: [...(record.timeline || []), { action: "rescheduled", at: now, before, after: structuredClone(nextSlots) }] });
    } });
    if (operation.status === "unavailable") return operation;
    await this.eventBus?.publish("booking.rescheduled.v1", { tenantId, customerId, bookingId, calendarEventId: record.calendarEventId, slots: nextSlots }, { source: "booking-engine" });
    return { status: "rescheduled", booking: operation.result, event: operation.event };
  }

  async cancel({ tenantId, customerId, bookingId, reason = "customer_requested" }) {
    const record = await this.#customerBooking(tenantId, customerId, bookingId);
    if (record.status === "cancelled") return record;
    const work = async () => { const now = new Date().toISOString(); return this.repository.save({ ...record, status: "cancelled", revision: Number(record.revision || 1) + 1, cancelledAt: now, cancellationReason: reason, updatedAt: now, timeline: [...(record.timeline || []), { action: "cancelled", at: now, reason }] }); };
    const operation = record.calendarEventId && this.calendarService ? await this.calendarService.cancel({ tenantId, customerId, eventId: record.calendarEventId, reason, work }) : { result: await work() };
    await this.eventBus?.publish("booking.cancelled.v1", { tenantId, customerId, bookingId, reason }, { source: "booking-engine" });
    return operation.result || record;
  }

  async #customerBooking(tenantId, customerId, bookingId) { const record = await this.repository.get(tenantId, bookingId); if (!record || record.customerId !== customerId) throw new NotFoundError("Booking not found for this customer and tenant."); return record; }
}

function calendarInput(slots = {}, config = {}) {
  const items = Array.isArray(slots.items) ? slots.items : [];
  const itemDuration = items.reduce((total, item) => total + Number(item.metadata?.durationMinutes || 0) * Number(item.quantity || 1), 0);
  const durationMinutes = Number(slots.durationHours || 0) * 60 || itemDuration || null;
  const capacityRequired = config.mode === "reservation" ? Number(slots.partySize || 1) : Number(slots.capacityRequired || 1);
  return { date: slots.date, time: slots.time, durationMinutes, capacityRequired, serviceIds: items.map((item) => item.id).filter(Boolean), subject: slots.subject || null };
}

module.exports = { BookingService, calendarInput };
