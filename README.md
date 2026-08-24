# Nova SaaS — Universal Multi-Tenant Engagement Engine

Nova is a multi-tenant conversational AI platform. v3.0 adds a reusable Generic Offering Engine, Generic Booking Engine, strict entity resolution, reusable domain semantics, and a knowledge-to-offering fallback so new industries can be onboarded without changing the core engine.

## Current release: v9.4.1 Workflow Language Stability

Nova v9.4.1-alpha.1 makes pending workflow fields authoritative and adds a
shared, validated field-amendment contract. Short replies such as `10 AM`, `4`,
or `4 cleaners for 5 hours` are consumed by the active Cleaning field instead
of falling into Catalog or remote NLU. Bounded structural typo handling accepts
weekday and workflow-choice variants such as `tuseday` and `stndrad` without
fuzzy-matching customer names or cross-tenant business data.

Generic apartment and villa requests always ask **Standard Cleaning** versus
**Deep Cleaning** unless the customer has already supplied decisive pricing
model details. Availability follow-ups retain the previously discussed service,
so a Move-in Cleaning conversation does not silently become Standard Cleaning.

Explicit changes to name, phone, optional email, address, city, landmark, and
payment method are extracted as field amendments. Cleaning drafts/submitted
requests, retail checkouts/orders, generic bookings, and standalone CRM updates
validate the new value before writing. A rejected value leaves the previous
value and transaction intact.

Run the release gate:

```powershell
npm run benchmark:v9.4.1
```

See `docs/V941_WORKFLOW_LANGUAGE_STABILITY.md`.

## Previous release: v9.4.0 Lightweight Local Semantic Router

Nova v9.4.0-alpha.1 adds a dependency-free probabilistic language router in
front of adaptive Groq escalation. It learns domain-independent conversational
meaning from multilingual seed examples using word/bigram, prefix, and character
n-gram features. Current-tenant service and product vocabulary is added at
inference time and remains isolated from every other tenant.

The router is evidence, not execution authority. Deterministic extraction still
owns dates, times, people, quantities, variants, and customer fields; capability
engines still own validation, pricing, availability, calendar holds, CRM, carts,
orders, bookings, and every write. A confident aligned local result avoids a
remote call. Uncertain, conflicting, unresolved-reference, or genuinely complex
language may be sent to Groq for strict JSON interpretation. If Groq is disabled
or unavailable, Nova safely continues with its deterministic core or asks for
clarification.

Cleaning property requests now have an explicit pricing boundary. “Villa
cleaning” or “apartment cleaning” asks the customer to choose **Standard
Cleaning** or **Deep Cleaning**. Standard Cleaning collects cleaner count and
hours; Deep Cleaning collects property type and bedroom count. Supplied dates,
times, and scope survive the clarification.

Recommended `.env` settings:

```dotenv
NOVA_SEMANTIC_ROUTER_MODE=on
NOVA_NLU_MODE=on
NOVA_NLU_STRATEGY=adaptive
GROQ_API_KEY=your_key_here
```

Use `NOVA_NLU_MODE=off` to run the same architecture without Groq. Trace the
local router and run the full release gate:

```powershell
npm run model:semantic:trace -- "thora kal wali booking adjust kar do"
npm run model:groq:trace -- "thora kal wali booking adjust kar do"
npm run benchmark:v9.4.0
```

See `docs/V940_LOCAL_SEMANTIC_ROUTER.md`.

## Previous release: v9.3.0 AI Language Contract

Nova v9.3.0-alpha.1 adds a provider-independent AI Language Layer between the
Conversation Manager and deterministic capability routing. A configured model
detects language, intent, multiple intents, entities, corrections, workflow
relationship, ambiguity, missing linguistic information, alternative dates and
times, and multiple service/product items. Its schema-constrained output is
normalized into `LanguageContract` v2.0.

The contract cannot call tools or execute anything. It carries
`authority.mayExecute=false`; Nova validates current-tenant service/product IDs,
layers deterministic extraction over AI hints, and sends only safe drafts or
read-only requests to Booking, Cleaning, Commerce, Catalog, Pricing,
Availability, CRM, and other deterministic capabilities. Provider failure,
timeout, rejected JSON, or `NOVA_NLU_MODE=off` falls back to the local engine.

Choose one language strategy in `.env`:

```dotenv
GROQ_API_KEY=your_key_here
NOVA_NLU_MODE=on

# AI only when local understanding is uncertain (fastest and cheapest)
NOVA_NLU_STRATEGY=adaptive

# AI interprets every message before deterministic routing
# NOVA_NLU_STRATEGY=primary
```

Run and inspect it:

```powershell
npm run model:groq:check
npm run model:language:trace -- "kal 4 baje, warna 5 baje 2 cleaners chahiye"
npm run benchmark:v9.3.0
npm start
```

See `docs/V930_AI_LANGUAGE_LAYER.md` and
`examples/ai-language-contract-v2.json`.

## Previous release: v9.2.1 Unified Catalog and Pricing Sources

Nova v9.2.1-alpha.1 removes the conflicting pricing editor from Knowledge
Manager. Retail tenants now manage product base prices and variant overrides
only in **Control Plane → Products & prices**. Service tenants manage service
metadata and every flat, hourly, unit, linear, matrix, starting-from, or custom
quote rule only in **Control Plane → Services & pricing**.

Service rows reference pricing rules in the same published resource; they no
longer repeat display prices, currencies, pricing types, package prices, or
numeric price claims in descriptions. Runtime repositories derive their legacy
compatibility fields from the selected rule, so quotes, discovery, booking, and
availability all see the same value. Old split tenant files and durable pricing
overlays are migration inputs only until the first unified Services revision is
published. After that, conflicting legacy values are ignored. The former
Knowledge Manager pricing endpoint returns HTTP 410 with migration guidance.

Run the v9.2.1 release gate with:

```powershell
npm run benchmark:v9.2.1
```

See `docs/V921_UNIFIED_CATALOG_PRICING.md` and
`examples/control-plane-unified-services.json`.

## Previous release: v9.2.0 Calendar Adapter and Live Capacity Reservations

Nova v9.2.0-alpha.1 adds a tenant-scoped scheduling boundary to the deterministic
core. A booking is no longer called confirmed merely because the business is
open: Nova checks configured resource capacity, places an expiring slot hold,
and converts that hold into a durable calendar event only after the customer
confirms. Concurrent customers cannot take the same final capacity unit.

Generic appointments/reservations and cleaning visits now share the same
calendar contract. Confirmed generic bookings can be rescheduled or cancelled;
unavailable moves preserve the original event and return deterministic
alternatives. Cleaning confirmation atomically creates one visit event for one
or several requested cleaning services. Confirmed cleaning visits can also be
rescheduled or cancelled without separating their linked service records. Exact
date/time availability questions use live capacity rather than an hours-only
answer. All records remain tenant/customer
scoped and store normalized UTC timestamps plus the tenant's local date, time,
and IANA timezone.

The Control Plane adds a **Calendar & capacity** resource and a live-calendar
panel. Owners/admins can publish provider settings, timezone, duration, slot
interval, hold TTL, lead/advance limits, capacity pools, and per-service rules;
they can also create blocked periods for testing. Operations managers may draft
and validate services, hours, and calendar configuration, but only owners/admins
publish operational changes. Secrets are rejected from tenant JSON.

Run the v9.2 release gate with:

```powershell
npm run benchmark:v9.2.0
```

See `docs/V920_CALENDAR_ADAPTER.md` and
`examples/control-plane-calendar.json`.

## Previous release: v9.1.0 Variant Inventory and Checkout Reservations

Nova v9.1.0-alpha.1 adds real product variants/SKUs to the tenant Control Plane.
Every variant can own its stock and optional price override. Checkout places an
expiring tenant-scoped stock hold, confirmation consumes it, cart cancellation
releases it, and supported order removal/exchange operations update the inventory
ledger. Two customers in one Nova process cannot reserve the same last SKU unit.

The Developer Console Control Plane now displays on-hand, reserved and available
stock and lets owners/admins record exact stock corrections. Variant definitions
still use the existing draft → validate → preview → publish lifecycle, with
unique-SKU and attribute validation before customer runtime caches are updated.

Run the v9.1 release gate with:

```powershell
npm run benchmark:v9.1.0
```

See `docs/V910_VARIANT_INVENTORY_RESERVATIONS.md` and
`examples/control-plane-product-variants.json`.

## Earlier release: v9.0.0 Tenant Business Control Plane Foundation

Nova v9.0.0-alpha.1 adds the first post-onboarding business administration
layer. Tenant owners can edit business profiles, products, services, and hours
through a controlled `draft → validate → preview → publish` lifecycle. Drafts
are invisible to customer conversations; publishing creates an immutable,
actor-attributed revision, invalidates the affected tenant cache, and supports
rollback by creating another revision rather than rewriting history.

The Developer Console now includes **Control Plane**. It shows the shipped or
published resource, validation errors, a deterministic diff preview, revision
history, and tenant-scoped audit history. Roles are enforced for owner, admin,
catalog manager, support agent, and viewer contexts. When `NOVA_DEV_TOKEN` is
configured, control-plane requests must also carry an authenticated
`x-nova-tenant-id` matching the URL tenant; mismatches fail closed.

Published resources feed the same deterministic runtime repositories used by
chat: tenant identity/contact, product catalog, cleaning/generic service catalog,
and business hours. Groq remains optional language interpretation only and has
no draft or publication authority.

Run the v9 release gate with:

```powershell
npm run benchmark:v9.0.0
```

See `docs/V900_CONTROL_PLANE_FOUNDATION.md` for API examples and resource formats.

## Previous release: v8.9.13 Stress Stability

Nova now keeps clear customer messages on the fast deterministic path and uses
Groq only to interpret uncertain, conflicting, multilingual-workflow, or complex
language. Groq returns strict intent/entity JSON and has no tools or execution
authority. Tenant-scoped Nova engines still validate and perform every booking,
cart, order, CRM, pricing, availability, policy, and confirmation operation.

v8.9.10 also made the deterministic workflow consume those interpretations:
Roman-Urdu times and flexible preferences such as `jis time team available ho`
are preserved, whole-property deep cleaning is distinguished from bathroom deep
cleaning, and retail return/exchange requests operate on tenant- and customer-
scoped order history instead of falling into catalog browsing. SparkleCare now
uses AED 40 per hour per cleaner for standard cleaning and scope tables for deep,
furniture, mattress, curtain, and carpet cleaning.

v8.9.11 separates information from transactions: asking a price never starts a
booking, while explicit `book`, `schedule`, or equivalent language does. Cleaning
price follow-ups preserve the referenced service and apply the configured deep-
cleaning and furniture-size tables. Retail requests can contain multiple sizes of
the same product, and customers can split or change a cart variant even while
checkout is waiting for delivery details. Social replies rotate tenant-approved
wording while business facts and actions remain deterministic.

v8.9.12 makes compound cleaning quotations compositional. When a customer asks
for villa cleaning and sofa cleaning together, Nova prices every explicit
service instead of keeping only the highest-scoring match. If `villa cleaning`
does not say standard or deep, Nova asks that one business clarification while
still showing the sofa price. Standard cleaning then asks for cleaners and
hours; deep cleaning uses the configured property-size table. Exact quote state
is retained so `book this quotation` starts the correct service and scope, even
when the price question interrupted another request. Internal workflow notes
remain in replay metadata instead of being spoken to the customer.

v8.9.13 hardens those workflows against real multi-turn stress conversations.
Retail now preserves per-line variants for several products or several sizes of
one product, lets cart/order commands interrupt checkout safely, accepts natural
final confirmations, and keeps order-history interruptions resumable. Cleaning
now distinguishes post-renovation, deep-home, deep-apartment, deep-villa,
standard-hourly and furniture pricing subjects; exact price questions remain
informational, while explicit booking language carries the quoted scope into the
request. Uploaded tenant knowledge can refine packaged facts according to source
priority, and cancellation questions cannot accidentally quote an arrival-window
paragraph.

The test runtime is isolated from developer `.env` provider settings and uses a
unique data directory per process. A local Groq key or shared `.nova-data` path
therefore cannot cause provider quota errors or concurrent Windows rename errors
during `npm test`.

Local Qwen model downloads and `llama-server` are retired from the active
runtime. Set `GROQ_API_KEY` and `NOVA_NLU_MODE=on` in `.env`, then run:

```powershell
npm run model:groq:check
npm run model:groq:trace -- "thora adjust kar do na, kal wali request ko"
npm start
```

Use `NOVA_NLU_MODE=off` for deterministic-only operation with no Groq NLU calls.
See `docs/V8913_STRESS_STABILITY.md` and run `npm run benchmark:v8.9.13`.

## v3.0 proof domains

- Retail — Catalog + Commerce
- Cleaning — specialized capability retained for regression
- Restaurant — generic menu offerings + table reservation
- Salon — generic services + appointments
- Healthcare — generic consultations + appointments
- Education — generic programs + admission inquiries

The permanent rule is: **core conversation intelligence is universal; domain schemas teach industry meaning; tenant knowledge supplies business truth; generic capabilities execute reusable workflows.**

## Quick start

```powershell
npm run check
npm test
npm run test:conversations
npm start
```

Open the Developer Playground at `http://localhost:3000/developer`.

See `docs/GENERIC_DOMAIN_FRAMEWORK.md` and `docs/GENERIC_DOMAIN_V3_ACCEPTANCE.md`.

---

# Nova SaaS — Transactional Validation v2.9

This build extends the v2.8 State & Slot Consistency milestone with transactional validation for invalid catalog inputs.

Key guarantees: invalid quantities never partially mutate the draft/cart, inventory-limit replies expose the actual availability, Social Intelligence acknowledges only accepted inputs, and cart inspection distinguishes an unfinished draft from a committed cart item.

# Nova SaaS — Universal Semantic Layer Milestone

Version **2.5.0-alpha.1**

This build adds the Universal Semantic Layer and reusable Domain Schemas on top of Conversation Intelligence, Goal/Social Intelligence, Replay and the Developer Playground. Retail is no longer the definition of the core engine; tenant domains map universal conversation semantics into domain capabilities.

## Start

```powershell
Copy-Item .env.example .env
npm run check
npm test
npm start
```

Open the Developer Playground:

```text
http://localhost:3000/developer
```

Run the 133-case conversation compliance corpus:

```powershell
npm run test:conversations
```

## Key architecture

```text
Channel
  ↓
Conversation Intelligence
  ↓
Capability Router
  ↓
Business Capability
  ↓
Humanization
  ↓
Channel Renderer
```

Conversation Intelligence handles conversational meaning and workflow state. Capabilities remain authoritative for business truth. Humanization controls communication style.

## New debugging tools

Every message records a replay containing state before/after, vocabulary matches, candidate intents, entities, selected capability, response model, humanization metadata and timing.

See:

- `docs/CONVERSATION_INTELLIGENCE_ARCHITECTURE.md`
- `docs/DEVELOPER_PLAYGROUND.md`
- `docs/CONVERSATION_DATASETS.md`

## Public Developer Console

When hosting publicly, set `NOVA_DEV_TOKEN` and enter it in the Playground. In production, Nova now fails closed when this token is missing, so `/api/dev/*` remains unavailable instead of exposing customer replay/debug and Control Plane endpoints.

## Development persistence warning

`NOVA_STORAGE_MODE=memory` is file-backed local storage under `.nova-data`; it survives local process restarts but not an ephemeral hosting filesystem. Production business data should use a persistent mounted volume or PostgreSQL + Redis with `NOVA_STORAGE_MODE=persistent`.

## Goal Engine (v2.3)
Conversation Intelligence now includes persistent goal continuity. Category browsing, candidate selection, product-detail collection and Commerce checkout can span multiple messages without requiring the customer to repeat context. The Developer Playground shows the current Goal and replays include goal transitions. See `docs/GOAL_ENGINE.md`.

## v2.4 Social Intelligence quality release

This release adds a deterministic Social Intelligence layer and fixes conversation-quality issues discovered in real WhatsApp/Playground testing.

Highlights:
- mixed greeting + business requests keep the business task;
- natural small talk such as `how do you do today`;
- friendly unsupported-product and unsupported-service responses;
- `other shoes` reopens the footwear category instead of repeating one product;
- natural acknowledgements on catalog attribute updates;
- tenant capability boundaries prevent retail from pretending to offer cleaning;
- Developer Playground exposes Social Intelligence signals.

See `docs/SOCIAL_INTELLIGENCE.md` and `docs/SOCIAL_INTELLIGENCE_ACCEPTANCE.md`.


## v2.5 architecture

```text
Channel → Universal Semantics → Domain Schema → Conversation Intelligence → Goal/Workflow → Capability → Humanization → Channel
                                      ↘ low confidence → LLM Interpreter → validated capability intent
```

See `docs/UNIVERSAL_SEMANTIC_LAYER.md` and `docs/V2_5_ACCEPTANCE.md`.

## v2.10 family-filtered browsing
Generic product-family requests with attributes (for example `black shoes`) now return all matching family options instead of silently selecting the first fuzzy product. The Developer Playground also contains Healthcare and Education semantic demo tenants.


## v2.11 quality release

This build adds new-subject precedence, reliable `clear/reset`, English/Roman-Urdu quantity disambiguation, and Restaurant/Salon semantic Playground demos. See `docs/SUBJECT_SWITCHING_V2_11.md`.


## v3.1 Universal Orchestration

Universal pending-slot interruption safety, strict entity resolution, tenant-isolated greetings, and generic offering/booking behavior across configured business domains. See `docs/UNIVERSAL_ORCHESTRATION_V31.md`.


## v4.0 Universal Engagement

Nova now centralizes multi-offering selection, shared field collection, validation, and confirmation in `packages/universal-engagement-engine`. See `docs/UNIVERSAL_ENGAGEMENT_V4.md`.


## v4.1 Identity, Review & Knowledge Hardening

Tenant-aware assistant introductions, bounded customer-name extraction, cross-cutting profile capture, checkout review-before-create, booking summary/view semantics, and business-policy knowledge routing. See `docs/CUSTOMER_DATA_PERSISTENCE.md` for the current in-memory vs future durable database model.


## v4.4 Knowledge Layer

Nova now has tenant-scoped knowledge indexing and retrieval. Business facts remain separate from universal conversation/action logic. Add approved JSON/TXT/Markdown/CSV knowledge under `tenants/<tenant>/knowledge/`; see `docs/KNOWLEDGE_LAYER_V44.md`.

Unknown informational questions can be answered from retrieved tenant-approved excerpts. When an LLM provider is available it may phrase an answer from those excerpts only; without an LLM Nova uses an extractive fallback. Transactional capabilities remain authoritative for booking, commerce, CRM, catalog and service requests.


## v4.5 Knowledge Ingestion & Universal Tenant Onboarding
Create unseen businesses from a tenant specification with `node scripts/onboard-tenant.js <spec.json>`. Ingest approved JSON/TXT/Markdown/CSV knowledge with `node scripts/ingest-knowledge.js <tenant-id> <file>`. See `docs/UNIVERSAL_TENANT_ONBOARDING_V45.md`.


## v4.6 Developer Onboarding Studio

Open `/developer`, select **Onboarding Studio**, enter business identity and offerings, paste or load supported knowledge, generate the tenant, then open it directly in the Conversation Playground. The Studio is a UI over the same UniversalTenantOnboardingService and Knowledge Ingestion services used by the CLI; it is designed to evolve into the customer-facing SaaS onboarding architecture. See `docs/ONBOARDING_STUDIO_V46.md`.


## v4.7 Structured Business Import

Onboarding Studio now separates structured Business Data Import from Additional Knowledge. JSON/CSV business files can populate identity, products/services, FAQs and native tenant configuration automatically. See `docs/STRUCTURED_BUSINESS_IMPORT_V47.md`.


## v4.8 Workflow Ownership

Central transaction ownership prevents Catalog drafts from stealing Commerce/Booking/Cleaning confirmation and continuation. Quantity extraction, multi-item add flows, side-question resume, and hourly-cleaner booking state are hardened. See `docs/WORKFLOW_OWNERSHIP_V48.md`.


## v4.9 Input Validation & Multi-Product Hardening

Central customer-detail semantic validation, multi-product sentence extraction, safer product switching, payment-policy routing, and generic cleaning quote handling. See `docs/INPUT_VALIDATION_AND_MULTICART_V49.md`.


## v4.10 Universal Service Pricing & Human Handoff

Tenant-configured hourly/unit/matrix/flat quotations, configured discounts, and a real context-preserving human handoff queue. See `docs/UNIVERSAL_SERVICE_PRICING_AND_HANDOFF_V410.md`.


## v4.11 Service Availability & Multi-Item Cart UX

Multi-product requests now return authoritative cart summaries, and service businesses gain a universal availability layer that separates business hours, service support, and live slot availability. See `docs/SERVICE_AVAILABILITY_AND_CART_UX_V411.md`.


## v4.12 Multi-Item Segmentation & Quote-to-Booking

Multi-item product requests are segmented safely, ambiguous product families are clarified, and service quotations can now transition directly into booking/request workflows while preserving the quote. See `docs/SERVICE_QUOTE_TO_BOOKING_V412.md`.


## v4.13 State Safety & Social Intelligence

Cart-first Commerce checkout removes Catalog-state assumptions, natural confirmations are centralized, runtime layers fail safely, and social/human wording has been expanded. See `docs/STATE_SAFETY_AND_SOCIAL_INTELLIGENCE_V413.md`.


## v4.15 Review Field Editing

Checkout review edits are isolated: Nova asks only for the requested field, preserves all other collected details, and returns directly to review. Roman-Urdu name declarations are also normalized correctly. See `docs/REVIEW_FIELD_EDIT_V415.md`.


## v5.0 Knowledge Platform

Nova now separates structured operational truth from managed informational knowledge. The Developer Console includes a tenant Knowledge Manager with source provenance, priorities, FAQ/fact/document management, reindexing and retrieval inspection. See `docs/KNOWLEDGE_PLATFORM_V5.md`.


## v5.1 Hybrid Knowledge Retrieval

Nova now uses hybrid lexical + vector retrieval with evidence-completeness gates and universal question-vs-action routing. The bundled vector provider works offline and can later be replaced by a neural embedding provider without changing business engines. See `docs/HYBRID_RAG_V51.md`.


## v5.2 Constraint-Aware Routing & Evidence Types

Nova now separates service constraints from service names, stores recurring bookings as structured state, filters internal assistant instructions out of customer RAG, and uses evidence-completeness gates before answering. See `docs/CONSTRAINT_ROUTING_EVIDENCE_RECURRENCE_V52.md`.


## v6.1 Structural Routing Hardening
Constraint canonicalization, multi-facet informational routing, custom quote handoff, command-vs-policy discrimination, and customer-safe knowledge evidence. See `docs/KNOWLEDGE_RETRIEVAL_V61.md`.


## v7 persistence

Nova v7 adds a repository-selected persistence layer. Keep `NOVA_STORAGE_MODE=memory` for local regression tests, or configure PostgreSQL + Redis and run `npm run db:migrate` before setting `NOVA_STORAGE_MODE=persistent`. See `docs/PERSISTENT_DATA_PLATFORM_V7.md`.

## v7.2 Consistency & Recovery

Nova v7.2 adds tenant-scoped transaction idempotency and consistency benchmark gates. Repeated order/booking confirmations are protected from duplicate durable writes while intentional new conversations can create new bookings. See `docs/V7_2_CONSISTENCY_RECOVERY.md` and run `npm run benchmark:v72`.

## v8.4 Unified Stability

Nova v8.4 reunifies the v8.1 catalog/PDF hotfix with the complete v8.2/v8.3 line. It keeps central customer and transaction consistency, local durable storage, knowledge idempotency, and catalog query normalization while adding maintained pure-Node PDF parsing and strict stale-subject reset behavior.

Run the complete release gate with `npm run benchmark:v8.4`. See `docs/V84_UNIFIED_STABILITY.md`.

## v8.5 Tenant-Aware Compound Understanding

Nova v8.5 grounds ambiguous words in the active tenant before enforcing domain boundaries. It adds universal asserted-vs-future clause semantics and date/time-range extraction, while cleaning-specific meaning remains owned by the cleaning adapter and tenant configuration. Real cleaning requests can now preserve staffing, duration, property scope, supplies/equipment, location, availability intent, and returning-customer claims without inventing prices, discounts, or availability.

Active cleaning drafts support two-turn schedule edits such as “change the hours for tomorrow” followed by “start at 9am.” Custom quotation handoffs retain the original detailed scope. The release suite proves state, CRM, customer, conversation, knowledge, and capability isolation across tenants.

Run `npm run benchmark:v8.5`. See `docs/V85_TENANT_AWARE_COMPOUND_UNDERSTANDING.md`.

## v8.6 Cross-Tenant Workflow Quality

Nova v8.6 converts multi-tenant playground transcripts into tenant-specific acceptance tests and closes deterministic workflow gaps across cleaning, salon, retail, and restaurant tenants. It supports multi-service booking estimates, explicit-date precedence, time windows, non-destructive reschedule proposals, product-variant inheritance, numeric-size safety, transactional cart validation, reservation-first routing, and conditional menu-first requests.

Business truth remains tenant-owned: shared engines interpret reusable language structure, while each tenant’s catalog, offerings, prices, knowledge, booking rules, CRM, and transactions remain isolated. Live availability is not promised without an authoritative scheduling provider.

Run `npm run benchmark:v8.6`. See `docs/V86_CROSS_TENANT_WORKFLOW_QUALITY.md`.

## v8.7 Durable Tenant Knowledge & Policy Routing

Nova v8.7 stores Knowledge Manager uploads and edits in a tenant-scoped durable overlay instead of modifying shipped tenant files. The overlay is merged over the immutable baseline on every start, so browser refreshes and process restarts retain PDF sources, documents, FAQs, facts, source status, and provenance. Production hosts must mount `NOVA_LOCAL_DATA_DIR` (or the separate knowledge/operations paths) to a persistent disk if their application filesystem is ephemeral.

Policy questions now retrieve only the active tenant’s approved evidence and resolve the applicable cancellation, rescheduling, arrival, confirmation, safety, fragrance-free, and pet rule rather than returning an unprocessed PDF chunk. Operational requests stay with booking/cleaning engines. Supplied property size, cleaner count, duration, date, start/end time, address, name, and phone are captured on the first turn, and Nova asks only for the next missing field.

Uploaded documents remain informational evidence; they never silently become executable prices. A reviewed structured pricing editor publishes tenant-scoped rates and mapped add-ons to the durable operational overlay.

Run `npm run benchmark:v8.7`. See `docs/V87_DURABLE_TENANT_KNOWLEDGE_POLICY_ROUTING.md`.

## v8.8 Hybrid Qwen Multilingual NLU

> Historical milestone only. Its local-model commands are retired in v8.9.8;
> use `docs/V898_ADAPTIVE_GROQ_NLU.md` for current setup.

Nova v8.8 uses the lightweight `Qwen/Qwen3-0.6B-GGUF` Q8 model as an optional schema-constrained language
understanding layer in front of the deterministic policy and capability engines.
Qwen classifies English, Urdu, Roman Urdu, Arabic, and mixed messages; extracts
already supplied booking fields; identifies corrections and workflow interrupts;
and returns a versioned JSON record. It receives no tools and cannot confirm,
cancel, price, schedule, update CRM, or execute any business action.

Conversation state remains application-owned. Invalid model output, timeouts, and
network failures never authorize a guessed action; unresolved arbitration asks
the customer to clarify while preserving the current workflow. The NLU context
contains only a bounded vocabulary for the current tenant and never includes CRM,
prices, stock, schedules, policies, customer history, or cross-tenant records.

Every message is first represented as a universal message frame. The frame keeps
all detected conversational acts and shared fields instead of forcing the whole
sentence into one intent. A sentence may therefore update name/phone/email,
provide booking date/time, request a service or product, ask for price, and greet
the business at the same time. Tenant adapters enrich that frame with their own
booking, catalog, cleaning, availability, commerce, and knowledge semantics. One
deterministic workflow owns transactional state, while safe CRM updates and
read-only interruptions can be handled without erasing or consuming its pending
field.

Download the lightweight model with `npm run model:qwen:download`, run it through
the configured OpenAI-compatible local server, and set `NOVA_NLU_MODE=on`.
In the original v8.8 policy, confident deterministic messages did not contact
Qwen; v8.9.7 supersedes that runtime behavior so `on` is model-first. The downloader is
cross-platform and runs natively from Windows
PowerShell without Bash. Run `npm run benchmark:v8.8`. See
`docs/V88_HYBRID_QWEN_NLU.md`.

## v8.9 Workflow Memory & Intent Ownership

Nova v8.9 makes the deterministic engine the first and normal understanding
path. Qwen remains optional: `NOVA_NLU_MODE=off` makes no model calls, while
`NOVA_NLU_MODE=on` invokes Qwen only when deterministic evidence is genuinely
ambiguous, conflicting, or insufficient. Clear catalog, booking, cleaning,
checkout, CRM, knowledge, and availability messages stay on the fast local path.

Multi-item commerce drafts now retain product-specific color, size, and quantity
answers across turns. Checkout and review commands own final confirmations even
when an older catalog draft exists, and unsupported product subtypes are not
silently replaced by a vaguely similar item.

Cleaning workflows retain supplied date, time window, address, identity, phone,
property scope, and add-ons when a customer changes the service or accepts a new
quote. Combined date/time answers advance both fields. Questions and social
interruptions are answered without consuming a pending field, and required-field
refusals receive a clear explanation instead of an invalid-value loop.

Run `npm run benchmark:v8.9`. See `docs/V89_WORKFLOW_MEMORY_INTENT_OWNERSHIP.md`.

## v8.9.1 Stabilization

Nova v8.9.1 closes the workflow gaps found in live cleaning and retail
playground conversations. Clear cleaning transactions now outrank informational
availability matches, natural time replacements stay inside the active request,
and supplied weekday/time/property fields are retained. Quote-and-availability
questions that explicitly say not to book remain read-only and preserve fallback
day/time and staffing constraints.

Retail multi-item drafts now bind color, size and quantity to individual product
lines. Short replies such as `small` are accepted when only one pending slot can
own them; unlabeled replies such as `black and black` are rejected without state
mutation when several mappings are possible. Common discovery wording and
bounded product typos no longer become fake unavailable products.

Run `npm run benchmark:v8.9.1`. See `docs/V891_STABILIZATION.md`. The next planned
milestone is the tenant-scoped Business Control Plane described in
`docs/V90_BUSINESS_CONTROL_PLANE_ROADMAP.md`.

## v8.9.2 Durable transaction amendments

Nova v8.9.2 makes change operations a platform capability instead of a
cleaning-only conversation exception. Tenant/customer-scoped records remain
durable after confirmation and keep the same ID while revisions and audit
timeline entries record approved or proposed changes.

- Cleaning requests can change their date, time, service type and requirements
  after submission. Pricing and live availability are explicitly marked for
  recheck.
- Active carts support multi-item removal without losing checkout details.
  Confirmed retail orders support adding and removing products while retaining
  their order ID and history; terminal orders fail closed.
- Generic booking tenants (salon, restaurant, clinic, education, tutoring and
  driving school) persist schedule and service amendments as pending proposals.
  The original slot remains authoritative until a future calendar integration
  approves the replacement.
- Multi-item option replies are sliced and evaluated per named product, so a
  color from one line cannot leak into another. Incomplete bulk requests show a
  provisional merchandise subtotal before asking only for missing variants.
- Explicit cleaner count plus duration selects hourly pricing even when property
  words such as apartment are also present.

Run `npm run benchmark:v8.9.2`. See
`docs/V892_TRANSACTION_AMENDMENTS.md`. The v9.0 Business Control Plane remains
the next roadmap milestone for tenant-owned product, service, hours, location
and policy administration.

## v8.9.3 Tenant routing and knowledge reliability

Nova v8.9.3 closes the cross-domain routing defects found with the fruit seller
and real-estate onboarding examples. Compound cart changes are atomic and
quantity-aware, cart/history questions remain owned by commerce, and overlapping
aliases cannot add a different product. `Reset chat` preserves durable business
records; `Fresh test` additionally clears only the active cart for that
tenant/customer while retaining CRM, bookings, orders and service history.

Knowledge retrieval can now accept strong exact policy evidence even when a
short document has a low semantic score, while topic-completeness checks reject
unrelated business descriptions, addresses and payment facts. Cross-tenant
customer-data requests and direct refund commands fail closed.

Explicit service transactions outrank business-hours answers. A real-estate
viewing message can extract the configured service, property reference, date,
time, name and phone in one turn, pause for an informational question, then
resume and confirm once. Short but unambiguous service names such as `valuation
visit` bind to the tenant's structured offering price; `do not book until I
approve` remains quote-only.

Run `npm run benchmark:v8.9.3`. See
`docs/V893_TENANT_ROUTING_KNOWLEDGE.md`.

## v8.9.4 Full cleaning catalog and multi-service composition

Nova v8.9.4 upgrades `cleaning-demo` into a standalone Dubai cleaning and home-
care test business with an AED catalog covering routine, deep, move-in/out,
post-construction, office, furniture, AC, pest-control and laundry services.
Published benchmark amounts are stored once at 10% below their cited public
Justlife UAE prices. A service whose public current checkout price was not
available remains `custom_quote`; Nova never fabricates the missing amount.

Cleaning transactions can now contain multiple explicit services. “Office
cleaning and a 3-seater sofa” keeps Office Cleaning as the primary request and
adds Sofa Cleaning as a separately priced line, while sharing the supplied
schedule and customer fields. Composite phrases such as post-renovation deep
cleaning remain one service instead of splitting into overlapping deep-clean
records.

Broad collection questions are also identity-safe. “What cleaning services do
you have?” returns the categorized cleaning catalog, and a grocery tenant’s “do
you have fruits?” lists its fruit collection instead of arbitrarily selecting a
single product.

Run `npm run benchmark:v8.9.4`. See
`docs/V894_FULL_CLEANING_MULTISERVICE.md`.

## v8.9.5 Validated customer contacts and business-time enforcement

Nova v8.9.5 validates customer identity and contact fields before any workflow
or CRM bridge can persist them. Wrapped declarations such as “my name is
Zeeshan” save only `Zeeshan`; sentence-like names, malformed phone numbers,
invalid email addresses, and incomplete addresses are rejected without losing
the active transaction. Email is optional in cleaning, generic booking and
retail checkout flows.

Calendar and business-time validation is now operational rather than merely
descriptive. Impossible dates are rejected, closed days remain unselected, and
times outside each tenant's configured opening hours keep the workflow at the
date/time step. Explicit durations also cannot silently finish after closing.

The assistant now detects cleaning actions expressed as “clean my sofa” or
“have my sofa cleaned,” answers multi-service support questions with every
matched configured service, and gives a friendly tenant-aware boundary for
cross-domain requests instead of returning an unrelated offering. Deterministic
workflow state remains authoritative; optional Qwen NLU behavior is unchanged
and is still reserved for configured low-confidence or ambiguous input.

Run `npm run benchmark:v8.9.5`. See
`docs/V895_VALIDATED_CONTACTS_HUMAN_ASSISTANT.md`.

## v8.9.6 Natural understanding and observable Qwen fallback

Nova v8.9.6 fixes false high-confidence interpretation before the optional
model boundary. Price questions can name a different cleaning service without
being answered from an older draft, service-family changes clear stale scope,
and deep-cleaning price questions no longer become hourly-cleaner quotes. Exact
product requests replace old family-browse goals, geographic availability
wording uses tenant service-area knowledge, and incomplete numeric/noise
addresses are rejected.

Qwen remains an ambiguity fallback rather than the main engine. `off` makes no
model calls; `on` invokes the schema-constrained NLU only after deterministic
confidence/conflict evaluation. The new `npm run model:qwen:trace -- "message"`
command reports whether Qwen was invoked, why it was invoked, validation status,
latency, selected route, and extracted fields.

Run `npm run benchmark:v8.9.6`. See
`docs/V896_NATURAL_UNDERSTANDING_QWEN_RUNBOOK.md`.

## v8.9.7 Qwen-first understanding with deterministic execution

> Historical behavior. v8.9.8 removes model-first execution and the local Qwen
> runtime. Current `on` mode is adaptive Groq NLU; clear messages stay local.

Nova now has the two runtime modes requested for the production architecture.
`NOVA_NLU_MODE=on` sends every message to Qwen before tenant capability routing;
Qwen returns schema-validated language meaning and Nova's deterministic engine
validates and performs the work. `NOVA_NLU_MODE=off` makes no model calls and
uses the deterministic engine for both understanding and execution.

Qwen can select a semantically aligned candidate when Nova's highest keyword
score is unrelated, but it cannot invent tenant identifiers, business facts, or
successful actions. Prices, services, products, stock, policies, hours,
availability, CRM, carts, orders, bookings, confirmations, and cancellations
remain deterministic. Model failure automatically falls back to the core, and a
short circuit breaker avoids repeating the full timeout for every message while
the local server is down.

Run `npm run benchmark:v8.9.7`. See
`docs/V897_QWEN_FIRST_DETERMINISTIC_FALLBACK.md`.

## v8.9.8 Adaptive Groq understanding with deterministic execution

Nova v8.9.8 removes Qwen weights, download scripts, local server configuration,
and model-first latency from the active runtime. `NOVA_NLU_MODE=on` now evaluates
the deterministic route first and calls Groq only for low-confidence, unresolved,
conflicting, multilingual pending-workflow, ambiguous-correction, or complex
multi-intent language. `off` is deterministic-only.

Groq is schema-constrained and interpretation-only. It receives no tools, and
Nova accepts only current-tenant identifiers before deterministic capabilities
perform any work. Provider failures use the circuit breaker and safe core
fallback; unresolved cases ask a tenant-aware clarification without changing
the existing workflow. Arabic response wording and deterministic reply flow are
also improved without moving business facts into a model prompt.

Run `npm run benchmark:v8.9.8`. See
`docs/V898_ADAPTIVE_GROQ_NLU.md`.
