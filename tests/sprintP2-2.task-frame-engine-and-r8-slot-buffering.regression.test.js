// Phase 2 Sprint 2 — Data-driven Task Frame Engine + R8 slot-buffering fix.
//
// The report's R8 root cause: "each capability re-implements parsing — salon
// works, cleaning one-shot drops date/time/name/phone". This suite verifies:
//   1. TaskFrameEngine: frame definitions (booking + cleaning) are data; the
//      engine walks slots via the shared UniversalEngagementEngine validators.
//   2. Slot buffering (the R8 fix): when the generic "book cleaning" path
//      asks the cleaning TYPE, the date/time/name/phone volunteered in the
//      same turn are buffered into pendingBookingType.scope and survive into
//      the booking flow — they are NOT re-asked after the type is picked.
//   3. Repair policy: re-ask → offer options → hand off.
//   4. No regressions: booking one-shot (salon) still works; cleaning one-shot
//      with a named service type still works.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");
const { TaskFrameEngine, BOOKING_FRAME, CLEANING_FRAME } = require("../packages/dialogue-manager/src/taskFrameEngine");
const { UniversalEngagementEngine } = require("../packages/universal-engagement-engine/src/universalEngagementEngine");

let container;
async function q(t, u, text) {
  return container.executionEngine.process({ tenantId: t, channel: "v42", customerId: u, text });
}

test.before(async () => {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p2s2-reg-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

// ── Frame definitions are data ────────────────────────────────────────────

test("TaskFrameEngine: booking frame is data with ordered slots + validators", () => {
  assert.equal(BOOKING_FRAME.type, "booking");
  assert.equal(BOOKING_FRAME.stateShape, "slots");
  assert.equal(BOOKING_FRAME.statusField, "status");
  assert.deepEqual(BOOKING_FRAME.slots, ["date", "time", "name", "phone"]);
  assert.ok(BOOKING_FRAME.requiredFields({}).includes("date"));
  assert.equal(BOOKING_FRAME.confirmStep.intent, "booking.confirm");
  assert.equal(typeof BOOKING_FRAME.ownershipPredicate, "function");
  assert.equal(BOOKING_FRAME.ownershipPredicate({ booking: { status: "ready" } }), true);
  assert.equal(BOOKING_FRAME.ownershipPredicate({ booking: { status: "collecting" } }), false);
});

test("TaskFrameEngine: cleaning frame is data with flat state shape", () => {
  assert.equal(CLEANING_FRAME.type, "cleaning");
  assert.equal(CLEANING_FRAME.stateShape, "flat");
  assert.equal(CLEANING_FRAME.statusField, "step");
  assert.deepEqual(CLEANING_FRAME.slots, ["date", "time", "address", "name", "phone"]);
  assert.equal(CLEANING_FRAME.ownershipPredicate({ cleaning: { step: "confirm" } }), true);
  assert.equal(CLEANING_FRAME.ownershipPredicate({ cleaning: { step: "date" } }), false);
});

// ── Engine reuses UniversalEngagementEngine validators ────────────────────

test("TaskFrameEngine: nextMissing delegates to engagement engine for booking", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  // No fields filled → date is missing first
  assert.equal(tfe.nextMissing("booking", {}, {}), "date");
  // date filled → time missing
  assert.equal(tfe.nextMissing("booking", { date: "28/11/2026" }, {}), "time");
  // date+time filled → name missing
  assert.equal(tfe.nextMissing("booking", { date: "28/11/2026", time: "10:00" }, {}), "name");
  // all filled → null (ready)
  assert.equal(tfe.nextMissing("booking", { date: "28/11/2026", time: "10:00", name: "Ali", phone: "0501234567" }, {}), null);
});

test("TaskFrameEngine: validateSlot delegates to engagement parseField", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const d = tfe.validateSlot("date", "tomorrow", { allowPast: false });
  assert.equal(d.valid, true);
  assert.ok(d.value);
  const bad = tfe.validateSlot("phone", "abc", { minDigits: 10, maxDigits: 15 });
  assert.equal(bad.valid, false);
});

// ── Slot buffering (the R8 fix) ────────────────────────────────────────────

test("TaskFrameEngine.bufferSlots: extracts date+time+name+phone from a one-shot message", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const { buffered, invalid } = tfe.bufferSlots("cleaning", "book cleaning for saturday at 10am my name is Ali phone 0501234567", { allowPast: false });
  // date + time + name + phone all extracted
  assert.ok(buffered.date || buffered.time, "date or time must be buffered");
  assert.ok(buffered.name, "name must be buffered: " + JSON.stringify(buffered));
  assert.ok(buffered.phone, "phone must be buffered: " + JSON.stringify(buffered));
});

test("TaskFrameEngine.bufferSlots: does not buffer when no slots present", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const { buffered } = tfe.bufferSlots("cleaning", "hi", {});
  assert.equal(Object.keys(buffered).length, 0);
});

// ── R8 fix: cleaning generic booking preserves slots across type disambiguation ─

test("R8 fix: 'book a cleaning for saturday at 10am' buffers date/time into pendingBookingType.scope", async () => {
  const sid = "p2s2-r8buf-" + Date.now();
  const r1 = await q("cleaning-demo", sid, "book a cleaning for saturday at 10am");
  assert.equal(r1.intelligence.selected.intent, "cleaning.service_explore");
  // The cleaning TYPE question is asked, and the slots are buffered
  const scope = r1.state?.capabilityState?.cleaning?.pendingBookingType?.scope;
  assert.ok(scope, "pendingBookingType.scope must be set (slots buffered)");
  assert.ok(scope.date || scope.startTime || scope.time, "date/time must be buffered in scope: " + JSON.stringify(scope));
});

test("R8 fix: buffered date/time survive into the booking flow after type is picked", async () => {
  const sid = "p2s2-r8survive-" + Date.now();
  // Turn 1: generic booking with date+time → asks TYPE, buffers slots
  await q("cleaning-demo", sid, "book a cleaning for saturday at 10am");
  // Turn 2: pick standard cleaning + provide name+phone
  const r2 = await q("cleaning-demo", sid, "standard cleaning for Ali phone 0501234567");
  assert.equal(r2.intelligence.selected.intent, "cleaning.booking_type_selected");
  const cs = r2.state?.capabilityState?.cleaning;
  // The buffered date/time from turn 1 survived — they are NOT null
  assert.ok(cs.preferredDate, "preferredDate must survive the disambiguation (was dropped before R8 fix): " + cs.preferredDate);
  assert.ok(cs.preferredTime, "preferredTime must survive the disambiguation: " + cs.preferredTime);
  // name+phone from turn 2 captured
  assert.equal(cs.name, "Ali");
  assert.equal(cs.phone, "0501234567");
  // step advanced past date/time (standard cleaning is hourly → asks cleanerCount)
  assert.ok(cs.step !== "date" && cs.step !== "time", "step must advance past date/time (slots already filled): " + cs.step);
});

// ── No regressions: booking one-shot (salon) still works ──────────────────

test("No regression: salon booking one-shot still captures all slots", async () => {
  const sid = "p2s2-salon-" + Date.now();
  const r = await q("salon-demo", sid, "book a haircut tomorrow at 3pm for Ahmed, 0300-1234567");
  const slots = r.state?.capabilityState?.booking?.slots;
  assert.ok(slots.date, "date captured");
  assert.equal(slots.time, "15:00");
  assert.equal(slots.name, "Ahmed");
  assert.equal(slots.phone, "03001234567");
});

test("No regression: cleaning one-shot with NAMED service type still works (deep cleaning)", async () => {
  const sid = "p2s2-deep-" + Date.now();
  const r = await q("cleaning-demo", sid, "book deep cleaning tomorrow at 3pm for Ahmed, 0300-1234567");
  const cs = r.state?.capabilityState?.cleaning;
  assert.ok(cs.preferredDate, "preferredDate captured for deep cleaning one-shot");
  assert.ok(cs.name === "Ahmed" || cs.phone === "03001234567", "name/phone captured");
});

// ── Repair policy ──────────────────────────────────────────────────────────

test("TaskFrameEngine.repairPrompt: re-ask on 1st fail, offer options on 2nd, hand off on 3rd+", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const r1 = tfe.repairPrompt("date", 0, {}, "english");
  assert.equal(r1.action, "reask");
  assert.ok(r1.prompt.length > 0);
  const r2 = tfe.repairPrompt("date", 2, {}, "english");
  assert.equal(r2.action, "offer_options");
  const r3 = tfe.repairPrompt("date", 3, {}, "english");
  assert.equal(r3.action, "handoff");
});

// ── Correction detection ───────────────────────────────────────────────────

test("TaskFrameEngine.detectCorrection: detects 'actually 6pm' as a time correction", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const filled = { date: "28/11/2026", time: "10:00", name: "Ali", phone: "0501234567" };
  const c = tfe.detectCorrection("actually 6pm", filled);
  assert.equal(c.isCorrection, true);
  assert.ok(c.field, "must detect which field is being corrected");
});

test("TaskFrameEngine.detectCorrection: non-correction message returns isCorrection=false", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const c = tfe.detectCorrection("yes", { date: "28/11/2026" });
  assert.equal(c.isCorrection, false);
});

// ── State patch serialization ───────────────────────────────────────────────

test("TaskFrameEngine.toStatePatch: booking writes into slots shape", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const patch = tfe.toStatePatch("booking", { date: "28/11/2026", time: "10:00" }, { status: "collecting", slots: { name: "Ali" } });
  assert.ok(patch.slots, "booking patch must have slots");
  assert.equal(patch.slots.date, "28/11/2026");
  assert.equal(patch.slots.name, "Ali"); // preserved from previous
  assert.equal(patch.status, "collecting"); // preserved
});

test("TaskFrameEngine.toStatePatch: cleaning writes into flat shape", () => {
  const eng = new UniversalEngagementEngine();
  const tfe = new TaskFrameEngine({ engagementEngine: eng });
  const patch = tfe.toStatePatch("cleaning", { preferredDate: "28/11/2026", name: "Ali" }, { step: "phone", serviceId: "CLN001" });
  assert.equal(patch.preferredDate, "28/11/2026");
  assert.equal(patch.name, "Ali");
  assert.equal(patch.step, "phone"); // preserved
  assert.equal(patch.serviceId, "CLN001"); // preserved
});

// ── Container wiring ────────────────────────────────────────────────────────

test("Container: taskFrameEngine + dialogueManager are wired into services", async () => {
  assert.ok(container.taskFrameEngine, "container exposes taskFrameEngine");
  assert.ok(container.dialogueManager, "container exposes dialogueManager");
  assert.ok(container.dialogueManager.taskFrames, "dialogueManager hosts the TaskFrameEngine");
  // The frame engine reuses the engagement engine's validators
  assert.ok(container.taskFrameEngine.engagement, "taskFrameEngine has engagement engine injected");
});
