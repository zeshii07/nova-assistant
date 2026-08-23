# Nova Generic Domain Framework — v3.0

## Principle
Nova core is not modified for each client or industry.

The runtime is split into:

1. Universal Conversation Intelligence — conversation acts, state, corrections, interruptions, semantic roles.
2. Domain Schema — reusable domain vocabulary/entities/actions (restaurant, salon, healthcare, education, etc.).
3. Tenant Knowledge — facts specific to one business.
4. Generic Offering Engine — products/services/menu items/treatments/programs/visits as one `offering` abstraction.
5. Generic Booking Engine — appointments/reservations/inquiries/visits as one slot-driven workflow.
6. Business-specific capabilities only when a domain truly needs special behavior.

## Tenant files
A tenant can define:

```
tenants/<tenant>/
  profile.json
  knowledge/business.json
  knowledge/faqs.json
  offerings/config.json
  offerings/items.json
  booking/config.json
```

`offerings/items.json` stores authoritative structured offerings. If it is absent, the offering repository can expose `knowledge/business.json.services` and `highlights` as informational, non-bookable offerings. This gives the future Knowledge Ingestion Layer a direct path to bootstrap a tenant before structured review/approval.

## Offering model
An offering can represent:
- retail product
- professional service
- salon treatment
- healthcare consultation
- restaurant menu item
- education program
- admission inquiry
- campus visit

Important fields include `id`, `name`, `aliases`, `type`, `category`, `description`, pricing fields, duration and `bookable`.

## Strict entity resolution
`EntityResolver` distinguishes:
- exact
- ambiguous
- fuzzy (confirmation required)
- suggestion (confirmation required)
- none

A fuzzy/nearest match is never silently asserted as an exact business entity. This prevents dangerous substitutions such as Pediatric Consultation -> General Consultation or an unknown salon service -> Haircut.

## Generic booking
Booking behavior is configured per tenant rather than coded per domain. Config defines:
- mode: appointment / reservation / inquiry / visit
- trigger terms
- default resource/subject when applicable
- required fields
- field prompts
- labels and confirmation wording

The engine collects only missing slots and stores booking requests through a common repository.

## Domain semantics
Reusable domain schemas live in `domains/<domain>/schema.json`. They provide domain-level entities/actions and semantic vocabulary. Individual client tenants do not need to modify the Nova engine.

## Current proof tenants
- Retail: existing Catalog + Commerce
- Cleaning: existing specialized capability (kept for regression while generic migration is evaluated)
- Restaurant: Generic Offering + Booking
- Salon: Generic Offering + Booking
- Healthcare: Generic Offering + Booking
- Education: Generic Offering + Booking

The framework intentionally allows specialized capabilities to coexist with generic engines when a domain later requires advanced business rules.
