
const test=require('node:test');const assert=require('node:assert/strict');
const path=require('path');const fs=require('fs');const os=require('os');
const {buildContainer}=require('../apps/api/src/container');
const {extractPdfText,DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
let c;
async function q(u,text){return c.executionEngine.process({tenantId:'default',channel:'v81',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('native PDF extractor reads business PDF without external Poppler',async()=>{
 const pdf=path.join(__dirname,'fixtures','sparklecare-v81-full-knowledge.pdf');
 const text=await extractPdfText(pdf);
 assert.match(text,/SparkleCare/i);
 assert.match(text,/12 hours/i);
 assert.match(text,/Visa/i);
});

test('DocumentIngestor ingests PDF using native extractor',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v81-pdf-'));
 const ing=new DocumentIngestor();
 const result=await ing.ingestFile({tenantId:'x',filePath:path.join(__dirname,'fixtures','sparklecare-v81-full-knowledge.pdf'),tenantsDir:root,destinationName:'sparkle'});
 assert.equal(result.sourceFormat,'pdf');assert.equal(result.format,'txt');
 assert.ok(fs.existsSync(result.path));assert.ok(fs.existsSync(result.originalPath));
 assert.match(fs.readFileSync(result.path,'utf8'),/Parking/i);
});

test('fresh shirt request supersedes stale footwear browsing goal',async()=>{
 const u='switch';
 let r=await q(u,'do you have shoes');assert.match(r.reply,/Running Shoes/);
 r=await q(u,'i want to buy a large shirt');
 assert.equal(r.capabilityId,'catalog');
 assert.doesNotMatch(r.reply,/Running Shoes|Comfort Slides/);
 assert.match(r.reply,/shirt/i);
 assert.match(r.reply,/L|large/i);
});

test('negative correction clears old shoes and browses shirts',async()=>{
 const u='neg';
 let r=await q(u,'do you have shoes');assert.match(r.reply,/Running Shoes/);
 r=await q(u,'not shoes but i want shirts');
 assert.equal(r.capabilityId,'catalog');
 assert.doesNotMatch(r.reply,/Running Shoes available/i);
 assert.match(r.reply,/Cotton T-Shirt|Polo Shirt/);
});

test('frustrated explicit replacement request cannot be stolen by old product goal',async()=>{
 const u='frustrated';
 let r=await q(u,'do you have shoes');
 r=await q(u,'running shoes');
 assert.match(r.reply,/Running Shoes/);
 r=await q(u,'are you mad man i want to buy shirts like a t shirt or polo shirt');
 assert.equal(r.capabilityId,'catalog');
 assert.doesNotMatch(r.reply,/Running Shoes/);
 assert.match(r.reply,/Cotton T-Shirt|Polo Shirt|shirt/i);
});
