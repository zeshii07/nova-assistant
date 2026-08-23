
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const os=require('os');const path=require('path');
const {MemoryStateRepository}=require('../packages/state/src/memoryStateRepository');
const {InMemoryCrmRepository}=require('../packages/crm-engine/src/inMemoryCrmRepository');
const {InMemoryCommerceRepository}=require('../packages/commerce-engine/src/inMemoryCommerceRepository');
const {InMemoryBookingRepository}=require('../packages/booking-engine/src/inMemoryBookingRepository');
const {InMemoryCleaningRepository}=require('../packages/cleaning-engine/src/inMemoryCleaningRepository');
const {InMemoryMemoryRepository}=require('../packages/memory-engine/src/inMemoryMemoryRepository');
const {KnowledgeSourceRepository}=require('../packages/knowledge-platform/src/knowledgeSourceRepository');
const {TenantKnowledgeManager}=require('../packages/knowledge-platform/src/tenantKnowledgeManager');
const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
const {FileKnowledgeRepository}=require('../packages/knowledge/src/fileKnowledgeRepository');
const {normalizeCatalogRequest}=require('../packages/catalog-engine/src/productMatcher');
const {buildContainer}=require('../apps/api/src/container');

test('local repositories survive re-instantiation without Redis/Postgres',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v83-local-'));
 let state=new MemoryStateRepository({snapshotFile:path.join(root,'state.json')});
 await state.save({conversationId:'t:web:u',tenantId:'t',customerId:'u',capabilityState:{booking:{pendingField:'date'}}});
 state=new MemoryStateRepository({snapshotFile:path.join(root,'state.json')});
 assert.equal((await state.get('t:web:u')).capabilityState.booking.pendingField,'date');

 let crm=new InMemoryCrmRepository({snapshotFile:path.join(root,'crm.json')});
 await crm.upsertCustomer({tenantId:'clinic',customerId:'u',name:'Ali Raza',phone:'03011112222'});
 crm=new InMemoryCrmRepository({snapshotFile:path.join(root,'crm.json')});
 assert.equal((await crm.getCustomer('clinic','u')).name,'Ali Raza');

 let commerce=new InMemoryCommerceRepository({snapshotFile:path.join(root,'commerce.json')});
 await commerce.saveCart({tenantId:'store',customerId:'u',items:[{productId:'P1',quantity:2}]});
 commerce=new InMemoryCommerceRepository({snapshotFile:path.join(root,'commerce.json')});
 assert.equal((await commerce.getCart('store','u')).items[0].quantity,2);

 let booking=new InMemoryBookingRepository({snapshotFile:path.join(root,'booking.json')});
 await booking.create({id:'B1',tenantId:'salon',customerId:'u',slots:{name:'Ali'}});
 booking=new InMemoryBookingRepository({snapshotFile:path.join(root,'booking.json')});
 assert.equal((await booking.list('salon','u')).length,1);

 let cleaning=new InMemoryCleaningRepository({snapshotFile:path.join(root,'cleaning.json')});
 await cleaning.save({id:'C1',tenantId:'clean',customerId:'u',serviceName:'Deep Home Cleaning'});
 cleaning=new InMemoryCleaningRepository({snapshotFile:path.join(root,'cleaning.json')});
 assert.equal((await cleaning.listByCustomer('clean','u'))[0].serviceName,'Deep Home Cleaning');

 let memory=new InMemoryMemoryRepository({snapshotFile:path.join(root,'memory.json')});
 await memory.upsert({id:'M1',tenantId:'clinic',customerId:'u',scope:'customer',namespace:'preference',key:'language',value:'roman_urdu',tags:[]});
 memory=new InMemoryMemoryRepository({snapshotFile:path.join(root,'memory.json')});
 assert.equal((await memory.get('M1')).value,'roman_urdu');
});

test('knowledge file registration is idempotent by durable content hash',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v83-knowledge-'));
 const tenant='tenant-a';fs.mkdirSync(path.join(root,tenant,'knowledge','documents'),{recursive:true});
 fs.writeFileSync(path.join(root,tenant,'knowledge','business.json'),'{}\n');
 fs.writeFileSync(path.join(root,tenant,'knowledge','faqs.json'),'[]\n');
 const knowledgeRepository=new FileKnowledgeRepository({tenantsDir:root,logger:null});
 const sourceRepository=new KnowledgeSourceRepository({tenantsDir:root});
 const manager=new TenantKnowledgeManager({tenantsDir:root,sourceRepository,knowledgeRepository,documentIngestor:new DocumentIngestor({knowledgeRepository})});
 const src=path.join(root,'sample.txt');fs.writeFileSync(src,'Returns are accepted within seven days.');
 const a=await manager.addFile(tenant,{filePath:src,title:'Returns'});
 const b=await manager.addFile(tenant,{filePath:src,title:'Returns'});
 assert.equal(a.source.id,b.source.id);
 assert.equal(b.alreadyRegistered,true);
 assert.equal(sourceRepository.list(tenant).filter(x=>x.kind==='document').length,1);
});

test('catalog noun phrase normalizer removes conversational wrappers only',()=>{
 assert.equal(normalizeCatalogRequest('can i get candy biscuits from you'),'candy biscuits');
 assert.equal(normalizeCatalogRequest('do you have toys for kids'),'toys');
 assert.equal(normalizeCatalogRequest('can i get a plastic water bottle from you'),'plastic water bottle');
 assert.equal(normalizeCatalogRequest('i want a school bag'),'school bag');
 assert.equal(normalizeCatalogRequest('i want a fountain pen please'),'fountain pen');
});

test('unavailable catalog reply echoes normalized product phrase, not request scaffolding',async()=>{
 const old=process.env.NOVA_LOCAL_DATA_DIR;process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v83-container-'));
 const c=await buildContainer();c.llmRouter.providers=[];
 const r=await c.executionEngine.process({tenantId:'default',channel:'v83',customerId:'norm-user',text:'can i get candy biscuits from you'});
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/candy biscuits/i);
 assert.doesNotMatch(r.reply,/candy biscuits from you/i);
 if(old===undefined)delete process.env.NOVA_LOCAL_DATA_DIR;else process.env.NOVA_LOCAL_DATA_DIR=old;
});
