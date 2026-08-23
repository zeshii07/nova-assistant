# Nova v8.4 — Unified Stability

Nova v8.4 merges the later native-PDF and catalog subject-reset hotfix onto the complete v8.3 line. It keeps every v8.2/v8.3 guarantee while removing the split release lineage.

## Preserved from v8.2 and v8.3

- Central customer-data synchronization and transaction visibility
- Service identity integrity and mixed social/task routing
- Local durable development storage with tenant isolation
- Knowledge-source idempotency by tenant and content hash
- Catalog noun-phrase normalization and identity-modifier precision

## Native PDF ingestion

`pdf-parse` is now the preferred parser and installs through ordinary `npm install`. No Poppler, `pdftotext`, Python, or host-level binary is required.

Nova retains its deterministic built-in text-PDF parser as a fallback. Original PDFs are preserved under the tenant's knowledge originals directory. Image-only/scanned PDFs fail safely with an OCR-required message.

PDF ingestion is asynchronous throughout the API, Knowledge Manager, CLI, and tests.

## Catalog subject reset

A fresh product, category, or family request clears incompatible stale browse state and goal candidates.

- Footwear browse → `I want a large shirt` returns only the shirt family.
- `not shoes but I want shirts` cannot be stolen by the old footwear goal.
- `t-shirt or polo shirt` is treated as family discovery, not an accidental multi-add.
- Attribute-only replies such as `black 42` still continue the selected product.

Unsupported styles remain precise: `old style bags` is reported unavailable and real in-stock bag alternatives are offered without silently selecting one.

## Release gate

Run:

```bash
npm run benchmark:v8.4
```

Verified release results:

- v8.4 blockers: 5/5
- Complete automated suite: 332/332
- Conversation corpus: 156/156
- JavaScript syntax: 255 files
- State-safety audit: pass
