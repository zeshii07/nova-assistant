# Nova Universal Semantic Layer (v2.5)

Nova no longer treats Retail as the definition of conversation intelligence.

## Separation of responsibility

1. **Universal Semantic Engine** detects domain-neutral acts: greeting, question, action request, correction, cancellation, alternatives, dates, time windows and generic quantities.
2. **Domain Schema Registry** declares concepts/actions for a reusable domain (Retail, Cleaning, Healthcare, Education, or Universal).
3. **Capability conversation adapters** map domain semantics to executable capability intents.
4. **Tenant Knowledge** supplies business-specific facts. It must not redefine the core conversation engine.
5. **LLM Interpreter** is a low-confidence semantic fallback only. Backend capabilities remain authoritative for products, services, prices, availability and writes.

## Adding a new domain

Create `domains/<domain>/schema.json`, then implement only the capabilities that can execute its actions. Do not add niche vocabulary to the universal engine.

## Future Knowledge Ingestion

The next Knowledge milestone can ingest TXT/PDF/DOCX/CSV/XLSX into tenant-scoped approved knowledge, propose domain mappings/entities, and require validation before actionable facts become authoritative.
