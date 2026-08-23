# Sprint 3.5 Memory Architecture

## Purpose

State answers “what is happening in this conversation?” Memory answers “what useful, approved information should persist across conversations?”

## Boundaries

- `state-engine` remains temporary workflow state.
- `memory-sdk` defines records and the repository port.
- `memory-engine` enforces tenant, customer, capability namespace, scope, TTL, and permissions.
- Capabilities receive a scoped facade as `context.services.memory`.
- Capabilities never receive the raw repository or arbitrary tenant identifiers.

## Scopes

- `conversation`: temporary information tied to one conversation ID.
- `customer`: long-lived preferences, history, and summaries for one customer.
- `tenant`: tenant-wide capability memory.

## Namespacing

Every record belongs to one capability namespace. The assistant cannot read catalog memory unless explicitly given a cross-capability service in a future governed design.

## Security

Tenant permissions support scoped grants:

- `memory.read:assistant`
- `memory.write:assistant`
- `memory.delete:assistant`

Wildcards and broad permissions are supported by the permission service, but scoped grants are recommended.

## Events

- `memory.written.v1`
- `memory.deleted.v1`

Events contain identifiers and metadata, not the stored value.

## Production migration

Sprint 3.5 uses an in-memory repository. A PostgreSQL or Redis-backed repository can replace it through `MemoryPort` without changing capabilities or the execution engine.
