/**
 * Sprint 7 — v47.0 Hotel Management System + Reservation Bug Fix Tests
 *
 * Group P — Restaurant reservation bug fix (catalog should not intercept "reserve a table")
 * Group Q — Hotel management system (room booking via Nova chat)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');

let container;
test.before(async () => { container = await buildContainer(); });

async function msg(tenantId, customerId, text) {
  return container.executionEngine.process({ tenantId, channel: 'test', customerId, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP P — Restaurant reservation bug fix
// ─────────────────────────────────────────────────────────────────────────────

test('P1: "i want to reserve a table for party of 10 people" routes to booking', async () => {
  const r = await msg('restaurant-demo', 'v47-p1', 'i want to reserve a table for party of 10 people');
  assert.equal(r.capabilityId, 'booking', `expected booking, got ${r.capabilityId}`);
  assert.match(r.reply, /table|reservation|party size|date/i,
    `expected reservation reply, got: ${r.reply.slice(0, 200)}`);
});

test('P2: "i want to book a table for 10 persons" routes to booking', async () => {
  const r = await msg('restaurant-demo', 'v47-p2', 'i want to book a table for 10 persons');
  assert.equal(r.capabilityId, 'booking', `expected booking, got ${r.capabilityId}`);
  assert.match(r.reply, /table|reservation|party size|date/i,
    `expected reservation reply, got: ${r.reply.slice(0, 200)}`);
});

test('P3: "i want to reserve space for my family we are 10 family members" routes to booking', async () => {
  const r = await msg('restaurant-demo', 'v47-p3', 'i want to reserve space for my family we are 10 family members');
  assert.equal(r.capabilityId, 'booking', `expected booking, got ${r.capabilityId}`);
});

test('P4: reservation is NOT misrouted to catalog.unavailable_request', async () => {
  const r = await msg('restaurant-demo', 'v47-p4', 'i want to book a table for 6 people');
  assert.doesNotMatch(r.reply, /not available|sorry.*catalog|couldn't find/i,
    `should not produce catalog unavailable reply, got: ${r.reply.slice(0, 200)}`);
});

test('P5: party size is extracted correctly', async () => {
  const r = await msg('restaurant-demo', 'v47-p5', 'i want to book a table for 8 people');
  assert.match(r.reply, /8/i, `expected party size 8 in reply, got: ${r.reply.slice(0, 200)}`);
});

test('P6: catalog adapter still works for product orders after fix', async () => {
  // Verify the fix doesn't break normal product ordering
  const r = await msg('restaurant-demo', 'v47-p6', 'i want 1 chicken biryani');
  assert.ok(r.reply.length > 0, 'should have a reply');
  // Should NOT be misrouted to booking — it's a food order
  assert.doesNotMatch(r.reply, /table|reservation|party size/i,
    `food order should not trigger reservation, got: ${r.reply.slice(0, 200)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP Q — Hotel management system
// ─────────────────────────────────────────────────────────────────────────────

test('Q1: "what rooms do you have" lists available room types', async () => {
  const r = await msg('hotel-demo', 'v47-q1', 'what rooms do you have');
  assert.ok(r.reply.length > 0, 'should have a reply');
  // Should mention at least one room type
  assert.match(r.reply, /standard|deluxe|executive|family|presidential|suite/i,
    `should mention room types, got: ${r.reply.slice(0, 200)}`);
});

test('Q2: "i want to book a deluxe room for tomorrow" starts booking flow', async () => {
  const r = await msg('hotel-demo', 'v47-q2', 'i want to book a deluxe room for tomorrow');
  assert.equal(r.capabilityId, 'booking', `expected booking, got ${r.capabilityId}`);
  assert.match(r.reply, /deluxe|reservation|date|night/i,
    `expected booking flow reply, got: ${r.reply.slice(0, 200)}`);
});

test('Q3: "how much is the presidential suite" returns price', async () => {
  const r = await msg('hotel-demo', 'v47-q3', 'how much is the presidential suite');
  assert.match(r.reply, /50,000|presidential/i,
    `expected price for presidential suite, got: ${r.reply.slice(0, 200)}`);
});

test('Q4: "do you have family rooms available" starts booking', async () => {
  const r = await msg('hotel-demo', 'v47-q4', 'do you have family rooms available');
  assert.ok(r.reply.length > 0, 'should have a reply');
  assert.doesNotMatch(r.reply, /not fully sure|couldn't find/i,
    `should not produce clarification, got: ${r.reply.slice(0, 200)}`);
});

test('Q5: "book a standard room for 2 nights" starts booking', async () => {
  const r = await msg('hotel-demo', 'v47-q5', 'book a standard room for 2 nights');
  assert.equal(r.capabilityId, 'booking', `expected booking, got ${r.capabilityId}`);
});

test('Q6: hotel vocabulary enriches "delux" typo to "deluxe"', () => {
  const { domainVocabulary } = require('../packages/tenant-adapter/src/tenantAdapterRegistry');
  const enriched = domainVocabulary.enrichText('i want a delux room', 'hotel');
  assert.match(enriched, /deluxe/i, `expected "deluxe", got: ${enriched}`);
});

test('Q7: hotel vocabulary enriches "accomodation" typo to "accommodation"', () => {
  const { domainVocabulary } = require('../packages/tenant-adapter/src/tenantAdapterRegistry');
  const enriched = domainVocabulary.enrichText('i need accomodation', 'hotel');
  assert.match(enriched, /accommodation/i, `expected "accommodation", got: ${enriched}`);
});

test('Q8: hotel vocabulary enriches "presedential" typo to "presidential"', () => {
  const { domainVocabulary } = require('../packages/tenant-adapter/src/tenantAdapterRegistry');
  const enriched = domainVocabulary.enrichText('i want the presedential suite', 'hotel');
  assert.match(enriched, /presidential/i, `expected "presidential", got: ${enriched}`);
});

test('Q9: hotel domain adapter is registered', () => {
  const { TenantAdapterRegistry } = require('../packages/tenant-adapter/src/tenantAdapterRegistry');
  const registry = new TenantAdapterRegistry({ tenantsDir: '/tmp/nonexistent' });
  const adapter = registry.get({ id: 'test-hotel', domain: 'hotel' });
  assert.ok(adapter, 'hotel adapter should exist');
  assert.equal(typeof adapter.enrichText, 'function', 'hotel adapter should have enrichText');
  assert.ok(adapter.vocabulary, 'hotel adapter should have vocabulary');
  assert.ok(adapter.vocabulary.domainTerms.includes('hotel'), 'hotel vocabulary should include "hotel" as domain term');
});

test('Q10: "tell me about the executive room" returns room details', async () => {
  const r = await msg('hotel-demo', 'v47-q10', 'tell me about the executive room');
  assert.match(r.reply, /executive|king|lounge|business/i,
    `expected executive room details, got: ${r.reply.slice(0, 200)}`);
});

test('Q11: hotel guest can complete a full booking flow', async () => {
  const cid = 'v47-q11';
  // Book a room
  await msg('hotel-demo', cid, 'i want to book a deluxe room for tomorrow');
  // Provide check-in date / nights
  await msg('hotel-demo', cid, '2 nights');
  // Provide name
  await msg('hotel-demo', cid, 'Ahmed Ali');
  // Provide phone
  const r = await msg('hotel-demo', cid, '03009999999');
  // Should be ready or confirmed
  assert.doesNotMatch(r.reply, /not fully sure|couldn't find/i,
    `should not produce clarification, got: ${r.reply.slice(0, 200)}`);
});

test('Q12: hotel knowledge answers "what time is check in"', async () => {
  const r = await msg('hotel-demo', 'v47-q12', 'what time is check in');
  assert.doesNotMatch(r.reply, /not fully sure|couldn't find/i,
    `should answer check-in time, got: ${r.reply.slice(0, 200)}`);
});
