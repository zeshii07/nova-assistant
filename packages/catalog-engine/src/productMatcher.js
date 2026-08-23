const { createSearchResult } = require("../../catalog-sdk/src/searchResult");
const { normalizeCatalogText, levenshtein } = require("./attributeExtractor");
const { canonicalize } = require("../../universal-vocabulary/src");

/** Deterministic whole-word product matcher. It never invents catalog records. */
class ProductMatcher {
  constructor({ synonymService, attributeExtractor }) { Object.assign(this, { synonymService, attributeExtractor }); }
  search(query, products, synonyms = {}) {
    const canonical = canonicalize(query);
    const attributeText = normalizeCatalogText(canonical);
    const focused = focusPositiveCatalogIntent(canonical);
    const normalized = normalizeCatalogText(focused);
    const rawTokens = meaningfulTokens(normalized);
    const expandedTokens = this.synonymService.expand(rawTokens, synonyms);
    const scored = products.filter((product) => product.inStock).map((product) => this.#score(normalized, expandedTokens, product)).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
    const winner = scored[0];
    // Precision-first catalog rule: a nearby catalog item is NOT an acceptable
    // substitute for a requested product. If the query contains meaningful
    // product-defining terms that the winner cannot support, return no product.
    // Example: "fountain pen" must never resolve to "Gel Pen Pack" merely
    // because both contain the word "pen".
    if (!winner || winner.score < 24 || winner.productTokenMatches < 1 || hasIdentityConflict(normalized, winner.product)) {
      // Exact resolution failed. Recommendation candidates are intentionally
      // more permissive than identity resolution: a fountain pen may suggest
      // Gel Pen Pack, or a plastic bottle may suggest Steel Water Bottle, but
      // these are NEVER promoted to `product` until the customer chooses them.
      return createSearchResult({
        query: normalized,
        alternatives: scored
          .filter((item) => item.score >= 12 && item.productTokenMatches >= 1)
          .slice(0, 3)
          .map((item) => item.product)
      });
    }
    return createSearchResult({
      query: normalized,
      product: winner.product,
      score: winner.score,
      confidence: Math.min(0.99, 0.55 + winner.score / 100),
      matchedTerms: winner.matchedTerms,
      attributes: this.attributeExtractor.extract(attributeText, winner.product),
      alternatives: scored.slice(1, 4).filter((item) => item.score >= 18).map((item) => item.product)
    });
  }
  #score(query, queryTokens, product) {
    const names = [product.name, ...(product.aliases || [])].map(normalizeCatalogText);
    const productName = names[0];
    let score = 0; const matchedTerms = new Set(); let productTokenMatches = 0;
    if (query === productName) score += 100;
    if (names.slice(1).includes(query)) score += 90;
    if (names.some((name) => query.includes(name) && name.length >= 4)) score += 55;
    const nameTokens = new Set(names.flatMap((name) => meaningfulTokens(name)));
    const descriptionTokens = new Set(meaningfulTokens(normalizeCatalogText(`${product.description} ${product.category} ${(product.tags || []).join(" ")}`)));
    for (const token of queryTokens) {
      if (nameTokens.has(token) || [...nameTokens].some((candidate)=>pluralEquivalent(token,candidate))) { score += 25; productTokenMatches += 1; matchedTerms.add(token); continue; }
      if (token.length >= 4 && [...nameTokens].some((candidate) => candidate.length >= 4 && levenshtein(token, candidate) <= typoDistance(token))) { score += 14; productTokenMatches += 1; matchedTerms.add(token); continue; }
      if (descriptionTokens.has(token)) { score += 5; matchedTerms.add(token); }
    }
    return { product, score, matchedTerms: [...matchedTerms], productTokenMatches };
  }
}
function focusPositiveCatalogIntent(value){
  let text=String(value||'').trim();
  text=text.replace(/^\s*(?:(?:hello|hi|hey|salam|assalam(?:[ -]?o[ -]?alaikum)?)[,!.:-]?\s+)*/i,'');
  const normalized=text.toLowerCase().replace(/[^a-z0-9\s'-]/g,' ').replace(/\s+/g,' ').trim();
  if(/^(?:ok\s+|okay\s+)?(?:book|confirm|place|checkout|finalize)\s+(?:my\s+|the\s+)?order$/.test(normalized))return '';
  // Explicit corrections: the positive clause after "but/instead/rather"
  // is the customer's new subject. Negated old subjects must not earn score.
  const correction=text.match(/\b(?:not|no|don't|do not|nahin|nahi|nhn)\b[\s\S]{0,80}?\b(?:but|instead|rather)\b\s+([\s\S]+)$/i);
  if(correction&&correction[1].trim())return correction[1].trim();
  const direct=text.match(/^\s*(?:not|no|don't|do not|nahin|nahi|nhn)\s+[\w -]{1,50}?\s+(?=(?:i|we)\s+(?:want|need)|(?:can i|get|show|give))/i);
  if(direct)text=text.slice(direct[0].length).trim();

  // Remove conversational request scaffolding while preserving the actual
  // product noun phrase and identity modifiers.
  text=text
    .replace(/^\s*(?:(?:ok|okay|well|so)\s+)?(?:can|could|may|would)\s+(?:i|we)\s+(?:get|buy|have|order|purchase)\s+/i,'')
    .replace(/^\s*(?:do|did)\s+(?:you|u)\s+(?:have|sell|stock|carry)\s+/i,'')
    .replace(/^\s*(?:have|got)\s+(?:you|u)\s+(?:got\s+)?/i,'')
    .replace(/^\s*(?:i|we)\s+(?:want|need|would like|want to buy|need to buy)\s+/i,'')
    .replace(/^\s*(?:please\s+)?(?:show|give|sell)\s+(?:me|us)\s+/i,'')
    .replace(/\s+(?:from\s+(?:you|your store|here)|for\s+(?:me|us|kids?|children|my\s+(?:son|daughter|kid|child))|please|pls|plz)\s*$/i,'')
    .replace(/^\s*(?:a|an|the)\s+/i,'')
    .replace(/\s+/g,' ')
    .trim();
  return text;
}

const STOP_WORDS = new Set(["i", "a", "an", "the", "is", "are", "do", "you", "have", "want", "need", "please", "price", "of", "for", "show", "me", "mujhe", "chahiye", "hai", "ap", "aap", "k", "ke", "pass", "paas", "ka", "ki", "kya", "ہے", "مجھے", "چاہیے", "آپ", "کے", "پاس", "کیا", "what", "here", "this", "that", "also", "too", "from", "your", "store", "products", "product"]);
function meaningfulTokens(value) { return String(value || "").split(" ").filter((token) => token && !STOP_WORDS.has(token) && (token.length >= 3 || /^[smlx]{1,3}$/.test(token) || /^\d+$/.test(token))); }
function typoDistance(token) { return token.length >= 6 ? 2 : 1; }
function pluralEquivalent(a,b){
  if(a===b)return true;
  const singular=(x)=>x.endsWith('ies')?`${x.slice(0,-3)}y`:x.endsWith('ses')?x.slice(0,-2):x.endsWith('s')&&!x.endsWith('ss')?x.slice(0,-1):x;
  return singular(a)===singular(b);
}

// Words that describe transaction/attributes rather than product identity.
const NON_IDENTITY = new Set([
  "buy","get","can","could","would","give","sell","add","make","to","want","need","looking","order","some","other","another","into","cart","pack","piece","pieces",
  "black","white","blue","navy","brown","silver","gold","small","medium","large","size",
  "kg","liter","litre","ml","color","colour","tight"
]);
const IDENTITY_MODIFIERS = new Set([
  // materials
  "plastic","steel","stainless","metal","wood","wooden","glass","leather","cotton","denim","silk","wool","rubber",
  // common product subtypes/styles whose substitution changes the actual item
  "fountain","ballpoint","ball","point","gel","rollerball","mechanical","wireless","wired","running","slides","polo","hoodie","skinny","slim","school","bulb"
]);
function hasIdentityConflict(query, product) {
  const q = meaningfulTokens(query);
  const identityText = normalizeCatalogText([product.name, ...(product.aliases||[]), product.description, ...(product.tags||[])].join(" "));
  const p = new Set(meaningfulTokens(identityText));
  return q.some(t => IDENTITY_MODIFIERS.has(t) && !p.has(t) && ![...p].some(c => c.length >= 5 && t.length >= 5 && levenshtein(t,c) <= typoDistance(t)));
}
function supportsRequestedIdentity(query, product) {
  const q = meaningfulTokens(query).filter(t => !NON_IDENTITY.has(t) && !/^\d+$/.test(t));
  if (!q.length) return true;
  const identityText = normalizeCatalogText([product.name, ...(product.aliases||[]), product.description, ...(product.tags||[])].join(" "));
  const p = new Set(meaningfulTokens(identityText));
  const matched = q.filter(t => p.has(t) || (t.length >= 5 && [...p].some(c => c.length >= 5 && levenshtein(t,c) <= typoDistance(t))));
  // A single generic shared noun (e.g. pen, bottle, shirt) is not enough when
  // the user supplied an additional identity modifier (fountain, plastic, ball).
  return matched.length === q.length;
}
module.exports = { ProductMatcher, meaningfulTokens, supportsRequestedIdentity, focusPositiveCatalogIntent, normalizeCatalogRequest:focusPositiveCatalogIntent };
