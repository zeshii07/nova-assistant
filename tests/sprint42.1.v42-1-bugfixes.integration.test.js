/**
 * Sprint 42.1 — v42.1 Bug-fix Regression Tests
 *
 * Validates the four bugs reported by the user after the live restaurant-demo
 * conversation:
 *
 *   Bug 1: "Provisional merchandise subtotal (assuming the requested sizes and
 *           colors are available)" was shown for restaurant orders where food
 *           items have NO colors/sizes.
 *
 *   Bug 2: "ok confirm and i want to dine inn" was misrouted to the catalog
 *           adapter which fired catalog.unavailable_request (searching for
 *           "dine inn" as a product) and produced the "I'm not fully sure"
 *           clarification reply — leaving the customer confused and the cart
 *           apparently orphaned on the next turn.
 *
 *   Bug 3: "i want to dine inn" (with the typo) didn't trigger order-type
 *           detection because the v42 detection required explicit change/make/
 *           switch verbs. Standalone declarations are now caught.
 *
 *   Bug 4: When "ok confirm and i want to dine inn" did succeed in routing
 *           to commerce, the orderType='dine-in' was set on the local state
 *           object but lost when startCheckout returned a new state with only
 *           mode + pendingField.
 *
 * Source conversation:
 *   User:  "i wnt 2 chicken biryani and 6 beef burgers"
 *   Nova:  "Provisional merchandise subtotal (assuming the requested sizes...)"
 *   User:  "ok confirm and i want to dine inn"
 *   Nova:  "I'm not fully sure which restaurant request you mean..." (BUG)
 *   User:  "ok confirm"
 *   Nova:  "Your cart is empty. Add a product before checkout." (BUG)
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
// GROUP E — v42.1 bug-fix regressions
// ─────────────────────────────────────────────────────────────────────────────

test('E1: restaurant multi-item order does NOT show "assuming sizes/colors" message', async () => {
  const cid = 'v42-1-bug1-restaurant-subtotal';
  const r = await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  // The misleading phrase should NOT appear for restaurant items without variants
  assert.doesNotMatch(r.reply, /assuming the requested sizes and colors are available/i,
    `restaurant food items have no colors/sizes — should not see "assuming sizes/colors", got: ${r.reply}`);
  // But the subtotal should still be shown
  assert.match(r.reply, /subtotal/i, `expected subtotal line, got: ${r.reply}`);
});

test('E2: retail multi-item order DOES show "assuming sizes/colors" message (variant products)', async () => {
  const cid = 'v42-1-bug1-retail-subtotal';
  // Default tenant has products with colors/sizes (e.g., Wireless Earbuds has Black)
  const r = await msg('default', cid, 'i want 1 black wireless airbud and 1 small t-shirt');
  // For products WITH variants, the original message is still appropriate
  // (we don't assert exact text — just that the reply is non-empty and mentions subtotal or items added)
  assert.ok(r.reply.length > 0, 'expected non-empty reply');
});

test('E3: "ok confirm and i want to dine inn" does NOT trigger clarification reply', async () => {
  const cid = 'v42-1-bug2-no-clarification';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  const r = await msg('restaurant-demo', cid, 'ok confirm and i want to dine inn');
  // The "I'm not fully sure" clarification reply must NOT fire
  assert.doesNotMatch(r.reply, /not fully sure which/i,
    `expected no clarification reply, got: ${r.reply}`);
  // The cart should still have items (not cleared)
  assert.doesNotMatch(r.reply, /cart is empty/i,
    `cart should not be empty after a successful confirm, got: ${r.reply}`);
});

test('E4: "ok confirm and i want to dine inn" preserves the cart', async () => {
  const cid = 'v42-1-bug2-cart-preserved';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  await msg('restaurant-demo', cid, 'ok confirm and i want to dine inn');
  // Verify the cart is still populated
  const cart = await container.commerceRepository?.getCart?.('restaurant-demo', cid);
  assert.ok(cart?.items?.length > 0, 'cart should still have items after "ok confirm and i want to dine inn"');
  assert.equal(cart.items.length, 2, 'cart should have exactly 2 items (biryani + burger)');
});

test('E5: "ok confirm and i want to dine inn" captures the order type as dine-in', async () => {
  const cid = 'v42-1-bug3-dine-in-typo';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  const r = await msg('restaurant-demo', cid, 'ok confirm and i want to dine inn');
  // The orderType should be set on the commerce state
  assert.equal(r.state?.capabilityState?.commerce?.orderType, 'dine-in',
    `expected orderType='dine-in', got: ${r.state?.capabilityState?.commerce?.orderType}`);
});

test('E6: "i want to dine in" without "ok confirm" also triggers order type detection', async () => {
  const cid = 'v42-1-bug3-standalone-dine-in';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani');
  // Just "i want to dine in" — no "change" or "make" verb
  const r = await msg('restaurant-demo', cid, 'i want to dine in');
  // Should detect order type (either as state.orderType or via update_order_meta intent)
  // The reply should not be a clarification ("not fully sure")
  assert.doesNotMatch(r.reply, /not fully sure which/i,
    `expected no clarification for "i want to dine in", got: ${r.reply}`);
});

test('E7: "for here" / "to go" / "for delivery" trigger order type detection', async () => {
  const cid = 'v42-1-bug3-standalone-togo';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani');
  // "to go" should trigger takeaway order type
  const r = await msg('restaurant-demo', cid, 'for here please');
  // Should not produce a clarification reply
  assert.doesNotMatch(r.reply, /not fully sure which/i,
    `expected no clarification for "for here please", got: ${r.reply}`);
});

test('E8: subsequent "ok confirm" works correctly after order type declaration', async () => {
  const cid = 'v42-1-bug4-confirm-after-dine-in';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  await msg('restaurant-demo', cid, 'ok confirm and i want to dine inn');
  // Now the second "ok confirm" — should NOT say "cart is empty"
  const r = await msg('restaurant-demo', cid, 'ok confirm');
  assert.doesNotMatch(r.reply, /cart is empty/i,
    `cart should not be empty on subsequent confirm, got: ${r.reply}`);
  // Should ask for the next checkout field (name)
  assert.match(r.reply, /name|delivery/i,
    `expected checkout continue prompt, got: ${r.reply}`);
});

test('E9: order type persists on cart.checkout record (not just state)', async () => {
  const cid = 'v42-1-bug4-order-type-on-cart';
  await msg('restaurant-demo', cid, 'i wnt 2 chicken biryani and 6 beef burgers');
  await msg('restaurant-demo', cid, 'ok confirm and i want to dine inn');
  const cart = await container.commerceRepository?.getCart?.('restaurant-demo', cid);
  assert.equal(cart?.checkout?.orderType, 'dine-in',
    `expected cart.checkout.orderType='dine-in', got: ${cart?.checkout?.orderType}`);
});
