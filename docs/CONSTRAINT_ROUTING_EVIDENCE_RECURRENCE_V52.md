# Nova v5.2 — Constraint-Aware Routing, Evidence Types & Recurring Workflows

## Why this release exists

Customers often mention words that look like service names but are actually constraints:

- same-day cleaning
- Sunday service
- weekend availability
- weekly cleaning
- twice-a-week cleaner
- monthly recurring service

v5.2 separates the **offering** from the **constraints** attached to it.

```text
message
  -> action / question
  -> offering or product
  -> service constraints
       - day / weekend
       - same-day
       - recurrence
       - policy conditions (pets, materials, parking, presence)
  -> deterministic capability
```

## Central service constraint extractor

`packages/conversation-intelligence/src/serviceConstraintExtractor.js`

It extracts reusable fields such as:

```json
{
  "day": "sunday",
  "weekend": true,
  "sameDay": false,
  "recurrence": {
    "frequency": "weekly",
    "occurrencesPerWeek": 2,
    "intervalWeeks": 1
  }
}
```

Availability and Cleaning consume this structure instead of interpreting `same day`, `Sunday`, or `weekly` as service names.

## Availability behavior

Examples:

- `do you provide same day cleaning service?` -> same-day policy + live availability caveat
- `can I get services on Sunday?` -> checks business hours; does not search for a service called “Sunday service”
- `are you open on weekend?` -> reports Saturday and Sunday separately
- `are you available Monday for cleaning?` -> reports business-hours support and requires live calendar/scheduling confirmation for the exact slot

## Customer-safe evidence types

Knowledge passages are now classified at ingestion time:

- `customer_fact`
- `customer_policy`
- `faq`
- `internal_instruction`

The index excludes internal-only passages from customer retrieval.

Sentences such as:

`The assistant should answer using configured payment methods.`

or

`Nova must not promise Sunday availability.`

are treated as system guidance, not customer-facing business facts.

Mixed policy sections are sanitized: valid customer facts remain searchable while assistant-only instructions are removed.

## Evidence completeness

Hybrid similarity does not automatically mean a passage answers the question.

Question-specific evidence gates require actual supporting content for concepts such as:

- workforce counts
- service areas
- payment methods
- pets
- customer presence
- parking
- materials
- balcony/window policies
- same-day policies

If approved knowledge does not contain the answer, Nova abstains.

## Unconfigured add-ons

If a requested item is not a structured bookable service but approved knowledge explains it, Nova can explain the policy without inventing a booking.

Example:

`Can I book window cleaning?`

If window cleaning is described as an add-on but not configured as a standalone offering, Nova explains that policy and refuses to fabricate a standalone booking until the tenant maps it to an offering/add-on.

## Recurring service state

Recurrence is now stored as operational booking state and survives into Cleaning request records.

Supported concepts include:

- daily
- weekly
- twice/three/four times per week
- every two weeks / biweekly
- monthly

Example:

```text
can i book cleaner twice a week
 -> service: Hourly Cleaner Hire
 -> recurrence.frequency: weekly
 -> recurrence.occurrencesPerWeek: 2
 -> ask hours per visit
 -> ask preferred recurring days
 -> ask time / address / customer details
```

A generic request such as `book recurring cleaning monthly` does **not** guess Standard Cleaning; it asks which service should repeat.

## Recurring pricing

Recurring frequency does not invent a special price.

`I want your services weekly, what are the charges?`

Nova explains that recurring price depends on the configured service and visit details. If Hourly Cleaner Hire is relevant, it can state the configured per-hour/per-cleaner rate, but it does not invent a weekly package.

## Discounts

Discount questions are now read from `pricing/services.json`, not free-form RAG. A generic discount question reports configured discount rules; a service-specific discount request continues through the quotation engine.

## Product-store boundary

v5.2 contains a cross-domain regression proving that the new service-constraint/RAG logic does not steal retail actions:

- `do you have shoes` -> Catalog
- `what is your returns policy` -> approved Knowledge/RAG

The same separation should be used when adding richer product-store knowledge next.
