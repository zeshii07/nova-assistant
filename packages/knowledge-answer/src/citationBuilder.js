/**
 * v57.0 — Citation Builder
 *
 * Attaches internal evidence IDs to factual claims in the structured internal
 * result. Citations are NEVER shown to the customer (spec §4 Step 9) but are
 * retained for audit and for the ResponseValidator.
 *
 * Spec reference: §4 Step 9, §12
 *
 * Output shape per claim:
 *   { text, evidenceIds: [chunkId, ...], sourceIds: [sourceId, ...], versions: [n, ...] }
 */

class CitationBuilder {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Attach citations to an array of claims.
   *
   * @param {Array<{text, evidenceIds}>} claims — from the AnswerComposer
   * @param {Array<{sourceId, chunkId, version}>} evidence — full evidence set
   * @returns {Array<{text, evidenceIds, sourceIds, versions}>}
   */
  attach(claims, evidence = []) {
    const evidenceByChunkId = new Map();
    for (const e of evidence) {
      if (e.chunkId) evidenceByChunkId.set(e.chunkId, e);
    }
    return (claims || []).map(claim => {
      const cited = (claim.evidenceIds || [])
        .map(id => evidenceByChunkId.get(id))
        .filter(Boolean);
      return {
        text: claim.text,
        evidenceIds: claim.evidenceIds || [],
        sourceIds: cited.map(e => e.sourceId).filter(Boolean),
        versions: cited.map(e => e.version).filter(v => v != null),
      };
    });
  }

  /**
   * Build a citation-only summary for audit logging (never customer-facing).
   */
  summarize(claims) {
    return (claims || []).map((c, i) => ({
      claimIndex: i,
      evidenceIds: c.evidenceIds || [],
      sourceIds: c.sourceIds || [],
    }));
  }
}

module.exports = { CitationBuilder };
