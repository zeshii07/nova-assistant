# Nova v8.9.5 — Validated contacts, business hours, and tenant-aware replies

This release closes the customer-detail and scheduling gaps that allowed a
sentence, invalid date, or out-of-hours time to enter transactional state.

## Central validation contract

`UniversalEngagementEngine` is the single validator for fields collected by
Cleaning, generic Booking, Commerce, CRM, the universal message frame, and the
central customer-data bridge.

- Name declarations remove wrappers: `my name is Zeeshan` becomes `Zeeshan`.
- Questions, commands and sentence-like values are not accepted as names.
- Phone numbers contain 10–15 digits and may use a small set of natural wrappers.
- Email uses strict address validation and is always optional.
- Full addresses need location evidence such as a house, apartment, building,
  street, area, or nearby location; a city alone is not a full address.
- Calendar dates must exist and must not be in the past unless a tenant explicitly
  allows historical dates.
- Clock values must use valid 12-hour or 24-hour syntax.

The Execution Engine and customer-data bridge revalidate shared fields before
CRM persistence, so a future capability cannot bypass this contract by placing
an unchecked scalar in its state.

## Tenant business-hours enforcement

The scoped Availability service now exposes `validateTime(day, time, options)`.
Cleaning and generic Booking call it before advancing the workflow. It checks:

- whether the tenant is open that day;
- whether the requested start is within the configured range;
- an explicit end time; and
- an explicitly supplied duration that would finish after closing.

The valid date is retained when only the time is wrong. The assistant explains
the tenant's configured hours and asks for another time instead of discarding
the entire request. `Daily` business-hours declarations are also supported.

## Optional email

Email does not appear in any required-fields list. Customers may provide it
alongside their name/phone or as a separate message during Cleaning, generic
Booking, or Commerce checkout. The workflow resumes its original required
field after saving the optional email. Cleaning request summaries and Commerce
checkout reviews show the value when present.

## Tenant-aware conversation behavior

- “I want my sofa to be cleaned” starts Sofa Cleaning even when prefixed by a
  greeting.
- “Do you offer sofa and mattress cleaning?” reports both configured services.
- A cleaning request sent to a retail tenant receives a friendly explanation
  that the tenant sells products and handles orders.
- A shopping request sent to a cleaning tenant receives the corresponding
  cleaning-business explanation.
- An unmatched message keeps the current workflow safe and asks for a more
  specific tenant-relevant product, service, booking, order, or information need.

No response can borrow services, products, customer records, or knowledge from
another tenant.

## Release gate

```bash
npm run benchmark:v8.9.5
```

The gate runs the focused v8.9.5 regression suite, all Node tests, the complete
conversation corpus, structural checks, and the state-safety audit.
