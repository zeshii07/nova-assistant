# Nova v8.3 — Local Durability, Knowledge Idempotency & Catalog Query Normalization

## Zero-dependency development persistence

`NOVA_STORAGE_MODE=memory` remains the zero-external-service developer setting, but its implementation is now **local-durable** rather than process-ephemeral.

Nova writes runtime snapshots under:

`.nova-data/`

unless `NOVA_LOCAL_DATA_DIR` overrides the location.

The local durability contract covers:
- conversation state
- CRM customers and activities
- carts and orders
- generic bookings
- cleaning/service requests
- offering orders
- customer memory/preferences/history

This means restarting the Nova server no longer erases customer identity, a pending booking, a cart, or service requests.

Production persistence remains PostgreSQL + Redis through `NOVA_STORAGE_MODE=persistent`.

## Tenant isolation

All local records retain tenant keys. The same customer ID can have independent CRM, booking, cart, and memory state in different tenants.

## Test-worker isolation

Node test workers automatically receive process-scoped `.nova-data/test-<pid>` directories, preventing durable development storage from leaking state across parallel test files.

Local JSON writes use unique temporary filenames before atomic rename to avoid concurrent `.tmp` collisions.

## Knowledge persistence and idempotency

Uploaded tenant knowledge was already stored under each tenant's `knowledge/` directory. v8.3 makes re-upload behavior explicit and idempotent.

The Knowledge Manager now checks:
- tenant
- content hash
- normalized knowledge file path

Uploading the same PDF/TXT/MD/CSV/JSON knowledge again reuses the existing source ID instead of creating duplicate `KS-*` registrations.

The UI now tells the operator that successfully registered knowledge remains stored after browser/server refresh. Browser file inputs themselves cannot retain a selected local file after refresh, but Nova does not require re-upload once the source is registered.

## Catalog noun-phrase normalization

Product identity matching now removes conversational scaffolding before matching:

- `can i get candy biscuits from you` → `candy biscuits`
- `do you have toys for kids` → `toys`
- `can i get a plastic water bottle from you` → `plastic water bottle`
- `i want a school bag` → `school bag`
- `i want a fountain pen please` → `fountain pen`

Identity modifiers are preserved. Nova does not collapse `plastic bottle` into `bottle` or `fountain pen` into `pen`.

The cleaned phrase is used for identity resolution and customer-facing unavailable wording.

The original normalized message is still used for color/size/quantity extraction, so grammar such as `I want polo shirt white small one` retains quantity=1.

## Regression gates

- v8.3 contracts: 4/4
- full automated suite: 327/327
- conversation corpus: 156/156
- JavaScript syntax: 254 files
- state-safety audit: pass
