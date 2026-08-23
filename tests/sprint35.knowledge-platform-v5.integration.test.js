const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');
const {FileKnowledgeRepository}=require('../packages/knowledge/src/fileKnowledgeRepository');
const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
const {KnowledgeSourceRepository}=require('../packages/knowledge-platform/src/knowledgeSourceRepository');
const {TenantKnowledgeManager}=require('../packages/knowledge-platform/src/tenantKnowledgeManager');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');

function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-kv5-'));
 new UniversalTenantOnboardingService({tenantsDir:root}).create({id:'alpha',name:'Alpha Services',description:'Alpha demo.',offerings:[{name:'Strategy Session',type:'service',bookable:true}]});
 new UniversalTenantOnboardingService({tenantsDir:root}).create({id:'beta',name:'Beta Services',description:'Beta demo.'});
 const repo=new FileKnowledgeRepository({tenantsDir:root});
 const sources=new KnowledgeSourceRepository({tenantsDir:root});
 const ingestor=new DocumentIngestor({knowledgeRepository:repo});
 const manager=new TenantKnowledgeManager({tenantsDir:root,sourceRepository:sources,knowledgeRepository:repo,documentIngestor:ingestor});
 return {root,repo,sources,manager};
}
test('overview separates operational truth from informational knowledge',()=>{
 const {manager}=setup();const o=manager.overview('alpha');
 assert.equal(o.operational.services,1);assert.equal(o.operational.products,0);
 assert.equal(o.business.name,'Alpha Services');assert.ok(o.sources.some(x=>x.kind==='business_profile'));
});
test('document ingestion is tenant scoped and retrieval returns provenance',()=>{
 const {manager,repo}=setup();
 const added=manager.addDocument('alpha',{title:'Cancellation Policy',text:'Appointments can be cancelled up to 24 hours before the scheduled time.',priority:75,tags:['policy']});
 assert.ok(added.source.id);
 const a=repo.search('alpha','when can appointments be cancelled',{minScore:.05});
 const b=repo.search('beta','when can appointments be cancelled',{minScore:.05});
 assert.ok(a.length>0);assert.equal(b.length,0);
 assert.equal(a[0].sourceKind,'document');assert.equal(a[0].priority,75);assert.ok(a[0].sourceId);
});
test('business facts and FAQs become searchable after cache invalidation',()=>{
 const {manager,repo}=setup();
 manager.setFact('alpha',{key:'policies.minimumAge',value:'18 years'});
 manager.addFaq('alpha',{question:'Do you work weekends?',answer:'Saturday appointments are available.'});
 assert.ok(repo.search('alpha','minimum age',{minScore:.05}).some(x=>/18 years/.test(x.text)));
 assert.ok(repo.search('alpha','weekends saturday',{minScore:.05}).some(x=>/Saturday appointments/.test(x.text)));
});
test('source removal deletes a managed document and removes it from retrieval',()=>{
 const {manager,repo,root}=setup();
 const x=manager.addDocument('alpha',{title:'Temporary Note',text:'The secret demo keyword is ORCHID-77.'});
 assert.ok(repo.search('alpha','ORCHID-77',{minScore:.01}).length);
 assert.equal(manager.removeSource('alpha',x.source.id),true);
 assert.equal(repo.search('alpha','ORCHID-77',{minScore:.01}).length,0);
 const abs=path.join(root,'alpha',x.source.file);assert.equal(fs.existsSync(abs),false);
});

test('unseen tenant can answer approved informational knowledge through the existing assistant',async()=>{
 const projectTenants=path.join(__dirname,'..','tenants'),id='v5-knowledge-e2e',dir=path.join(projectTenants,id);
 fs.rmSync(dir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:projectTenants}).create({id,name:'V5 Knowledge E2E',description:'An unseen tenant.'});
 const {buildContainer}=require('../apps/api/src/container');const c=await buildContainer();c.llmRouter.providers=[];
 c.tenantKnowledgeManager.addDocument(id,{title:'Parking Policy',text:'Customer parking is available behind the main building after 5 PM.',priority:70});
 const r=await c.executionEngine.process({tenantId:id,channel:'knowledge-v5',customerId:'u1',text:'where can customers park after 5 pm'});
 assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/behind the main building/i);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('reindex reports chunks and registered sources',()=>{
 const {manager}=setup();manager.addDocument('alpha',{title:'Notes',text:'Approved tenant knowledge.'});
 const r=manager.reindex('alpha');assert.equal(r.tenantId,'alpha');assert.ok(r.chunks>0);assert.ok(r.sources>=3);
});
