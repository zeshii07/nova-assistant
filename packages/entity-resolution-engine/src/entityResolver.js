const { normalizeText } = require('../../conversation-intelligence/src/text');

// v40.0: Abbreviation expansion — common SMS shorthand → full words
const ABBREVIATIONS = {
  'wht': 'what', 'whn': 'when', 'whr': 'where', 'hw': 'how',
  'pls': 'please', 'plz': 'please', 'thx': 'thanks', 'ty': 'thank you',
  'ur': 'your', 'u': 'you', 'r': 'are', 'n': 'and',
  'wnt': 'want', 'shd': 'should', 'wud': 'would', 'shw': 'show',
  'avail': 'available', 'availabl': 'available',
  'ordr': 'order', 'info': 'information',
  'resturant': 'restaurant', 'restaurent': 'restaurant',
  'chiken': 'chicken', 'biriyani': 'biryani', 'burgers': 'burger',
  'somw': 'some', 'kinda': 'kind of', 'kindof': 'kind of',
};
function expandAbbreviations(text) {
  let result = String(text || '');
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    result = result.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full);
  }
  return result;
}

// v35.5: Singularize common English plurals so "burgers" matches "Beef Burger"
// and "biryani" matches "Chicken Biryani". Conservative — only handles
// regular plurals (s/es/ies) plus a few common irregulars.
function singularize(word) {
  if (!word || word.length <= 3) return word;
  // Common irregular plurals
  const irregular = { 'men': 'man', 'women': 'woman', 'children': 'child', 'teeth': 'tooth', 'feet': 'foot', 'mice': 'mouse', 'geese': 'goose' };
  const lower = word.toLowerCase();
  if (irregular[lower]) return irregular[lower];
  // Regular plurals
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
function normalizeSingular(text) {
  return String(text || '').split(/\s+/).map(singularize).join(' ');
}

function levenshtein(a,b){
  const m=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)m[i][0]=i; for(let k=0;k<=b.length;k++)m[0][k]=k;
  for(let i=1;i<=a.length;i++)for(let k=1;k<=b.length;k++)m[i][k]=Math.min(m[i-1][k]+1,m[i][k-1]+1,m[i-1][k-1]+(a[i-1]===b[k-1]?0:1));
  return m[a.length][b.length];
}
function scoreSimilarity(a,b){
  a=normalizeText(a); b=normalizeText(b); if(!a||!b)return 0; if(a===b)return 1;
  // v35.5: also try singularized comparison — "burgers" → "burger"
  const aS = normalizeSingular(a);
  const bS = normalizeSingular(b);
  if (aS === bS) return .96;
  const at=a.split(' ').filter(Boolean), bt=b.split(' ').filter(Boolean);
  if(at.length>1 && bt.length>1 && at.length===bt.length && [...at].sort().join(' ')===[...bt].sort().join(' ')) return .94;
  if(a.includes(b)||b.includes(a)) return .88;
  // v35.5: singularized token-level includes
  if (aS.includes(bS) || bS.includes(aS)) return .9;
  const qTokens=meaningfulTokens(a),nameTokens=meaningfulTokens(b);
  // v35.5: also compare singularized tokens
  const qTokensS = qTokens.map(singularize);
  let tokenScore=0;
  if(nameTokens.length){
    const matched=nameTokens.filter(name=>qTokens.some(query=>query===name||levenshtein(query,name)<=boundedTokenDistance(name))||qTokensS.some(query=>query===singularize(name)||levenshtein(query,singularize(name))<=boundedTokenDistance(name))).length;
    tokenScore=matched/nameTokens.length;
    if(tokenScore===1)tokenScore=nameTokens.length===1?.9:.93;
  }
  const distance=levenshtein(a,b);
  return Math.max(tokenScore,Math.max(0,1-distance/Math.max(a.length,b.length)));
}
const REQUEST_STOPWORDS=new Set('i me my we our you please want need looking for interested get have can could would mujhe mujhay mujy main mai mein ny ne ko ka ki ke apna apni apne karna karani karwana karwani krani krwana chahiye chaheye chahye lena leni hai hn hoon hun service product item the a an do does'.split(' '));
function meaningfulTokens(value){return normalizeText(value).split(' ').filter(token=>token.length>1&&!REQUEST_STOPWORDS.has(token));}
function boundedTokenDistance(token){return token.length>=8?2:token.length>=5?1:0;}
class EntityResolver {
  resolve(query, records=[], { fuzzyThreshold=.72, suggestionThreshold=.55 }={}) {
    // v40.0: Expand abbreviations before resolving (wht→what, chiken→chicken, etc.)
    const expandedQuery = expandAbbreviations(query);
    const q=normalizeText(expandedQuery); const exact=[]; const scored=[];
    for(const record of records){
      const names=[record.name,...(record.aliases||[])].filter(Boolean);
      let best=0, exactName=null;
      for(const name of names){
        const n=normalizeText(name);
        // v36.1: exact match — full query equals the name/alias
        if(q===n){best=1;exactName=name;break;}
        // v36.1: word-boundary match, but ONLY if the alias is a significant
        // portion of the query. "burger" matching inside "zinger burger" is
        // NOT an exact match for "Beef Burger" — "zinger" is a different food.
        // Rule: alias must be >= 50% of the query length OR query must be
        // <= 2 words longer than the alias.
        if(new RegExp(`\\b${escapeRegex(n)}\\b`).test(q)){
          const qWords=q.split(/\s+/).length;
          const nWords=n.split(/\s+/).length;
          // If alias is a single word and query has other significant words, don't match
          if(nWords===1 && qWords>2){
            // Single-word alias in a longer query — don't treat as exact
            // (e.g., "zinger burger" shouldn't exact-match alias "burger")
            best=Math.max(best,scoreSimilarity(q,n));
            continue;
          }
          best=1;exactName=name;break;
        }
        best=Math.max(best,scoreSimilarity(q,n));
      }
      if(best===1) exact.push({record,match:exactName,confidence:1});
      scored.push({record,confidence:best});
    }
    if(exact.length===1) return {type:'exact',record:exact[0].record,confidence:1};
    if(exact.length>1) return {type:'ambiguous',candidates:exact.map(x=>x.record),confidence:1};
    scored.sort((a,b)=>b.confidence-a.confidence);
    const first=scored[0]; const second=scored[1];
    if(first && first.confidence>=fuzzyThreshold && (!second || first.confidence-second.confidence>=.12)) return {type:'fuzzy',record:first.record,confidence:first.confidence,requiresConfirmation:true};
    if(first && first.confidence>=suggestionThreshold) return {type:'suggestion',record:first.record,confidence:first.confidence,requiresConfirmation:true};
    return {type:'none',confidence:first?.confidence||0};
  }
}
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');}
module.exports={EntityResolver,scoreSimilarity};
