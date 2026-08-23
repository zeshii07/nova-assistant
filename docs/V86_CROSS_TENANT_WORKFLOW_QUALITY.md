# NOVA v8.6 — Cross-Tenant Workflow Quality

## Decision

NOVA does not need a second statistical language engine. The failures in the supplied playground transcript came from deterministic workflow gaps, not from an absence of machine learning. v8.6 strengthens the current architecture:

1. universal conversation intelligence extracts domain-neutral clauses, dates, time windows, confirmation, and workflow operations;
2. the active tenant’s adapter maps that structure to configured products, offerings, booking fields, and policies;
3. tenant-scoped repositories remain the only source of operational truth;
4. optional structured AI fallback remains suitable only for low-confidence interpretation after deterministic validation.

This keeps booking, pricing, availability, inventory, CRM, and order creation auditable and tenant-isolated.

## Root causes and corrections

| Tenant example | Root cause | v8.6 correction |
|---|---|---|
| Cleaning `confim` | Confirmation handling was exact-string only inside the cleaning workflow | Bounded common confirmation typos are normalized without broad fuzzy acceptance |
| Salon multi-service request | Booking resolved one offering and discarded the others | Every explicitly mentioned configured offering is preserved in one booking basket |
| Salon `Friday, 21 August` | Weekday parsing ran before the explicit date | Explicit dates outrank weekdays; yearless dates remain future-oriented |
| Salon price and duration | Booking summaries did not aggregate configured offering facts | Estimates sum tenant prices and durations; variable `From` pricing remains qualified |
| Salon time window | `between 2 PM and 5 PM` had no shared range structure | Universal temporal extraction supports both `from–to` and `between–and` ranges |
| Salon reschedule with fallback | Completed bookings had view-only behavior | A proposed change is recorded, while the original booking stays unchanged until an authoritative slot is confirmed |
| Retail same-product variants | Multi-product parsing could not inherit one product across variant clauses | One black Medium and one white Large become separate quantity-one lines |
| Retail shoe size 42 | A generic digit parser treated size as quantity | Product-aware extraction excludes configured numeric sizes from quantity inference |
| Retail checkout edit | Quantity commands lost to the pending customer-name field | Cart operations outrank pending checkout fields and resume the same checkout step |
| Retail final confirmation | Bad cart state threw an inventory exception | Transactional cart preflight returns an actionable repair response and preserves state |
| Restaurant table request | Offering vocabulary outranked reservation meaning | Configured booking terms own reservation requests before menu resolution |
| Restaurant menu-first condition | A future conditional reservation executed before the requested menu browse | Conditional clauses are secondary; filtered menu results are returned first |
| Restaurant `add chicken` | A partial term silently risked choosing one of two dishes | Ambiguous configured matches are listed for explicit customer choice |

## Tenant isolation contract

Each tenant is standalone. The engine scopes conversation state, CRM, knowledge, catalog/offering data, carts, bookings, and orders by tenant and customer. Shared code contains only reusable language/workflow rules. Business vocabulary and truth remain in tenant configuration.

- Cleaning examples test `cleaning-demo` only.
- Salon examples resolve only `salon-demo` offerings and booking configuration.
- Retail examples resolve only the `default` catalog and checkout configuration.
- Restaurant examples resolve only `restaurant-demo` menu and reservation configuration.
- No tenant can read or answer from another tenant’s products, knowledge, CRM records, bookings, or transaction state.

## Commerce safety rules

- Numeric configured sizes are never inferred as quantities.
- Complete multi-item updates are transactional: if a required variant is missing, no partial cart mutation occurs.
- Apparel and footwear variants require complete selections before checkout/order creation.
- Generic color-only product requests may retain the existing optional-color behavior unless the customer began a variant-specific selection.
- Catalog price, inventory, available colors, and sizes are always revalidated before order creation.
- Recoverable cart problems never become a generic capability exception.

## Booking safety rules

- Multiple services share one date, time, customer, and phone workflow.
- Price and duration are computed only from configured offering records.
- Live availability is never promised without an authoritative provider.
- A reschedule request against a completed booking is a proposal; it does not overwrite the original record.
- Conditional future actions do not mutate booking state before their condition is satisfied.

## Acceptance coverage

The v8.6 suite adds nine transcript-derived scenarios:

1. typo-safe cleaning confirmation;
2. salon multi-service/date/window/price/duration extraction;
3. non-destructive salon rescheduling;
4. two variants of one retail product;
5. mixed retail items with missing-variant clarification;
6. checkout quantity edit plus wrapped-name normalization;
7. safe final order confirmation;
8. restaurant reservation routing and availability abstention;
9. menu-first conditional browsing plus ambiguous dish clarification.

Run the complete isolated release gate:

```bash
npm run benchmark:v8.6
```

## Roadmap continuation

The recommended next work remains aligned with the existing roadmap:

1. add tenant-specific compound-message datasets for every onboarded business type;
2. connect authoritative calendars and resource-capacity providers;
3. implement confirmed booking updates once availability providers are present;
4. add structured low-confidence AI interpretation behind schemas, redaction, cost limits, and deterministic validation;
5. expose per-tenant routing, abstention, repair, and isolation metrics in operations.
