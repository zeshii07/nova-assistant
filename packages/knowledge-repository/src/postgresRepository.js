/**
 * v58.0 — Postgres Knowledge Repository
 *
 * Durable storage for knowledge sources, source versions, chunks, and chunk
 * metadata. Same public interface as FileKnowledgeRepository
 * (getForTenant, getIndexForTenant, search, clearCache) so the container can
 * swap implementations via config.
 *
 * Spec reference: §10 (PostgreSQL), §8 (versioning)
 *
 * Schema (migrations/001_knowledge_schema.sql):
 *   knowledge_sources(tenant_id, source_id, version, kind, title, status, ...)
 *   knowledge_chunks(tenant_id, chunk_id, source_id, source_version, content, ...)
 *   knowledge_embeddings(tenant_id, chunk_id, embedding_model, embedding vector(384))
 *   ingestion_jobs(job_id, tenant_id, status, validation_report, ...)
 *
 * Degradation: when no Postgres client is wired, this repository delegates to
 * the FileKnowledgeRepository so the system keeps running in single-node mode.
 */

const { FileKnowledgeRepository } = require('../../knowledge/src/fileKnowledgeRepository');
const { KnowledgeIndex } = require('../../knowledge/src/knowledgeIndex');

const PUBLISHED_STATUSES = ['published', 'active'];

class PostgresRepository {
  constructor({ pgClient = null, tenantsDir = null, knowledgeDataDir = null, logger = null } = {}) {
    this.pgClient = pgClient; // a node-postgres Pool or compatible client
    this.logger = logger;
    // Fallback to the file repository when Postgres is not configured.
    this.fallback = (tenantsDir)
      ? new FileKnowledgeRepository({ tenantsDir, knowledgeDataDir, logger })
      : null;
    this.cache = new Map(); // tenantId → { public, index }
  }

  /**
   * Get all retrievable knowledge for a tenant (published + active, not expired).
   */
  async getForTenant(tenantId) {
    if (!this.pgClient) return this.fallback?.getForTenant(tenantId) || { business: {}, faqs: [], sources: [], documentCount: 0 };
    if (this.cache.has(tenantId)) return structuredClone(this.cache.get(tenantId).public);
    const result = await this._loadFromPostgres(tenantId);
    this.cache.set(tenantId, result);
    return structuredClone(result.public);
  }

  async getIndexForTenant(tenantId) {
    if (!this.pgClient) return this.fallback?.getIndexForTenant(tenantId);
    if (this.cache.has(tenantId)) return this.cache.get(tenantId).index;
    const result = await this._loadFromPostgres(tenantId);
    this.cache.set(tenantId, result);
    return result.index;
  }

  async search(tenantId, query, options) {
    const index = await this.getIndexForTenant(tenantId);
    return index.search(query, options);
  }

  clearCache(tenantId) {
    this.cache.delete(tenantId);
    this.fallback?.clearCache?.(tenantId);
  }

  async _loadFromPostgres(tenantId) {
    // Query published + active chunks for this tenant, joined to sources.
    const sql = `
      SELECT c.chunk_id, c.content, c.knowledge_type, c.language, c.parent_heading,
             c.customer_safe, c.source_id, c.source_version, s.kind AS source_kind,
             s.status AS source_status, s.priority, s.title AS source_title,
             s.effective_from, s.effective_until
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON c.tenant_id = s.tenant_id
        AND c.source_id = s.source_id AND c.source_version = s.version
      WHERE c.tenant_id = $1 AND s.status = ANY($2)
    `;
    const now = new Date();
    const res = await this.pgClient.query(sql, [tenantId, PUBLISHED_STATUSES]);
    const docs = res.rows
      .filter(r => {
        if (r.effective_until) {
          const u = new Date(r.effective_until);
          if (!isNaN(u.getTime()) && u < now) return false;
        }
        if (r.effective_from) {
          const f = new Date(r.effective_from);
          if (!isNaN(f.getTime()) && f > now) return false;
        }
        return true;
      })
      .map(r => ({
        id: r.chunk_id, source: r.source_id, text: r.content,
        evidenceType: r.knowledge_type, language: r.language,
        heading: r.parent_heading, customerSafe: r.customer_safe,
        sourceId: r.source_id, sourceKind: r.source_kind,
        sourceStatus: r.source_status, sourceRevision: r.source_version,
        sourceVersion: r.source_version, priority: r.priority,
        sourceTitle: r.source_title,
      }));
    const index = new KnowledgeIndex(docs);
    return { public: { documentCount: docs.length }, index };
  }

  /**
   * Insert a chunk (used by ingestion workers).
   */
  async insertChunk({ tenantId, chunkId, sourceId, sourceVersion, content, knowledgeType, language, parentHeading, customerSafe = true, metadata = {} }) {
    if (!this.pgClient) throw new Error('Postgres client not configured');
    const sql = `
      INSERT INTO knowledge_chunks (tenant_id, chunk_id, source_id, source_version, content, knowledge_type, language, parent_heading, customer_safe, metadata_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, chunk_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
    `;
    await this.pgClient.query(sql, [tenantId, chunkId, sourceId, sourceVersion, content, knowledgeType, language, parentHeading, customerSafe, JSON.stringify(metadata)]);
  }

  async insertEmbedding({ tenantId, chunkId, embeddingModel, embedding }) {
    if (!this.pgClient) throw new Error('Postgres client not configured');
    const sql = `
      INSERT INTO knowledge_embeddings (tenant_id, chunk_id, embedding_model, embedding)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, chunk_id, embedding_model) DO UPDATE SET embedding = EXCLUDED.embedding
    `;
    // pgvector accepts a string like '[0.1,0.2,...]'
    const vecStr = `[${(embedding || []).join(',')}]`;
    await this.pgClient.query(sql, [tenantId, chunkId, embeddingModel, vecStr]);
  }

  /**
   * Record an ingestion job's status + validation report.
   */
  async recordIngestionJob({ jobId, tenantId, sourceId, fileName, status, validationReport = null }) {
    if (!this.pgClient) return;
    const sql = `
      INSERT INTO ingestion_jobs (job_id, tenant_id, source_id, file_name, status, validation_report)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, validation_report = EXCLUDED.validation_report, completed_at = CASE WHEN EXCLUDED.status IN ('completed','failed') THEN now() ELSE ingestion_jobs.completed_at END
    `;
    await this.pgClient.query(sql, [jobId, tenantId, sourceId, fileName, status, JSON.stringify(validationReport)]);
  }

  async getIngestionJob(jobId) {
    if (!this.pgClient) return null;
    const res = await this.pgClient.query('SELECT * FROM ingestion_jobs WHERE job_id = $1', [jobId]);
    return res.rows[0] || null;
  }
}

module.exports = { PostgresRepository, PUBLISHED_STATUSES };
