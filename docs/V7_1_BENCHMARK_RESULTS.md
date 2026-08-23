# Nova v7.1 Benchmark Results

Date: 2026-08-10

## Level A — repository contracts + full regressions

Status: PASS

- Persistence/restart contract tests: 7/7 passed
- Full automated suite: 287/287 passed
- Conversation corpus: 156/156 passed
- Syntax/structure check: 241 JavaScript files passed
- State-safety audit: passed

The persistence contract covers:
- Redis-style conversation state surviving repository/client re-instantiation
- CRM customer recognition surviving repository re-instantiation
- tenant isolation for the same external customer identity across tenants
- active cart and confirmed order persistence contracts
- booking persistence contracts
- cleaning/service-request tenant scoping
- memory mode remaining the zero-dependency development default

## Level B — live PostgreSQL + Redis restart benchmark

Status: NOT RUN IN BUILD CONTAINER

Reason: no PostgreSQL or Redis server is available in the build environment.

This remains a release gate for real persistent mode. Configure DATABASE_URL and REDIS_URL, run migrations, then run:

```bash
npm run db:migrate
npm run benchmark:persistent
```

The live benchmark writes state and durable records, closes clients, constructs fresh clients/repositories, and verifies that customer, cart/order, booking, cleaning-request and conversation state remain present and tenant-isolated.

Persistent mode must not be called production-ready until Level B passes against the target database/Redis deployment.
