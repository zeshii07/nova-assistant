# Nova v8.7 — Durable Tenant Knowledge & Policy Routing

## Decision

Nova does not need a second statistical language engine for the supplied failures. They came from four architectural gaps: mutable/ephemeral knowledge storage, query expansion that was calculated but not used, policy questions competing with operational intents, and booking entities being extracted without consistently filling workflow slots.

v8.7 keeps the existing roadmap: deterministic and auditable operational engines own bookings, prices, CRM, availability, orders, and handoffs; tenant-approved knowledge grounds informational answers; an optional model may later help only with low-confidence interpretation behind structured schemas and validation.

## Tenant boundary

Every lookup and write is scoped by `tenantId`. Shipped tenant files are immutable baseline data. Each tenant receives independent durable knowledge and operational overlays:

```text
NOVA_LOCAL_DATA_DIR/
  tenant-knowledge/<tenantId>/knowledge/...
  tenant-operational/<tenantId>/pricing/services.json
```

The active view is baseline plus that tenant’s overlay. No global PDF index, pricing table, CRM profile, conversation state, or source registry is shared between tenants.

## Knowledge persistence

Knowledge Manager mutations now write to the overlay:

- uploaded originals and normalized documents;
- source registry, provenance, priority, revision, and status;
- business fact edits;
- FAQs;
- document updates and baseline-source tombstones.

The repository merges the overlay over baseline files after restart and rebuilds the tenant index. Re-uploading the same content is idempotent.

`NOVA_LOCAL_DATA_DIR=./.nova-data` is locally durable. On Render, Koyeb, containers, or any host with an ephemeral application filesystem, mount that directory to persistent storage. You may instead mount `NOVA_KNOWLEDGE_DATA_DIR` and `NOVA_OPERATIONAL_DATA_DIR` separately. A browser refresh never requires re-uploading; a redeploy is durable only when the configured path itself is durable.

## Informational knowledge versus operational truth

PDFs and documents are approved evidence for policies, explanations, service limitations, and FAQs. They are not executable pricing or availability configuration. Automatically turning prose such as “balconies cost Rs 800” into a charge would make quotations unauditable and vulnerable to malformed documents.

The Developer Console therefore has a reviewed operational pricing publisher. It validates service IDs, pricing models, matrix values, add-on input mappings, rates, and duplicate IDs before atomically publishing a tenant override. The pricing engine then calculates from that structured configuration and can show the formula.

## Policy resolution

Retrieval now uses the expanded query and separates cancellation from rescheduling evidence. Same-source chunks are combined rather than treated as conflicts. For supported policy questions, the grounded resolver selects the applicable rule from retrieved evidence:

| Customer meaning | Result behavior |
|---|---|
| Cancellation 20 hours before | Selects the 6–24 hour cancellation band |
| Reschedule 10 hours before | Selects the rescheduling band, not cancellation |
| Arrival 15 minutes after start | Compares against the 30-minute arrival window |
| Arrival 70 minutes after start and customer cancels | Applies the retrieved no-fee late-arrival rule |
| High-rise exterior windows | Returns the retrieved safety limitation |
| “Does this quote confirm my booking?” | Explains the retrieved confirmation requirements |
| Fragrance-free request 8 hours before | Compares 8 hours with the retrieved 12-hour requirement |
| Pet present without heavy hair | Does not invent the heavy-hair surcharge |

If the required evidence is absent or incomplete, Nova abstains and asks the tenant’s team to confirm. It does not invent a rule.

## Complete first-turn booking extraction

The cleaning adapter now preserves all supplied fields before choosing the next workflow step:

- property type and bedrooms;
- cleaner count and duration;
- explicit date, weekday, and relative date;
- start time, end time, and time window;
- address/location;
- add-on quantities and service scope;
- name and phone when declared;
- equipment, supplies, recurrence, availability intent, staff preference, and policy facets.

Example: “2 cleaners this Saturday from 9 AM to 12 PM for a 3-bedroom apartment” fills bedrooms `3`, cleaners `2`, duration `3`, the resolved date, start `09:00`, and end `12:00`. Nova proceeds to the next missing field instead of asking for size, date, or time again.

## Test isolation correction

Test storage previously used only the process ID. Old local snapshots could be revived when an operating system reused a PID, creating false cross-customer failures. v8.7 adds a per-test-process run token while keeping repeated container builds inside that process on one stable test path.

## Acceptance and release gate

The v8.7 acceptance suite covers durable PDF restart behavior, cross-tenant knowledge isolation, six policy cases, first-turn slot extraction, stale custom-quote protection, reviewed add-on pricing, and operational-pricing restart durability.

Run the full isolated gate:

```bash
npm run benchmark:v8.7
```

## Roadmap continuation

1. Move knowledge blobs and revisions into object storage/PostgreSQL for hosts where a mounted volume is undesirable.
2. Add the same compound-message acceptance matrix for every tenant/domain.
3. Connect authoritative calendar and workforce-capacity providers.
4. Add structured low-confidence model interpretation behind schemas, redaction, cost limits, and deterministic validation.
5. Add tenant-level retrieval, abstention, routing, repair, and isolation metrics.
