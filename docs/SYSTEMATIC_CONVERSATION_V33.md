# Nova v3.3 — Systematic Conversation Gap Closure

## Shared fixes
- Lexical quantities (`five`, `ten`, Roman Urdu equivalents) fill an active quantity slot without confusing numeric sizes.
- Alternative browsing remains at the narrowest semantic family (`other shirts` stays shirts, not all Clothing).
- Roman-Urdu add-to-order phrasing routes through Commerce and preserves existing cart items.
- Checkout summaries are generated from the canonical multi-item cart.
- Booking slot values outrank Offering interpretation when the user is answering the pending date/time/grade field.
- Embedded and combined date/time messages are decomposed into both slots.
- Entity resolution tolerates token-order variation while keeping strict unknown-offering behavior.
- Cleaning preserves requested duration, including Roman-Urdu `ghanty/ghantay` variants.
- Explicit Roman-Urdu self-introductions can update CRM.
- Education supports fuzzy admissions follow-ups, program fee queries through configured offering data, and campus-location questions.
- Generic Offering Order Engine enables tenant-configured orderable offerings (Restaurant is the demo tenant) without modifying core logic for the domain.

## Generic Offering Order configuration
A tenant can enable:
```json
{
  "actionMode": "order",
  "defaultQuantity": 1,
  "orderTerms": ["order", "buy", "confirm this item"]
}
```
and mark individual offerings with `"orderable": true`.

## Quality gates
- Full Node integration suite.
- Conversation corpus.
- Syntax validation.
- Sprint 21 regression suite derived from cross-domain stress-test conversations.
