// Bug 5 + Bug 6 regression (Phase 1 items 5 & 6):
//   Bug 5  — booking executor silently substituted config.defaultSubject
//            ("Room Reservation") when a visitor asked for a service the
//            business does NOT offer ("can i book a conference room?"),
//            instead of saying "we don't have that". Fixed by
//            detectExplicitServiceRequest() emitting booking.unavailable_request.
//   Bug 6a — a food-price question ("what is the price of biryani?") on a
//            catalog tenant routed to service.quote ("Would you like to book
//            it?") instead of the catalog product-price answer. Fixed by
//            PricingConversationAdapter + detectServiceDetail bailing when the
//            tenant has catalog AND a product matches.
//   Bug 6b — "what time is check in?" on a hotel routed to booking.start
//            ("What is your check-in date?") because "check in" is a literal
//            config triggerTerm and the unified adapter had no interrogative
//            guard. Fixed by suppressing the trigger when the message is an
//            interrogative question with no acquisition verb.
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
function lastIntent(r) { return r.state && r.state.lastIntent; }
function bookingSubject(r) {
  return r.state?.capabilityState?.booking?.slots?.subject || null;
}

test.before(async () => {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nova-b56-reg-"));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

// ── Bug 5: don't treat whole phrase as a product name / swallow into booking ──

test("Bug 5: 'can i book a conference room?' on hotel → booking.unavailable_request (not defaultSubject)", async () => {
  const r = await q("hotel-demo", "b5-conf-" + Date.now(), "can i book a conference room?");
  assert.equal(lastIntent(r), "booking_unavailable_request");
  assert.equal(bookingSubject(r), null); // no defaultSubject substituted
  assert.match(r.reply, /conference room/i);
  assert.match(r.reply, /don't see|not available|configured offerings/i);
});

test("Bug 5: 'do you have a gym?' on hotel → unavailable outcome (not a booking)", async () => {
  const r = await q("hotel-demo", "b5-gym-" + Date.now(), "do you have a gym?");
  // Either booking_unavailable_request OR offering.unavailable OR domain_mismatch
  // — any unavailable outcome is correct; the bug was it became booking_collecting.
  const li = lastIntent(r);
  assert.ok(
    li === "booking_unavailable_request" || li === "offering.unavailable" || li === "domain_mismatch",
    `expected an unavailable outcome, got ${li}`,
  );
  assert.equal(bookingSubject(r), null);
});

test("Bug 5 control: 'book a room for tomorrow' still substitutes defaultSubject (genuine booking)", async () => {
  const r = await q("hotel-demo", "b5-ctl-room-" + Date.now(), "book a room for tomorrow");
  assert.equal(lastIntent(r), "booking_collecting");
  assert.equal(bookingSubject(r), "Room Reservation");
});

test("Bug 5 control: 'i want to book a room' still substitutes defaultSubject (generic booking)", async () => {
  const r = await q("hotel-demo", "b5-ctl-want-" + Date.now(), "i want to book a room");
  assert.equal(lastIntent(r), "booking_collecting");
  assert.equal(bookingSubject(r), "Room Reservation");
});

test("Bug 5 control: 'i want to reserve a table' still substitutes defaultSubject", async () => {
  const r = await q("hotel-demo", "b5-ctl-table-" + Date.now(), "i want to reserve a table");
  assert.equal(lastIntent(r), "booking_collecting");
  assert.equal(bookingSubject(r), "Room Reservation");
});

// ── Bug 6a: food price → catalog, not service.quote ─────────────────────────

test("Bug 6a: 'what is the price of biryani?' on restaurant → catalog (not service.quote / booking)", async () => {
  const r = await q("restaurant-demo", "b6a-bir-" + Date.now(), "what is the price of biryani?");
  assert.equal(r.capabilityId, "catalog");
  assert.match(r.reply, /biryani/i);
  assert.match(r.reply, /Rs|price/i);
  // Must NOT push the service-quote "Would you like to book it?" flow.
  assert.doesNotMatch(r.reply, /would you like to book/i);
});

test("Bug 6a: 'how much is the beef burger?' on restaurant → catalog", async () => {
  const r = await q("restaurant-demo", "b6a-bur-" + Date.now(), "how much is the beef burger?");
  assert.equal(r.capabilityId, "catalog");
  assert.match(r.reply, /beef burger/i);
  assert.doesNotMatch(r.reply, /would you like to book/i);
});

test("Bug 6a control: 'how much is a haircut?' on salon still quotes via service.quote (salon has no catalog)", async () => {
  const r = await q("salon-demo", "b6a-ctl-cut-" + Date.now(), "how much is a haircut?");
  // Salon has no catalog, so the service.quote flow should still own it.
  assert.equal(r.capabilityId, "booking");
  assert.match(r.reply, /haircut/i);
  assert.match(r.reply, /Rs|cost/i);
});

// ── Bug 6b: "what time is check in?" → knowledge, not booking ──────────────

test("Bug 6b: 'what time is check in?' on hotel → routes to assistant/knowledge (not booking.start)", async () => {
  const r = await q("hotel-demo", "b6b-q1-" + Date.now(), "what time is check in?");
  assert.notEqual(r.capabilityId, "booking", "must NOT route to booking");
  assert.notEqual(lastIntent(r), "booking_collecting");
  // Must NOT ask for a check-in date (the old mis-route symptom).
  assert.doesNotMatch(r.reply, /check-in date/i);
});

test("Bug 6b: 'when is check in?' on hotel → not booking", async () => {
  const r = await q("hotel-demo", "b6b-q2-" + Date.now(), "when is check in?");
  assert.notEqual(r.capabilityId, "booking");
  assert.doesNotMatch(r.reply, /check-in date/i);
});

test("Bug 6b: 'what time is check out?' on hotel → not booking", async () => {
  const r = await q("hotel-demo", "b6b-q3-" + Date.now(), "what time is check out?");
  assert.notEqual(r.capabilityId, "booking");
  assert.doesNotMatch(r.reply, /check-in date/i);
});

test("Bug 6b control: 'check in please' still books (genuine request, no question word)", async () => {
  const r = await q("hotel-demo", "b6b-c1-" + Date.now(), "check in please");
  // This is a request, not a question — should still trigger booking.
  assert.equal(r.capabilityId, "booking");
  assert.equal(lastIntent(r), "booking_collecting");
});

test("Bug 6b control: 'book a room for tomorrow' still books", async () => {
  const r = await q("hotel-demo", "b6b-c2-" + Date.now(), "book a room for tomorrow");
  assert.equal(r.capabilityId, "booking");
  assert.equal(lastIntent(r), "booking_collecting");
  assert.equal(bookingSubject(r), "Room Reservation");
});
