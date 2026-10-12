/**
 * v31.0 — Google Calendar Provider.
 * Implements the CalendarProvider contract (check, hold, confirmHold,
 * releaseHold, reschedule, cancel, listEvents) using the Google Calendar API.
 *
 * Design notes:
 *   - Google Calendar has no native "hold" concept. A hold is a tentative event
 *     with status "tentative" and a custom extended property nova_hold=true.
 *     When confirmHold is called, we change status to "confirmed" and remove
 *     the nova_hold property.
 *   - check() queries the freeBusy API to see if the owner is free at the
 *     requested time. If busy, we return alternatives (next 3 free slots).
 *   - All events are created on the owner's PRIMARY calendar.
 *   - We use extended properties to mark events as Nova-created so we can
 *     list/cancel only events that Nova created (not the owner's personal events).
 */
const { google } = require('googleapis');

const NOVA_EXT_KEY = 'nova'; // extendedProperties key
const HOLD_TTL_MINUTES = 10; // tentative events expire after 10 minutes

class GoogleCalendarProvider {
  constructor({ oauthClient, tokenRepository, logger = null }) {
    this.oauthClient = oauthClient;
    this.tokenRepository = tokenRepository;
    this.logger = logger;
  }

  async _getCalendar(tenantId) {
    const tokens = this.tokenRepository.load(tenantId);
    if (!tokens) throw new Error(`Google Calendar is not connected for tenant '${tenantId}'. Connect it via the dashboard.`);
    const auth = this.oauthClient.createClientForTokens(tokens);
    return google.calendar({ version: 'v3', auth });
  }

  async _getPrimaryCalendarId(tenantId, calendar) {
    const res = await calendar.calendarList.list();
    const primary = res.data.items.find(c => c.primary);
    if (!primary) throw new Error('No primary calendar found for this Google account.');
    return primary.id;
  }

  async check(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const { startISO, endISO } = slotToISO(input);

      // Query freeBusy to check if the owner is free
      const freebusyRes = await calendar.freebusy.query({
        requestBody: {
          timeMin: startISO,
          timeMax: endISO,
          items: [{ id: calendarId }]
        }
      });
      const busy = freebusyRes.data.calendars?.[calendarId]?.busy || [];
      const isFree = busy.length === 0;

      if (!isFree) {
        // Find next 3 available slots (30-min intervals for the next 7 days)
        const alternatives = await this._findAlternatives(input, calendar, calendarId, config);
        return {
          status: 'unavailable',
          source: 'google_calendar',
          reason: 'owner_busy',
          alternatives,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime
        };
      }
      return {
        status: 'available',
        source: 'google_calendar',
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        remainingCapacity: 1
      };
    } catch (error) {
      this.logger?.error?.('google_calendar.check_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async _findAlternatives(input, calendar, calendarId, config) {
    const alternatives = [];
    const slotDuration = config.defaultDurationMinutes || 60;
    const slotInterval = config.slotIntervalMinutes || 30;
    const maxAdvanceDays = config.maxAdvanceDays || 7;
    const now = new Date();
    const maxDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Start from the requested date, look forward
    let searchStart = new Date(input.dateISO);
    if (searchStart < now) searchStart = now;

    for (let day = 0; day < maxAdvanceDays && alternatives.length < 3; day++) {
      const dayStart = new Date(searchStart);
      dayStart.setDate(dayStart.getDate() + day);
      dayStart.setHours(8, 0, 0, 0); // 8 AM
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(20, 0, 0, 0); // 8 PM

      for (let t = dayStart; t < dayEnd && alternatives.length < 3; t = new Date(t.getTime() + slotInterval * 60 * 1000)) {
        const slotEnd = new Date(t.getTime() + slotDuration * 60 * 1000);
        if (slotEnd > dayEnd) break;
        try {
          const freebusyRes = await calendar.freebusy.query({
            requestBody: {
              timeMin: t.toISOString(),
              timeMax: slotEnd.toISOString(),
              items: [{ id: calendarId }]
            }
          });
          const busy = freebusyRes.data.calendars?.[calendarId]?.busy || [];
          if (busy.length === 0) {
            alternatives.push({
              date: t.toISOString().split('T')[0],
              startTime: t.toTimeString().slice(0, 5),
              endTime: slotEnd.toTimeString().slice(0, 5),
              iso: t.toISOString()
            });
          }
        } catch {}
      }
    }
    return alternatives;
  }

  async hold(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      // First check if the slot is actually free
      const checkResult = await this.check(input, config);
      if (checkResult.status === 'unavailable') return checkResult;

      const { startISO, endISO } = slotToISO(input);
      const event = {
        summary: `🔒 HOLD: ${input.serviceName || 'Booking'}`,
        description: `Tentative hold by Nova. Customer: ${input.customerName || 'N/A'}\nService: ${input.serviceName || 'N/A'}`,
        start: { dateTime: startISO, timeZone: config.timezone || 'UTC' },
        end: { dateTime: endISO, timeZone: config.timezone || 'UTC' },
        status: 'tentative',
        extendedProperties: {
          private: {
            [`${NOVA_EXT_KEY}_hold`]: 'true',
            [`${NOVA_EXT_KEY}_tenant`]: input.tenantId,
            [`${NOVA_EXT_KEY}_customer`]: input.customerId || '',
            [`${NOVA_EXT_KEY}_service`]: input.serviceId || '',
            [`${NOVA_EXT_KEY}_created_at`]: new Date().toISOString()
          }
        }
      };
      const res = await calendar.events.insert({ calendarId, resource: event });
      this.logger?.info?.('google_calendar.hold_created', { tenantId: input.tenantId, eventId: res.data.id });
      return {
        status: 'held',
        source: 'google_calendar',
        hold: { id: res.data.id, calendarEventId: res.data.id, expiresAt: new Date(Date.now() + HOLD_TTL_MINUTES * 60 * 1000).toISOString() },
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime
      };
    } catch (error) {
      this.logger?.error?.('google_calendar.hold_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async confirmHold(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const eventId = input.holdId || input.calendarEventId;
      if (!eventId) throw new Error('holdId or calendarEventId is required');

      // Update the event: change status to confirmed, update summary, add customer email as attendee
      const updates = {
        status: 'confirmed',
        summary: `✅ ${input.serviceName || 'Booking'} — ${input.customerName || 'Customer'}`,
        description: `Confirmed booking by Nova.\nCustomer: ${input.customerName || 'N/A'}\nService: ${input.serviceName || 'N/A'}\nPhone: ${input.customerPhone || 'N/A'}\nAddress: ${input.address || 'N/A'}`,
        extendedProperties: {
          private: {
            [`${NOVA_EXT_KEY}_hold`]: 'false',
            [`${NOVA_EXT_KEY}_confirmed`]: 'true',
            [`${NOVA_EXT_KEY}_tenant`]: input.tenantId,
            [`${NOVA_EXT_KEY}_customer`]: input.customerId || '',
            [`${NOVA_EXT_KEY}_service`]: input.serviceId || ''
          }
        }
      };
      // If customer provided an email, add as attendee so they get a calendar invite
      if (input.customerEmail) {
        updates.attendees = [{ email: input.customerEmail, responseStatus: 'needsAction' }];
      }
      const res = await calendar.events.patch({ calendarId, eventId, resource: updates, sendUpdates: 'all' });
      this.logger?.info?.('google_calendar.hold_confirmed', { tenantId: input.tenantId, eventId });
      return {
        status: 'confirmed',
        source: 'google_calendar',
        calendarEventId: res.data.id,
        htmlLink: res.data.htmlLink,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime
      };
    } catch (error) {
      this.logger?.error?.('google_calendar.confirm_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async releaseHold(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const eventId = input.holdId || input.calendarEventId;
      if (!eventId) throw new Error('holdId or calendarEventId is required');
      await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
      this.logger?.info?.('google_calendar.hold_released', { tenantId: input.tenantId, eventId });
      return { status: 'released', source: 'google_calendar', eventId };
    } catch (error) {
      this.logger?.error?.('google_calendar.release_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async reschedule(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const eventId = input.eventId || input.calendarEventId;
      if (!eventId) throw new Error('eventId is required');
      const { startISO, endISO } = slotToISO(input);
      const res = await calendar.events.patch({
        calendarId, eventId,
        resource: {
          start: { dateTime: startISO, timeZone: config.timezone || 'UTC' },
          end: { dateTime: endISO, timeZone: config.timezone || 'UTC' }
        },
        sendUpdates: 'all'
      });
      this.logger?.info?.('google_calendar.rescheduled', { tenantId: input.tenantId, eventId });
      return { status: 'rescheduled', source: 'google_calendar', calendarEventId: res.data.id, htmlLink: res.data.htmlLink };
    } catch (error) {
      this.logger?.error?.('google_calendar.reschedule_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async cancel(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const eventId = input.eventId || input.calendarEventId;
      if (!eventId) throw new Error('eventId is required');
      // Instead of deleting, we mark as cancelled so there's a record
      await calendar.events.patch({
        calendarId, eventId,
        resource: { status: 'cancelled' },
        sendUpdates: 'all'
      });
      this.logger?.info?.('google_calendar.cancelled', { tenantId: input.tenantId, eventId });
      return { status: 'cancelled', source: 'google_calendar', eventId };
    } catch (error) {
      this.logger?.error?.('google_calendar.cancel_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'unknown', source: 'google_calendar_error', error: error.message };
    }
  }

  async listEvents(input, config) {
    try {
      const calendar = await this._getCalendar(input.tenantId);
      const calendarId = await this._getPrimaryCalendarId(input.tenantId, calendar);
      const timeMin = input.from || new Date().toISOString();
      const timeMax = input.to || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        privateExtendedProperty: `${NOVA_EXT_KEY}_tenant=${input.tenantId}`,
        maxResults: input.limit || 50
      });
      const events = (res.data.items || []).map(e => ({
        id: e.id,
        summary: e.summary,
        status: e.status,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        htmlLink: e.htmlLink,
        attendees: (e.attendees || []).map(a => a.email),
        isHold: e.extendedProperties?.private?.[`${NOVA_EXT_KEY}_hold`] === 'true',
        isConfirmed: e.extendedProperties?.private?.[`${NOVA_EXT_KEY}_confirmed`] === 'true',
        customer: e.extendedProperties?.private?.[`${NOVA_EXT_KEY}_customer`] || null,
        service: e.extendedProperties?.private?.[`${NOVA_EXT_KEY}_service`] || null
      }));
      return { status: 'ok', source: 'google_calendar', events };
    } catch (error) {
      this.logger?.error?.('google_calendar.list_failed', { tenantId: input.tenantId, error: error.message });
      return { status: 'error', source: 'google_calendar_error', error: error.message, events: [] };
    }
  }
}

// Helper: convert slot input (date + startTime + endTime + timezone) to ISO strings
function slotToISO(input) {
  const tz = input.timezone || 'UTC';
  const date = input.date;
  const startTime = input.startTime;
  const endTime = input.endTime;
  // Build ISO strings in the tenant's timezone
  const startISO = new Date(`${date}T${startTime}:00`).toISOString();
  const endISO = new Date(`${date}T${endTime}:00`).toISOString();
  return { startISO, endISO };
}

module.exports = { GoogleCalendarProvider, NOVA_EXT_KEY };
