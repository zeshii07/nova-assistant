# Nova v2.8 — State & Slot Consistency

## Purpose
This quality release removes duplicate transactional truth between conversational Goal/Catalog state and Commerce state, and makes semantic entities flow into capability-owned slots.

## Canonical cart
- Commerce is the single source of truth for cart contents.
- When Catalog has a complete purchasable configuration (product + required attributes + quantity), it synchronizes that configuration into Commerce.
- `show my cart` therefore reflects the same item that `confirm my order` will check out.
- Checkout detects an already-staged item and does not duplicate it.

## Inventory-aware increments
`add N more <product>` is a Commerce quantity-increment operation. Nova validates the resulting total against official Catalog inventory. It reports current quantity, total stock, and maximum additional quantity instead of returning a generic unavailable message.

Example for Comfort Slides (inventory 38): cart 30 + request 50 => keep 30 and explain that at most 8 more can be added.

## Semantic slot handoff
Cleaning duration extracted by Conversation Intelligence is copied into `capabilityState.cleaning.durationHours` and retained while the user chooses a cleaning service. Humanization templates expose the preserved duration so it is visible in the actual reply.

## Boundary
The demo Cleaning tenant still has service-based pricing. Nova does not invent an hourly price unless an hourly pricing model is configured.
