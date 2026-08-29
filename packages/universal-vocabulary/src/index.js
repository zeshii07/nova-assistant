const data=require('./vocabulary.json');
function baseNormalize(value){return String(value||'').toLowerCase().replace(/[’']/g,"'").replace(/[-_/]+/g,' ').replace(/[^\p{L}\p{N}+']+/gu,' ').replace(/\s+/g,' ').trim();}
function phrases(concept){return data.concepts[concept]||[];}
function allConcepts(){return Object.keys(data.concepts);}
// Unicode-aware "word boundary". JavaScript's \b is ASCII-only and does NOT
// fire between Urdu/Arabic-script characters and whitespace, so the original
// \b...\b canonicalize left Urdu tokens untouched. We use lookbehind/lookahead
// on \p{L}\p{N}_ which work for any script when paired with the `u` flag.
const B='(?<![\\p{L}\\p{N}_])';
const E='(?![\\p{L}\\p{N}_])';
function canonicalize(value){
 let text=baseNormalize(value);
 const entries=Object.entries(data.canonical_replacements).sort((a,b)=>b[0].length-a[0].length);
 for(const [from,to] of entries){
   const f=escapeRegex(baseNormalize(from));
   // Use Unicode-aware boundaries so Urdu/Arabic tokens are also rewritten.
   // The `u` flag is required for \p{...} to work. Fall back to \b if the
   // regex fails to compile (defensive — never break canonicalize).
   try { text=text.replace(new RegExp(`${B}${f}${E}`,'gu'),baseNormalize(to)); }
   catch { text=text.replace(new RegExp(`\\b${f}\\b`,'g'),baseNormalize(to)); }
 }
 return text.replace(/\s+/g,' ').trim();
}
function hasConcept(value,concept){const text=` ${canonicalize(value)} `;return phrases(concept).some(p=>text.includes(` ${canonicalize(p)} `));}
function matchingConcepts(value){return allConcepts().filter(c=>hasConcept(value,c));}
function aliasesFor(...concepts){return [...new Set(concepts.flatMap(phrases))];}
function escapeRegex(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
module.exports={data,phrases,aliasesFor,hasConcept,matchingConcepts,canonicalize,baseNormalize};
