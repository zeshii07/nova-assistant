# Nova v7 — Persistent Multi-Tenant Data Platform

Nova v7 keeps the deterministic conversation, catalog, commerce, booking, CRM, pricing, knowledge and humanization engines unchanged. Persistence is selected below those engines through repository adapters.

## Modes

- `NOVA_STORAGE_MODE=memory` — default; zero external services, ideal for regression tests.
- `NOVA_STORAGE_MODE=persistent` — PostgreSQL for durable operational data and Redis for live conversation state.

## Durable data in v7.0

PostgreSQL stores CRM customers/activities, carts, orders, bookings, cleaning/service requests and schema-ready tenant/knowledge/conversation tables. Existing tenant configuration and catalog/knowledge source files remain authoritative configuration inputs in v7.0; later migrations can mirror/import them into the prepared tables without changing capability code.

Redis owns active conversation state. Keys are tenant-scoped through the existing conversation id (`tenant:channel:customer`) and expire after `NOVA_STATE_TTL_SECONDS`.

## Setup

1. `npm install`
2. Create PostgreSQL and Redis instances.
3. Set `DATABASE_URL` and `REDIS_URL`.
4. Run `npm run db:migrate`.
5. Set `NOVA_STORAGE_MODE=persistent`.
6. Start Nova normally.

## Isolation rule

Every durable operational query is tenant-scoped. Repositories accept `tenantId` explicitly; cross-tenant reads are not permitted.

## Data Inspector

`GET /api/dev/data/inspect?tenantId=...&customerId=...&channel=playground` returns the current conversation state, CRM profile/activity, cart, orders and bookings. This endpoint uses the same repositories as the runtime and therefore works in memory and persistent modes.
