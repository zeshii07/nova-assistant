const test=require('node:test');
const assert=require('node:assert/strict');
process.env.LOG_LEVEL='error';
const {buildContainer}=require('../apps/api/src/container');
async function chat(c,text,id='social-user',tenantId='default'){return c.executionEngine.process({tenantId,customerId:id,channel:'http',text});}

test('mixed greeting plus shopping keeps the catalog task and adds a greeting',async()=>{
  const c=await buildContainer();
  const r=await chat(c,'hello can i get shoes from here','social-mixed');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/hello|assalam/i);
  assert.match(r.reply,/Running Shoes/);
  assert.match(r.reply,/Comfort Slides/);
  await c.registry.shutdownAll();
});

test('other shoes reopens footwear choices instead of repeating Running Shoes',async()=>{
  const c=await buildContainer();
  await chat(c,'running shoes','social-other');
  const r=await chat(c,'do you have other shoes','social-other');
  assert.equal(r.capabilityId,'catalog');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.match(r.reply,/Running Shoes/);
  assert.match(r.reply,/Comfort Slides/);
  await c.registry.shutdownAll();
});

test('explicit unavailable product request gets a friendly catalog response',async()=>{
  const c=await buildContainer();
  const r=await chat(c,'do you sell football','social-unavailable');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/sorry|maazrat/i);
  assert.match(r.reply,/football/i);
  await c.registry.shutdownAll();
});

test('retail tenant politely rejects cleaning rather than answering business hours',async()=>{
  const c=await buildContainer();
  const r=await chat(c,'I need a cleaner tomorrow for two hours','social-cleaning-retail');
  assert.equal(r.capabilityId,'assistant');
  assert.equal(r.intelligence.selected.intent,'assistant.unsupported_capability');
  assert.match(r.reply,/cleaning/i);
  assert.match(r.reply,/not|isn.t|available|offer/i);
  await c.registry.shutdownAll();
});

test('how do you do today is real small talk',async()=>{
  const c=await buildContainer();
  const r=await chat(c,'how do you do today','social-smalltalk');
  assert.equal(r.capabilityId,'assistant');
  assert.equal(r.intelligence.selected.intent,'assistant.small_talk');
  assert.match(r.reply,/doing well|fine|well/i);
  await c.registry.shutdownAll();
});
