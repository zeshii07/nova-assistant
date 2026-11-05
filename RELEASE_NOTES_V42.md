# Nova v42.0 — Sprint 2: Comprehensive Modification Operations

**Released**: 2026-11-05
**Focus**: Close every modification gap surfaced during Sprint 1 review and add 9 new important modification operations across commerce (product tenants) and booking (service tenants).

This sprint delivers the missing handlers for intents declared in v41.0 (Sprint 1) plus nine new modification operations that any tenant should support — covering the full lifecycle of a customer modifying an in-progress product order or service booking.

---

## Summary

| Category | Count | Where |
| --- | --- | --- |
| Sprint 1 gap fixes | 6 | commerce/src, booking/src |
| New commerce modification ops | 6 | commerce/conversation, commerce/src |
| New booking modification ops | 5 | unifiedServiceAdapter, booking/src |
| Cleaning scope detection expansion | 1 | cleaning/conversation |
| Global-cancel handler hardening | 1 | execution-engine |
| New integration tests | 20 | tests/sprint42.v42-modification-operations.integration.test.js |

**Test results**: 20/20 new integration tests pass. All existing commerce, catalog, and cart regression tests still pass (sprint6, sprint12, sprint5, sprint31). The sprint18 "generic-domain-framework" suite had pre-existing failures unrelated to v42 (the test expected `capabilityId='offering'` but the unified service adapter returns `service.browse` with `capabilityId='service'`, which gets routed to booking — this behavior was the same in v41.0).

---

## Sprint 1 Gap Fixes

Sprint 1 (v41.0) declared several new intents in the conversation adapters but never added the matching execute handlers. v42.0 closes all of them:

### 1. `commerce.cart.reschedule` handler (was declared, never handled)
Customer says "change delivery to tomorrow at 7pm" mid-checkout. v41.0 detected the intent but the commerce capability had no handler — it fell through to the generic collecting flow. v42.0 adds `rescheduleOrder()` which:
- Extracts date and/or time via `engagement.parseField`
- Persists `preferredDate` / `preferredTime` on the cart.checkout record
- Surfaces the new slot in the order review summary
- Resumes the active checkout workflow

### 2. `booking.cancel` handler (was declared, never handled)
Customer says "cancel my booking" with an active workflow. v41.0's unifiedServiceAdapter emitted `booking.cancel` but the booking capability had no handler — the global cancel command fired instead and wiped state without persisting the cancellation on the booking record. v42.0 adds:
- A dedicated `booking.cancel` handler that calls `booking.cancel(bookingId)` when there's a stored booking
- Hardening of the global cancel handler in `executionEngine.js` to also call `booking.cancel(bookingId)` for stored bookings, so the merchant sees the cancellation on the record

### 3. `booking.service_change` handler (was declared, never handled)
Customer says "change to beard grooming" mid-booking. v42.0 adds the handler that:
- For stored bookings: persists a `service_change` amendment proposal via `booking.proposeAmendment`
- For in-progress flows: replaces the items and resumes collecting

### 4. `booking.reschedule` handler (active flow) (was declared, never handled)
Customer says "move to tomorrow at 5pm" mid-booking. v42.0 adds the handler that:
- For stored bookings: delegates to the existing `rescheduleResult()` helper
- For in-progress flows: extracts date/time and updates the flow state

### 5. `booking.party_size_change` handler (was declared, never handled)
Customer says "change to 6 people" for a restaurant reservation. v42.0 adds the handler that extracts the new size, updates `flow.fields.partySize`, and (for stored bookings) proposes a `party_size_change` amendment.

### 6. `booking.field_edit` handler (was declared, never handled)
Customer says "change the name to Ali" mid-booking. v42.0 adds the handler that validates the new value, updates `flow.fields[field]`, and (for stored bookings) calls `booking.updateDetails({[field]: value})`.

### 7. `booking.list` handler (was declared, never handled)
Customer says "show my bookings" / "list my appointments". v42.0 adds the handler that lists the customer's bookings for this tenant (up to 10, most recent first) with reference, subject, date, time, and status.

---

## New Modification Operations

### Commerce (product tenants)

#### 1. Promo / Discount Code Application
- **Intent**: `commerce.cart.apply_promo`
- **Trigger phrases**: "apply code SAVE10", "use coupon DISCOUNT50", "I have a promo code XYZ", "discount code laga do", "coupon lagao"
- **Persistence**: stores `promoCode` and `promoApplied=false` on `cart.checkout` for the pricing engine to apply on fulfilment
- **Respects**: resumes the active checkout/review workflow

#### 2. Order Type Change (delivery ↔ takeaway ↔ dine-in)
- **Intent**: `commerce.cart.update_order_meta` (with `orderType` entity)
- **Trigger phrases**: "change to delivery", "make it takeaway", "switch to dine-in", "make it delivery", "delivery change karo"
- **Guarded against**: date/time keywords ("change delivery to tomorrow at 7pm" routes to reschedule, not order type change)

#### 3. Special Instructions Edit (mid-checkout)
- **Intent**: `commerce.cart.update_order_meta` (with `editInstructions=true` entity)
- **Trigger phrases**: "make it less spicy", "extra cheese laga do", "no onions please", "make it extra hot", "mirch kam kar do"
- **Merging**: appends to any existing special instructions (dedup), persists on `cart.checkout.specialInstructions`

#### 4. Order Note Add (free-text instruction)
- **Intent**: `commerce.cart.add_note`
- **Trigger phrases**: "add a note: deliver after 8pm", "leave a note for the kitchen", "note: please call before delivery", "instructions for the chef"
- **Extraction**: parses text after "note:" / "instruction:" / "remark:" markers
- **Truncation**: caps at 240 characters
- **Persistence**: stores on `cart.checkout.note`

#### 5. Cancel Single Cart Item (without cancelling whole cart)
- **Intent**: `commerce.cart.cancel_item`
- **Trigger phrases**: "cancel the biryani", "cancel just the burger", "cancel the earbuds"
- **Disambiguation**: distinct from "cancel my order" / "clear cart" — only matches when a single named item exists in the cart
- **Behaviour**: removes only the matched cart line; leaves the rest of the cart and checkout state intact

#### 6. Reorder / Repeat Last Order
- **Intent**: `commerce.reorder`
- **Trigger phrases**: "reorder my last order", "I'll have my usual", "repeat my previous order", "same as last time", "phir se same order"
- **Behaviour**: clears the current cart, re-adds each item from the customer's most recent confirmed order, carries over order type / special instructions / note from that order, and resumes at "checkout" or "modify items"
- **Graceful fallback**: returns a clear message when there's no prior order history or when none of the previous items are still available in the catalog

### Booking (service tenants)

#### 7. Remove Single Service from Active Booking
- **Intent**: `booking.remove_item`
- **Trigger phrases**: "remove carpet cleaning from my booking", "delete the haircut", "drop the deep cleaning"
- **Disambiguation**: distinct from "cancel my booking" (whole booking) — only matches when a named service is mentioned that exists in the active booking
- **Behaviour**: removes only that service; if it was the last service, prompts the user to add a new service or cancel the booking

#### 8. Service Swap in Active Booking
- **Intent**: `booking.swap_item`
- **Trigger phrases**: "swap beard grooming for haircut", "replace haircut with hair color", "exchange X for Y"
- **Behaviour**: resolves both "from" and "to" services via the offering service; if only the "to" service resolves, falls back to `booking.service_change`; otherwise removes `from` and adds `to` while preserving the rest of the booking flow

#### 9. Booking Note Add
- **Intent**: `booking.add_note`
- **Trigger phrases**: "add a note: please use organic products", "leave instructions for the cleaner", "note: bring extra towels"
- **Behaviour**: persists on `booking.metadata.note`; for stored bookings, also proposes a `note` amendment via `booking.proposeAmendment`

#### 10. Booking Recipient Change
- **Intent**: `booking.recipient_change`
- **Trigger phrases**: "this is for my wife Sara", "the appointment is for my son Ali", "book for Sara instead", "change the name to Ali"
- **Behaviour**: validates the name via `engagement.parseField('name', ...)`, updates `flow.fields.name`; for stored bookings, calls `booking.updateDetails({name: value})`

### Cleaning (service tenants with cleaning capability)

#### 11. Cleaning Scope Quantity Edit
- **Intent**: `cleaning.scope_update` (existing intent, expanded detection)
- **Trigger phrases** (new in v42):
  - "4 bedrooms" / "3 bhk" (apartment cleaning)
  - "5 seater sofa" / "7 seater carpet" (sofa/carpet cleaning)
  - "actually 4 bedrooms instead of 3" (explicit quantity edit)
  - "make it a 7-seater carpet"
- **Behaviour**: extracts `scopeCount` and `scopeUnit` from the message and persists them on the cleaning workflow state; the existing handler re-prompts for the pending field

---

## Architecture Changes

### Early-Exit Modification Detection in `unifiedServiceAdapter.js`

Previously, modification intents (cancel, remove, swap, note, recipient, party size, service change, field edit, reschedule) were checked INSIDE the `if (active?.status === "collecting" || active?.status === "ready")` block, which only fires when there's an active booking flow. This caused two bugs:

1. **"cancel my booking" without an active flow** matched the trigger term "book" (substring of "booking") and started a new booking instead of cancelling.
2. **Modification intents for an in-progress booking** were intercepted by `detectServiceDetail` (because the message mentioned a service name) and routed to `service.detail`.

v42.0 adds an EARLY modification-intent detection block at the very top of `analyze()`, BEFORE service browse/detail/trigger detection. This ensures modification intents always win, regardless of whether there's an active workflow.

### Hardened `detectServiceDetail` Helper

The helper previously defaulted to `type: 'detail'` for ANY message that mentioned a service name — even when the user was clearly trying to book. This caused "book beard grooming tomorrow at 5pm" to be intercepted as a service detail view, preventing the booking flow from starting.

v42.0 adds two guards:
1. **Booking-trigger guard**: returns null if the message contains "book", "schedule", "reserve", "appointment", "arrange", or any date/time keyword.
2. **Explicit-keyword guard**: returns null unless the message explicitly contains a quote keyword ("price", "how much", "kitna") or a detail keyword ("tell me about", "details", "info", "about", "what is").

### Reordered `commerce` Adapter Detection

The v41.0 modification block (quantity change, cancel, variant change, reschedule) was checked BEFORE the v42 specific patterns, which meant "change to delivery" matched the broad v41 quantity pattern (`change` + `to`) and fired `commerce.cart.update_quantity` instead of `commerce.cart.update_order_meta`.

v42.0 moves the v42 specific patterns (promo code, order type change, special instructions edit, order note, reorder, cancel single item) BEFORE the v41 patterns, and adds explicit exclusion keywords to v41 so it doesn't catch delivery/takeaway/spice/cheese/people keywords.

### Global Cancel Handler Now Persists Booking Cancellation

The execution engine's `#handleGlobalCommand` previously only released the calendar hold when handling "cancel" — it did not call `booking.cancel(bookingId)` for stored bookings. This meant a "confirmed" booking remained "confirmed" in the repository even after the user said "cancel my booking".

v42.0 adds a call to `bookingService.scope(...).cancel(storedBookingId, 'customer_requested')` when there's an active bookingId, so the merchant sees the cancellation on the booking record.

---

## Files Changed

| File | Change |
| --- | --- |
| `capabilities/commerce/conversation/index.js` | +6 new modification intent detections (promo, order type, instructions, note, reorder, cancel item) reordered before v41 |
| `capabilities/commerce/src/index.js` | +6 new handler methods (applyPromoCode, updateOrderMeta, addOrderNote, cancelSingleItem, reorderLast, rescheduleOrder) + intent dispatch wiring |
| `capabilities/booking/conversation/unifiedServiceAdapter.js` | Early-exit modification detection block (cancel/list/remove/swap/note/recipient/party-size/service-change/field-edit/reschedule) + hardened `detectServiceDetail` |
| `capabilities/booking/src/index.js` | +7 new handler methods (cancel, service_change, swap_item, remove_item, add_note, recipient_change, party_size_change, field_edit, list, reschedule active) |
| `capabilities/cleaning/conversation/index.js` | Expanded `scopeMention` detection to cover bedrooms, bhk, seater sofa, seater carpet, "X instead of Y" |
| `packages/execution-engine/src/executionEngine.js` | Global cancel handler now calls `bookingService.cancel(bookingId)` when there's a stored bookingId |
| `tests/sprint42.v42-modification-operations.integration.test.js` | New integration test file with 20 tests across 4 groups (A: Sprint 1 gap fixes, B: new commerce ops, C: new booking ops, D: cleaning scope) |
| `package.json` | Version 40.0.0 → 42.0.0 |

---

## Test Coverage

The new test file `tests/sprint42.v42-modification-operations.integration.test.js` exercises every new operation through a real conversation via the ExecutionEngine:

- **Group A — Sprint 1 gap fixes** (1 test): commerce.cart.reschedule handler
- **Group B — New commerce ops** (9 tests): promo code, promo without value, order type to delivery, order type to takeaway, special instructions edit, free-text note, cancel single cart item, reorder with prior order, reorder without prior order
- **Group C — New booking ops** (8 tests): cancel active booking, service change, swap item, remove item, add note, recipient change, party size change, list bookings
- **Group D — Cleaning scope quantity edit** (2 tests): bedroom count mid-flow, seater sofa count

**Result**: 20/20 passing in ~13 seconds.

---

## What's Next (Future Sprints)

The modification surface is now comprehensive. Possible follow-ups:

- **Promo code validation**: integrate with a real pricing engine to validate codes and apply percentage/fixed-amount discounts to the cart total
- **Booking staff/provider preference**: "I want a female cleaner" / "I prefer Dr. Smith"
- **Order/booking hold for later**: "save this order for later" / "pause my booking"
- **Loyalty/reward redemption**: "use my 100 loyalty points"
- **Multi-booking management**: view all active bookings across tenants (currently per-tenant only)
