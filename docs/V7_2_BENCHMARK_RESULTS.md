# Nova v7.2 Benchmark Results

Build: `7.2.0-alpha.1`

## Passed gates
- Consistency & recovery contracts: 4/4
- v7 persistence contracts: 7/7
- Full automated Node test suite: 291/291
- Conversation compliance corpus: 156/156
- JavaScript syntax check: 244 files
- Project `npm run check`: PASS

## New consistency guarantees
1. Stable transaction fingerprints are deterministic across object key ordering.
2. Repeated order writes with the same tenant-scoped idempotency key return the original order instead of creating a duplicate.
3. Repeated confirmation of the same booking in the same conversation returns the original booking.
4. An equivalent booking in a different conversation remains an intentional new booking.
5. Cross-tenant reads remain blocked.

## External-infrastructure gate
Real PostgreSQL + Redis restart behavior still requires `npm run db:migrate` followed by `npm run benchmark:persistent` against actual services. The local benchmark does not claim a live networked database test.
