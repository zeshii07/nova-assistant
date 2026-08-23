const {BM25Retriever,GraphVectorRetriever,reciprocalRankFusion,EvidenceReranker}=require('./hybridRetrieval');
class KnowledgeIndex{
 constructor(docs=[],options={}){this.docs=docs;this.bm25=new BM25Retriever(docs,options.bm25);this.graphVector=new GraphVectorRetriever(docs,{embeddingProvider:options.embeddingProvider});this.reranker=new EvidenceReranker();this.rrfK=options.rrfK||60;}
 search(query,{limit=5,minScore=0,minLexical=0,minSemantic=0,kinds=null,evidenceComplete=null}={}){
   const depth=Math.max(limit*3,12);
   const lexical=this.bm25.search(query,{limit:depth,kinds});
   const graph=this.graphVector.search(query,{limit:depth,kinds});
   const fused=reciprocalRankFusion([lexical,graph],{k:this.rrfK,limit:depth});
   const reranked=this.reranker.rerank(query,fused,{limit:depth,evidenceComplete});
   return reranked.map(row=>{
     const lexicalRow=lexical.find(x=>x.id===row.id), graphRow=graph.find(x=>x.id===row.id);
     const bm25Score=lexicalRow?.bm25Score||0, semanticScore=graphRow?.semanticScore||row.semanticScore||0;
     // Compatibility score: keeps the public KnowledgeService contract stable while
     // ranking itself is RRF + reranker based.
     const lexicalNorm=bm25Score?bm25Score/(bm25Score+2):0;
     const hybridScore=Math.max(0,Math.min(1,.48*lexicalNorm+.52*semanticScore+(row.evidenceComplete?.08:0)));
     return {...row,bm25Score,lexicalScore:lexicalNorm,semanticScore,hybridScore,score:row.rerankScore};
   }).filter(x=>x.hybridScore>=minScore&&x.lexicalScore>=minLexical&&x.semanticScore>=minSemantic).slice(0,limit);
 }
}
module.exports={KnowledgeIndex};
