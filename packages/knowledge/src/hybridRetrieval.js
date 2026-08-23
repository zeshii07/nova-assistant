const {tokens}=require('./knowledgeNormalizer');
const {LocalSemanticEmbeddingProvider,cosine}=require('./embeddingProvider');
const STOP=new Set(['the','a','an','is','are','do','does','what','which','your','you','i','me','my','for','to','of','and','or','in','on','at','hai','hain','kia','kya','ap','aap','ka','ki','ke','mujhe','mujhy']);
function terms(v){return tokens(v).filter(x=>!STOP.has(x));}
function stem(t){let x=String(t||'');for(const s of ['ing','ers','ies','ed','es','s'])if(x.length>s.length+3&&x.endsWith(s)){x=x.slice(0,-s.length);break;}return x;}

class BM25Retriever{
 constructor(docs=[],{k1=1.5,b=.75}={}){this.docs=docs;this.k1=k1;this.b=b;this.N=docs.length;this.df=new Map();this.rows=docs.map(doc=>{const ts=terms(`${doc.path||''} ${doc.text||''}`).map(stem),tf=new Map();for(const t of ts)tf.set(t,(tf.get(t)||0)+1);for(const t of new Set(ts))this.df.set(t,(this.df.get(t)||0)+1);return {doc,tf,len:ts.length};});this.avgdl=this.rows.reduce((a,x)=>a+x.len,0)/(this.N||1);}
 search(query,{limit=12,kinds=null}={}){const qs=terms(query).map(stem);return this.rows.filter(x=>!kinds||kinds.includes(x.doc.sourceKind)).map(x=>{let score=0;for(const q of qs){const f=x.tf.get(q)||0;if(!f)continue;const df=this.df.get(q)||0,idf=Math.log(1+(this.N-df+.5)/(df+.5));score+=idf*(f*(this.k1+1))/(f+this.k1*(1-this.b+this.b*x.len/(this.avgdl||1)));}return {...x.doc,bm25Score:score};}).filter(x=>x.bm25Score>0).sort((a,b)=>b.bm25Score-a.bm25Score).slice(0,limit);}
}

// LightRAG-compatible local graph/vector branch. It extracts lightweight entity/concept
// relationships from tenant chunks today; an external LightRAG adapter can implement the
// same search() contract later without touching business engines or the fusion pipeline.
class GraphVectorRetriever{
 constructor(docs=[],{embeddingProvider=null}={}){this.docs=docs;this.embeddingProvider=embeddingProvider||new LocalSemanticEmbeddingProvider();this.rows=docs.map(doc=>{const text=`${doc.path||''} ${doc.text||''}`;return {doc,embedding:this.embeddingProvider.embed(text),entities:new Set(terms(text).map(stem))};});}
 search(query,{limit=12,kinds=null}={}){const qv=this.embeddingProvider.embed(query),qe=new Set(terms(query).map(stem));return this.rows.filter(x=>!kinds||kinds.includes(x.doc.sourceKind)).map(x=>{const vector=Math.max(0,cosine(qv,x.embedding));let overlap=0;for(const e of qe)if(x.entities.has(e))overlap++;const graph=qe.size?overlap/qe.size:0;const score=.72*vector+.28*graph;return {...x.doc,semanticScore:vector,graphScore:graph,graphVectorScore:score};}).filter(x=>x.graphVectorScore>0).sort((a,b)=>b.graphVectorScore-a.graphVectorScore).slice(0,limit);}
}

function reciprocalRankFusion(rankings,{k=60,weights=[1,1],limit=12}={}){const map=new Map();rankings.forEach((list,li)=>list.forEach((row,idx)=>{const key=row.id||`${row.source}:${row.path}:${row.text}`;const prev=map.get(key)||{...row,rrfScore:0,ranks:{}};prev.rrfScore+=(weights[li]??1)/(k+idx+1);prev.ranks[li]=idx+1;Object.assign(prev,row,{rrfScore:prev.rrfScore,ranks:prev.ranks});map.set(key,prev);}));return [...map.values()].sort((a,b)=>b.rrfScore-a.rrfScore||Number(b.priority||0)-Number(a.priority||0)).slice(0,limit);}

class EvidenceReranker{
 rerank(query,rows,{limit=6,evidenceComplete=null}={}){const q=new Set(terms(query).map(stem));return rows.map(row=>{const d=new Set(terms(`${row.path||''} ${row.text||''}`).map(stem));let overlap=0;for(const t of q)if(d.has(t))overlap++;const lexical=q.size?overlap/q.size:0;const complete=evidenceComplete?Boolean(evidenceComplete(query,row)):true;const priority=Math.max(0,Math.min(100,Number(row.priority||0)))/100;return {...row,evidenceComplete:complete,rerankScore:(row.rrfScore||0)*100+lexical*.5+priority*.08+(complete?.35:0)};}).sort((a,b)=>b.rerankScore-a.rerankScore).slice(0,limit);}
}
module.exports={BM25Retriever,GraphVectorRetriever,reciprocalRankFusion,EvidenceReranker};
