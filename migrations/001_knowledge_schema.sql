-- Nova Knowledge Engine v2 — Phase 5 Schema
-- migrations/001_knowledge_schema.sql
--
-- ⚠️  SUPERSEDED (v73.0): this schema is now applied via
-- database/migrations/003_v73_knowledge_reconcile.sql, which `npm run
-- db:migrate` picks up automatically (this file's directory is NOT scanned by
-- migrate.js). This file is kept for historical reference + manual `psql -f`
-- application on pre-v73 databases. Do NOT run both — 003 reconciles the
-- table-name collision with 001_v7_core.sql's knowledge_sources stub.
--
-- Spec reference: §10 Storage and scalability
--
-- This migration creates the durable knowledge schema in PostgreSQL. It is
-- idempotent (uses CREATE TABLE IF NOT EXISTS). Apply with:
--   psql "$DATABASE_URL" -f migrations/001_knowledge_schema.sql
--
-- Prerequisite: pgvector extension must be installed.
--   CREATE EXTENSION IF NOT EXISTS vector;

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── knowledge_sources ────────────────────────────────────────────────────
-- One row per (tenant, source, version). Version history is preserved by
-- keeping superseded rows with status = 'archived'.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  tenant_id          TEXT        NOT NULL,
  source_id          TEXT        NOT NULL,
  version            INT         NOT NULL DEFAULT 1,
  kind               TEXT        NOT NULL,           -- document | faq_collection | business_profile
  title              TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'draft',  -- draft|processing|published|disabled|archived|failed
  priority           INT         NOT NULL DEFAULT 50,
  effective_from     TIMESTAMPTZ,
  effective_until    TIMESTAMPTZ,
  supersedes_source_id TEXT,
  approved_by        TEXT,
  content_hash       TEXT,
  tags               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_id, version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_tenant_status
  ON knowledge_sources (tenant_id, status);

-- ─── knowledge_chunks ─────────────────────────────────────────────────────
-- One row per chunk. A chunk belongs to exactly one (tenant, source, version).
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  tenant_id          TEXT        NOT NULL,
  chunk_id           TEXT        NOT NULL,
  source_id          TEXT        NOT NULL,
  source_version     INT         NOT NULL,
  content            TEXT        NOT NULL,
  knowledge_type     TEXT        NOT NULL,           -- customer_policy | customer_fact | faq | internal_instruction
  language           TEXT,
  parent_heading     TEXT,
  source_location    JSONB,                            -- { page, lineStart, lineEnd }
  customer_safe      BOOLEAN     NOT NULL DEFAULT true,
  metadata_json      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chunk_id),
  FOREIGN KEY (tenant_id, source_id, source_version) REFERENCES knowledge_sources (tenant_id, source_id, version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_source
  ON knowledge_chunks (tenant_id, source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_type
  ON knowledge_chunks (tenant_id, knowledge_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_safe
  ON knowledge_chunks (tenant_id, customer_safe);

-- ─── knowledge_embeddings ─────────────────────────────────────────────────
-- One row per (tenant, chunk, embedding_model). Multiple models can coexist
-- (spec §9 allows re-embedding when the model changes); the retriever filters
-- by embedding_model to never mix incompatible vectors.
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  tenant_id          TEXT        NOT NULL,
  chunk_id           TEXT        NOT NULL,
  embedding_model    TEXT        NOT NULL,
  embedding          vector(384) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chunk_id, embedding_model),
  FOREIGN KEY (tenant_id, chunk_id) REFERENCES knowledge_chunks (tenant_id, chunk_id)
);

-- ivfflat index for fast cosine similarity search.
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_cosine
  ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─── ingestion_jobs ───────────────────────────────────────────────────────
-- Tracks async ingestion jobs (Phase 2 T2.9). Workers poll by status.
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  job_id             TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  source_id          TEXT,
  file_name          TEXT,
  status             TEXT        NOT NULL,           -- queued|processing|completed|failed
  validation_report  JSONB,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_tenant_status
  ON ingestion_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_created
  ON ingestion_jobs (status, created_at);

-- ─── Row-level security (tenant isolation, spec §11) ──────────────────────
-- Enable RLS so a misconfigured query cannot leak across tenants even if the
-- WHERE clause is missing. The application sets the tenant context per session.
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- Example policy (uncomment + adapt to your session-variable convention):
-- CREATE POLICY tenant_isolation_sources ON knowledge_sources
--   USING (tenant_id = current_setting('app.tenant_id', true));
-- CREATE POLICY tenant_isolation_chunks ON knowledge_chunks
--   USING (tenant_id = current_setting('app.tenant_id', true));
-- CREATE POLICY tenant_isolation_embeddings ON knowledge_embeddings
--   USING (tenant_id = current_setting('app.tenant_id', true));
-- CREATE POLICY tenant_isolation_jobs ON ingestion_jobs
--   USING (tenant_id = current_setting('app.tenant_id', true));
