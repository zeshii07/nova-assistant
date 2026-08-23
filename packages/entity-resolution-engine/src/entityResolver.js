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
  const distance=levenshtein(a,b); return Math.max(0,1-distance/Math.max(a.length,b.length));
}
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
