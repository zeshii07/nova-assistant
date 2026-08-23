const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer()});
test.after(async()=>{await c.registry.shutdownAll()});
const msg=(tenant,id,text)=>c.executionEngine.process({tenantId:tenant,channel:'test',customerId:id,text});

test('generic family plus color returns all matching footwear instead of choosing one product',async()=>{
  const r=await msg('default','fb-1','hello can i get black shoes');
  assert.equal(r.capabilityId,'catalog');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.equal(r.intelligence.entities.categoryId,'footwear');
  assert.equal(r.intelligence.entities.filters.color,'Black');
  assert.match(r.reply,/Running Shoes/);
  assert.match(r.reply,/Comfort Slides/);
  assert.doesNotMatch(r.reply,/What size would you like/i);
});

test('specific product plus color remains a specific product request',async()=>{
  const r=await msg('default','fb-2','i want black running shoes');
  assert.equal(r.capabilityId,'catalog');
  assert.equal(r.intelligence.selected.intent,'catalog.product_interest');
  assert.equal(r.intelligence.entities.productName,'Running Shoes');
  assert.match(r.reply,/Color: Black/);
});

test('filtered shirt family shows only products that support requested color',async()=>{
  const r=await msg('default','fb-3','show me navy shirts');
  assert.equal(r.intelligence.selected.intent,'catalog.family_browse');
  assert.equal(r.intelligence.entities.filters.color,'Navy');
  assert.match(r.reply,/Cotton T-Shirt/);
  assert.doesNotMatch(r.reply,/Polo Shirt/);
});

test('healthcare and education generic domain tenants load through normal core path',async()=>{
  const h=await msg('healthcare-demo','fb-h','what services do you offer');
  assert.equal(h.capabilityId,'offering'); assert.equal(h.intelligence.domain.domainId,'healthcare'); assert.match(h.reply,/General consultation|Dermatology|Physiotherapy/i);
  const e=await msg('education-demo','fb-e','what services do you offer');
  assert.equal(e.capabilityId,'assistant'); assert.equal(e.intelligence.domain.domainId,'education'); assert.match(e.reply,/Admissions|Grade 1-10|Campus/i);
});
