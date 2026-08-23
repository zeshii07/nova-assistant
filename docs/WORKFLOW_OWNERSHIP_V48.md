# Nova v4.8 — Workflow Ownership & Continuation

## Problem fixed
A product draft, cart workflow, checkout workflow, booking flow and service request can coexist in conversation state. Before v4.8, lower-level Catalog state could sometimes steal control from the active Commerce transaction.

Example:
- Cooking Oil product name contains `1 Litre`.
- User answers quantity `4`.
- Catalog previously searched `Cooking Oil ... 1 Litre ... 4`, allowing the product-name digit `1` to contaminate quantity extraction.
- Confirmation could then be interpreted as another Catalog turn.

## Central workflow ownership
`packages/conversation-intelligence/src/workflowOwnershipEngine.js`

The ownership layer gives transactional control words to the active workflow:
- paused Commerce item addition + `confirm` -> Commerce
- checkout review + `confirm` -> Commerce
- ready generic booking + `confirm` -> Booking
- ready cleaning request + `confirm` -> Cleaning

Informational interruptions are still allowed to route to Assistant/Knowledge without deleting the transaction.

## Product attributes
Active Catalog attribute extraction now parses **only the new customer message against the already selected product**.

It no longer appends the product name before extracting quantity/size/color.

Numeric rule:
- shoe `42` -> size 42
- grocery `4` -> quantity 4
- explicit `quantity 4` -> quantity 4

## Multi-item commerce
`add <item> also` is a supported cart-add construction.
The first completed item remains in the authoritative cart while another Catalog selection is configured.

A temporary question such as `do you offer JazzCash?` can be answered by tenant knowledge while Commerce remains paused and resumable.

## Cleaning hourly requests
The configured $40/hour/cleaner quote is now a real request workflow, not a dead-end response.

Example:
`book a cleaner for two hours tomorrow`
- quote = $80
- cleaner count = 1
- duration = 2
- date = tomorrow
- next field = time

If the user says `confirm` before required details are complete, Nova asks for the missing field rather than falling back to Assistant.

A hidden operational `Hourly Cleaner Hire` service exists only so the final request can be persisted. It does not appear in the normal cleaning-service menu.

Duration is also an editable workflow slot. Repeating/changing `2 hours` updates the active request instead of being parsed as a date.

## Side-question precedence
Pending values outrank interruption detection. For example, `Cash on Delivery` while Commerce is asking for payment is a payment answer, not a payment-policy question.
