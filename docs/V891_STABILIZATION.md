# Nova v8.9.1 — Workflow and multi-item stabilization

v8.9.1 is a stabilization release built from real cleaning and retail
conversations. It does not make Qwen authoritative. Nova's deterministic engine
still owns state, prices, inventory, bookings, CRM writes and tenant isolation.

## Corrected behavior

### Cleaning workflow ownership

- A clear request such as `book a 2 bedroom vila on Friday at 9 AM` owns the
  cleaning transaction instead of being diverted to generic availability.
- The bounded typo `vila` resolves to `villa`; the supplied weekday and time are
  consumed immediately instead of being asked again.
- `change my request from 2 PM to 6 PM` is a start-time replacement. The previous
  duration is retained, the end time is recalculated, and the pending address or
  customer field is preserved.
- `Friday on 2 PM` supplies both the date and time.
- `show my service details` reads only that customer's cleaning requests inside
  the active tenant. It does not list the public service catalog.
- A message that requests a quote/availability check *before booking anything*
  calculates the configured quote without starting address/name/phone collection.
  Ordered day/time fallbacks, finish-by constraints and exact staff-count rules
  remain attached to the inquiry.

### Retail catalog and cart drafts

- Generic discovery such as `I want to buy some products` and the common typo
  `wht products do you have` list the real catalog instead of searching for a
  product literally named after the sentence.
- Multi-product matching accepts bounded identity typos such as `smrt watch`
  without enabling loose one-word substitutions.
- Every pending line keeps its own color, size and quantity. A unique shorthand
  answer is applied to its only possible owner.
- If the same shorthand could update several products, Nova asks the customer to
  label each answer and does not mutate the draft or cart.
- Assistant/knowledge fallbacks cannot steal a valid pending color or size reply,
  preventing unrelated contact details from appearing in the flow.

## Qwen boundary

Qwen remains optional. With `NOVA_NLU_MODE=off`, no model is called. With
`NOVA_NLU_MODE=on`, clear deterministic messages remain on the local fast path.
Only unresolved, conflicting, multilingual or genuinely ambiguous messages are
eligible for schema-validated interpretation. The model cannot execute actions or
invent business facts.

Examples that may invoke Qwen when the deterministic candidates cannot resolve a
safe owner:

- `Kal wali booking ko Friday kar do, but the second service stays the same.`
- `Use the same one as before, add two, and send the other one tomorrow.`

Even then, Nova validates the returned intent/entities and asks for clarification
instead of guessing when several transaction targets remain possible.

## Release gate

```bash
npm run benchmark:v8.9.1
```

The gate runs the v8.9.1 regressions, the complete test suite, conversation
datasets, structural checks and state-safety audit.
