# Nova v8.0 — Persistent Business Knowledge + Memory Intelligence

## Principle

Nova separates three kinds of truth:

1. **Operational truth** — products, prices, stock, carts, orders, services, booking configuration, availability and customer-detail validation. Deterministic engines own this.
2. **Business knowledge** — approved tenant documents, policies, FAQs, procedures and descriptive information.
3. **Customer memory** — tenant-scoped CRM facts used for continuity/personalization, never as business policy evidence.

Knowledge or memory can never overwrite operational truth.

## Knowledge ingestion

Knowledge Manager supports:
- TXT
- Markdown
- PDF
- CSV
- JSON informational documents

PDF text extraction is performed by Nova's bundled native text-PDF parser. The original PDF is preserved under `knowledge/originals/`, while extracted customer-safe text is indexed under `knowledge/documents/`. Image-only/scanned PDFs require OCR and are rejected rather than guessed.

## Source lifecycle

Every knowledge source has:
- tenant scope
- source ID
- title
- kind
- status
- priority
- revision
- tags
- metadata
- content hash
- created/updated timestamps

Updating content increments the revision. Disabled documents are excluded from the retrieval index.

## Retrieval safety

The existing BM25 + graph/vector + RRF + evidence reranking pipeline remains.

v8 adds:
- placeholder structured facts excluded as evidence
- authority-aware conflict resolution
- equal-authority conflicting policies cause abstention
- higher-authority structured truth can win over stale lower-priority documents
- tenant isolation is mandatory
- internal assistant instructions remain filtered from customer evidence

## Memory bridge

Grounded LLM wording may receive a minimal safe customer context:
- name
- preferred language
- city
- last order ID

Phone numbers, addresses, emails and arbitrary CRM custom fields are not placed into the business-knowledge prompt.

Customer memory is personalization context only. It is never evidence for prices, policies, stock, availability, or business claims.

## Developer Console

Knowledge Manager now supports direct file upload for TXT/MD/PDF/CSV/JSON, source revision display, enable/disable, search and re-index.

## Benchmarks

- v8 knowledge/memory contracts: 6/6
- complete automated test suite: see release output
- conversation corpus: 156/156
- syntax check and state-safety audit required before release
