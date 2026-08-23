# Nova v9.2.0-alpha.1 — Calendar adapter and live capacity

## Outcome

Nova now distinguishes three different facts:

1. **Business hours** say whether the tenant is normally open.
2. **Calendar capacity** says whether the required staff, room, vehicle, table,
   or cleaning-team units are free for the full requested duration.
3. **Confirmation** converts an expiring hold into a durable event only after
   the customer approves the reviewed transaction.

The LLM has no calendar tool and cannot confirm, move, or cancel a slot. Groq
may interpret uncertain language, but the deterministic workflow validates the
date/time, tenant hours, resource rules, capacity, ownership, and confirmation.

## Provider boundary

Every external scheduler must implement:

- `check`
- `hold`
- `confirmHold`
- `releaseHold`
- `reschedule`
- `cancel`
- `listEvents`

The first provider is `local`. It uses an atomic JSON snapshot and a per-tenant
process mutex, making local development and one-process deployments fully
testable without external accounts. The provider registry is the seam for later
`google_calendar` and `microsoft_graph` implementations.

## Slot lifecycle

1. Normalize the customer date/time in the tenant IANA timezone.
2. Validate closed days, working hours, duration, lead time, and advance window.
3. Resolve a service rule and resource pool.
4. Count overlapping confirmed events and active holds.
5. Place a tenant/customer/conversation-scoped hold with an expiry.
6. Confirm the reviewed booking and create its event atomically within the local
   provider lock.
7. Release an abandoned hold immediately or expire it on the next operation.
8. Reschedule only when the replacement has capacity; otherwise retain the
   original event and offer nearby slots.
9. Cancellation marks the event cancelled and immediately frees capacity.

Generic bookings place a hold when all required fields are complete. Cleaning
requests acquire the visit capacity during final confirmation; multiple cleaning
service lines share one visit event and retain their own request IDs. A customer
can later reschedule or cancel that confirmed cleaning visit; every linked line
is updated together and the calendar capacity is released only once.

Questions that include an exact date/time (for example, “Are you available
Monday at 2 PM?”) use the live slot checker. Questions that mention only a day
continue to receive the tenant’s normal business-hours answer.

## Calendar Control Plane resource

Open Developer Console → Control Plane → **Calendar & capacity**. The resource
uses the normal draft → validate → preview → publish lifecycle. The JSON fields
are demonstrated in `examples/control-plane-calendar.json`.

- `provider`: `disabled`, `local`, `google_calendar`, or `microsoft_graph`.
- `timezone`: an IANA timezone such as `Asia/Dubai`.
- `defaultDurationMinutes`: duration when the service has no explicit duration.
- `slotIntervalMinutes`: interval used to search nearby alternatives.
- `holdTtlSeconds`: review-time hold expiry.
- `minLeadMinutes` / `maxAdvanceDays`: scheduling window.
- `resourcePools[].capacity`: simultaneous deterministic capacity units.
- `serviceRules[]`: service-to-pool duration and capacity requirements.

Credentials are never stored here. External provider documents may reference a
server-side environment variable name through `credentialEnv`; validators reject
API keys, tokens, client secrets, credentials, and private keys in tenant JSON.

The **Live calendar** panel shows events and holds and lets an owner/admin block
a period to simulate an unavailable team or resource. The Data Inspector shows
calendar events for only the selected tenant/customer.

## API

```http
GET /api/dev/control-plane/{tenantId}/calendar
POST /api/dev/control-plane/{tenantId}/calendar/blocks
POST /api/dev/control-plane/{tenantId}/calendar/events/{eventId}/cancel
```

All routes require the existing developer authentication plus matching
`x-nova-tenant-id`, actor ID, and role. Reads accept Control Plane read roles;
live block operations and removal of operator-created blocks require owner/admin
publication authority. Customer events must be cancelled through their booking
or service-request workflow so transaction and calendar records cannot diverge.

## Test

```powershell
npm install
npm run benchmark:v9.2.0
npm start
```

Then open `http://localhost:3000/developer` and:

1. Select `salon-demo` or `cleaning-demo`.
2. Open Control Plane → Calendar & capacity and inspect the published/baseline
   resource.
3. In Live calendar, block a date/time.
4. Ask the customer assistant for that exact slot and verify it declines and
   proposes alternatives.
5. Use another customer ID to test competition for capacity.
6. Confirm a booking, ask to move it into the blocked period, and verify the
   original slot remains intact.
7. Cancel the confirmed booking or cleaning visit and verify the event becomes
   cancelled and its capacity can be booked again.

## Deployment boundary

The local provider prevents double booking inside one Nova API process and
survives restart when `NOVA_LOCAL_DATA_DIR` or `NOVA_OPERATIONAL_DATA_DIR` is on
persistent storage. Multiple API replicas must not share local calendar traffic.
Before horizontally scaling, implement a PostgreSQL calendar repository with
transactions/advisory or row locks, or connect an authoritative external
scheduler whose adapter provides equivalent idempotency and concurrency.
