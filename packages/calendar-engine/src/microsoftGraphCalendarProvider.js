// Phase 4 Sprint 3 — Microsoft Graph Calendar Provider.
//
// Implements the same CalendarProvider contract as GoogleCalendarProvider
// (check, hold, confirmHold, releaseHold, reschedule, cancel, listEvents)
// against the Microsoft Graph API.
//
// Microsoft Graph notes:
//   - No native "hold" concept. A hold is an event with `status: "tentative"`
//     and a `categories: ["NovaHold"]` marker. confirmHold sets it to "accepted"
//     and recategorizes to ["NovaConfirmed"].
//   - check() uses the getSchedule API (requires Calendar.Read) — but since we
//     already have Calendars.ReadWrite, we list events overlapping the slot
//     and treat a non-empty result as busy. This avoids the getSchedule
//     restriction (it needs free/busy lookup on others, not self).
//   - All events are created on the user's default calendar (`/me/calendar`).
//   - We tag events with categories NovaHold / NovaConfirmed so listEvents can
//     filter to Nova-managed events only.
// How long a NovaHold event may live before the lazy reaper deletes it. Holds
// are tentative events; if a customer abandons the booking after hold but
// before confirm/release, the reaper (called lazily by check/hold) deletes the
// stale hold so it doesn't block the slot forever.
const HOLD_TTL_MINUTES = 10;

class MicrosoftGraphCalendarProvider {
  constructor({ oauthClient, tokenRepository, logger = null }) {
    this.oauthClient = oauthClient;
    this.tokenRepository = tokenRepository;
    this.logger = logger;
  }

  /** Build an authenticated Graph client for the tenant, persisting refreshed tokens. */
  async _getClient(tenantId) {
    const tokens = this.tokenRepository.load(tenantId);
    if (!tokens) throw new Error(`Microsoft Calendar is not connected for tenant '${tenantId}'. Connect it via the dashboard.`);
    const onRefresh = async (fresh) => {
      try { this.tokenRepository.save(tenantId, fresh); } catch (e) { this.logger?.warn?.("microsoft_graph.token_refresh_persist_failed", { tenantId, error: e.message }); }
    };
    return this.oauthClient.createClientForTokens(tokens, { onRefresh });
  }

  async check(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const { startISO, endISO } = slotToISO(input);
      // Lazily reap expired NovaHold events so abandoned bookings don't block
      // slots forever. Cheap: one extra list call per check, only deletes
      // NovaHold events whose start is in the past.
      await this._reapExpiredHolds(input.tenantId, client).catch(() => {});
      // List events overlapping [start, end) on the default calendar via the
      // calendarView time-window query params (NOT a $filter — Graph's $filter
      // on calendarView has limited support).
      const url = `/me/calendar/calendarView?startDateTime=${encodeURIComponent(startISO)}&endDateTime=${encodeURIComponent(endISO)}&$select=id,subject,start,end,showAs,categories`;
      const res = await client.request(url);
      if (!res.ok) throw new Error(`Graph list failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const events = Array.isArray(data?.value) ? data.value : [];
      // An event blocks the slot if it's marked Busy/Tentative (not Free).
      const blocking = events.filter((e) => e.showAs !== "free");
      if (blocking.length > 0) {
        const alternatives = await this._findAlternatives(input, client, config);
        return {
          status: "unavailable", source: "microsoft_graph", reason: "owner_busy",
          alternatives, date: input.date, startTime: input.startTime, endTime: input.endTime,
        };
      }
      return {
        status: "available", source: "microsoft_graph",
        date: input.date, startTime: input.startTime, endTime: input.endTime, remainingCapacity: 1,
      };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.check_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  /**
   * Delete NovaHold-tagged events whose start time is in the past. Called
   * lazily by check/hold so abandoned holds (customer dropped off after hold
   * but before confirm/release) don't permanently block slots. The 10-minute
   * TTL is enforced by treating any NovaHold event older than HOLD_TTL_MINUTES
   * as expired.
   */
  async _reapExpiredHolds(tenantId, client) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - HOLD_TTL_MINUTES * 60000);
    const url = `/me/calendar/events?$filter=categories/any(c:c eq 'NovaHold') and start/dateTime lt '${cutoff.toISOString()}'&$select=id,start`;
    const res = await client.request(url);
    if (!res.ok) return; // non-fatal — reaping is best-effort
    const data = await res.json().catch(() => null);
    const expired = Array.isArray(data?.value) ? data.value : [];
    for (const ev of expired) {
      try { await client.request(`/me/calendar/events/${ev.id}`, { method: "DELETE" }); }
      catch (e) { this.logger?.warn?.("microsoft_graph.reap_failed", { tenantId, eventId: ev.id, error: e.message }); }
    }
    if (expired.length) this.logger?.info?.("microsoft_graph.holds_reaped", { tenantId, count: expired.length });
  }

  async _findAlternatives(input, client, config) {
    const alternatives = [];
    const slotDuration = config.defaultDurationMinutes || 60;
    const slotInterval = config.slotIntervalMinutes || 30;
    const maxAdvanceDays = config.maxAdvanceDays || 7;
    const now = new Date();
    let searchStart = input.dateISO ? new Date(input.dateISO) : now;
    if (searchStart < now) searchStart = now;
    for (let day = 0; day < maxAdvanceDays && alternatives.length < 3; day++) {
      const dayStart = new Date(searchStart);
      dayStart.setDate(dayStart.getDate() + day);
      dayStart.setHours(8, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(20, 0, 0, 0);
      for (let t = new Date(dayStart); t < dayEnd && alternatives.length < 3; t = new Date(t.getTime() + slotInterval * 60000)) {
        const slotEnd = new Date(t.getTime() + slotDuration * 60000);
        if (slotEnd > dayEnd) break;
        try {
          const startISO = t.toISOString(), endISO = slotEnd.toISOString();
          const url = `/me/calendar/calendarView?startDateTime=${encodeURIComponent(startISO)}&endDateTime=${encodeURIComponent(endISO)}&$select=id,showAs`;
          const res = await client.request(url);
          if (!res.ok) continue;
          const data = await res.json();
          const blocking = (Array.isArray(data?.value) ? data.value : []).filter((e) => e.showAs !== "free");
          if (blocking.length === 0) {
            alternatives.push({
              date: t.toISOString().split("T")[0],
              startTime: t.toTimeString().slice(0, 5),
              endTime: slotEnd.toTimeString().slice(0, 5),
              iso: t.toISOString(),
            });
          }
        } catch (e) {
          // Log instead of silently swallowing — alternative-finding failures
          // used to be invisible.
          this.logger?.warn?.("microsoft_graph.alternative_probe_failed", { tenantId: input.tenantId, error: e.message });
        }
      }
    }
    return alternatives;
  }

  async hold(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const checkResult = await this.check(input, config);
      if (checkResult.status === "unavailable") return checkResult;
      const { startISO, endISO } = slotToISO(input);
      const event = {
        subject: `🔒 HOLD: ${input.serviceName || "Booking"}`,
        body: { contentType: "Text", content: `Tentative hold by Nova. Customer: ${input.customerName || "N/A"}\nService: ${input.serviceName || "N/A"}` },
        start: { dateTime: startISO, timeZone: config.timezone || "UTC" },
        end: { dateTime: endISO, timeZone: config.timezone || "UTC" },
        showAs: "tentative",
        categories: ["NovaHold"],
      };
      const res = await client.request("/me/calendar/events", { method: "POST", body: JSON.stringify(event) });
      if (!res.ok) throw new Error(`Graph create failed (${res.status}): ${await res.text()}`);
      const created = await res.json();
      this.logger?.info?.("microsoft_graph.hold_created", { tenantId: input.tenantId, eventId: created.id });
      return {
        status: "held", source: "microsoft_graph",
        hold: { id: created.id, calendarEventId: created.id, expiresAt: new Date(Date.now() + 10 * 60000).toISOString() },
        date: input.date, startTime: input.startTime, endTime: input.endTime,
      };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.hold_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  async confirmHold(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const eventId = input.holdId || input.calendarEventId;
      if (!eventId) throw new Error("holdId or calendarEventId is required");
      const updates = {
        subject: `✅ ${input.serviceName || "Booking"} — ${input.customerName || "Customer"}`,
        body: { contentType: "Text", content: `Confirmed booking by Nova.\nCustomer: ${input.customerName || "N/A"}\nService: ${input.serviceName || "N/A"}\nPhone: ${input.customerPhone || "N/A"}\nAddress: ${input.address || "N/A"}` },
        showAs: "busy",
        categories: ["NovaConfirmed"],
      };
      // Add the customer as an attendee (gets an invite) if email provided.
      if (input.customerEmail) updates.attendees = [{ emailAddress: { address: input.customerEmail }, type: "required" }];
      const res = await client.request(`/me/calendar/events/${eventId}`, { method: "PATCH", body: JSON.stringify(updates) });
      if (!res.ok) throw new Error(`Graph patch failed (${res.status}): ${await res.text()}`);
      const updated = await res.json();
      this.logger?.info?.("microsoft_graph.hold_confirmed", { tenantId: input.tenantId, eventId });
      return {
        status: "confirmed", source: "microsoft_graph", calendarEventId: updated.id,
        htmlLink: updated.webLink || null,
        date: input.date, startTime: input.startTime, endTime: input.endTime,
      };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.confirm_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  async releaseHold(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const eventId = input.holdId || input.calendarEventId;
      if (!eventId) throw new Error("holdId or calendarEventId is required");
      const res = await client.request(`/me/calendar/events/${eventId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`Graph delete failed (${res.status}): ${await res.text()}`);
      this.logger?.info?.("microsoft_graph.hold_released", { tenantId: input.tenantId, eventId });
      return { status: "released", source: "microsoft_graph", eventId };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.release_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  async reschedule(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const eventId = input.eventId || input.calendarEventId;
      if (!eventId) throw new Error("eventId is required");
      const { startISO, endISO } = slotToISO(input);
      const res = await client.request(`/me/calendar/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ start: { dateTime: startISO, timeZone: config.timezone || "UTC" }, end: { dateTime: endISO, timeZone: config.timezone || "UTC" } }),
      });
      if (!res.ok) throw new Error(`Graph patch failed (${res.status}): ${await res.text()}`);
      const updated = await res.json();
      this.logger?.info?.("microsoft_graph.rescheduled", { tenantId: input.tenantId, eventId });
      return { status: "rescheduled", source: "microsoft_graph", calendarEventId: updated.id, htmlLink: updated.webLink || null };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.reschedule_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  async cancel(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const eventId = input.eventId || input.calendarEventId;
      if (!eventId) throw new Error("eventId is required");
      // Mark cancelled (cancel property) rather than delete, so there's a record.
      const res = await client.request(`/me/calendar/events/${eventId}`, { method: "PATCH", body: JSON.stringify({ isCancelled: true, showAs: "free", categories: ["NovaCancelled"] }) });
      if (!res.ok) throw new Error(`Graph patch failed (${res.status}): ${await res.text()}`);
      this.logger?.info?.("microsoft_graph.cancelled", { tenantId: input.tenantId, eventId });
      return { status: "cancelled", source: "microsoft_graph", eventId };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.cancel_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "unknown", source: "microsoft_graph_error", error: error.message };
    }
  }

  async listEvents(input, config) {
    try {
      const client = await this._getClient(input.tenantId);
      const timeMin = input.from || new Date().toISOString();
      const timeMax = input.to || new Date(Date.now() + 30 * 86400000).toISOString();
      const url = `/me/calendar/calendarView?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$filter=categories/any(c:c eq 'NovaHold' or c eq 'NovaConfirmed')&$select=id,subject,start,end,showAs,categories,webLink&$top=${input.limit || 50}`;
      const res = await client.request(url);
      if (!res.ok) throw new Error(`Graph list failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const events = (data.value || []).map((e) => ({
        id: e.id,
        summary: e.subject,
        status: e.showAs,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        htmlLink: e.webLink || null,
        attendees: (e.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean),
        isHold: (e.categories || []).includes("NovaHold"),
        isConfirmed: (e.categories || []).includes("NovaConfirmed"),
        customer: null,
        service: null,
      }));
      return { status: "ok", source: "microsoft_graph", events };
    } catch (error) {
      this.logger?.error?.("microsoft_graph.list_failed", { tenantId: input.tenantId, error: error.message });
      return { status: "error", source: "microsoft_graph_error", error: error.message, events: [] };
    }
  }
}

// Helper: convert slot input (date + startTime + endTime) to ISO strings.
// Mirrors the Google provider's helper so both adapters accept the same input.
function slotToISO(input) {
  const date = input.date;
  const startTime = input.startTime;
  const endTime = input.endTime;
  const startISO = new Date(`${date}T${startTime}:00`).toISOString();
  const endISO = new Date(`${date}T${endTime}:00`).toISOString();
  return { startISO, endISO };
}

module.exports = { MicrosoftGraphCalendarProvider };
