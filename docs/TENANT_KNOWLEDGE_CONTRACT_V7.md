# Nova v7 Tenant Knowledge Contract

Nova separates **engine behavior** from **tenant business truth**.

## 1. Engine rules
Engine rules live in Nova code/configuration and are shared across tenants. Examples:
- never invent an unavailable product
- validate phone numbers
- preserve checkout while answering a side question
- never treat a knowledge question as a date
- do not let RAG mutate orders or bookings

Business owners should not need to edit these rules.

## 2. Structured tenant truth
Frequently used operational facts should be stored as structured tenant data:
- business identity and hours
- contact/location
- products, variants, stock and aliases
- services and prices
- payment methods
- providers/staff profiles
- availability configuration
- return/cancellation rules when represented structurally

In memory/file mode these live under `tenants/<tenant-id>/`. In persistent mode they move behind the tenant repository/PostgreSQL without changing the engines.

## 3. Knowledge documents
Markdown/TXT/PDF/JSON knowledge is for business-owned information that may be detailed or frequently updated:
- terms and conditions
- return/refund/exchange policies
- service coverage areas
- FAQs
- parking/pet/material policies
- warranty information
- delivery rules
- admission requirements
- doctor/provider biographies
- product care guides
- custom quotation rules

A business can upload a replacement or additional document through Knowledge Manager. Nova ingests it, chunks it, indexes it through BM25 + graph/vector retrieval, applies RRF/evidence gating, and answers from approved evidence.

## 4. Internal instructions
Instructions such as `the assistant must...` or `never invent...` are not customer facts. They belong in engine policy/configuration and should be marked/internalized as `internal_instruction` evidence if imported. They must never be rendered as business answers.

## 5. Updating a business later
Examples:
- Change return policy: update structured `returns` or upload a new Returns Policy document.
- Add a payment method: update tenant payment methods.
- Add a new service: add an Offering/Service record, including price/bookability/aliases.
- Add a new doctor: create a provider profile and attach services/schedule.
- Change coverage areas: update the Service Areas knowledge source.

The tenant changes its data; Nova's core code stays unchanged.
