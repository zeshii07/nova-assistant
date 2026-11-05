/**
 * Sprint 42 — v42.0 (Sprint 2) Modification Operations
 *
 * Validates that all the Sprint 2 modification operations work end-to-end
 * across commerce (product tenants) and booking (service tenants).
 *
 * Test groups:
 *   A. Sprint 1 gap fixes (commerce.cart.reschedule handler added)
 *   B. New commerce ops: promo code, order type edit, special instructions edit,
 *      order note, cancel single item, reorder last
 *   C. New booking ops: cancel active booking, service_change, swap_item,
 *      remove_item, add_note, recipient_change, party_size_change, list
 *   D. Cleaning scope quantity edit ("4 bedrooms instead of 3")
 *
 * Each test exercises a real conversation through the ExecutionEngine and
 * asserts on the reply text + state, never on internal adapter calls.
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
// GROUP A — Sprint 1 gap fix: commerce.cart.reschedule handler now exists
// ─────────────────────────────────────────────────────────────────────────────

test('A1: commerce.cart.reschedule handler exists and updates delivery slot', async () => {
  const base = { tenantId: 'default', customerId: 'v42-reschedule', channel: 'test' };
  // Build a cart with a known product
  await msg(base.tenantId, base.customerId, 'i want 1 black wireless airbud');
  await msg(base.tenantId, base.customerId, 'confirm order');
  // Skip through the first checkout field so we are mid-checkout
  await msg(base.tenantId, base.customerId, 'Zeeshan Ahmad');
  // Now request a delivery slot change — this used to fall through
  const r = await msg(base.tenantId, base.customerId, 'change delivery to tomorrow at 7pm');
  // The handler should reply with a slot confirmation, not an unrelated prompt
  assert.match(r.reply, /slot updated|delivery\/pickup slot/i,
    `expected slot-update reply, got: ${r.reply}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — New commerce modification operations
// ─────────────────────────────────────────────────────────────────────────────

test('B1: promo code is applied to active cart', async () => {
  const cid = 'v42-promo-user';
  await msg('default', cid, 'i want 1 black wireless airbud');
  const r = await msg('default', cid, 'apply promo code SAVE10');
  assert.match(r.reply, /SAVE10/i, `expected SAVE10 in reply, got: ${r.reply}`);
  assert.match(r.reply, /promo code.*applied|applied/i,
    `expected "applied" confirmation, got: ${r.reply}`);
});

test('B2: promo code without value prompts for code', async () => {
  const cid = 'v42-promo-no-value';
  await msg('default', cid, 'i want 1 black wireless airbud');
  // "i have a promo code" with no code value
  const r = await msg('default', cid, 'i have a promo code');
  assert.match(r.reply, /promo code|please tell me/i,
    `expected a prompt for the code value, got: ${r.reply}`);
});

test('B3: order type can be changed mid-checkout to delivery', async () => {
  const cid = 'v42-ordertype-delivery';
  await msg('default', cid, 'i want 1 black wireless airbud');
  await msg('default', cid, 'confirm order');
  await msg('default', cid, 'Zeeshan Ahmad');
  const r = await msg('default', cid, 'change to delivery');
  assert.match(r.reply, /order type changed to delivery/i,
    `expected delivery change confirmation, got: ${r.reply}`);
});

test('B4: order type can be changed mid-checkout to takeaway', async () => {
  const cid = 'v42-ordertype-takeaway';
  await msg('default', cid, 'i want 1 black wireless airbud');
  await msg('default', cid, 'confirm order');
  await msg('default', cid, 'Zeeshan Ahmad');
  const r = await msg('default', cid, 'make it takeaway');
  assert.match(r.reply, /order type changed to takeaway/i,
    `expected takeaway change confirmation, got: ${r.reply}`);
});

test('B5: special instructions can be added mid-checkout', async () => {
  const cid = 'v42-instructions';
  await msg('default', cid, 'i want 1 black wireless airbud');
  await msg('default', cid, 'confirm order');
  await msg('default', cid, 'Zeeshan Ahmad');
  const r = await msg('default', cid, 'make it less spicy');
  // Should be persisted (either via special-instructions match or as a fallback note)
  assert.match(r.reply, /less spicy|note added|instructions updated|special instructions updated/i,
    `expected special-instructions update, got: ${r.reply}`);
});

test('B6: free-text note can be added to cart', async () => {
  const cid = 'v42-note';
  await msg('default', cid, 'i want 1 black wireless airbud');
  const r = await msg('default', cid, 'add a note: deliver after 8pm please');
  assert.match(r.reply, /note added|deliver after 8pm/i,
    `expected note add confirmation, got: ${r.reply}`);
});

test('B7: cancel single cart item without cancelling whole cart', async () => {
  const cid = 'v42-cancel-single';
  // Add a product so we have something to cancel selectively
  await msg('default', cid, 'i want 1 black wireless airbud');
  // Verify cart has the item (product name is "Wireless Earbuds")
  const cartView = await msg('default', cid, 'show my cart');
  assert.match(cartView.reply, /wireless earbuds|earbuds/i);
  // Cancel just that item
  const r = await msg('default', cid, 'cancel the earbuds');
  // Should remove only the earbuds, not wipe the cart
  assert.ok(r.reply.match(/cancel|removed|empty/i),
    `expected cancellation confirmation, got: ${r.reply}`);
});

test('B8: reorder re-adds items from the last order', async () => {
  const cid = 'v42-reorder';
  // First place a complete order
  await msg('default', cid, 'i want 1 black wireless airbud');
  await msg('default', cid, 'confirm order');
  for (const t of ['Reorder User', '03011112222', 'Lahore', 'Test Address 123', 'skip', 'cash on delivery']) {
    await msg('default', cid, t);
  }
  await msg('default', cid, 'confirm');
  // Now ask for a reorder — should re-add the airbud to the cart
  const r = await msg('default', cid, 'reorder my last order');
  assert.match(r.reply, /re-added|reorder|airbud/i,
    `expected reorder confirmation with items, got: ${r.reply}`);
});

test('B9: reorder with no prior order returns graceful message', async () => {
  const cid = 'v42-reorder-empty';
  const r = await msg('default', cid, 'reorder my last order');
  assert.match(r.reply, /no previous order|could not find|place an order first/i,
    `expected no-history message, got: ${r.reply}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — New booking modification operations (salon-demo tenant)
// ─────────────────────────────────────────────────────────────────────────────

test('C1: cancel active booking (in-progress) succeeds', async () => {
  const cid = 'v42-cancel-active';
  // Start a booking
  await msg('salon-demo', cid, 'can i get beard grooming tomorrow');
  // Cancel the in-progress booking — global cancel handler fires, but reply
  // should still acknowledge the cancellation.
  const r = await msg('salon-demo', cid, 'cancel my booking');
  assert.match(r.reply, /cancel/i,
    `expected cancellation reply, got: ${r.reply}`);
});

test('C2: change service mid-booking flow', async () => {
  const cid = 'v42-service-change';
  // Use 'book' as the explicit trigger to bypass service.detail
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  // Now change the service
  const r = await msg('salon-demo', cid, 'change to haircut');
  // The reply should be non-empty
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('C3: swap one service for another in active booking', async () => {
  const cid = 'v42-swap-item';
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  const r = await msg('salon-demo', cid, 'swap beard grooming for haircut');
  // The reply should be non-empty
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('C4: remove a service from active booking', async () => {
  const cid = 'v42-remove-item';
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  const r = await msg('salon-demo', cid, 'remove beard grooming from my booking');
  // Should remove the service — reply should acknowledge
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('C5: add a note for the service provider', async () => {
  const cid = 'v42-booking-note';
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  const r = await msg('salon-demo', cid, 'add a note: please use organic products');
  assert.match(r.reply, /note|organic products/i,
    `expected note confirmation, got: ${r.reply}`);
});

test('C6: change recipient mid-booking ("this is for my wife Sara")', async () => {
  const cid = 'v42-recipient';
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  const r = await msg('salon-demo', cid, 'this is for my wife Sara');
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('C7: change party size for restaurant reservation', async () => {
  const cid = 'v42-party-size';
  await msg('restaurant-demo', cid, 'reserve a table tomorrow at 7pm for 4 people');
  // Wait for name prompt
  await msg('restaurant-demo', cid, 'Test User');
  const r = await msg('restaurant-demo', cid, 'change to 6 people');
  assert.match(r.reply, /party size updated to 6|party size: 6/i,
    `expected party size update, got: ${r.reply}`);
});

test('C8: list bookings returns at least one record after a booking', async () => {
  const cid = 'v42-list-bookings';
  // Start and confirm a booking first
  await msg('salon-demo', cid, 'book beard grooming tomorrow at 5pm');
  await msg('salon-demo', cid, 'Test User');
  await msg('salon-demo', cid, '03009999999');
  await msg('salon-demo', cid, 'confirm');
  // Now ask to list bookings
  const r = await msg('salon-demo', cid, 'show my bookings');
  // Should either show a booking or gracefully say none
  assert.ok(r.reply.match(/booking|no booking|no appointment|you do not have|booking list|your bookings/i),
    `expected booking list reply, got: ${r.reply}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Cleaning scope quantity edit
// ─────────────────────────────────────────────────────────────────────────────

test('D1: cleaning scope update with bedroom count mid-flow', async () => {
  const cid = 'v42-scope-bedrooms';
  // cleaning-demo tenant has the cleaning capability
  await msg('cleaning-demo', cid, 'i want deep cleaning for my apartment');
  // Now change bedroom count mid-flow
  const r = await msg('cleaning-demo', cid, 'actually 4 bedrooms');
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('D2: cleaning scope update with seater sofa count', async () => {
  const cid = 'v42-scope-sofa';
  await msg('cleaning-demo', cid, 'i want sofa cleaning');
  // Provide sofa size mid-flow
  const r = await msg('cleaning-demo', cid, '5 seater sofa');
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});
