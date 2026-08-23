const { canonicalize } = require('../../universal-vocabulary/src');
function normalizeText(value) {
  return canonicalize(String(value || ""))
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function words(value) { return normalizeText(value).split(" ").filter(Boolean); }
function hasAny(text, phrases = []) {
  const padded = ` ${normalizeText(text)} `;
  return phrases.some((phrase) => padded.includes(` ${normalizeText(phrase)} `));
}
function numberFromText(value) {
  const text = normalizeText(value);
  const direct = text.match(/\b(\d{1,3})\b/);
  if (direct) return Number(direct[1]);
  const map = {
    one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
    ek:1,aik:1,do:2,teen:3,char:4,chaar:4,paanch:5,che:6,chay:6,saat:7,aath:8,nau:9,das:10,
    ایک:1,دو:2,تین:3,چار:4,پانچ:5,چھ:6,سات:7,آٹھ:8,نو:9,دس:10
  };
  for (const token of words(text)) if (map[token]) return map[token];
  return null;
}
module.exports = { normalizeText, words, hasAny, numberFromText };
