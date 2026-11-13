/**
 * v58.0 — Vector Repository
 *
 * pgvector-backed semantic search. Replaces the in-memory brute-force cosine
 * scan in GraphVectorRetriever when Postgres + pgvector are available.
 *
 * Spec reference: §9, §10
 *
 * Degradation: when no pgclient is wired, falls back to the existing
 * LocalSemanticEmbeddingProvider brute-force scan (already in GraphVectorRetriever).
 */

class VectorRepository {
  constructor({ pgClient = null, embeddingProvider = null, dimensions = 384, logger = null } = {}) {
    this.pgClient = pgClient;
    this.embeddingProvider = embeddingProvider;
    this.dimensions = dimensions;
    this.logger = logger;
  }

  /**
   * Search for chunks whose embedding is closest to the query embedding.
   *
   * @param {object} params
   *   - tenantId
   *   - queryEmbedding: number[] (already embedded by the caller)
   *   - limit
   *   - embeddingModel: filter to embeddings from this model (spec §9: never mix)
   *   - kinds: optional source-kind filter
   * @returns {Array<{ chunkId, sourceId, score, text }>}
   */
  async search({ tenantId, queryEmbedding, limit = 12, embeddingModel = null, kinds = null } = {}) {
    if (!this.pgClient) return []; // caller falls back to GraphVectorRetriever
    const vecStr = `[${(queryEmbedding || []).join(',')}]`;
    let sql = `
      SELECT e.chunk_id, c.source_id, c.content, c.knowledge_type,
             1 - (e.embedding <=> $1::vector) AS score
      FROM knowledge_embeddings e
      JOIN knowledge_chunks c ON e.tenant_id = c.tenant_id AND e.chunk_id = c.chunk_id
      WHERE e.tenant_id = $2
    `;
    const params = [vecStr, tenantId];
    if (embeddingModel) {
      params.push(embeddingModel);
      sql += ` AND e.embedding_model = $${params.length}`;
    }
    if (kinds && kinds.length) {
      params.push(kinds);
      sql += ` AND c.knowledge_type = ANY($${params.length})`;
    }
    sql += ` ORDER BY e.embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);
    const res = await this.pgClient.query(sql, params);
    return res.rows.map(r => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      text: r.content,
      knowledgeType: r.knowledge_type,
      score: Number(r.score),
    }));
  }

  /**
   * Store an embedding for a chunk. Re-embeds (overwrites) when the model changes.
   */
  async storeEmbedding({ tenantId, chunkId, embeddingModel, embedding }) {
    if (!this.pgClient) return;
    const vecStr = `[${(embedding || []).join(',')}]`;
    const sql = `
      INSERT INTO knowledge_embeddings (tenant_id, chunk_id, embedding_model, embedding)
      VALUES ($1, $2, $3, $4::vector)
      ON CONFLICT (tenant_id, chunk_id, embedding_model) DO UPDATE SET embedding = EXCLUDED.embedding
    `;
    await this.pgClient.query(sql, [tenantId, chunkId, embeddingModel, vecStr]);
  }

  /**
   * Detect incompatible vectors: chunks whose embedding_model differs from the
   * currently-configured model. Spec §9: "Do not mix vectors from incompatible
   * models in the same index."
   */
  async listIncompatibleEmbeddings(tenantId, currentModel) {
    if (!this.pgClient) return [];
    const res = await this.pgClient.query(
      'SELECT DISTINCT embedding_model FROM knowledge_embeddings WHERE tenant_id = $1 AND embedding_model <> $2',
      [tenantId, currentModel]
    );
    return res.rows.map(r => r.embedding_model);
  }
}

module.exports = { VectorRepository };
