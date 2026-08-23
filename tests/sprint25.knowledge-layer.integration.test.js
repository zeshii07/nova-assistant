const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const {FileKnowledgeRepository}=require('../packages/knowledge/src/fileKnowledgeRepository');
const {KnowledgeService}=require('../packages/assistant/src/knowledgeService');
const {buildContainer}=require('../apps/api/src/container');

test('knowledge index retrieves tenant-approved document facts',()=>{
 const repo=new FileKnowledgeRepository({tenantsDir:path.join(__dirname,'..','tenants')});
 const service=new KnowledgeService({knowledgeRepository:repo});
 const tenant={id:'default',business:{},branding:{}};
 const r=service.retrieve('what payment methods are supported',tenant);
 assert.equal(r.answerable,true);
 assert.match(r.context,/Cash on Delivery|JazzCash/i);
});

test('knowledge indexes remain tenant isolated',()=>{
 const repo=new FileKnowledgeRepository({tenantsDir:path.join(__dirname,'..','tenants')});
 const store=repo.search('default','JazzCash',{minScore:.1});
 const salon=repo.search('salon-demo','JazzCash',{minScore:.1});
 assert.ok(store.length>0);
 assert.equal(salon.length,0);
});

test('assistant can answer an unknown natural question from tenant documents without changing capability code',async()=>{
 const c=await buildContainer();
 // Disable providers for deterministic extractive fallback in this regression.
 c.llmRouter.providers=[];
 const r=await c.executionEngine.process({tenantId:'default',channel:'knowledge-test',customerId:'k1',text:'what happens after confirmation'});
 assert.equal(r.capabilityId,'assistant');
 assert.match(r.reply,/dispatched after confirmation/i);
 assert.equal(r.state.lastIntent,'knowledge_answer');
});
