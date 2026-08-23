# Nova v9.1.0-alpha.1 — Variant inventory and checkout reservations

This release completes Control Plane roadmap step 4. Product options can now be
real tenant-scoped SKUs instead of free-form color and size labels. Each variant
can have its own stock, active state, and optional price override.

## What the Control Plane is for

The Control Plane is the authenticated business-admin side of Nova. It is not a
customer conversation and an LLM cannot publish through it. Owners and approved
staff use it to:

- update business identity and contact information;
- manage products, SKU variants, services, prices, aliases and active states;
- publish business hours;
- validate references and values before they affect customers;
- preview a deterministic diff;
- publish immutable tenant revisions or roll back by creating a new revision;
- inspect actor-attributed audit history;
- view SKU on-hand, reserved and available quantities;
- correct on-hand SKU stock with a required tenant and actor context.

Catalog managers can draft and validate product/service changes. Only owners and
admins publish, roll back or adjust live stock. Cross-tenant access fails closed.

## Variant format

Open Developer Console → Control Plane → Products. Use
`examples/control-plane-product-variants.json` as a shape reference. A variant
requires a unique tenant-wide `sku`, a unique attribute combination and a
non-negative integer `inventory`. `color` and `size` values must exist in the
parent product options.

When variants exist, variant inventory is authoritative. Products without a
`variants` array retain the previous product-level static inventory behavior.

## Reservation lifecycle

1. Checkout validates the exact product option against current tenant catalog.
2. Nova reserves the finite variant SKU for the active cart.
3. Other customers see only unreserved availability.
4. Updating/clearing the cart releases its old hold; checkout can reserve again.
5. Confirming the order consumes the hold and writes a negative sale movement.
6. Expired holds release automatically on the next inventory operation.
7. Removing an item from a modifiable order restocks its SKU.
8. A variant exchange atomically consumes the destination SKU and restores the
   source SKU.

The default hold is 15 minutes. Configure it with:

```dotenv
NOVA_INVENTORY_RESERVATION_TTL_SECONDS=900
```

## Inventory admin API

Read a tenant inventory overview:

```http
GET /api/dev/control-plane/{tenantId}/inventory
x-nova-tenant-id: {tenantId}
x-nova-actor-id: owner-123
x-nova-role: owner
```

Set an exact variant on-hand quantity:

```http
PATCH /api/dev/control-plane/{tenantId}/inventory/POLO-BLK-L
Content-Type: application/json
x-nova-tenant-id: {tenantId}
x-nova-actor-id: owner-123
x-nova-role: owner

{"onHand":7,"reason":"physical stock count"}
```

The inventory overview exposes levels, reservations and the latest 100 movements
for only the requested tenant.

## Run and verify

```powershell
npm install
npm run benchmark:v9.1.0
npm start
```

Open `http://localhost:3000/developer`, select a retail tenant, then use Control
Plane → Products to publish a variant catalog. The Live SKU inventory panel shows
on-hand, reserved and available quantities.

## Current deployment boundary

The alpha repository uses an atomic local JSON snapshot and a per-tenant process
mutex. It prevents overselling within one Nova API process and survives restart
on a persistent volume. A multi-instance deployment still requires the roadmap
PostgreSQL inventory adapter with database transactions/row locks before more
than one API replica may execute commerce traffic safely.
