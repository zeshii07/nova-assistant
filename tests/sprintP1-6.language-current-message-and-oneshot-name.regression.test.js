// Bug 7 + Bug 8 regression (Phase 1 items 7 & 8):
//   Bug 7 — language should track the CURRENT message, not the prior turn's
//            stored language. ExperienceLanguageEngine.resolve() previously
//            returned `previous || ...` whenever the current message detected
//            as English, so a visitor switching Roman Urdu → English kept
//            getting Roman-Urdu replies (and state.language stayed roman_urdu).
//            Fixed by making the current message's detected language primary;
//            prior/CRM/memory are now fallbacks only for empty messages.
//            Booking capability + unifiedServiceAdapter now detect from the
//            current message too (previously read state.language directly).
//   Bug 8 — one-shot booking phrases like "book a haircut tomorrow at 3pm for
//            Ahmed, 0300-1234567" extracted date+time+phone but MISSED the
//            name "Ahmed", because the universal name regex required an
//            explicit cue ("my name is"/"call me"/"mera naam"). Both salon and
//            cleaning asked "May I have your full name?" even though the
//            visitor supplied it. Fixed by adding a "for <Name>" fallback that
//            activates only when a phone number follows (the strong contact
//            signal), so party-size ("for 4") and duration ("for 2 hours") are
//            not misread as names.
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
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-b78-reg-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

// ── Bug 7: language tracks the current message ──────────────────────────────

test("Bug 7: Roman Urdu → English switch → state.language = english (current message)", async () => {
  const sid = "b7-ru-en-" + Date.now();
  await q("salon-demo", sid, "mujhe haircut book karna hai kal"); // Roman Urdu
  const r2 = await q("salon-demo", sid, "yes book it"); // English
  assert.equal(r2.state?.language, "english", "current message is English → state.language must be english");
});

test("Bug 7: English → Roman Urdu switch → state.language = roman_urdu (current message)", async () => {
  const sid = "b7-en-ru-" + Date.now();
  await q("salon-demo", sid, "i want to book a haircut"); // English
  const r2 = await q("salon-demo", sid, "haan kal karwani hai"); // Roman Urdu
  assert.equal(r2.state?.language, "roman_urdu", "current message is Roman Urdu → state.language must be roman_urdu");
});

test("Bug 7: English → Urdu (Arabic script) switch → state.language = urdu", async () => {
  const sid = "b7-en-ur-" + Date.now();
  await q("salon-demo", sid, "i want to book a haircut"); // English
  const r2 = await q("salon-demo", sid, "ہاں کل کروانا ہے"); // Urdu (Arabic script)
  assert.equal(r2.state?.language, "urdu", "current message is Urdu script → state.language must be urdu");
});

test("Bug 7: stable Roman Urdu across turns stays roman_urdu", async () => {
  const sid = "b7-stable-ru-" + Date.now();
  const r1 = await q("salon-demo", sid, "mujhe haircut book karna hai kal sham 5 baje");
  assert.equal(r1.state?.language, "roman_urdu");
  const r2 = await q("salon-demo", sid, "mera naam Ahmed hai, phone 03001234567");
  assert.equal(r2.state?.language, "roman_urdu", "still Roman Urdu — no drift to english");
});

test("Bug 7: English-location guard still works (Main Street → english)", async () => {
  // "123 Main Street" must NOT be misclassified as Roman Urdu even though
  // "main" matches the Roman-Urdu token for "I".
  const sid = "b7-loc-" + Date.now();
  const r = await q("salon-demo", sid, "deliver to 123 Main Street, apartment 4");
  assert.equal(r.state?.language, "english", "English address with 'Main Street' must be english, not roman_urdu");
});

// ── Bug 8: one-shot name extraction "for <Name>" ───────────────────────────

test("Bug 8: salon extracts name from 'for Ahmed, 0300-1234567' in one shot", async () => {
  const r = await q("salon-demo", "b8-salon-" + Date.now(), "book a haircut tomorrow at 3pm for Ahmed, 0300-1234567");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.ok(s.date, "date should be captured from 'tomorrow'");
  assert.equal(s.time, "15:00");
  assert.equal(s.name, "Ahmed");
  assert.equal(s.phone, "03001234567");
});

test("Bug 8: cleaning extracts name from 'for Ahmed, 0300-1234567' in one shot", async () => {
  const r = await q("cleaning-demo", "b8-clean-" + Date.now(), "book deep cleaning tomorrow at 3pm for Ahmed, 0300-1234567");
  const c = r.state?.capabilityState?.cleaning || {};
  assert.ok(c.preferredDate, "date should be captured from 'tomorrow'");
  assert.equal(c.preferredTime, "15:00");
  assert.equal(c.name, "Ahmed");
  assert.equal(c.phone, "03001234567");
});

test("Bug 8 control: explicit 'My name is James Khan' still works", async () => {
  const r = await q("salon-demo", "b8-explicit-" + Date.now(), "book a haircut tomorrow at 3pm. My name is James Khan and my phone is 03012345678");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.equal(s.name, "James Khan");
  assert.equal(s.phone, "03012345678");
});

test("Bug 8 control: party size 'for 4 people' is NOT a name", async () => {
  const r = await q("salon-demo", "b8-party-" + Date.now(), "book a haircut tomorrow at 3pm for 4 people, 0300-1234567");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.equal(s.name, undefined, "'for 4 people' must not be read as a name");
  assert.equal(s.partySize, 4, "party size still captured");
  assert.equal(s.phone, "03001234567");
});

test("Bug 8 control: duration 'for 2 hours' is NOT a name", async () => {
  const r = await q("salon-demo", "b8-hours-" + Date.now(), "book a haircut tomorrow at 3pm for 2 hours, 0300-1234567");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.equal(s.name, undefined, "'for 2 hours' must not be read as a name");
  assert.equal(s.durationHours, 2, "duration still captured");
});

test("Bug 8 control: 'for Ahmed' WITHOUT a phone is NOT extracted (no strong contact signal)", async () => {
  const r = await q("salon-demo", "b8-nophone-" + Date.now(), "book a haircut tomorrow at 3pm for Ahmed");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.equal(s.name, undefined, "without a phone following, 'for Ahmed' is too ambiguous to extract");
});

test("Bug 8 control: 'for Maria, 0300-9876543' extracts a multi-letter name", async () => {
  const r = await q("salon-demo", "b8-maria-" + Date.now(), "book a haircut tomorrow at 3pm for Maria, 0300-9876543");
  const s = r.state?.capabilityState?.booking?.slots || {};
  assert.equal(s.name, "Maria");
  assert.equal(s.phone, "03009876543");
});
