/** Creates the stable search result returned by CatalogService. */
function createSearchResult(input = {}) {
  return Object.freeze({
    query: String(input.query || ""),
    product: input.product || null,
    score: Number(input.score || 0),
    confidence: Number(input.confidence || 0),
    matchedTerms: Object.freeze([...(input.matchedTerms || [])]),
    attributes: Object.freeze({ ...(input.attributes || {}) }),
    alternatives: Object.freeze([...(input.alternatives || [])])
  });
}
module.exports = { createSearchResult };
