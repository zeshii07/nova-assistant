# Catalog Capability Architecture

Catalog is the only source of truth for tenant products, aliases, valid variants, prices, currency, stock state, and inventory metadata.

## Boundaries

- `catalog-sdk` defines stable records and repository contracts.
- `catalog-engine` loads tenant data and performs deterministic search and validation.
- `capabilities/catalog` provides the conversational interface.
- Booking and checkout are intentionally excluded and will consume the Catalog SDK later.
- LLM output is not used to create or select products.

## Data flow

Channel → Execution Engine → Capability Router → Catalog Capability → scoped Catalog Service → tenant repository → deterministic matcher → validated response.

## Isolation

Catalog files live under `tenants/<tenantId>/catalog/`. A capability receives only a tenant-scoped facade and cannot select another tenant ID.
