# Nova v4.0 — Universal Engagement Architecture

## Why this exists
Nova must not implement a new conversation workflow for every industry. A retail product, salon service, doctor consultation, cleaning service, tutoring lesson, restaurant item, admission inquiry, or future unknown offering shares a common conversational lifecycle.

## Central contract

```
Tenant Knowledge / Offering Data
           ↓
Offering Resolution
           ↓
UNIVERSAL ENGAGEMENT ENGINE
  ├─ basket: one or many selections
  ├─ shared fields
  ├─ field validation
  ├─ pending field
  ├─ corrections / interruptions
  ├─ confirmation state
  └─ reusable summary
           ↓
Thin Fulfillment Adapter
  ├─ inventory order
  ├─ booking/request record
  ├─ service request
  └─ generic offering order
```

The central engine lives at:

`packages/universal-engagement-engine/src/universalEngagementEngine.js`

It owns reusable field semantics for:
- name
- phone
- date
- time
- grade
- party size
- quantity
- duration
- address
- city
- email
- generic custom fields

It also owns the generic multi-item engagement basket and missing-field progression.

## What remains adapter-specific
Adapters are allowed to enforce facts that really are different:
- Retail Catalog validates SKU variants and inventory.
- Commerce persists an inventory-backed order.
- Booking persists an appointment/reservation/inquiry request.
- Cleaning can expose cleaning-specific pricing data.
- Offering Order persists orderable non-SKU offerings.

They do not define independent conversational meaning for names, dates, phone numbers, multi-selection, or confirmation collection.

## Unseen-business proof
`tutor-demo` contains no tutoring capability.

It only provides:
- tenant profile
- offerings
- booking configuration
- business knowledge
- templates

The existing Offering + Booking adapters and Universal Engagement Engine can browse Math/English/Science tutoring and create a tutoring-session request without code changes.

This is the onboarding model for the upcoming Knowledge Layer: uploaded business material will populate these tenant structures instead of modifying Nova core code.

## v4 regression fixes
- Jeans are a family; `large size jeans` does not silently become Denim Jeans.
- `skinny jeans` remains a strict unsupported subtype unless explicitly configured.
- Checkout can extract `use my name Zeeshan`.
- Phone validation is shared and requires 10–15 digits.
- `track my order` routes to Commerce.
- Cleaning rejects past dates and requires contact number.
- Yearless dates resolve to the next future occurrence.
- Booking supports multiple services in one request and reuses shared date/time/name/phone fields.
- Adding Facial during a Haircut booking keeps the same booking and pending contact workflow.
- Config-only Tutoring proves a new service industry can work without adding a domain capability.
