const data=require('./vocabulary.json');
function baseNormalize(value){return String(value||'').toLowerCase().replace(/[’']/g,"'").replace(/[-_/]+/g,' ').replace(/[^\p{L}\p{N}+']+/gu,' ').replace(/\s+/g,' ').trim();}
function phrases(concept){return data.concepts[concept]||[];}
function allConcepts(){return Object.keys(data.concepts);}
function canonicalize(value){
 let text=baseNormalize(value);
 const entries=Object.entries(data.canonical_replacements).sort((a,b)=>b[0].length-a[0].length);
 for(const [from,to] of entries){const f=escapeRegex(baseNormalize(from));text=text.replace(new RegExp(`\\b${f}\\b`,'g'),baseNormalize(to));}
 return text.replace(/\s+/g,' ').trim();
}
function hasConcept(value,concept){const text=` ${canonicalize(value)} `;return phrases(concept).some(p=>text.includes(` ${canonicalize(p)} `));}
function matchingConcepts(value){return allConcepts().filter(c=>hasConcept(value,c));}
function aliasesFor(...concepts){return [...new Set(concepts.flatMap(phrases))];}
function escapeRegex(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
module.exports={data,phrases,aliasesFor,hasConcept,matchingConcepts,canonicalize,baseNormalize};
