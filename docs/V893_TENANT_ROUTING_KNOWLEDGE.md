# Nova v8.9.3 — Tenant routing and knowledge reliability

v8.9.3 converts the fruit-seller and real-estate playground failures into
cross-domain contracts. The changes are driven by configured tenant data and do
not contain tenant-specific hard-coded products, service IDs or answers.

## Intent ownership

| Customer request | Deterministic owner | Safety rule |
|---|---|---|
| View cart/order history | Commerce | A generic FAQ match cannot steal a transaction read |
| Remove and add cart items | Commerce | Validate the complete mutation before changing the cart |
| Book a viewing/consultation | Booking | Explicit transaction details outrank hours-only availability |
| Ask a policy/instruction question | Knowledge | Return only topic-complete approved evidence |
| Ask for another tenant's records | Assistant safety | Deny without catalog, CRM or knowledge leakage |
| Command a cash refund | Assistant safety | Explain the approved policy; require authorized human action |

Qwen remains outside every action path. With `NOVA_NLU_MODE=off`, all of these
cases are deterministic. With `NOVA_NLU_MODE=on`, the model is eligible only for
genuinely ambiguous low-confidence language; it cannot read another tenant or
write a cart, booking, refund, CRM record, price, stock or schedule.

## Atomic compound cart mutation

`Remove one dozen bananas and add one small fruit gift basket` is parsed into a
removal plan and an addition plan. Nova validates that:

- the requested cart item and quantity exist;
- the added product resolves to one catalog identity;
- required variants and inventory are valid;
- overlapping aliases do not resolve a longer, different product name.

Only after every check succeeds are the changes applied. Any ambiguity or
invalid line leaves the complete cart unchanged.

## Knowledge evidence gates

Retrieval searches tenant-scoped business facts, FAQs and durable knowledge
documents. Strong lexical evidence can satisfy a short exact question even when
the semantic score is weak. Topic gates then require the returned evidence to
contain the information needed by the question. For example:

- a spoiled-goods answer must contain claim/replacement/credit/refund evidence;
- storage guidance must actually contain storage instructions;
- rental-document guidance must mention relevant identity, income or tenancy
  requirements.

An address, business description or payment-method fact cannot pass these gates.
When approved evidence is absent, Nova abstains instead of inventing a policy.

## Booking and pricing extraction

A complete appointment request can capture the configured offering, date, time,
name, phone, property reference and availability-check constraint in one turn.
The application owns this state, so a brokerage or document question can be
answered as an interrupt and the booking remains ready for confirmation.

Structured service prices are authoritative even if an operational pricing
matrix is unnecessary for that service. A shortened name is accepted only when
at least two tokens identify one clear configured offering. One-token fuzzy
guesses are rejected.

## Playground reset semantics

- **Reset chat** clears conversational workflow state only. It preserves the
  active cart, CRM, orders, bookings and service history.
- **Fresh test** clears conversational state and only the active cart for the
  selected tenant/customer. It still preserves CRM and all submitted history.

This distinction prevents accidental history deletion while making isolated cart
tests convenient.

## Release gate

```bash
npm run benchmark:v8.9.3
```

The gate runs the exact fruit and property regressions, the full test suite,
conversation datasets, structural checks and the state-safety audit.
