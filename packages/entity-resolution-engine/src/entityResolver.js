const { normalizeText } = require('../../conversation-intelligence/src/text');

function levenshtein(a,b){
  const m=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)m[i][0]=i; for(let k=0;k<=b.length;k++)m[0][k]=k;
  for(let i=1;i<=a.length;i++)for(let k=1;k<=b.length;k++)m[i][k]=Math.min(m[i-1][k]+1,m[i][k-1]+1,m[i-1][k-1]+(a[i-1]===b[k-1]?0:1));
  return m[a.length][b.length];
}
function scoreSimilarity(a,b){
  a=normalizeText(a); b=normalizeText(b); if(!a||!b)return 0; if(a===b)return 1;
  const at=a.split(' ').filter(Boolean), bt=b.split(' ').filter(Boolean);
  if(at.length>1 && bt.length>1 && at.length===bt.length && [...at].sort().join(' ')===[...bt].sort().join(' ')) return .94;
  if(a.includes(b)||b.includes(a)) return .88;
  const qTokens=meaningfulTokens(a),nameTokens=meaningfulTokens(b);
  // Compare tenant nouns against individual request tokens/windows. This
  // recognizes "mujhe hair cut karwana hai" and small spelling mistakes while
  // keeping the configured offering as the source of truth.
  let tokenScore=0;
  if(nameTokens.length){
    const matched=nameTokens.filter(name=>qTokens.some(query=>query===name||levenshtein(query,name)<=boundedTokenDistance(name))).length;
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
    const q=normalizeText(query); const exact=[]; const scored=[];
    for(const record of records){
      const names=[record.name,...(record.aliases||[])].filter(Boolean);
      let best=0, exactName=null;
      for(const name of names){ const n=normalizeText(name); if(q===n || new RegExp(`\\b${escapeRegex(n)}\\b`).test(q)){best=1;exactName=name;break;} best=Math.max(best,scoreSimilarity(q,n)); }
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
