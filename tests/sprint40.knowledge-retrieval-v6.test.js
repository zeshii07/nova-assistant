const test=require('node:test');const assert=require('node:assert/strict');
const {BM25Retriever,GraphVectorRetriever,reciprocalRankFusion,EvidenceReranker}=require('../packages/knowledge/src/hybridRetrieval');
const docs=[{id:'a',text:'Paid parking is the customer responsibility.',sourceKind:'document',priority:50},{id:'b',text:'Deep cleaning includes standard cleaning materials.',sourceKind:'document',priority:50},{id:'c',text:'We serve DHA Lahore and Johar Town.',sourceKind:'document',priority:50}];
test('BM25 returns exact lexical evidence',()=>{const r=new BM25Retriever(docs).search('paid parking customer');assert.equal(r[0].id,'a');});
test('graph/vector branch returns semantic candidates',()=>{const r=new GraphVectorRetriever(docs).search('who pays parking');assert.equal(r[0].id,'a');});
test('RRF merges independent rankings without duplicate documents',()=>{const r=reciprocalRankFusion([[docs[0],docs[1]],[docs[1],docs[0]]]);assert.equal(r.length,2);assert.ok(r.every(x=>x.rrfScore>0));});
test('evidence reranker can prioritize complete evidence',()=>{const rows=reciprocalRankFusion([[docs[0],docs[1]],[docs[1],docs[0]]]);const r=new EvidenceReranker().rerank('parking',rows,{evidenceComplete:(q,x)=>x.id==='a'});assert.equal(r[0].id,'a');});
