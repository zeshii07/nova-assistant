/** Expands tenant-defined synonyms while preserving original words. */
class SynonymService {
  expand(tokens, synonyms = {}) {
    const output = new Set(tokens);
    for (const token of tokens) {
      const canonical = findCanonical(token, synonyms);
      if (canonical) output.add(canonical);
      for (const synonym of synonyms[token] || []) output.add(normalizeToken(synonym));
    }
    return [...output].filter(Boolean);
  }
}
function findCanonical(token, synonyms) {
  if (Object.prototype.hasOwnProperty.call(synonyms, token)) return token;
  for (const [canonical, aliases] of Object.entries(synonyms)) {
    if ((aliases || []).map(normalizeToken).includes(token)) return normalizeToken(canonical);
  }
  return null;
}
function normalizeToken(value) { return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
module.exports = { SynonymService };
