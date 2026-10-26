const { canonicalize } = require('../../universal-vocabulary/src');
const { normalizeUrduDigits, canonicalWeekdayToken } = require('./multilingualLexicon');
function normalizeText(value) {
  return canonicalize(normalizeUrduDigits(String(value || "")))
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
    eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,
    ek:1,aik:1,do:2,teen:3,char:4,chaar:4,paanch:5,che:6,chay:6,saat:7,aath:8,nau:9,das:10,
    gyara:11,gyarah:11,baara:12,baarah:12,tera:13,terah:13,chauda:14,chaudah:14,pandra:15,pandrah:15,sola:16,solah:16,satra:17,satrah:17,athara:18,atrah:18,unnees:19,bees:20,
    ایک:1,دو:2,تین:3,چار:4,پانچ:5,چھ:6,سات:7,آٹھ:8,نو:9,دس:10,
    گیارہ:11,بارہ:12,تیرہ:13,چودہ:14,پندرہ:15,سولہ:16,سترہ:17,اٹھارہ:18,انیس:19,بیس:20
  };
  // v35.7: Context-aware number extraction.
  // "do" can mean "two" in Roman Urdu OR "do/make" in English ("do biryani").
  // Only treat "do" as quantity 2 when it's clearly a number — preceded by
  // a quantity word or at the start with a unit context ("do biryani" where
  // biryani is a known item). For safety, require "do" to be adjacent to an
  // item noun, not used as a verb.
  const tokens = words(text);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'do') {
      // Check if "do" is used as a verb (followed by a known action noun)
      const nextToken = tokens[i + 1] || '';
      const verbContexts = ['biryani','burger','pasta','chicken','beef','food','order','this','that','it','please','quickly','now','delivery','takeaway','pack','confirm','cancel','change','update'];
      // If "do" is at start of sentence and followed by a food item, it's likely "do/make" not "two"
      if (i === 0 && verbContexts.includes(nextToken)) continue;
      // If preceded by a number word or quantity context, treat as 2
      if (i > 0 && /\b(?:quantity|qty|x|×)\b/i.test(tokens[i-1])) return 2;
      // If "do" is used as "I want do biryani" — skip (it's a verb)
      if (i > 0 && /\b(?:want|need|like|please|ok|okay|just|only)\b/i.test(tokens[i-1])) continue;
      // Default: only treat as 2 if surrounded by clear quantity context
      // Skip "do" when ambiguous
      continue;
    }
    if (map[token]) return map[token];
  }
  return null;
}

/**
 * Bounded token correction for structural vocabulary only.  This deliberately
 * does not rewrite arbitrary nouns, customer names, products, or services.
 * It is used for small closed sets such as weekdays and workflow choices.
 */
function closestKeywordToken(value, keywords = [], { maxDistance = 2, minLength = 5 } = {}) {
  const input=words(value);
  let best=null;
  for(const token of input){
    if(token.length<minLength)continue;
    for(const keywordValue of keywords){
      const keyword=normalizeText(keywordValue);
      if(!keyword||keyword.includes(' ')||Math.abs(token.length-keyword.length)>maxDistance)continue;
      if(token[0]!==keyword[0])continue;
      const distance=damerauLevenshtein(token,keyword);
      if(distance>maxDistance)continue;
      if(!best||distance<best.distance)best={token,keyword,distance};
      else if(distance===best.distance&&keyword!==best.keyword)best={...best,ambiguous:true};
    }
  }
  return best&&!best.ambiguous?best:null;
}

function normalizeWeekdayTypos(value) {
  const weekdays=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const normalized=normalizeText(value);
  const exact=new Set(weekdays);
  return normalized.split(' ').map((token)=>{
    const multilingual=canonicalWeekdayToken(token);
    if(multilingual)return multilingual;
    if(exact.has(token))return token;
    const match=closestKeywordToken(token,weekdays,{maxDistance:2,minLength:5});
    return match?.keyword||token;
  }).join(' ');
}

function damerauLevenshtein(a,b){
  const left=String(a||''),right=String(b||'');
  const rows=left.length+1,cols=right.length+1;
  const matrix=Array.from({length:rows},()=>Array(cols).fill(0));
  for(let i=0;i<rows;i++)matrix[i][0]=i;
  for(let j=0;j<cols;j++)matrix[0][j]=j;
  for(let i=1;i<rows;i++){
    for(let j=1;j<cols;j++){
      const cost=left[i-1]===right[j-1]?0:1;
      matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+cost);
      if(i>1&&j>1&&left[i-1]===right[j-2]&&left[i-2]===right[j-1]){
        matrix[i][j]=Math.min(matrix[i][j],matrix[i-2][j-2]+1);
      }
    }
  }
  return matrix[left.length][right.length];
}

module.exports = { normalizeText, words, hasAny, numberFromText, closestKeywordToken, normalizeWeekdayTypos, damerauLevenshtein, normalizeUrduDigits };
