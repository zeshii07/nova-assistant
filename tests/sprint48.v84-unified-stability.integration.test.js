const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');

let container;
async function ask(customerId,text){
  return container.executionEngine.process({tenantId:'default',channel:'v84',customerId,text});
}

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v84-data-'));
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test('maintained native PDF parser ingests the bundled full business document',async()=>{
  const tenantsDir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v84-pdf-'));
  const filePath=path.join(__dirname,'fixtures','sparklecare-v81-full-knowledge.pdf');
  const result=await new DocumentIngestor().ingestFile({tenantId:'sparkle',filePath,tenantsDir});
  const text=fs.readFileSync(result.path,'utf8');
  assert.match(text,/SparkleCare/i);
  assert.match(text,/12 hours/i);
  assert.ok(fs.existsSync(result.originalPath));
});

test('unsupported bag style stays unavailable and offers real bag alternatives',async()=>{
  const response=await ask('descriptor','do you have old style bags');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/old style bags.*not available|don't have old style bags/is);
  assert.match(response.reply,/Urban Backpack/);
  assert.match(response.reply,/Canvas Tote Bag/);
  assert.equal(response.state.capabilityState.catalog.selectedProductId,null);
});

test('fresh shirt family clears stale footwear state and goal candidates',async()=>{
  const customerId='subject-reset';
  let response=await ask(customerId,'do you have shoes');
  assert.match(response.reply,/Running Shoes/);
  response=await ask(customerId,'i want to buy a large shirt');
  assert.match(response.reply,/Cotton T-Shirt/);
  assert.match(response.reply,/Polo Shirt/);
  assert.doesNotMatch(response.reply,/Running Shoes|Comfort Slides/);
  assert.equal(response.state.capabilityState.catalog.browsingCategoryId,null);
  assert.equal(response.intelligence.goal.nextGoal.categoryId,null);
  assert.deepEqual(new Set(response.intelligence.goal.nextGoal.candidateIds),new Set(['P001','P008']));
});

test('product choice phrasing becomes shirt-family discovery',async()=>{
  const response=await ask('family-choice','i want shirts like a t shirt or polo shirt');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/Cotton T-Shirt/);
  assert.match(response.reply,/Polo Shirt/);
  assert.doesNotMatch(response.reply,/Running Shoes/);
});

test('modifier-only replies still continue the selected product',async()=>{
  const customerId='modifier-followup';
  let response=await ask(customerId,'i want running shoes');
  assert.match(response.reply,/Running Shoes/);
  response=await ask(customerId,'black 42');
  assert.match(response.reply,/Color: Black/);
  assert.match(response.reply,/Size: 42/);
});
