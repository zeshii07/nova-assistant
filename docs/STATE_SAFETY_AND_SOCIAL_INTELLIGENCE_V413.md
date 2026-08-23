# Nova v4.13 — State Safety, Runtime Resilience & Social Intelligence

## Root crash fixed
A multi-item Commerce flow can have a complete cart without any active Catalog draft.

Previously, checkout and conversation-stack code could assume:

`capabilityState.catalog.selectedAttributes`

always existed. This caused:

`Cannot read properties of undefined (reading 'selectedAttributes')`

v4.13 makes the authoritative cart the primary source for checkout and makes Catalog draft access optional/null-safe.

## Cart-first checkout
If the cart already contains valid items:
- checkout starts directly from the cart,
- Catalog state is not required,
- multi-product Commerce requests can confirm immediately,
- an active Catalog draft is merged only when present and valid.

## Natural confirmation
Confirmation is now centralized and understands polite/informal variants such as:
- `confirm kro bhai jan`
- `order confirm kar do bhai`
- `ok confirm karo`
- `pakka bhai`
- `confirm my order please`

## Runtime resilience
Non-critical layers cannot expose raw runtime errors to customers:
- conversation intelligence failure → logged, safe routing fallback
- humanization failure → logged, original capability reply preserved
- replay/debug recording failure → logged, response still delivered

Core capability failures are still logged for developers.

## State-safety audit
`scripts/audit-state-safety.js` scans production JavaScript for obvious unsafe capability-state dereference patterns.

## Social intelligence upgrade
The social layer now detects additional conversational signals:
- familiar address: bhai, bhaijan, yaar, dost, bro, boss
- respectful address
- gratitude
- apology
- positive reactions
- price concern
- greeting + small-talk combinations

It may adjust warmth and conversational transitions but never business facts, pricing, inventory, availability, or workflow state.

Example:
`hello bhai kiaa hal hai`

can answer naturally in Roman Urdu rather than only replaying a formal assistant introduction.

## Language safety
Commerce Roman-Urdu detection was expanded for common forms such as:
`mujhy`, `kro`, `bhai`, `chahiy`, `aur`

while explicitly avoiding English `do` as a Roman-Urdu signal so:
`do you have milk?`
does not switch the checkout language incorrectly.

## Verification
The release includes forced-failure regressions proving that intelligence, humanization, and replay failures do not leak raw exceptions to customers.
