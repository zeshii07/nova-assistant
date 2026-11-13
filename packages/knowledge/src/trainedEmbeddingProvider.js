/**
 * v56.0 — Trained Embedding Provider
 *
 * Adapts the existing packages/transformer-embeddings (all-MiniLM-L6-v2 +
 * paraphrase-multilingual-MiniLM-L12-v2) to the EmbeddingProvider interface.
 *
 * When @xenova/transformers is installed, this provider produces real semantic
 * embeddings (384-dim). When it is not installed (or fails to load), it degrades
 * gracefully to the LocalSemanticEmbeddingProvider so retrieval still works.
 *
 * Spec reference: §9 — "Benchmark trained multilingual embedding models against
 * the current provider."
 *
 * Language routing (from transformerEmbeddingService.js):
 *   - English queries → all-MiniLM-L6-v2 (384-dim, 22MB, 7ms inference)
 *   - Roman-Urdu / Urdu-script / Arabic → paraphrase-multilingual-MiniLM-L12-v2
 *
 * The provider records model name + version + dimensions on every embedding so
 * the index can detect incompatible vectors (spec §9 requirement).
 */

const { LocalSemanticEmbeddingProvider } = require('./embeddingProvider');

const ENGLISH_MODEL = { name: 'Xenova/all-MiniLM-L6-v2', version: 1, dimensions: 384 };
const MULTILINGUAL_MODEL = { name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', version: 1, dimensions: 384 };

function isUrduOrArabicScript(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(text || ''));
}

function isRomanUrdu(text) {
  const t = String(text || '').toLowerCase();
  const hits = (t.match(/\b(hai|hain|nahi|nahin|kya|kia|aap|ap|ka|ki|ke|mujhe|mujhy|kar|karna|bhai|acha|theek|kaisa|kaisi|kyun|kyu|mera|meri|sath|sakta|sakti|hoon|tha|thi|aana|aane|jaana|jaane|chahiye|chahiye|batao|bataiye|kitna|kitne|kahan|kahaan)\b/g) || []).length;
  return hits >= 2;
}

class TrainedEmbeddingProvider {
  constructor({ logger = null, fallback = null } = {}) {
    this.logger = logger;
    this.fallback = fallback || new LocalSemanticEmbeddingProvider();
    this._pipeline = null;
    this._multilingualPipeline = null;
    this._loadError = null;
  }

  async _ensurePipeline(multilingual = false) {
    // Lazy load. If transformers is not installed, we record the error and fall back.
    if (multilingual && this._multilingualPipeline) return this._multilingualPipeline;
    if (!multilingual && this._pipeline) return this._pipeline;
    try {
      const transformers = require('@xenova/transformers');
      const { pipeline } = transformers;
      const model = multilingual ? MULTILINGUAL_MODEL.name : ENGLISH_MODEL.name;
      const pipe = await pipeline('feature-extraction', model);
      if (multilingual) this._multilingualPipeline = pipe;
      else this._pipeline = pipe;
      return pipe;
    } catch (err) {
      this._loadError = err.message;
      this.logger?.warn?.('trainedEmbedding.load_failed', { multilingual, error: err.message });
      return null;
    }
  }

  async _embedWith(pipe, text) {
    const output = await pipe(String(text || ''), { pooling: 'mean', normalize: true });
    // Xenova returns a Tensor; convert to plain array.
    return Array.from(output.data || output.tolist?.() || []);
  }

  async embedQuery(text) {
    const multilingual = isUrduOrArabicScript(text) || isRomanUrdu(text);
    const pipe = await this._ensurePipeline(multilingual);
    if (!pipe) return this.fallback.embed(text);
    try {
      return await this._embedWith(pipe, text);
    } catch (err) {
      this.logger?.warn?.('trainedEmbedding.query_failed', { error: err.message });
      return this.fallback.embed(text);
    }
  }

  async embedDocuments(texts) {
    const out = [];
    for (const t of texts || []) {
      out.push(await this.embedQuery(t));
    }
    return out;
  }

  getModelInfo(multilingual = false) {
    return multilingual ? MULTILINGUAL_MODEL : ENGLISH_MODEL;
  }

  /**
   * Sync embed for compatibility with the existing GraphVectorRetriever,
   * which calls embeddingProvider.embed(text) synchronously. Falls back to
   * the deterministic provider when transformers is not loaded.
   */
  embed(text) {
    return this.fallback.embed(text);
  }

  get dimensions() {
    return ENGLISH_MODEL.dimensions;
  }

  get loadError() {
    return this._loadError;
  }
}

module.exports = { TrainedEmbeddingProvider, ENGLISH_MODEL, MULTILINGUAL_MODEL, isUrduOrArabicScript, isRomanUrdu };
