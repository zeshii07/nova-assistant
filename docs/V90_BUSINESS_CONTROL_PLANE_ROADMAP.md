# Nova v9.0 roadmap — Tenant Business Control Plane

> v9.2.1 update: commercial values now have two explicit user-facing owners.
> Product and variant prices live in **Products & Prices**; service metadata and
> executable price rules live together in **Services & Pricing**. Knowledge
> Manager pricing publication and `GET|PUT /api/dev/operations/:tenant/pricing`
> are retired. Legacy pricing files are migration inputs, not parallel editors.

The next milestone should make business data safely editable after onboarding.
It should not move business truth into prompts or PDFs. v9.0 is a tenant-scoped
control plane over the same deterministic engines already used by Nova.

## Where business information belongs

| Information | Authoritative owner | Examples |
|---|---|---|
| Identity and contact | Business profile | name, phone, email, address, locations |
| Opening rules | Availability configuration | weekly hours, closures, holidays, lead time |
| Services and service charges | Control Plane → Services & Pricing | name, aliases, duration, price rules, matrices, add-ons, discounts |
| Products and product prices | Control Plane → Products & Prices | categories, SKUs, variants, base/variant prices, images, active status |
| Live stock | Inventory engine | on-hand stock, reservations, movements |
| Informational content | Knowledge Manager | policies, FAQs, instructions, service explanations |
| Customer/transaction data | CRM and transaction repositories | profiles, carts, orders, bookings, service requests |

A PDF may explain a cancellation policy or service limitation. It must not
silently change stock, availability or a charge. Those changes require reviewed
structured data.

## Current v8.9.4 administration

Open `/developer`:

1. **Onboarding Studio** creates a new tenant and its initial structured products,
   services, identity and booking configuration.
2. **Knowledge Manager** adds, edits, disables or removes tenant-approved
   documents, PDFs, FAQs and facts. These durable overlays survive refresh/restart
   when `NOVA_LOCAL_DATA_DIR` is mounted on persistent storage.
3. **Control Plane** publishes product prices and service pricing rules with the
   same draft, validation, preview, revision and rollback lifecycle as their
   catalog records. Knowledge Manager has no commercial write path.

Current API boundaries are:

- `POST /api/dev/onboarding/tenant`
- `GET /api/dev/knowledge/:tenant`
- `POST /api/dev/knowledge/:tenant/files|documents|faqs|facts`
- `PATCH|DELETE /api/dev/knowledge/:tenant/sources/:sourceId`
- `GET|PUT /api/dev/operations/:tenant/pricing` — retired in v9.2.1 (HTTP 410)

v8.9.2 adds durable customer transaction amendments for carts, confirmed orders,
cleaning requests and generic booking proposals. It does not yet provide complete
post-onboarding CRUD screens for products,
services, hours and locations. Re-running onboarding or editing shipped tenant
files is suitable for development, but is not the intended SaaS administration
experience.

v8.9.3 strengthens this boundary: tenant knowledge, catalog, booking, pricing,
commerce and privacy intents are routed to their authoritative owners, and the
playground exposes separate chat-reset and fresh-test controls without deleting
durable transaction history.

v8.9.4 additionally proves that a tenant can own a large categorized service
catalog, source-traceable pricing and composed multi-service requests without
moving business facts into prompts. The remaining roadmap is unchanged: v9.0
adds authenticated draft/validate/publish controls so business owners can edit
these same resources without changing shipped JSON files.

## v9.0 control-plane scope

### 1. Tenant-scoped resources

Add explicit repositories and APIs for:

- business profile and locations;
- products, categories, variants and SKUs;
- services, aliases, duration and bookability;
- business hours, closures and availability rules;
- prices, matrices, add-ons, stock and reservations;
- channel connections and tenant feature flags.

Every read and write must require `tenantId` from authenticated server context,
not from a trusted client body alone.

### 2. Draft, validate, publish

Operational changes use this lifecycle:

`draft -> schema validation -> cross-reference validation -> preview -> publish`

Publishing creates an immutable revision, records the actor and timestamp,
invalidates tenant caches atomically and supports rollback. Draft changes never
affect customer conversations.

### 3. Admin roles and audit

Introduce organizations, users, memberships and roles such as owner, admin,
catalog manager, support agent and viewer. Audit records must include tenant,
actor, resource, before/after revision and request correlation ID. Cross-tenant
lookups must fail closed.

### 4. Catalog and inventory reliability

The first v9.0 delivery should prioritize the existing retail gaps:

- durable aliases and search terms;
- product variants/SKUs instead of free-form color and size fields;
- variant-level stock and reservation during checkout;
- category and product activation/deactivation;
- deterministic price rules and sale windows;
- import preview for CSV/JSON with row-level validation errors.

### 5. Service-business administration

The same control plane then exposes service duration, staff requirements,
property pricing matrices, add-ons, hours, closures and live scheduling-provider
connections. Availability answers must distinguish business hours from actual
staff/calendar capacity.

## Suggested delivery order

1. ✅ Resource schemas, tenant-scoped repositories and revision model — delivered in v9.0.0-alpha.1.
2. ✅ Product/service/hours/profile draft APIs with validation and audit — delivered in v9.0.0-alpha.1.
3. ✅ Initial admin UI for draft, preview, publish and rollback — delivered in v9.0.0-alpha.1.
4. ✅ Variant inventory and reservation semantics — delivered in v9.1.0-alpha.1.
5. 🟡 Scheduling adapter and local live-capacity reservations — local provider delivered in v9.2.0-alpha.1; Google Calendar/Microsoft Graph adapters remain next.
6. ✅ Unified Products & Prices and Services & Pricing ownership — delivered in v9.2.1-alpha.1.
7. Production PostgreSQL/object-storage migration and operational monitoring.

Remote NLU remains an interpretation helper outside this control plane. Groq may
propose structured meaning during import, but a human must review operational
edits and deterministic validators decide whether they can be published.
