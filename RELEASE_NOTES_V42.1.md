# Nova v42.1 — Sprint 2 Bug Fixes

**Released**: 2026-11-05
**Focus**: Fix four bugs surfaced by a live restaurant-demo conversation where the customer said "i wnt 2 chicken biryani and 6 beef burgers" → "ok confirm and i want to dine inn" → got "I'm not fully sure which restaurant request you mean" → "ok confirm" → got "Your cart is empty".

This patch release closes all four bugs and adds 9 dedicated regression tests.

---

## Summary

| Bug | Symptom | Root Cause | Fix |
| --- | --- | --- | --- |
| 1 | "Provisional merchandise subtotal (assuming the requested sizes and colors are available)" shown for restaurant orders | Multi-item handler always showed the variant qualifier, regardless of whether products had variants | Conditional: only show "assuming sizes/colors" when at least one product actually has colors/sizes; otherwise show plain "Provisional subtotal" |
| 2 | "ok confirm and i want to dine inn" misrouted to catalog adapter, which fired `catalog.unavailable_request` for "dine inn" | Catalog adapter only suppressed search during `checkout` mode, not `paused_add_item` mode | Catalog adapter now also suppresses search in `paused_add_item` mode when the message contains order-type keywords (dine in / takeaway / delivery) or confirmation language (ok / confirm / done) |
| 3 | "i want to dine inn" (with typo) didn't trigger order-type detection | v42.0 detection required explicit change/make/switch verbs; standalone declarations weren't caught | Expanded v42 commerce adapter detection to catch standalone phrases when there's an active commerce workflow: "i want to dine in", "for here", "to go", "dine inn" (typo), Roman Urdu ("delivery chahiye", "takeaway karo") |
| 4 | When the user's order-type declaration did reach `startCheckout`, the `orderType` was set on the local `state` object but lost when `next` was built with only `mode` + `pendingField` | `startCheckout` built a fresh `next` object that didn't carry forward orderType/specialInstructions/note/promoCode | `startCheckout` now accepts the caller's `state` object and merges orderType + specialInstructions + note + promoCode into the returned `next` state, AND persists them on `cart.checkout` so they survive across turns |

---

## Test Coverage

New test file: `tests/sprint42.1.v42-1-bugfixes.integration.test.js`

9 tests across the four bug categories:

- **E1**: Restaurant multi-item order does NOT show "assuming sizes/colors" message
- **E2**: Retail multi-item order DOES show "assuming sizes/colors" message (variant products)
- **E3**: "ok confirm and i want to dine inn" does NOT trigger clarification reply
- **E4**: "ok confirm and i want to dine inn" preserves the cart (2 items intact)
- **E5**: "ok confirm and i want to dine inn" captures the order type as `dine-in`
- **E6**: "i want to dine in" without "ok confirm" also triggers order type detection
- **E7**: "for here" / "to go" / "for delivery" trigger order type detection
- **E8**: Subsequent "ok confirm" works correctly after order type declaration
- **E9**: Order type persists on `cart.checkout` record (not just state)

**Result**: 9/9 passing in ~4 seconds. All 20 v42.0 tests still pass. All 13 commerce/catalog regression tests (sprint6, sprint5, sprint12) still pass.

---

## Files Changed

| File | Change |
| --- | --- |
| `capabilities/commerce/src/index.js` | (1) Conditional "Provisional merchandise subtotal" message; (2) `canHandle` accepts "ok confirm" + extra context in `paused_add_item` mode; (3) `startCheckout` accepts caller's state and merges orderType/specialInstructions/note/promoCode into `next`, AND persists them on `cart.checkout` |
| `capabilities/commerce/conversation/index.js` | Expanded order-type-change detection to catch standalone declarations ("i want to dine in", "for here", "to go", "dine inn" typo, Roman Urdu) |
| `capabilities/catalog/conversation/index.js` | Catalog adapter now suppresses search in `paused_add_item` mode when message contains order-type or confirmation keywords |
| `tests/sprint42.1.v42-1-bugfixes.integration.test.js` | New regression test file with 9 tests covering all 4 bugs |
| `package.json` | Version 42.0.0 → 42.1.0 |
