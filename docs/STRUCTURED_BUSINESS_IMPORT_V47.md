# Nova v4.7 — Structured Business Data Import

## Why v4.6 could fail
The old Onboarding Studio had one file control under Knowledge. Uploading a complete business JSON there indexed the raw JSON as knowledge text. It did **not** create native Catalog products or Offering services unless the user also manually entered them in the visual Offerings rows.

That could produce two bad outcomes:
1. Product questions fell back to Assistant/Knowledge because the tenant had no native Catalog.
2. Retrieval could return the raw uploaded JSON verbatim.

## v4.7 Studio model

### Import Business Data
Use this for structured JSON or CSV that describes the business and its products/services.

A JSON may contain:
- id
- name
- domain
- description / summary
- hours
- location
- contact
- currency
- paymentMethods
- offerings
- products
- services
- faqs
- businessFacts

Offerings may contain:
- name
- type (`product` or `service`)
- category
- description
- price
- currency
- unit
- aliases/synonyms
- sizes
- colors
- tags
- inventory
- inStock
- bookable
- orderable
- durationMinutes

Nova parses the file and populates the Onboarding Studio form for review.

### Additional Knowledge
Use this separately for policies, notes, long descriptions, FAQs, TXT/Markdown documents, etc. These are retrieval knowledge and are **not automatically actionable products/services**.

If a JSON uploaded as Additional Knowledge contains `offerings`, `products`, or `services`, the Studio warns the user to use Import Business Data instead.

## Native tenant generation
Structured products generate:
- `catalog/products.json`
- `catalog/categories.json`
- `catalog/synonyms.json`

Structured services generate:
- `offerings/items.json`
- `booking/config.json` when bookable

Product aliases remain native Catalog aliases. Missing inventory no longer becomes zero; omitted inventory means no explicit stock-count limit is configured.

## Mixed product + service businesses
Catalog now wins when the message matches a native product, even if the same tenant also has services and Booking enabled.

Examples:
- `what products do you have` → Catalog
- `what products do you offer` → Catalog
- `do you have rice` → Catalog
- `can i get rice here` → Catalog
- `do you offer home delivery` → Offering/Booking as configured

## Rebuilding an existing test tenant
Enable **Replace existing tenant with the same ID** in the Studio.

This performs a clean directory rebuild so stale raw knowledge files from an earlier incorrect import cannot survive.
