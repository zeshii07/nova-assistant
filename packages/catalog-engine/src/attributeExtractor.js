/** Extracts only attributes that are valid for the selected product. */
class AttributeExtractor {
  extract(text, product) {
    if (!product) return {};
    const normalized = normalize(text);
    const comparable = normalizeDimensions(normalized);
    const color = resolveKnownValue(comparable, product.colors, COLOR_ALIASES);
    const size = resolveKnownValue(comparable, product.sizes, SIZE_ALIASES);
    return {
      color,
      size,
      quantity: resolveQuantity(normalized, product, size)
    };
  }
}
const COLOR_ALIASES = {
  black: ["black", "blck", "blk", "kala", "kali", "کالا", "کالی"],
  white: ["white", "wht", "safed", "سفید"],
  navy: ["navy", "navy blue"],
  blue: ["blue", "blu", "neela", "neeli", "نیلا", "نیلی"],
  brown: ["brown", "brwn", "bhura", "بھورا"],
  silver: ["silver", "slvr", "چاندی"],
  gold: ["gold", "golden", "سنہری"]
};
const SIZE_ALIASES = {
  s: ["s", "small", "chota", "چھوٹا"],
  m: ["m", "medium", "med", "درمیانہ"],
  l: ["l", "large", "bara", "بڑا"],
  xl: ["xl", "extra large"],
  xxl: ["xxl", "double xl"]
};
function resolveKnownValue(text, validValues, aliases) {
  for (const value of validValues || []) {
    const canonical = normalizeDimensions(normalize(value));
    const candidates = new Set([canonical, ...(aliases[canonical] || []).map((item)=>normalizeDimensions(normalize(item)))]);
    if ([...candidates].some((candidate) => candidate && hasPhrase(text, candidate))) return value;
    const words = text.split(" ");
    if (canonical.length >= 4 && words.some((word) => levenshtein(word, canonical) <= 1)) return value;
  }
  return null;
}
function resolveQuantity(text, product, resolvedSize) {
  const normalized = normalize(text);

  // Prefer explicit quantity grammar so numeric product sizes (e.g. shoe 42)
  // are never mistaken for an order quantity.
  const afterCue = normalized.match(/(?:qty|quantity|pieces?|pcs?|items?|kitne|kitni|تعداد)\s*(\d{1,3})\b/);
  const beforeCue = normalized.match(/\b(\d{1,3})\s*(?:pieces?|pcs?|items?)\b/);
  // In "2 pieces 24cm", the number before "pieces" is the quantity and the
  // following dimension is a product size. Prefer that unambiguous grammar.
  const explicit = beforeCue || afterCue;
  if (explicit) {
    const value = Number(explicit[1]);
    return value >= 1 ? value : null;
  }

  const numberWords = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    ek: 1, aik: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, che: 6, chay: 6, saat: 7, aath: 8, nau: 9, das: 10,
    ایک: 1, دو: 2, تین: 3, چار: 4, پانچ: 5, چھ: 6, سات: 7, آٹھ: 8, نو: 9, دس: 10
  };
  // Number words are quantities only when quantity/order grammar is present,
  // or the entire reply is the number word. This prevents English "do you
  // have..." from becoming Roman-Urdu quantity 2.
  const quantityCue = /\b(qty|quantity|pieces?|pcs?|items?|kitne|kitni|order|want|need|make it|i meant|kar dein|kardo|chahiye|تعداد)\b/;
  const tokens = normalized.split(" ");
  for (const token of tokens) {
    if (!numberWords[token]) continue;
    // Roman-Urdu "do" means two, but English "do you have..." uses "do"
    // as an auxiliary verb. Never infer quantity=2 from that grammar.
    if (token === "do" && /\b(?:do you|do we|do they|what do|how do|where do|when do)\b/.test(normalized)) continue;
    if (tokens.length === 1 || quantityCue.test(normalized) || new RegExp(`\\b${token}\\s*(?:pieces?|pcs?|items?)\\b`).test(normalized)) return numberWords[token];
  }

  const leadingOrder=normalized.match(/\b(?:i want|i need|buy|purchase|order|add)\s+(\d{1,5})\b/);
  if(leadingOrder){
    const value=Number(leadingOrder[1]);
    const numericSizes=new Set((product?.sizes || []).map(numericPart).filter(Number.isFinite));
    if(value>=1&&!numericSizes.has(value))return value;
  }
  const digits = [...normalized.matchAll(/\b(\d{1,5})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1);
  if (!digits.length) return null;

  const numericSizes = new Set((product?.sizes || []).map(numericPart).filter(Number.isFinite));
  const resolvedNumericSize = numericPart(resolvedSize);

  // A bare numeric reply is quantity only if it is not itself a valid numeric
  // variant. Thus shoe "42" means size 42, while grocery "4" means quantity 4.
  if (/^\d{1,3}$/.test(normalized)) {
    const value=digits[0];
    if ((Number.isFinite(resolvedNumericSize) && value===resolvedNumericSize) || numericSizes.has(value)) return null;
    return value;
  }

  const candidates = digits.filter((value) => !(Number.isFinite(resolvedNumericSize) && value === resolvedNumericSize) && !numericSizes.has(value));
  return candidates[0] || null;
}
function hasPhrase(text, phrase) { return (` ${text} `).includes(` ${phrase} `); }
function normalize(value) { return String(value || "").toLowerCase().replace(/[-_/]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
function normalizeDimensions(value){return String(value||'').replace(/\b(\d{1,4})\s+(cm|mm|ml|l|kg|g|inch|inches)\b/gi,'$1$2');}
function numericPart(value){const match=String(value||'').trim().match(/^(\d{1,4})(?:\s*(?:cm|mm|ml|l|kg|g|inch|inches))?$/i);return match?Number(match[1]):NaN;}
function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return rows[a.length][b.length];
}
module.exports = { AttributeExtractor, normalizeCatalogText: normalize, levenshtein };
