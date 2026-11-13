# Knowledge Source Authority Rules

**Owner:** Nova Knowledge Layer (packages/knowledge, packages/knowledge-platform)
**Spec reference:** §5 Knowledge authority and source-of-truth rules
**Established:** Phase 1 architecture cleanup (v54.0)

Nova answers customer questions from multiple sources. Not every source is equally
trusted. This document defines the authority model that the retrieval pipeline
enforces, and the rules that govern which source wins when two disagree.

## Authority priority (highest to lowest)

| Priority | Source | Examples |
|---|---|---|
| 1 | Live transactional system | Prices, stock, bookings, availability, order status |
| 2 | Tenant-managed structured configuration | Business hours, contact details, configured policies |
| 3 | Approved tenant knowledge (uploaded) | Uploaded policies, FAQs, procedures, service documents |
| 4 | Approved platform baseline | Packaged business templates and default content |
| 5 | General model knowledge | General conversational information only, never tenant-specific facts |

## Rules

1. **Authority is domain-specific.** Pricing must come from the pricing system,
   not from a PDF. Availability must come from the availability system. The
   knowledge layer retrieves descriptive information (FAQs, policies, service
   descriptions) — it does not replace transactional database queries.

2. **A newer approved tenant policy may supersede an older policy.** The source
   registry tracks `supersedes` relationships; only the latest published version
   is loaded by the retriever.

3. **A disabled or expired source must not be used as current evidence.** The
   loader (FileKnowledgeRepository) skips any source whose status is `disabled`
   or whose `effectiveUntil` is in the past.

4. **A source's priority must not override access permissions or validity
   dates.** A high-priority source that is disabled, expired, or unauthorized
   must not win. The loader enforces status + validity before priority.

5. **If two authoritative sources conflict and the conflict cannot be resolved
   safely, ask for clarification or escalate.** KnowledgeService.detectConflict
   compares fact signatures for sensitive topics (refund, cancel, parking,
   payment, same-day). A detected conflict sets `answerable=false` and the
   assistant abstains rather than guessing.

6. **Keep a record of which source version supported each answer.** Every
   retrieval result carries `sourceId`, `sourceRevision`, `sourceStatus`,
   `sourceKind`, and `sourceTitle`. The Phase 4 CitationBuilder attaches these
   to factual claims in the structured internal result.

## Enforcement points

- **Loader:** `FileKnowledgeRepository.#load` (packages/knowledge/src/fileKnowledgeRepository.js)
  skips disabled files before building the index.
- **Enrichment:** the `enrich()` helper attaches source authority metadata to
  every chunk: `sourceId`, `sourceKind`, `sourceRevision`, `sourceStatus`,
  `priority`, `sourceTitle`.
- **Authority resolution:** `KnowledgeService.applyAuthority` gives
  tenant-managed sources (sourceId starts with `KS-`) a 20-point boost over
  packaged baselines for the same policy topic.
- **Conflict detection:** `KnowledgeService.detectConflict` compares fact
  signatures across the top matches for sensitive topics.
- **Evidence completeness:** `KnowledgeService.evidenceComplete` is a 60-line
  rule set that knows the difference between "we have cleaners" and "we have 12
  cleaners" — the latter requires a literal count in the matched chunk.

## The single retrieval path (Phase 1)

There is exactly one authoritative retrieval path:

```
AssistantService
  → KnowledgeService.retrieve / KnowledgeService.answer
    → FileKnowledgeRepository.search
      → KnowledgeIndex.search
        → BM25Retriever + GraphVectorRetriever
          → reciprocalRankFusion
            → EvidenceReranker
              → applyAuthority + detectConflict + evidenceComplete
                → answerable gate
```

The duplicate `packages/knowledge-engine` (Phase 3 KnowledgeEngine) was deleted
in v54.0. It was never wired into the runtime; only test Y1–Y10 imported it.
Those tests were migrated to `tests/sprint54.v54-knowledge-unified-path.regression.test.js`
(Group Z3) and now exercise KnowledgeService against the same tenant fixtures.
