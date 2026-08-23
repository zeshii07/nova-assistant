
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const os=require('os');
const {FileKnowledgeRepository}=require('../packages/knowledge/src/fileKnowledgeRepository');
const {KnowledgeService}=require('../packages/assistant/src/knowledgeService');
const {KnowledgeSourceRepository}=require('../packages/knowledge-platform/src/knowledgeSourceRepository');
const {TenantKnowledgeManager}=require('../packages/knowledge-platform/src/tenantKnowledgeManager');
const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
const {AssistantService}=require('../packages/assistant/src/assistantService');

function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v8-'));
  const tenantsDir=path.join(root,'tenants');
  for(const id of ['a','b'])fs.mkdirSync(path.join(tenantsDir,id,'knowledge','documents'),{recursive:true});
  const repository=new FileKnowledgeRepository({tenantsDir});
  const sources=new KnowledgeSourceRepository({tenantsDir});
  const ingestor=new DocumentIngestor({knowledgeRepository:repository});
  const manager=new TenantKnowledgeManager({tenantsDir,sourceRepository:sources,knowledgeRepository:repository,documentIngestor:ingestor});
  const service=new KnowledgeService({knowledgeRepository:repository});
  return {root,tenantsDir,repository,sources,ingestor,manager,service};
}
function tenant(id){return {id,business:{name:id}};}

test('v8 PDF ingestion extracts tenant-approved text and keeps original PDF',async()=>{
  const x=setup();
  const fixture=path.join(__dirname,'fixtures','sparklecare-v8-policy.pdf');
  const added=await x.manager.addFile('a',{filePath:fixture,title:'Cancellation policy',priority:60});
  assert.equal(added.source.metadata.sourceFormat,'pdf');
  assert.ok(added.source.metadata.originalFile.endsWith('.pdf'));
  assert.ok(fs.existsSync(path.join(x.tenantsDir,'a',added.source.metadata.originalFile)));
  const r=x.service.retrieve('how much notice do i need to cancel a cleaning booking',tenant('a'),{minScore:.08,minSemantic:.05});
  assert.equal(r.answerable,true);
  assert.match(r.matches[0].text,/12 hours/i);
});

test('v8 source revisions increment and disabled documents disappear from retrieval',()=>{
  const x=setup();
  const first=x.manager.addDocument('a',{title:'Parking',text:'Paid parking is paid by the customer.',priority:60});
  assert.equal(first.source.revision,1);
  const second=x.manager.updateDocument('a',first.source.id,{text:'Paid parking is the customer responsibility and must be arranged before arrival.',priority:60});
  assert.equal(second.revision,2);
  let r=x.service.retrieve('who pays for parking',tenant('a'),{minScore:.08,minSemantic:.05});
  assert.equal(r.answerable,true);
  x.manager.setSourceStatus('a',first.source.id,'disabled');
  r=x.service.retrieve('who pays for parking',tenant('a'),{minScore:.08,minSemantic:.05});
  assert.equal(r.answerable,false);
});

test('v8 tenant knowledge never crosses tenant boundary',()=>{
  const x=setup();
  x.manager.addDocument('a',{title:'Secret policy',text:'Returns are accepted within 17 days.',priority:60});
  const a=x.service.retrieve('what is the return policy',tenant('a'),{minScore:.08,minSemantic:.05});
  const b=x.service.retrieve('what is the return policy',tenant('b'),{minScore:.08,minSemantic:.05});
  assert.equal(a.answerable,true);
  assert.equal(b.answerable,false);
});

test('v8 conflicting same-authority policies abstain instead of guessing',()=>{
  const x=setup();
  x.manager.addDocument('a',{title:'Returns one',text:'Returns are accepted within 7 days of delivery.',priority:60});
  x.manager.addDocument('a',{title:'Returns two',text:'Returns are accepted within 14 days of delivery.',priority:60});
  const r=x.service.retrieve('what is your return policy',tenant('a'),{minScore:.08,minSemantic:.05,limit:6});
  assert.equal(r.conflict,true);
  assert.equal(r.answerable,false);
});

test('v8 structured business truth outranks lower-priority uploaded document',()=>{
  const x=setup();
  fs.writeFileSync(path.join(x.tenantsDir,'a','knowledge','business.json'),JSON.stringify({returns:'Returns are accepted within 7 days of delivery.'},null,2));
  x.manager.ensureRegistry('a');
  x.manager.addDocument('a',{title:'Old returns document',text:'Returns are accepted within 14 days of delivery.',priority:50});
  x.repository.clearCache('a');
  const r=x.service.retrieve('what is your return policy',tenant('a'),{minScore:.08,minSemantic:.05,limit:6});
  assert.equal(r.answerable,true);
  assert.equal(r.conflict,false);
  assert.ok(r.matches[0].priority>=90,r.matches.map(m=>m.priority));
  assert.match(r.matches[0].text,/7 days/i);
});

test('v8 customer memory context is personalization-only and excludes raw CRM internals',()=>{
  const assistant=new AssistantService({languageEngine:null,intentEngine:null,knowledgeService:null,responseEngine:null,llmRouter:null});
  const safe=JSON.parse(assistant.safeCustomerContext({
    name:'Zeeshan Ahmad',preferredLanguage:'roman_urdu',
    phone:'03019299608',email:'private@example.com',
    customFields:{lastDelivery:{city:'Lahore',address:'private street'},lastOrderId:'ORD-123',internalFlag:'secret'}
  }));
  assert.deepEqual(safe,{name:'Zeeshan Ahmad',preferredLanguage:'roman_urdu',city:'Lahore',lastOrderId:'ORD-123'});
  assert.equal(JSON.stringify(safe).includes('03019299608'),false);
  assert.equal(JSON.stringify(safe).includes('private street'),false);
});
