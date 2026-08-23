// ML-ready scoring boundary. Today this is deterministic and auditable.
// A future embedding/classifier provider can implement scoreConcept() without
// changing conversation capabilities or tenant knowledge formats.
const {canonicalize,phrases}=require('./index');
class SemanticMatcher{
 constructor({provider=null}={}){this.provider=provider;}
 async scoreConcept(text,concept){
  if(this.provider?.scoreConcept)return this.provider.scoreConcept(text,concept);
  const q=canonicalize(text), qt=new Set(q.split(' ')); let best=0;
  for(const alias of phrases(concept)){const a=canonicalize(alias), at=new Set(a.split(' '));const overlap=[...at].filter(x=>qt.has(x)).length/Math.max(1,at.size);const phrase=q.includes(a)?1:0;best=Math.max(best,phrase,overlap*.88);}
  return best;
 }
}
module.exports={SemanticMatcher};
