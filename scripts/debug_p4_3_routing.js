// Debug: what does CalendarService.check return for a microsoft-configured tenant?
const fs = require("fs"), os = require("os"), path = require("path");
const { CalendarService } = require("../packages/calendar-engine/src/calendarService");
const { FileCalendarConfigRepository } = require("../packages/calendar-engine/src/fileCalendarConfigRepository");

(async () => {
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s3-debug-"));
  const TENANT = "ms-test-tenant";
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
  const service = new CalendarService({ configRepository: configRepo, repository: {}, providers: { microsoft: mockProvider } });
  const input = { tenantId: TENANT, date: "30/11/2026", time: "10:00", serviceId: "s1", poolId: "default" };
  const result = await service.check(input);
  console.log("RESULT:", JSON.stringify(result, null, 2));
})().catch(e => { console.error("ERR:", e.stack || e); process.exit(1); });
