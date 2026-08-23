const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
const {FileKnowledgeRepository}=require('../packages/knowledge/src/fileKnowledgeRepository');
test('unseen service business is generated from one tenant spec',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-onboard-'));
 const svc=new UniversalTenantOnboardingService({tenantsDir:root});
 const r=svc.create({id:'coach-x',name:'Coach X',domain:'coaching',description:'Personal coaching.',offerings:[{name:'Strategy Session',price:5000,durationMinutes:60,bookable:true,aliases:['strategy call']}]});
 assert.deepEqual(r.profile.capabilities,['assistant','crm','offering','pricing','availability','booking']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'coach-x','offerings','items.json')))[0].name,'Strategy Session');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'coach-x','booking','config.json'))).enabled,true);
});
test('mixed product and service tenant derives both commerce and booking capabilities',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-onboard-'));
 const r=new UniversalTenantOnboardingService({tenantsDir:root}).create({id:'mixed',name:'Mixed',offerings:[{name:'Consultation',type:'service',bookable:true},{name:'Guide Book',type:'product',price:1000,inventory:5}]});
 for(const cap of ['catalog','commerce','offering','booking'])assert.ok(r.profile.capabilities.includes(cap));
});
test('ingested tenant document becomes searchable and remains tenant scoped',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-ingest-'));
 const on=new UniversalTenantOnboardingService({tenantsDir:root});on.create({id:'a',name:'A'});on.create({id:'b',name:'B'});
 const src=path.join(root,'policy.md');fs.writeFileSync(src,'Weekend appointments require advance booking.');
 const repo=new FileKnowledgeRepository({tenantsDir:root});
 await new DocumentIngestor({knowledgeRepository:repo}).ingestFile({tenantId:'a',filePath:src,tenantsDir:root});
 assert.ok(repo.search('a','weekend appointments',{minScore:.1}).length);
 assert.equal(repo.search('b','weekend appointments',{minScore:.1}).length,0);
});
test('unsupported binary formats fail explicitly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-ingest-'));const p=path.join(root,'x.bin');fs.writeFileSync(p,'fake');
 await assert.rejects(()=>new DocumentIngestor().ingestFile({tenantId:'a',filePath:p,tenantsDir:root}),/Unsupported knowledge file/);
});
