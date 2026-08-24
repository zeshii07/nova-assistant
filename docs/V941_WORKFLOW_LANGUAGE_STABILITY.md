# Nova v9.4.1-alpha.1 — Workflow Language Stability

## Outcome

This release repairs the boundary between natural-language understanding and
deterministic workflow execution. Nova no longer requires an exact phrase for
common pending values, and a valid short answer cannot be stolen by Catalog,
Availability, or remote NLU.

## Understanding changes

- Explicit AM/PM clocks such as `10 AM` are extracted without requiring `at` or
  a weekday prefix.
- Weekday spelling variants are normalized only against the closed weekday set.
- Cleaning-type spelling variants are normalized only against the closed
  Standard/Deep workflow choice.
- A pending cleaner count accepts a scalar count, while a clock such as
  `Friday 10 AM` remains a schedule value and is never interpreted as ten
  cleaners.
- A pending duration accepts a scalar answer such as `4` and keeps Catalog from
  listing services.
- A combined answer such as `4 cleaners for 5 hours` fills both fields.
- A contextual action after an Availability answer retains the last discussed
  tenant service, including Move-in / Move-out Cleaning.

These corrections are structural and tenant-independent. Product names,
service names, customer identities, and tenant knowledge are not subjected to
unbounded fuzzy matching.

## Validated field amendments

The shared field-amendment extractor recognizes explicit replacements and
returns only a proposed field and raw value. It cannot write data. The owning
deterministic capability validates and persists the value:

| Owner | Supported amendments |
|---|---|
| Cleaning | name, phone, optional email, service address |
| Commerce | name, phone, optional email, city, address, landmark, payment method |
| Generic Booking | name, phone, optional email |
| CRM | name, phone, optional email, primary address |

Cleaning requests and retail orders can be amended after submission when their
authoritative record is still modifiable. Revisions and timelines remain
durable. Invalid values do not overwrite an existing value.

## LLM policy

In adaptive mode, clear validated pending values remain local even if the local
statistical router abstains. Groq is still interpretation-only and is reserved
for unresolved, conflicting, or genuinely complex language. Nova remains fully
usable with `NOVA_NLU_MODE=off`.

## Verification

```powershell
npm run benchmark:v9.4.1
```

The focused suite covers the supplied time loop, bare-number duration loop,
combined cleaner/hour extraction, weekday and cleaning-type typos, contextual
service carryover, adaptive Groq routing, and validated field amendments across
Cleaning, Commerce, Booking, and CRM.
