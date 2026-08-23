const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer()});
test.after(async()=>{await c.registry.shutdownAll()});
const msg=(id,text,tenantId='default')=>c.executionEngine.process({tenantId,channel:'test',customerId:id,text});

test('shoe family question browses footwear instead of selecting Running Shoes',async()=>{
  const r=await msg('sd-1','what types of shoes do you have');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.match(r.reply,/Running Shoes/); assert.match(r.reply,/Comfort Slides/);
  assert.doesNotMatch(r.reply,/What color would you like/);
});

test('roman urdu shoe family question browses footwear',async()=>{
  const r=await msg('sd-2','ap k pass konsy shoes hain');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.match(r.reply,/Running Shoes/); assert.match(r.reply,/Comfort Slides/);
});

test('two hours is a duration semantic role, not business hours',async()=>{
  const r=await msg('sd-3','i want a clenr for two hours what will be charges','cleaning-demo');
  assert.equal(r.intelligence.semantic.genericEntities.duration.value,2);
  assert.equal(r.intelligence.semantic.genericEntities.duration.role,'duration');
  assert.equal(r.intelligence.selected.intent,'cleaning.pricing_request');
  assert.equal(r.capabilityId,'cleaning');
  assert.doesNotMatch(r.reply,/Monday to Saturday|Business hours/i);
  assert.match(r.reply,/AED 80|40 per hour/i);
});

test('cleaning price for two hours uses configured hourly cleaner rate',async()=>{
  const r=await msg('sd-4','what do you charge for two hours of cleaning','cleaning-demo');
  assert.equal(r.intelligence.selected.intent,'cleaning.pricing_request');
  assert.match(r.reply,/AED 80|40 per hour/i);
});

test('actual business hours question still routes to assistant hours',async()=>{
  const r=await msg('sd-5','what are your working hours','cleaning-demo');
  assert.equal(r.intelligence.selected.intent,'assistant.ask_hours');
  assert.match(r.reply,/Monday|AM|PM/i);
});
