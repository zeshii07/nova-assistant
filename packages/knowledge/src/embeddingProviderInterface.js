/**
 * v56.0 — Embedding Provider Interface
 *
 * The contract that every embedding provider must implement. The bundled
 * LocalSemanticEmbeddingProvider (deterministic, hash-based, 384-dim) is the
 * baseline; the TrainedEmbeddingProvider (all-MiniLM-L6-v2 + multilingual)
 * is the production option.
 *
 * Spec reference: §9 Embedding and multilingual retrieval
 *
 * Contract:
 *   async embedQuery(text)      → number[]
 *   async embedDocuments(texts) → number[][]
 *   getModelInfo()              → { name, version, dimensions }
 *
 * Requirements (spec §9):
 *   - Benchmark trained multilingual models against the current provider.
 *   - Test English, Urdu, and Roman Urdu queries.
 *   - Preserve BM25 as an independent retrieval branch.
 *   - Store embedding model name, version, and dimensions.
 *   - Re-embed documents when the embedding model changes.
 *   - Do not mix vectors from incompatible models in the same index.
 *   - Provide a rollback path.
 */

class EmbeddingProvider {
  async embedQuery(text) { throw new Error('EmbeddingProvider.embedQuery not implemented'); }
  async embedDocuments(texts) { throw new Error('EmbeddingProvider.embedDocuments not implemented'); }
  getModelInfo() { throw new Error('EmbeddingProvider.getModelInfo not implemented'); }
}

module.exports = { EmbeddingProvider };
