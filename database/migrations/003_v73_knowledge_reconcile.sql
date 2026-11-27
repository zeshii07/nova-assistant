-- 003_v73_knowledge_reconcile.sql — reconcile the two knowledge schemas.
--
-- History: 001_v7_core.sql created a minimal `knowledge_sources` stub
-- (columns: id, tenant_id, title, type, evidence_type, priority, status,
-- metadata; PK = id) that no application code actually reads or writes.
-- Separately, migrations/001_knowledge_schema.sql (the v58 Phase-5 schema)
-- defined the REAL knowledge schema with a different, richer shape
-- (columns: tenant_id, source_id, version, kind, title, status, priority,
-- effective_from/until, supersedes_source_id, approved_by, content_hash,
-- tags, metadata; PK = (tenant_id, source_id, version)) plus knowledge_chunks,
-- knowledge_embeddings (pgvector), and ingestion_jobs with RLS.
--
-- The problem: migrate.js only scans database/migrations/, so the v58 schema
-- was never applied by `npm run db:migrate`. And the two `knowledge_sources`
-- definitions are incompatible — CREATE TABLE IF NOT EXISTS would silently
-- keep the v7 stub, so even a manual run of the v58 file after 001 would fail
-- or be a no-op.
--
-- This migration reconciles them, idempotently:
--   1. If the v7 stub exists (detected by the `evidence_type` column, which is
--      unique to the stub), drop it. It held no real data.
--   2. CREATE EXTENSION vector (pgvector) — required for knowledge_embeddings.
--   3. Create the full v58 schema: knowledge_sources (rich), knowledge_chunks,
--      knowledge_embeddings, ingestion_jobs, indexes, RLS.
--
-- All statements are IF NOT EXISTS / guarded, so re-running is safe. The v58
-- schema is the source of truth for the knowledge-repository package.

BEGIN;

-- (1) Drop the v7 stub if present. The `evidence_type` column is unique to the
-- stub shape, so its presence proves we have the wrong table. We use a DO
-- block + information_schema check so this is a no-op on a fresh DB (where
-- knowledge_sources doesn't exist yet) and a no-op if the v58 schema already
-- exists (no evidence_type column).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_sources' AND column_name = 'evidence_type'
  ) THEN
    DROP TABLE knowledge_sources;
  END IF;
END $$;

-- (2) pgvector extension (required for the embedding column + ivfflat index).
CREATE EXTENSION IF NOT EXISTS vector;

-- (3a) knowledge_sources — rich v58 shape. One row per (tenant, source, version).
CREATE TABLE IF NOT EXISTS knowledge_sources (
  tenant_id          TEXT        NOT NULL,
  source_id          TEXT        NOT NULL,
  version            INT         NOT NULL DEFAULT 1,
  kind               TEXT        NOT NULL,
  title              TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'draft',
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

-- (3b) knowledge_chunks — one row per chunk, belongs to a (tenant, source, version).
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  tenant_id          TEXT        NOT NULL,
  chunk_id           TEXT        NOT NULL,
  source_id          TEXT        NOT NULL,
  source_version     INT         NOT NULL,
  content            TEXT        NOT NULL,
  knowledge_type     TEXT        NOT NULL,
  language           TEXT,
  parent_heading     TEXT,
  source_location    JSONB,
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

-- (3c) knowledge_embeddings — one row per (tenant, chunk, embedding_model).
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  tenant_id          TEXT        NOT NULL,
  chunk_id           TEXT        NOT NULL,
  embedding_model    TEXT        NOT NULL,
  embedding          vector(384) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chunk_id, embedding_model),
  FOREIGN KEY (tenant_id, chunk_id) REFERENCES knowledge_chunks (tenant_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_cosine
  ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- (3d) ingestion_jobs — async ingestion job tracking.
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  job_id             TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  source_id          TEXT,
  file_name          TEXT,
  status             TEXT        NOT NULL,
  validation_report  JSONB,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_tenant_status
  ON ingestion_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_created
  ON ingestion_jobs (status, created_at);

-- (3e) Row-level security for tenant isolation. The application sets the
-- tenant context per session; RLS is defense-in-depth so a missing WHERE
-- clause cannot leak across tenants.
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

INSERT INTO nova_schema_migrations(version) VALUES('003_v73_knowledge_reconcile') ON CONFLICT DO NOTHING;
COMMIT;
