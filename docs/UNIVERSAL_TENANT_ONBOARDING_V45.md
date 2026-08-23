# Nova v4.5 — Knowledge Ingestion & Universal Tenant Onboarding

## Goal
Onboard a new business or individual by configuration and approved knowledge, without writing a new domain capability.

## 1. Create a tenant
Copy `examples/tenant-spec.example.json`, change the business facts and offerings, then run:

```bash
node scripts/onboard-tenant.js ./my-tenant.json
```

Nova derives the native tenant structure:
- `profile.json`
- `knowledge/business.json`
- `knowledge/faqs.json`
- `offerings/items.json` for service-like offerings
- `booking/config.json` when services are bookable
- `catalog/products.json` for product-like offerings

The generated tenant uses the existing universal assistant, CRM, offering, booking, catalog and commerce engines.

## 2. Ingest additional knowledge
Supported in v4.5: JSON, TXT, Markdown and CSV.

```bash
node scripts/ingest-knowledge.js <tenant-id> ./policy.md
```

CSV is normalized to JSON. Files are copied into the tenant's isolated `knowledge/documents/` directory and become searchable by the v4.4 Knowledge Layer.

## 3. PDF / DOCX / websites
These should enter through extraction adapters, not conversation capabilities. The v4.5 ingestor deliberately rejects unsupported binary formats instead of pretending to understand them. A later ingestion-adapter phase can extract PDF/DOCX/web content into normalized text and feed the same index.

## 4. What onboarding does NOT do
It does not invent missing prices, policies, inventory or availability. Tenant input remains the source of business truth.

It also does not create a new capability for "driving school", "lawyer", "consultant", "coach", etc. A service offering is handled by the universal offering/booking engines; products use catalog/commerce.

## 5. Current boundary
Some truly specialized operational workflows can still require a future schema/plugin (for example medical records, hotel room inventory, or school enrollment documents). The universal onboarding layer should still answer knowledge questions and handle generic bookable offerings without modifying the core.
