# NOVA v8.5 — Tenant-Aware Compound Understanding

## Decision

NOVA should not be replaced by a second statistical language engine. The roadmap already has the right separation:

1. deterministic, tenant-scoped business engines remain authoritative;
2. universal conversation intelligence extracts domain-neutral language structure;
3. each tenant/domain adapter maps that structure to its own business meaning;
4. a controlled structured-output AI fallback can be added later for genuinely ambiguous messages, behind validation, redaction, cost limits, versioning, and deterministic fallback.

A separate statistical engine would duplicate routing, weaken auditability, and create another place for tenant context to leak. v8.5 instead improves the existing hybrid core at the point where the failures occurred.

## Root causes found

| Failure | Root cause | v8.5 correction |
|---|---|---|
| “cleaning products” became retail | The assistant treated generic `products` as retail before considering cleaning context | Ambiguous vocabulary is grounded in the active tenant; strong unrelated retail nouns still trigger a boundary response |
| One-time request became weekly | Recurrence parsing read an optional future-consideration clause as the current action | The universal clause pass separates asserted work from future/conditional ideas |
| 8–11 and “start at 9am” were lost | The shared semantic pass extracted durations but not explicit ranges/start times | Universal temporal extraction now emits date text, weekday, start, end, duration, and relative date references |
| Explicit 2 cleaners × 3 hours used property pricing | Property quotation ran before explicit work-model semantics | Staffing + duration now selects the tenant-configured hourly model while retaining property scope |
| “change the hours” became business hours | Active workflow edits had no intent/state contract | Cleaning now owns schedule edits, asks only for a missing new time, applies it, then resumes the prior step |
| Villa handoff lost requirements | The pending custom quote stored only a few property fields and overwrote the original message on acceptance | Pending and handoff context preserve the original message, location, floor, rooms, washrooms, tasks, and confirmation message |

## Architecture boundary

The shared core understands only reusable conversational structure:

- asserted request versus future consideration;
- date references, weekdays, natural date text, explicit start/end time, and duration;
- general conversational operations such as asking, booking, rescheduling, confirming, or cancelling.

The cleaning tenant owns cleaning meaning:

- cleaner/person count;
- apartment/villa, bedrooms, washrooms, halls, balconies, and floor;
- post-renovation scope and requested cleaning tasks;
- supplies and equipment requirements;
- cleaning prices, discounts, service availability, service catalog, and approved knowledge.

Other tenants do not inherit cleaning meanings or cleaning test examples. Their adapters and fixtures must be tested with examples from their own business domain.

## Business-truth rules

- Price comes from the active tenant’s structured pricing engine.
- Returning-customer text is a claim, not proof. No discount is applied until the same tenant’s CRM/transaction history verifies eligibility.
- Requested time is captured, but live staff availability is not confirmed unless an authoritative scheduling provider confirms it.
- Natural dates without a year are preserved as customer text. The system does not invent a year from unrelated runtime context.
- Tenant knowledge answers use only tenant-approved sources and abstain when evidence is missing.

## Isolation contract

The execution path derives conversation identity as:

`tenantId + channel + customerId`

CRM and transactional repositories key records by tenant and customer. Capability facades receive the resolved tenant and customer scope rather than raw repositories. v8.5 regression tests prove:

- the same external customer ID creates separate CRM records in two tenants;
- the same customer ID creates separate conversation states in two tenants;
- two customers inside one tenant do not share workflow state;
- cleaning knowledge does not appear in the retail tenant;
- cleaning capability state does not appear in the retail tenant;
- custom quote handoffs remain tagged with the originating tenant, customer, and conversation.

## Real-message acceptance coverage

The v8.5 suite uses the supplied examples only for `cleaning-demo`:

1. apartment, windows/balconies, equipment, location, explicit staff/time, and quote;
2. weekly staff/time quote, supplies/equipment, and returning-customer claim;
3. one-time booking with optional future weekly interest;
4. active request asking to change tomorrow’s hours;
5. follow-up changing the start to 09:00 while preserving the three-hour duration;
6. post-renovation upper-floor villa scope and complete custom-quote handoff.

Run the complete gate:

```bash
npm run benchmark:v8.5
```

The v8.5 gate creates a fresh temporary durable-data root on every run so a previous local test execution cannot contaminate a later result.

## Next roadmap step

Continue the current roadmap rather than building a parallel engine:

1. add domain-specific compound-message fixtures for every tenant type;
2. generalize the schedule-edit state contract into the shared booking engine;
3. connect authoritative live availability providers;
4. verify loyalty/discount eligibility through tenant-scoped CRM transactions;
5. add controlled structured-output AI only for low-confidence parsing, with a schema allowlist and deterministic validation;
6. expose isolation and abstention metrics in production operations.
