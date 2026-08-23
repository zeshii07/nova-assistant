# Nova Knowledge Platform v5

## Purpose

v5 makes tenant knowledge a managed platform layer instead of a collection of files that developers edit manually.

The central rule is:

**Structured operational truth is not retrieval text.**

Products, services, inventory, pricing, booking rules and availability remain structured and are owned by the deterministic engines.

Policies, FAQs, descriptions, terminology and business information are informational knowledge and may be retrieved for conversational answers.

## Architecture

```text
Tenant
├── Operational Knowledge
│   ├── catalog/products.json
│   ├── offerings/items.json
│   ├── pricing/services.json
│   ├── availability/services.json
│   └── booking/config.json
│
└── Informational Knowledge
    ├── knowledge/business.json
    ├── knowledge/faqs.json
    ├── knowledge/documents/*
    └── knowledge/sources.json
```

The Conversation/Action engines continue to own transactions. The Knowledge Layer never invents or overrides inventory, prices, booking availability or order totals.

## Source Registry

Every managed informational source can be represented in `knowledge/sources.json` with:

- `id`
- `kind`
- `title`
- `file`
- `status`
- `priority`
- `tags`
- `metadata`
- `createdAt`
- `updatedAt`

Retrieval results now carry provenance fields such as `sourceId`, `sourceKind`, `sourceTitle`, `priority`, `path`, semantic score and final score.

Disabled sources are excluded from indexing. Priority is a small tie-breaker; relevance still controls retrieval.

## Developer Knowledge Manager

Open:

```text
http://localhost:3000/developer
```

Then choose **Knowledge Manager**.

For the selected tenant you can:

- inspect business profile and operational counts
- inspect registered sources
- add/update a business fact
- add an FAQ
- add an informational document
- load TXT, Markdown, CSV or JSON informational files
- remove managed document/FAQ sources
- re-index knowledge
- test retrieval and inspect provenance before testing the conversation

If an uploaded JSON looks like structured products/services, the UI tells you to use Onboarding Studio instead.

## APIs

```text
GET    /api/dev/knowledge/:tenant
POST   /api/dev/knowledge/:tenant/documents
POST   /api/dev/knowledge/:tenant/faqs
POST   /api/dev/knowledge/:tenant/facts
POST   /api/dev/knowledge/:tenant/search
POST   /api/dev/knowledge/:tenant/reindex
DELETE /api/dev/knowledge/:tenant/sources/:sourceId
```

Developer API authorization follows the existing `NOVA_DEV_TOKEN` behavior.

## Ingestion boundary

v5 supports informational text content in:

- TXT
- Markdown
- CSV
- JSON

Structured JSON/CSV containing products/services belongs in Onboarding Studio so it becomes native operational data.

PDF, DOCX, XLSX and website ingestion should use extraction adapters that convert source material into normalized operational records or informational text before it enters these same v5 managers. That is an adapter problem, not a Conversation Engine change.

## Future retrieval

`KnowledgeIndex` remains deliberately provider-independent. The current lexical/semantic-ish index can later be supplemented/replaced with:

- embeddings/vector retrieval
- hybrid lexical + vector search
- reranking
- external vector databases

without changing Catalog, Commerce, Booking, Pricing or CRM behavior.

## v5.0.1 knowledge-routing hardening

- Markdown ingestion is section-aware: headings stay attached to their body/bullets.
- Managed informational documents may preempt domain action engines for genuine information questions.
- Operational/business-profile knowledge does not preempt Catalog, Offering, Booking or Cleaning workflows.
- Active Commerce/Booking/Cleaning workflows can be temporarily interrupted by business/policy questions and then resumed.
- Retrieval uses a stronger confidence threshold and ambiguity margin instead of answering from any weak match.
- Unknown facts should abstain rather than route to an unrelated service list.
