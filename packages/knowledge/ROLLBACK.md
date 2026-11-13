# Knowledge Engine v2 — Rollback & Recovery Procedures

**Owner:** Nova Knowledge Layer
**Spec reference:** §10 Migration safeguards, §18 Definition of Done
**Established:** Phase 5 (v58.0)

This document describes how to roll back each phase of the Knowledge Engine v2
upgrade if a regression is detected in production.

## General principle

Every phase is designed to be independently reversible. The single most
important safeguard is that the file-based repository (`FileKnowledgeRepository`)
remains the default storage backend. Phases 1–4 do not touch storage at all;
Phase 5 (Postgres) is opt-in via config.

## Phase 1 — Architecture cleanup (v54.0)

**What changed:** Deleted `packages/knowledge-engine`. Migrated Y1–Y10 tests.

**Rollback:** Not recommended. The deleted package was never wired into the
runtime. If a regression appears, the cause is in the migrated tests, not the
deletion. Restore from git: `git checkout <pre-v54> -- packages/knowledge-engine
tests/sprint50.v50-reply-intelligence.integration.test.js`.

## Phase 2 — Ingestion improvements (v55.0)

**What changed:** Structure-aware chunker replaces naive sentence splitter. Source
versioning + publication states. Validation reports.

**Rollback:**
1. Set `kind: 'default'` and `maxChars: 900` on all sources to restore the old
   chunking behavior (the structure-aware chunker is backward-compatible).
2. Set all source statuses back to `'active'` (the legacy default) via:
   ```sql
   UPDATE knowledge_sources SET status = 'active' WHERE status = 'published';
   ```
3. The FileKnowledgeRepository loader treats `'active'` and `'published'` the
   same, so this is non-disruptive.

## Phase 3 — Retrieval intelligence (v56.0)

**What changed:** IntentRouter, QueryRewriter, EvidenceValidator added. Existing
`expandQuery` patterns moved behind QueryRewriter.

**Rollback:** The components are additive — KnowledgeService still works without
them. To disable intent routing, comment out the IntentRouter call in
KnowledgeService.retrieve and fall back to the existing `kinds: null` retrieval.

## Phase 4 — Answer intelligence (v57.0)

**What changed:** AnswerComposer, ResponseValidator, DecisionEngine added. The
8 hardcoded `groundedAnswer` templates remain as a fallback.

**Rollback:** Disable the AnswerComposer in AssistantService. The existing
`groundedAnswer` + `extractiveAnswer` path still works exactly as before v57.0.

## Phase 5 — Storage and scalability (v58.0)

**What changed:** Optional Postgres + pgvector + Redis backends.

**Rollback (the critical one):**
1. Set `KNOWLEDGE_BACKEND=file` in the API config (or unset `DATABASE_URL`).
2. Restart all API instances.
3. The `PostgresRepository` falls back to `FileKnowledgeRepository` automatically.
4. The file repository is preserved during migration (spec §10 safeguard: "Do
   not delete the old data until the new repository is verified").
5. No data loss: the file-based `tenants/{id}/knowledge/` tree is intact.

**Verification before rollback:**
1. Run the evaluation corpus (`POST /api/dev/knowledge/{id}/evaluate`) against
   the file backend.
2. Compare the answerable rate, recall@5, and conflict rate to the Postgres backend.
3. If they match within tolerance, rollback is safe.

**Recovery from a failed backfill:**
1. The backfill script (`scripts/backfill-knowledge-to-postgres.js`) is
   idempotent — re-running it skips chunks whose content_hash already exists.
2. If the backfill wrote partial data, truncate and re-run:
   ```sql
   TRUNCATE knowledge_embeddings, knowledge_chunks, ingestion_jobs;
   -- Do NOT truncate knowledge_sources; it is the source of truth for versions.
   ```

## Phase 6 — Admin tools (v59.0)

**What changed:** Chunk Explorer, Retrieval Playground, /test endpoint, analytics
events.

**Rollback:** All admin endpoints are additive. Disable the routes in
`apps/api/src/server.js` if needed. The analytics events are write-only; they
do not affect retrieval.

## Cross-instance cache invalidation (Phase 5)

**Scenario:** Redis pub/sub is down; instances serve stale caches.

**Recovery:**
1. Each cache entry has a 5-minute TTL (configurable via `KNOWLEDGE_CACHE_TTL_SECONDS`).
2. Stale reads self-heal on TTL expiry.
3. To force a full flush: `redis-cli --scan --pattern 'nova:knowledge:*' | xargs redis-cli del`
   on every Redis node, then restart API instances.

## Contact

For questions about this rollback procedure, contact the Nova engineering team.
The implementation plan document (`Nova_Knowledge_Engine_v2_Implementation_Plan.docx`)
contains the full phase-by-phase task breakdown and acceptance criteria.
