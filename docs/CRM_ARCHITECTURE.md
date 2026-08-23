# CRM Capability Architecture

CRM stores official tenant-owned customer records. It is intentionally separate from Memory, which stores AI context and temporary preferences.

## Data ownership

- CRM: name, phone, email, lead stage, tags, notes, custom fields, official timeline.
- Memory: summaries, inferred preferences, recent context, TTL-based records.

## Access path

Capabilities receive `context.services.crm`, a permission-scoped facade. They never receive the repository.

## Events

- `crm.customer.created.v1`
- `crm.customer.updated.v1`
- `crm.note.added.v1`
- `crm.tag.added.v1`
- `crm.tag.removed.v1`
- `crm.activity.recorded.v1`

The development repository is in-memory. A PostgreSQL adapter can implement `CrmPort` later without changing capabilities.
