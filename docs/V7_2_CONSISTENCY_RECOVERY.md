# Nova v7.2 — Consistency & Recovery

v7.2 hardens transaction consistency without changing Nova's business-specific engines.

## Guarantees
- Order writes support tenant-scoped idempotency keys so retrying the same transaction cannot create a second order.
- Booking creation derives a stable key from tenant/customer conversation context plus normalized slots. Repeated confirmation of the same ready booking returns the original booking.
- The same requested booking in a different conversation is treated as a new intentional booking.
- Idempotency fingerprints are deterministic regardless of JavaScript object key ordering.
- Existing tenant isolation remains authoritative.
- Memory mode remains supported; PostgreSQL adds unique tenant/idempotency indexes for production retries and multi-instance deployments.

## Benchmark
Run `npm run benchmark:v72`. It must pass the v7.2 consistency contracts, v7 persistence contracts, and the complete automated regression suite.

Persistent deployments must additionally run `npm run db:migrate` and `npm run benchmark:persistent` against real PostgreSQL + Redis infrastructure.
