# Nova v8.9.2 — Durable transaction amendments

v8.9.2 introduces a shared rule for every transactional tenant: going idle after
confirmation must not erase the customer's transaction. The durable repository,
not the last assistant reply, owns the order, booking or service-request record.

## Cross-tenant contract

Every transactional capability follows this lifecycle:

`create -> persist -> view history -> amend or cancel -> retain audit timeline`

All lookups use the authenticated tenant plus customer identity. A matching ID
from another tenant or customer is treated as not found. Changes preserve the
original record ID and increment `revision`; repository timelines record the
action, timestamp and changed fields or items.

| Transaction | During collection | After submission/confirmation |
|---|---|---|
| Cleaning request | Change service, schedule, scope and customer fields | Change schedule, service or requirements on the same request ID; recheck price/availability |
| Retail cart | Add, remove or update items while checkout stays active | Not applicable until converted to an order |
| Retail order | Not applicable | Add/remove validated products on the same order ID; preserve history |
| Generic booking/reservation | Change collected fields and offerings | Persist a pending schedule/service amendment; keep the original slot until live approval |

Completed, cancelled or otherwise terminal records are not silently reopened.

## Cleaning corrections

- `two cleaners for three hours` is authoritative hourly-work evidence even when
  `apartment` is also present. It produces `2 x 3 x configured hourly rate` and
  does not ask for bedrooms merely to select a different pricing model.
- `before confirming anything` has the same read-only boundary as `before
  booking anything`: Nova returns the configured price and business-hours/live
  availability boundary without collecting address, name or phone.
- After submission, explicit changes load the customer's latest modifiable
  request (or the stored request pointer), update it in place, retain address and
  identity, and state that live team availability needs another check.

## Commerce corrections

- Removal routing runs before product discovery. `remove polo shirt and comfort
  slides` therefore changes the active cart or stored order rather than starting
  new product selections.
- An active cart always wins over a confirmed-order interpretation. Post-order
  amendments require a stored order reference and an idle commerce workflow.
- Product-specific local spans bind compact replies such as `hoodie black shirt
  white backpack black bottle blue` to the correct draft lines.
- Missing variants never partially mutate the cart. Nova shows the official
  provisional subtotal, preserves the complete draft, and asks for the remaining
  color/size values.

## Availability boundary

v8.9.2 does not claim live staff, provider or table availability. Generic booking
changes are stored as `pending_availability` proposals, leaving the original slot
unchanged. Cleaning amendments are saved to the service request but explicitly
require availability and, where scope/service changes, pricing revalidation.

## Qwen boundary

Qwen remains optional and cannot write or amend a transaction. Deterministic
routes own explicit create, view, add, remove, replace, reschedule and history
commands. With `NOVA_NLU_MODE=on`, Qwen is eligible only when Nova cannot safely
resolve the user's intended transaction or field; every returned structure is
validated before the deterministic engine decides what to do.

## Release gate

```bash
npm run benchmark:v8.9.2
```

The gate runs the v8.9.2 transaction-amendment regressions, the complete test
suite, conversation datasets, syntax/structure checks and the state-safety audit.
