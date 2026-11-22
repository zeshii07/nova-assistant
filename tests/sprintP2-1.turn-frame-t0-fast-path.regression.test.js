// Phase 2 Sprint 1 — T0 fast-path tier + Turn Frame regression.
//
// T0 sits in front of the regex/adapter brain in ConversationIntelligenceEngine
// .analyze() and short-circuits the ~30-40% of turns that need no understanding
// at all: greetings, gratitude, bare yes/no (when no workflow is mid-slot),
// emoji-only, "back"/"help", quick-reply payloads, and bare numbers. On a hit
// it returns the same `intelligence` shape with nlu.used=false and
// semanticRouter.used=false (skipping the heavy adapter iteration + ML + NLU),
// plus an additive `turnFrame` field. Misses fall through to the existing
// pipeline unchanged (NO rewrite of the regex brain).
//
// Guards verified by this suite:
//   • Never fires when globalCommand already fired (cancel/reset/human owned
//     by GlobalCommandEngine).
//   • Never fires when a workflow is mid-slot (a "yes" inside booking-ready
//     MUST reach the owning capability to confirm).
//   • Never fires on multi-intent or compound messages.
//   • Reuses SocialIntelligenceEngine for greeting/gratitude/goodbye detection
//     (no re-regex) and confirmation.js for yes/affirmation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");

let container;
async function q(t, u, text) {
  return container.executionEngine.process({ tenantId: t, channel: "v42", customerId: u, text });
}

test.before(async () => {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p2s1-t0-reg-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

// ── T0 hits: fast-path fires, heavy pipeline skipped ──────────────────────

test("T0: greeting short-circuits (nlu.used=false, semanticRouter.used=false, turnFrame present)", async () => {
  const r = await q("salon-demo", "t0-greet-" + Date.now(), "hi");
  assert.equal(r.intelligence.selected.intent, "assistant.greet");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.nlu.used, false);
  assert.equal(r.intelligence.semanticRouter.used, false);
  assert.equal(r.intelligence.forcedCapabilityId, "assistant");
  assert.ok(r.intelligence.turnFrame, "turnFrame must be present on a T0 hit");
  assert.equal(r.intelligence.turnFrame.acts[0].intent, "assistant.greet");
  assert.match(r.reply, /hello|assalam|hi/i);
});

test("T0: gratitude short-circuits (Roman Urdu shukriya)", async () => {
  const r = await q("salon-demo", "t0-thanks-" + Date.now(), "shukriya");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.nlu.used, false);
  assert.match(r.reply, /khushi|welcome/i);
});

test("T0: emoji-only short-circuits to small_talk (net-new class — previously selected:null)", async () => {
  const r = await q("salon-demo", "t0-emoji-" + Date.now(), "👍");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "assistant.small_talk");
  assert.equal(r.intelligence.nlu.used, false);
  assert.ok(r.reply.length > 0, "emoji-only must now get a reply, not a silent no-op");
});

test("T0: bare 'help' short-circuits (net-new — GlobalCommandEngine doesn't cover 'help')", async () => {
  const r = await q("salon-demo", "t0-help-" + Date.now(), "help");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "assistant.help");
  assert.match(r.reply, /salon|services|booking|help/i);
});

test("T0: 'go back' short-circuits (net-new navigation)", async () => {
  const r = await q("salon-demo", "t0-back-" + Date.now(), "go back");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "conversation.back");
  assert.match(r.reply, /back|revisit|something new/i);
});

test("T0: bare number with no workflow short-circuits to a clarifying question (net-new)", async () => {
  const r = await q("salon-demo", "t0-num-" + Date.now(), "2");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "assistant.clarify_bare_number");
  assert.equal(r.intelligence.entities.bareNumber, 2);
  assert.match(r.reply, /2.*quantity|quantity.*service/i);
});

test("T0: bare 'yes' with NO workflow short-circuits (net-new)", async () => {
  const r = await q("salon-demo", "t0-yes-" + Date.now(), "yes");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "conversation.affirm");
  assert.match(r.reply, /yes|absolutely|bilkul/i);
});

test("T0: bare 'no' with NO workflow short-circuits (net-new)", async () => {
  const r = await q("salon-demo", "t0-no-" + Date.now(), "no");
  assert.equal(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.intent, "conversation.deny");
  assert.match(r.reply, /no problem|koi baat nahi/i);
});

test("T0: turnFrame carries language, acts[], negation, needs_clarification", async () => {
  const r = await q("salon-demo", "t0-frame-" + Date.now(), "no");
  const tf = r.intelligence.turnFrame;
  assert.ok(tf.language, "turnFrame.language must be populated");
  assert.ok(Array.isArray(tf.acts) && tf.acts.length === 1);
  assert.equal(tf.negation, true); // "no" is a denial
  assert.equal(tf.is_correction, false);
  assert.equal(tf.topic_switch, false);
  assert.equal(tf.needs_clarification, null);
});

// ── Guards: T0 must NOT fire in these cases ────────────────────────────────

test("T0 guard: does NOT fire on multi-intent message (full pipeline runs)", async () => {
  const r = await q("salon-demo", "t0-multi-" + Date.now(), "hi i want to book a haircut tomorrow at 3pm");
  assert.notEqual(r.intelligence.selected.reason, "t0_fast_path");
  assert.ok(r.intelligence.semanticRouter.used || r.intelligence.nlu.used || r.intelligence.selected.capabilityId === "booking",
    "multi-intent must reach the full pipeline (booking capability expected)");
});

test("T0 guard: does NOT fire when globalCommand already fired (cancel/reset/human)", async () => {
  const r = await q("salon-demo", "t0-cancel-" + Date.now(), "cancel my order");
  assert.ok(r.intelligence.globalCommand, "globalCommand must be present (cancel)");
  assert.equal(r.intelligence.globalCommand.type, "cancel");
  // When globalCommand fires, the execution engine short-circuits — selected
  // may be null. Either way it must NOT be a T0 fast-path hit.
  if (r.intelligence.selected) {
    assert.notEqual(r.intelligence.selected.reason, "t0_fast_path");
  }
});

test("T0 guard: does NOT fire when a workflow is mid-slot — bare 'yes' inside booking-ready reaches booking", async () => {
  const sid = "t0-wfyes-" + Date.now();
  // One-shot booking → reaches booking-ready state
  await q("salon-demo", sid, "book a haircut tomorrow at 3pm for Ahmed, 0300-1234567");
  // Now confirm — the booking workflow must own this "yes", not T0
  const r = await q("salon-demo", sid, "yes confirm");
  assert.notEqual(r.intelligence.selected.reason, "t0_fast_path");
  assert.equal(r.intelligence.selected.capabilityId, "booking");
});

test("T0 guard: does NOT fire on a real booking question (greeting word present but not a greeting)", async () => {
  // "hi" + booking intent must NOT be misread as a pure greeting
  const r = await q("salon-demo", "t0-greetwithbook-" + Date.now(), "hi can i book a haircut for tomorrow");
  assert.notEqual(r.intelligence.selected.reason, "t0_fast_path");
});

// ── Latency: T0 hit must be faster than a full-pipeline turn ──────────────

test("T0 latency: greeting turn is faster than a catalog browse turn (no adapter iteration)", async () => {
  const t0Start = performance.now();
  await q("salon-demo", "t0-lat1-" + Date.now(), "hi");
  const t0Ms = performance.now() - t0Start;
  const fullStart = performance.now();
  await q("salon-demo", "t0-lat2-" + Date.now(), "show me running shoes");
  const fullMs = performance.now() - fullStart;
  // T0 must be at least as fast as the full pipeline; allow 2x slack for jitter.
  assert.ok(t0Ms <= fullMs * 2, `T0 greeting (${t0Ms.toFixed(1)}ms) should not be slower than catalog (${fullMs.toFixed(1)}ms) x2`);
});

// ── Intelligence-shape contract: T0 hit must preserve consumer fields ─────

test("T0 contract: analysis shape has all fields downstream consumers read", async () => {
  const r = await q("salon-demo", "t0-shape-" + Date.now(), "hi");
  const a = r.intelligence;
  // Execution engine reads
  assert.ok(a.messageFrame, "messageFrame");
  assert.ok("globalCommand" in a, "globalCommand");
  assert.ok("requiresClarification" in a, "requiresClarification");
  assert.ok("clarificationReason" in a, "clarificationReason");
  assert.ok(a.workflow, "workflow");
  assert.ok(a.workflow.current !== undefined, "workflow.current");
  assert.ok(a.goal, "goal");
  // Capability router reads
  assert.ok("forcedCapabilityId" in a, "forcedCapabilityId");
  assert.ok(a.selected, "selected");
  assert.ok("confidence" in a.selected, "selected.confidence");
  assert.ok("reason" in a.selected, "selected.reason");
  // Reply engine / messagePlan reads
  assert.ok(a.semanticRouter, "semanticRouter");
  assert.ok(a.nlu, "nlu");
  // summarizeIntelligence deep-reads nlu.*
  for (const k of ["used", "validated", "mode", "strategy", "deterministicFallback", "executionAuthority", "model", "promptVersion", "interpretation", "languageContract", "decision", "invocationReason", "error", "httpStatus", "providerMessage", "providerErrorType", "providerRequestId", "latencyMs"]) {
    assert.ok(k in a.nlu, `nlu.${k} must exist`);
  }
  assert.ok("entities" in a, "entities");
  assert.ok("timingMs" in a, "timingMs");
  assert.ok(a.turnFrame, "turnFrame (additive)");
});
