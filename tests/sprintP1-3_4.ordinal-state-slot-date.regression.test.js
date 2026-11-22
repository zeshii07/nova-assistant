// H3 + H5 + H4 regression (Phase 1 items 3, 4, 5):
//   H3  — ordinals/demonstratives ("first one", "option 2", "wo", "usko",
//          "pehla wala", "dusra") were NOT resolved before intent routing, so
//          a shorthand reply fell through to knowledge retrieval. Fixed by
//          PublicOptionResolver running BEFORE intentRouter.classify.
//   H5  — state.context did not persist lastShown/pending, so even an ordinal
//          resolver would have nothing to resolve against across turns. Fixed
//          by _updateMemory persisting the suggested_actions as lastShown.
//   H4b — colloquial dates (tmrw/tom/2morow/yesterday/next week/agla hafta/
//          in N days/this weekend) were not parsed. Fixed in parseDate.
//   H4a — an impossible clock ("25:90", "13:99") was flagged by the temporal
//          extractor but never surfaced by the booking flow; the visitor got a
//          generic "please enter a valid time". Fixed in extract() + the two
//          time re-ask sites.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PublicOptionResolver } = require("../packages/public-assistant/src/publicOptionResolver");
const { UniversalEngagementEngine } = require("../packages/universal-engagement-engine/src/universalEngagementEngine");

// ── H3: ordinal / demonstrative resolution (unit) ──────────────────────────

test("H3: resolver resolves English ordinals against lastShown", () => {
  const r = new PublicOptionResolver();
  const opts = [
    { label: "Request a demo", action: "demo_request" },
    { label: "Explore use case", action: "ask", value: "Show me an example." },
    { label: "Contact team", action: "demo_request" },
  ];
  assert.equal(r.resolve("first one", opts).index, 0);
  assert.equal(r.resolve("the second one", opts).index, 1);
  assert.equal(r.resolve("1st", opts).index, 0);
  assert.equal(r.resolve("3rd", opts).index, 2);
});

test("H3: resolver resolves 'option N' / 'number N' / bare digit", () => {
  const r = new PublicOptionResolver();
  const opts = [{ label: "A" }, { label: "B" }, { label: "C" }];
  assert.equal(r.resolve("option 2", opts).index, 1);
  assert.equal(r.resolve("number 3", opts).index, 2);
  assert.equal(r.resolve("choice one", opts).index, 0);
  assert.equal(r.resolve("2", opts).index, 1);
});

test("H3: resolver resolves Roman Urdu ordinals + demonstratives", () => {
  const r = new PublicOptionResolver();
  const opts = [{ label: "A" }, { label: "B" }, { label: "C" }];
  // pehla wala (first), dusra (second), teesra (third)
  assert.equal(r.resolve("pehla wala", opts).index, 0);
  assert.equal(r.resolve("dusra", opts).index, 1);
  assert.equal(r.resolve("teesra", opts).index, 2);
  // wo/usko/yeh → first (the recommended option)
  assert.equal(r.resolve("wo", opts).index, 0);
  assert.equal(r.resolve("usko", opts).index, 0);
  assert.equal(r.resolve("yeh wala", opts).index, 0);
  // last one / pichla → last
  assert.equal(r.resolve("last one", opts).index, 2);
  assert.equal(r.resolve("pichla", opts).index, 2);
});

test("H3: resolver returns the option's value (or label) when resolved", () => {
  const r = new PublicOptionResolver();
  const opts = [{ label: "A", value: "demo_request" }, { label: "B" }];
  assert.equal(r.resolve("first one", opts).value, "demo_request");
  assert.equal(r.resolve("option 2", opts).value, "B"); // falls back to label
});

test("H3 + H5: resolver returns resolved=false (and original text) when no lastShown", () => {
  const r = new PublicOptionResolver();
  const res = r.resolve("first one", null);
  assert.equal(res.resolved, false);
  assert.equal(res.value, "first one"); // caller routes normally
});

test("H3: resolver does NOT resolve unrelated text", () => {
  const r = new PublicOptionResolver();
  const opts = [{ label: "A" }, { label: "B" }];
  const res = r.resolve("what is nova", opts);
  assert.equal(res.resolved, false);
  assert.equal(res.reason, "no_match");
});

// ── H5: lastShown + pending persisted across turns (end-to-end) ─────────────
//   (Uses the real PublicAssistantService via the container.)

let container;
test.before(async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-h3h5-reg-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  const { buildContainer } = require("../apps/api/src/container");
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

test("H5: an industry-use-case turn persists lastShown + pending in state.context", async () => {
  const svc = container.publicAssistantService;
  const sid = "h5-reg-" + Date.now();
  const res = await svc.handleMessage({ conversation_id: sid, message: "I run a salon and want to automate bookings", locale: "en" });
  assert.ok(res.suggested_actions?.length > 0, "industry turn should offer suggested actions");
  const state = await container.stateRepository.get(svc._conversationKey(sid));
  assert.ok(Array.isArray(state.context.lastShown) && state.context.lastShown.length > 0, "lastShown persisted");
  assert.equal(state.context.pending, "option_selection", "pending flag set");
});

test("H3 + H5: a follow-up 'first one' resolves to the option (does NOT classify unknown)", async () => {
  const svc = container.publicAssistantService;
  const sid = "h3h5-reg-" + Date.now();
  // Turn 1: produce suggested actions (lastShown persisted).
  await svc.handleMessage({ conversation_id: sid, message: "I run a salon and want to automate bookings", locale: "en" });
  // Turn 2: "first one" → must route to the first option's intent, not unknown.
  const r2 = await svc.handleMessage({ conversation_id: sid, message: "first one", locale: "en" });
  assert.notEqual(r2.intent, "unknown", "'first one' must NOT fall through to unknown/knowledge");
  assert.ok(r2.outcome === "lead" || r2.outcome === "answer" || r2.outcome === "escalate", "got a real outcome");
});

test("H3 + H5: Roman Urdu demonstrative 'wo' resolves to the first option", async () => {
  const svc = container.publicAssistantService;
  const sid = "h3wo-reg-" + Date.now();
  await svc.handleMessage({ conversation_id: sid, message: "I run a salon and want to automate bookings", locale: "en" });
  const r2 = await svc.handleMessage({ conversation_id: sid, message: "wo", locale: "en" });
  assert.notEqual(r2.intent, "unknown", "'wo' must resolve, not fall through");
});

// ── H4b: date normalization aliases ────────────────────────────────────────

test("H4b: parseDate resolves colloquial English tomorrow aliases", () => {
  const eng = new UniversalEngagementEngine({ timezone: "UTC" });
  const now = "2026-11-22T10:00:00Z"; // Sunday
  for (const w of ["tmrw", "tom", "2morow", "2moro", "tomorrow"]) {
    const r = eng.parseDate(w, { now });
    assert.equal(r.valid, true, `${w} should parse`);
    assert.equal(r.value, "23/11/2026", `${w} → tomorrow (23/11/2026)`);
  }
});

test("H4b: parseDate resolves 'next week' / 'agla hafta' / 'in N days' / 'this weekend'", () => {
  const eng = new UniversalEngagementEngine({ timezone: "UTC" });
  const now = "2026-11-22T10:00:00Z"; // Sunday 22/11
  assert.equal(eng.parseDate("next week", { now }).value, "29/11/2026"); // +7
  assert.equal(eng.parseDate("agla hafta", { now }).value, "29/11/2026"); // +7 (consistent)
  assert.equal(eng.parseDate("in 3 days", { now }).value, "25/11/2026"); // +3
  assert.equal(eng.parseDate("in 2 weeks", { now }).value, "06/12/2026"); // +14
  // this weekend → next Saturday from Sunday 22/11 = Sat 28/11
  assert.equal(eng.parseDate("this weekend", { now }).value, "28/11/2026");
});

test("H4b: parseDate still handles the existing Roman Urdu + English relative dates (no regression)", () => {
  const eng = new UniversalEngagementEngine({ timezone: "UTC" });
  const now = "2026-11-22T10:00:00Z";
  assert.equal(eng.parseDate("today", { now }).value, "22/11/2026");
  assert.equal(eng.parseDate("aaj", { now }).value, "22/11/2026");
  assert.equal(eng.parseDate("kal", { now }).value, "23/11/2026");
  assert.equal(eng.parseDate("parso", { now }).value, "24/11/2026");
});

test("H4b: parseDate rejects 'yesterday' by default (allowPast guard), accepts with allowPast:true", () => {
  const eng = new UniversalEngagementEngine({ timezone: "UTC" });
  const now = "2026-11-22T10:00:00Z";
  const blocked = eng.parseDate("yesterday", { now });
  assert.equal(blocked.valid, false, "yesterday blocked by allowPast guard");
  assert.match(blocked.message, /in the past/i);
  const allowed = eng.parseDate("yesterday", { now, allowPast: true });
  assert.equal(allowed.valid, true);
  assert.equal(allowed.value, "21/11/2026");
});

// ── H4a: invalid-clock reason surfaced ─────────────────────────────────────
//   The booking extract() module is internal; verify the temporal extractor
//   flags the bad clock AND that the booking module loads cleanly with the
//   new invalid-clock carry-through (no syntax/wiring break).

test("H4a: the temporal extractor flags an impossible clock with a reason", () => {
  const { TemporalSemanticExtractor } = require("../packages/conversation-intelligence/src/temporalSemanticExtractor");
  const tse = new TemporalSemanticExtractor();
  const out = tse.extract("book for 25:90 tomorrow");
  assert.ok(out.invalidClockText, "invalidClockText is set");
  assert.ok(out.invalidClockReason, "invalidClockReason is set");
  assert.match(String(out.invalidClockText), /25:90/);
});

test("H4a: the booking capability module loads with the invalid-clock carry-through (no wiring break)", () => {
  // If extract() / the two time re-ask sites were mis-edited, require() throws.
  const booking = require("../capabilities/booking/src/index.js");
  assert.equal(typeof booking, "object");
  // The cleaning-capability parseDateInput must still load too.
  require("../capabilities/booking/conversation/index.js");
});
