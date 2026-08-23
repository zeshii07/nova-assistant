# Nova v9.0.0-alpha.1 — Tenant Business Control Plane Foundation

This release implements the first three control-plane roadmap steps without
changing Nova's customer-facing execution authority. Groq may interpret a
message, but neither Groq nor a customer conversation can create or publish a
business configuration revision.

## Delivered behavior

- Durable tenant-scoped state under `NOVA_OPERATIONAL_DATA_DIR`.
- Editable resources: `profile`, `products`, `services`, and `hours`.
- Lifecycle: draft, deterministic schema/cross-reference validation, diff
  preview, publish, and discard.
- Immutable published revisions with optimistic-concurrency protection.
- Rollback creates a new revision containing the selected older document.
- Audit rows include tenant, actor, role, action, resource, revision pointers,
  checksums, request correlation ID, and timestamp.
- Runtime cache invalidation is limited to the affected tenant and repository.
- Published profile, product, cleaning-service, generic-offering, and hours data
  is consumed by the existing deterministic customer runtime.
- Tenant-scoped roles: owner, admin, catalog manager, support agent, and viewer.
- Cross-tenant actor/URL mismatches fail with HTTP 403.

Shipped files in `tenants/<tenant>/` remain an immutable baseline. Drafts and
revisions are durable operational data, so deployment refreshes do not erase
published business changes when the Nova data directory is mounted persistently.
The local JSON repository is intended for one Nova API process. Multi-instance
production deployment belongs to the planned PostgreSQL control-plane adapter.

## Developer Console

Start Nova and open `http://localhost:3000/developer`, then select **Control
Plane**.

1. Select a tenant and resource.
2. Load the effective resource.
3. Create a draft.
4. Edit and save the JSON.
5. Validate and fix any reported field or cross-reference errors.
6. Preview the deterministic diff.
7. Publish as owner/admin.
8. Use revision history to create a rollback revision if necessary.

Catalog managers may draft/validate product and service changes, but publication
is reserved for owners/admins in this alpha. Support agents and viewers are
read-only.

## API authentication context

All endpoints are under `/api/dev/control-plane/:tenantId` and remain protected
by `NOVA_DEV_TOKEN` when that variable is set. A protected deployment must send:

```text
x-nova-dev-token: <developer token>
x-nova-tenant-id: <same tenant as URL>
x-nova-actor-id: <stable user/administrator ID>
x-nova-role: owner | admin | catalog_manager | support_agent | viewer
x-request-id: <optional correlation ID>
```

The tenant in the request body is never used as authority. The authenticated
tenant header must match the URL tenant.

## API lifecycle

```text
GET    /api/dev/control-plane/:tenant
GET    /api/dev/control-plane/:tenant/resources/:resource
GET    /api/dev/control-plane/:tenant/drafts
POST   /api/dev/control-plane/:tenant/drafts
GET    /api/dev/control-plane/:tenant/drafts/:draftId
PATCH  /api/dev/control-plane/:tenant/drafts/:draftId
DELETE /api/dev/control-plane/:tenant/drafts/:draftId
POST   /api/dev/control-plane/:tenant/drafts/:draftId/validate
POST   /api/dev/control-plane/:tenant/drafts/:draftId/preview
POST   /api/dev/control-plane/:tenant/drafts/:draftId/publish
GET    /api/dev/control-plane/:tenant/resources/:resource/revisions
POST   /api/dev/control-plane/:tenant/resources/:resource/rollback
GET    /api/dev/control-plane/:tenant/audit
```

Create a draft by sending:

```json
{
  "resourceType": "hours",
  "document": {
    "timezone": "Asia/Dubai",
    "schedule": {
      "monday": [{ "open": "09:00", "close": "19:00" }],
      "tuesday": [{ "open": "09:00", "close": "19:00" }],
      "wednesday": [{ "open": "09:00", "close": "19:00" }],
      "thursday": [{ "open": "09:00", "close": "19:00" }],
      "friday": [{ "open": "09:00", "close": "19:00" }],
      "saturday": [{ "open": "09:00", "close": "19:00" }],
      "sunday": []
    }
  }
}
```

Services use a canonical wrapper so Nova cannot confuse domain-specific
cleaning records with generic appointment offerings:

```json
{
  "kind": "cleaning",
  "items": [
    {
      "id": "CLN001",
      "name": "Standard Home Cleaning",
      "price": 40,
      "currency": "AED",
      "priceType": "hourly",
      "pricingServiceId": "hourly-cleaner",
      "aliases": ["standard cleaning"],
      "active": true
    }
  ]
}
```

The `kind` is fixed to the tenant's baseline service engine. Cleaning and generic
offering records therefore cannot leak into or replace one another.

## Validation guarantees

- Profile tenant ID is immutable and must match the authenticated tenant.
- Product/service IDs, SKUs, aliases, sizes, colors, and tags are checked for
  shape and duplicates.
- Product categories must exist in that tenant's category catalog.
- Prices and inventory cannot be negative; inventory must be an integer.
- Cleaning pricing references must resolve to that tenant's pricing table.
- Hours must contain a recognized text schedule or valid 24-hour intervals.
- A draft must be validated at its current checksum before publication.
- A draft whose base revision is older than the active revision is rejected as
  stale instead of overwriting newer work.

## Run and verify

```powershell
npm install
npm run benchmark:v9.0.0
npm start
```

The next roadmap slice is variant/SKU inventory and reservation semantics. Live
staff availability remains intentionally separate until the scheduling/calendar
adapter is implemented.
