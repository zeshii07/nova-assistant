# Nova v7.1 Persistence Benchmark

## Acceptance gates

Nova v7.1 is not considered persistence-ready unless all of these pass:

1. **Repository restart contract**
   - Redis conversation state survives repository/client re-instantiation.
   - PostgreSQL-backed CRM, cart/order, booking and service-request records survive repository re-instantiation.

2. **Tenant isolation**
   - The same external/customer identifier may exist in multiple tenants.
   - Reads always return only the requested tenant's data.
   - Cross-tenant order, booking and cleaning-request lookup returns null.

3. **Customer recognition**
   - CRM profile fields survive restart.
   - Returning customer lookup recovers name/phone/custom fields within the correct tenant.

4. **Cart/order persistence**
   - Active cart survives restart.
   - Confirmed order survives restart.
   - Cross-tenant order lookup is rejected.

5. **Booking persistence**
   - Booking survives restart.
   - Booking lookup requires tenant scope.

6. **Regression safety**
   - Full Nova automated suite has zero failures.
   - Conversation dataset has zero failures.
   - Syntax check passes.
   - State-safety audit passes.

## Two benchmark levels

### Level A — always runnable
`npm run benchmark:v7`

Runs persistence contracts with durable fake infrastructure plus the complete Nova regression suite. This catches repository/API/tenant-scope regressions without requiring a database server.

### Level B — real persistence infrastructure
Set:
- `DATABASE_URL`
- `REDIS_URL`
- `NOVA_STORAGE_MODE=persistent`

Then run:

`npm run db:migrate`
`npm run benchmark:persistent`

The live benchmark writes CRM, Redis conversation state, cart, confirmed order, booking and cleaning request; closes all clients; creates entirely new clients/repositories; then proves the records are still present and tenant-isolated.

## Local Docker option

`docker compose -f docker-compose.persistence.yml up -d`

Then copy `.env.persistence.example` to `.env` and run the migrations/benchmark.

## Benchmark interpretation

Memory mode losing data after a Node restart is expected.
Persistent mode losing any durable order/customer/booking after a restart is a release-blocking failure.
Cross-tenant data visibility is always a release-blocking failure.
