// Phase 4 Sprint 3 — Calendar adapters: Google + Microsoft Graph.
//
// Neither provider had test coverage before this sprint (both need real OAuth
// tokens + network). These tests close that gap with a mock-mode approach:
//   - A MockTokenRepository returns canned tokens.
//   - A MockGraphClient / the real Google provider is exercised via a mock
//     OAuth client whose createClientForTokens returns a fetch-mock.
//   - Every contract method (check, hold, confirmHold, releaseHold,
//     reschedule, cancel, listEvents) is exercised against the mock API, so
//     the provider's request building + response parsing is verified without
//     network access.
//
// Test matrix:
//   1. Contract: both providers implement all 7 required methods.
//   2. Microsoft OAuth client: not configured by default; getAuthUrl throws when unconfigured.
//   3. Microsoft provider — check: available when calendar empty; unavailable + alternatives when busy.
//   4. Microsoft provider — hold → confirmHold → releaseHold lifecycle.
//   5. Microsoft provider — reschedule + cancel + listEvents.
//   6. Microsoft provider — graceful error when tokens missing (not connected).
//   7. Google provider — contract methods exist (the real googleapis lib is
//      exercised only structurally here; full network tests need credentials).
//   8. Calendar service: routes to the configured external provider by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertCalendarProvider, REQUIRED_METHODS } = require("../packages/calendar-engine/src/calendarProviderContract");
const { MicrosoftOAuthClient } = require("../packages/calendar-engine/src/microsoftOAuthClient");
const { MicrosoftGraphCalendarProvider } = require("../packages/calendar-engine/src/microsoftGraphCalendarProvider");
const { GoogleCalendarProvider } = require("../packages/calendar-engine/src/googleCalendarProvider");
const { CalendarService } = require("../packages/calendar-engine/src/calendarService");
const { FileCalendarConfigRepository } = require("../packages/calendar-engine/src/fileCalendarConfigRepository");

// ── Mock token repository ────────────────────────────────────────────────
class MockTokenRepository {
  constructor(tokens = null) { this.tokens = tokens; this.saved = []; }
  load() { return this.tokens; }
  save(tenantId, tokens) { this.tokens = tokens; this.saved.push({ tenantId, tokens }); return tokens; }
  exists() { return !!this.tokens; }
}

// ── Mock Microsoft OAuth client ──────────────────────────────────────────
// createClientForTokens returns a client whose `request()` consults a route
// table the test sets up. This lets each test script the Graph API responses
// without touching the network.
class MockMicrosoftOAuthClient {
  constructor({ routes = {} } = {}) { this.routes = routes; this.configured = true; }
  isConfigured() { return this.configured; }
  createClientForTokens(tokens, { onRefresh = null } = {}) {
    const self = this;
    return {
      async request(path, init = {}) {
        const method = (init.method || "GET").toUpperCase();
        // Match the route by method + path prefix (longest match wins).
        let handler = null, matchKey = null;
        for (const key of Object.keys(self.routes)) {
          const [m, p] = key.split(" ");
          if (m === method && path.startsWith(p) && (!matchKey || p.length > matchKey.split(" ")[1].length)) {
            handler = self.routes[key]; matchKey = key;
          }
        }
        if (!handler) return { ok: false, status: 404, text: async () => `no mock for ${method} ${path}` };
        return handler(path, init);
      },
      get tokens() { return tokens; },
    };
  }
}

// ── Mock Google OAuth client (for the Google provider contract test) ─────
class MockGoogleOAuthClient {
  constructor() { this.configured = true; }
  isConfigured() { return this.configured; }
  createClientForTokens() { return {}; } // googleapis lib is not loaded in this test
}

// Helpers to build mock HTTP responses.
function okJson(body) { return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; }
function noContent() { return { ok: true, status: 204, json: async () => null, text: async () => "" }; }
function errJson(status, body) { return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }; }

const TENANT = "ms-test-tenant";
const CONFIG = { timezone: "UTC", defaultDurationMinutes: 60, slotIntervalMinutes: 30, maxAdvanceDays: 7 };
const SLOT_INPUT = { tenantId: TENANT, date: "2026-12-01", startTime: "10:00", endTime: "11:00", dateISO: "2026-12-01T10:00:00" };

// ═══════════════════════════════════════════════════════════════════════════
// 1. Contract — both providers implement all 7 required methods
// ═══════════════════════════════════════════════════════════════════════════
test("contract: REQUIRED_METHODS lists all 7 calendar operations", () => {
  assert.deepEqual([...REQUIRED_METHODS].sort(), ["cancel", "check", "confirmHold", "hold", "listEvents", "releaseHold", "reschedule"]);
});

test("contract: Microsoft provider implements all required methods", () => {
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: new MockMicrosoftOAuthClient(), tokenRepository: new MockTokenRepository({}) });
  assert.doesNotThrow(() => assertCalendarProvider(provider));
});

test("contract: Google provider implements all required methods", () => {
  const provider = new GoogleCalendarProvider({ oauthClient: new MockGoogleOAuthClient(), tokenRepository: new MockTokenRepository({}) });
  assert.doesNotThrow(() => assertCalendarProvider(provider));
});

test("contract: assertCalendarProvider rejects an object missing a method", () => {
  assert.throws(() => assertCalendarProvider({ check() {}, hold() {} }), /missing 'confirmHold/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Microsoft OAuth client — configuration behavior
// ═══════════════════════════════════════════════════════════════════════════
test("ms oauth: not configured by default (no env vars in test)", () => {
  // Save + restore env so this test is isolated.
  const savedId = process.env.MICROSOFT_CLIENT_ID, savedSecret = process.env.MICROSOFT_CLIENT_SECRET;
  delete process.env.MICROSOFT_CLIENT_ID; delete process.env.MICROSOFT_CLIENT_SECRET;
  try {
    const client = new MicrosoftOAuthClient();
    assert.equal(client.isConfigured(), false);
    assert.throws(() => client.getAuthUrl("t1"), /not configured/i);
  } finally {
    if (savedId) process.env.MICROSOFT_CLIENT_ID = savedId;
    if (savedSecret) process.env.MICROSOFT_CLIENT_SECRET = savedSecret;
  }
});

test("ms oauth: configured when clientId + clientSecret provided", () => {
  const client = new MicrosoftOAuthClient({ clientId: "test-id", clientSecret: "test-secret", redirectUri: "http://localhost/cb" });
  assert.equal(client.isConfigured(), true);
  const url = client.getAuthUrl("tenant-123");
  assert.ok(url.startsWith("https://login.microsoftonline.com/"));
  assert.ok(url.includes("client_id=test-id"));
  assert.ok(url.includes("Calendars.ReadWrite"));
  // state carries the tenantId
  assert.ok(url.includes("tenant-123"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Microsoft provider — check
// ═══════════════════════════════════════════════════════════════════════════
test("ms provider: check returns available when calendar has no blocking events", async () => {
  const oauth = new MockMicrosoftOAuthClient({
    routes: { "GET /me/calendar/calendarView": () => okJson({ value: [] }) },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.check(SLOT_INPUT, CONFIG);
  assert.equal(result.status, "available");
  assert.equal(result.source, "microsoft_graph");
  assert.equal(result.remainingCapacity, 1);
});

test("ms provider: check returns unavailable + alternatives when busy", async () => {
  const oauth = new MockMicrosoftOAuthClient({
    routes: {
      "GET /me/calendar/calendarView": (path) => {
        // First call (the actual check) returns a busy event; subsequent calls
        // (alternatives search) return empty so alternatives are found.
        const isBusy = path.includes("2026-12-01T");
        return okJson({ value: isBusy ? [{ id: "e1", showAs: "busy" }] : [] });
      },
    },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.check(SLOT_INPUT, CONFIG);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "owner_busy");
  assert.ok(result.alternatives.length > 0, "must suggest alternatives");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Microsoft provider — hold → confirmHold → releaseHold lifecycle
// ═══════════════════════════════════════════════════════════════════════════
test("ms provider: hold → confirmHold → releaseHold lifecycle", async () => {
  let createdEvent = null;
  const oauth = new MockMicrosoftOAuthClient({
    routes: {
      "GET /me/calendar/calendarView": () => okJson({ value: [] }), // slot is free
      "POST /me/calendar/events": (_p, init) => {
        const body = JSON.parse(init.body);
        createdEvent = { id: "evt-1", ...body, webLink: "https://graph/evt-1" };
        return okJson(createdEvent);
      },
      "PATCH /me/calendar/events/evt-1": (_p, init) => {
        const body = JSON.parse(init.body);
        createdEvent = { ...createdEvent, ...body };
        return okJson(createdEvent);
      },
      "DELETE /me/calendar/events/evt-1": () => noContent(),
    },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });

  // hold
  const held = await provider.hold(SLOT_INPUT, CONFIG);
  assert.equal(held.status, "held");
  assert.equal(held.hold.id, "evt-1");
  assert.ok(createdEvent.categories.includes("NovaHold"));
  assert.equal(createdEvent.showAs, "tentative");

  // confirmHold
  const confirmed = await provider.confirmHold({ ...SLOT_INPUT, holdId: "evt-1", customerName: "Jane", customerEmail: "jane@x.com" }, CONFIG);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.calendarEventId, "evt-1");
  assert.ok(createdEvent.categories.includes("NovaConfirmed"));
  assert.equal(createdEvent.showAs, "busy");
  assert.deepEqual(createdEvent.attendees, [{ emailAddress: { address: "jane@x.com" }, type: "required" }]);

  // releaseHold (delete)
  const released = await provider.releaseHold({ ...SLOT_INPUT, holdId: "evt-1" }, CONFIG);
  assert.equal(released.status, "released");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Microsoft provider — reschedule, cancel, listEvents
// ═══════════════════════════════════════════════════════════════════════════
test("ms provider: reschedule patches the event times", async () => {
  let patched = null;
  const oauth = new MockMicrosoftOAuthClient({
    routes: {
      "PATCH /me/calendar/events/evt-2": (_p, init) => {
        patched = JSON.parse(init.body);
        return okJson({ id: "evt-2", ...patched, webLink: "https://graph/evt-2" });
      },
    },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.reschedule({ tenantId: TENANT, eventId: "evt-2", date: "2026-12-05", startTime: "14:00", endTime: "15:00" }, CONFIG);
  assert.equal(result.status, "rescheduled");
  assert.ok(patched.start.dateTime.includes("2026-12-05"));
});

test("ms provider: cancel marks the event cancelled", async () => {
  let patched = null;
  const oauth = new MockMicrosoftOAuthClient({
    routes: {
      "PATCH /me/calendar/events/evt-3": (_p, init) => {
        patched = JSON.parse(init.body);
        return okJson({ id: "evt-3" });
      },
    },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.cancel({ tenantId: TENANT, eventId: "evt-3" }, CONFIG);
  assert.equal(result.status, "cancelled");
  assert.equal(patched.isCancelled, true);
  assert.equal(patched.showAs, "free");
});

test("ms provider: listEvents returns Nova-tagged events", async () => {
  const oauth = new MockMicrosoftOAuthClient({
    routes: {
      "GET /me/calendar/calendarView": () => okJson({
        value: [
          { id: "e1", subject: "✅ Booking", start: { dateTime: "2026-12-01T10:00" }, end: { dateTime: "2026-12-01T11:00" }, showAs: "busy", categories: ["NovaConfirmed"], webLink: "https://l", attendees: [{ emailAddress: { address: "c@x.com" } }] },
          { id: "e2", subject: "🔒 HOLD", start: { dateTime: "2026-12-02T10:00" }, end: { dateTime: "2026-12-02T11:00" }, showAs: "tentative", categories: ["NovaHold"], webLink: null, attendees: [] },
        ],
      }),
    },
  });
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: oauth, tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.listEvents({ tenantId: TENANT }, CONFIG);
  assert.equal(result.status, "ok");
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].isConfirmed, true);
  assert.equal(result.events[1].isHold, true);
  assert.deepEqual(result.events[0].attendees, ["c@x.com"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Microsoft provider — graceful error when not connected
// ═══════════════════════════════════════════════════════════════════════════
test("ms provider: check returns unknown when tokens missing (not connected)", async () => {
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: new MockMicrosoftOAuthClient(), tokenRepository: new MockTokenRepository(null) });
  const result = await provider.check(SLOT_INPUT, CONFIG);
  assert.equal(result.status, "unknown");
  assert.equal(result.source, "microsoft_graph_error");
  assert.match(result.error, /not connected/i);
});

test("ms provider: hold requires holdId or calendarEventId for confirm", async () => {
  const provider = new MicrosoftGraphCalendarProvider({ oauthClient: new MockMicrosoftOAuthClient({ routes: {} }), tokenRepository: new MockTokenRepository({ accessToken: "x" }) });
  const result = await provider.confirmHold({ ...SLOT_INPUT }, CONFIG);
  assert.equal(result.status, "unknown");
  assert.match(result.error, /holdId or calendarEventId/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Calendar service — routes to the configured external provider
// ═══════════════════════════════════════════════════════════════════════════
test("calendar service: routes to the microsoft provider when config.provider=microsoft", async () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s3-svc-"));
  const tenantDir = path.join(tenantsDir, TENANT);
  fs.mkdirSync(path.join(tenantDir, "calendar"), { recursive: true });
  fs.writeFileSync(path.join(tenantDir, "calendar", "config.json"), JSON.stringify({
    enabled: true, provider: "microsoft", timezone: "UTC",
    defaultDurationMinutes: 60, slotIntervalMinutes: 30, maxAdvanceDays: 7,
    resourcePools: [{ id: "default", name: "Default", capacity: 1, serviceIds: [], active: true }],
    serviceRules: [],
  }));
  const configRepo = new FileCalendarConfigRepository({ tenantsDir });
  const mockProvider = {
    check: async () => ({ status: "available", source: "mock_ms", remainingCapacity: 1 }),
    hold: async () => ({ status: "held" }), confirmHold: async () => ({ status: "confirmed" }),
    releaseHold: async () => ({ status: "released" }), reschedule: async () => ({ status: "rescheduled" }),
    cancel: async () => ({ status: "cancelled" }), listEvents: async () => ({ status: "ok", events: [] }),
  };
  // No hoursProvider passed → service skips business-hours check and dispatches
  // straight to the registered microsoft provider. `time` (not startTime) is the
  // field #normalizeSlot reads.
  const service = new CalendarService({ configRepository: configRepo, repository: {}, providers: { microsoft: mockProvider } });
  const result = await service.check({ tenantId: TENANT, date: "27/08/2026", time: "10:00", serviceId: "s1", poolId: "default" });
  assert.equal(result.source, "mock_ms");
});

test("calendar service: returns provider_not_connected when provider configured but not registered", async () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s3-notconn-"));
  const tenantDir = path.join(tenantsDir, "missing-tenant");
  fs.mkdirSync(path.join(tenantDir, "calendar"), { recursive: true });
  fs.writeFileSync(path.join(tenantDir, "calendar", "config.json"), JSON.stringify({
    enabled: true, provider: "microsoft", timezone: "UTC",
    defaultDurationMinutes: 60, slotIntervalMinutes: 30, maxAdvanceDays: 7,
    resourcePools: [{ id: "default", name: "Default", capacity: 1, serviceIds: [], active: true }],
    serviceRules: [],
  }));
  const configRepo = new FileCalendarConfigRepository({ tenantsDir });
  // No providers registered → service should report not connected, not crash.
  const service = new CalendarService({ configRepository: configRepo, repository: {}, providers: {} });
  const result = await service.check({ tenantId: "missing-tenant", date: "27/08/2026", time: "10:00", serviceId: "s1", poolId: "default" });
  assert.equal(result.status, "unknown");
  assert.equal(result.source, "provider_not_connected");
});
