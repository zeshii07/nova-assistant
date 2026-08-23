# Nova v6.1 — Structural Conversation & Knowledge Routing Hardening

## Preserved deterministic engines
Catalog, Commerce, Product Matching, Booking, CRM, Pricing and Availability remain deterministic. v6.1 changes routing and knowledge orchestration, not their authority.

## Constraint canonicalization
A central constraint normalizer now canonicalizes minor noisy spellings for high-value booking constraints before routing. Examples:
- `same dy bookigs` → `same day bookings`
- `twice a weak` → `twice a week`
- `weeekend` → `weekend`

The canonicalized text is used by Availability and recurrence extraction, instead of normalizing once and then accidentally matching later regexes against the original typo.

## Recurring hidden operational services
A service may be hidden from ordinary public service lists while still being a valid workflow primitive. `Hourly Cleaner Hire` is such a service. When the recurring workflow explicitly offers it, the selector may accept it even though it remains hidden from the normal service catalog.

## Command vs policy
`cancel my request` is a global cancel command.
`can I cancel a booked service?` is a cancellation-policy question.
The latter can temporarily interrupt an active workflow and then resume it without destroying state.

## Multi-facet informational questions
`queryFacetExtractor` can identify independent informational facets in one customer message. Example:
`what is your payment method and do you offer discounts?`
contains `payment` + `discount`.
Nova composes both answers rather than allowing the higher-priority Pricing/Cleaning intent to swallow the payment part.

## Customer-safe evidence
Knowledge sanitization now removes additional meta/instruction text such as:
- `Customers may ask ...`
- `The customer should be offered ...`
- `The assistant should ...`
- `The assistant must ...`
These passages may guide configuration but cannot become customer-facing factual answers.

## Service-area grounding
If a customer asks for coverage in a named place and that place is not present in the retrieved approved service-area evidence, Nova does not imply service there. It explains that the requested location is not in the configured areas and shows the approved coverage evidence.

## Actionable custom quotations
Unpriced property/service combinations now persist `customQuotePending` state. A follow-up such as:
`yes arrange a custom quotation`
creates a human handoff with the quote context attached and returns a reference ID. It no longer replays the RAG paragraph explaining when custom quotes may be required.

## Regression coverage
v6.1 adds exact tests for:
- unconfigured requested city vs configured coverage
- recurring Hourly Cleaner selection
- typo `twice a weak`
- cancellation-policy vs cancel-command behavior
- 5-bedroom villa custom quote handoff
- typo `same dy bookigs`
- combined payment + discount questions
- card-payment abstention when no real payment method is configured
