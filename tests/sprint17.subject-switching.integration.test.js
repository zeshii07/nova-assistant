const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
test.before(async()=>{c=await buildContainer()});
test.after(async()=>{await c.registry.shutdownAll()});
const msg=(id,text)=>c.executionEngine.process({tenantId:'default',channel:'test',customerId:id,text});

test('new product/family request overrides active product draft',async()=>{
  const id='switch-1';
  let r=await msg(id,'hello can i get large pants');
  assert.equal(r.capabilityId,'catalog');
  assert.match(r.reply,/Denim Jeans/i);

  r=await msg(id,'can i get white shirt');
  assert.equal(r.capabilityId,'catalog');
  assert.ok(['catalog.family_browse','catalog.category_browse','catalog.product_interest'].includes(r.intelligence.selected.intent));
  assert.doesNotMatch(r.reply,/Denim Jeans[\s\S]*What color would you like: Blue, Black/i);
  assert.match(r.reply,/Cotton T-Shirt|Polo Shirt/i);

  r=await msg(id,'i want white shirt do you have');
  assert.equal(r.capabilityId,'catalog');
  assert.notEqual(r.intelligence.entities.quantity,2);
  assert.doesNotMatch(r.reply,/Quantity: 2/i);

  r=await msg(id,'can i get black shoes');
  assert.equal(r.capabilityId,'catalog');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.equal(r.intelligence.entities.categoryId,'footwear');
  assert.equal(r.intelligence.entities.filters.color,'Black');
  assert.match(r.reply,/Running Shoes/);
  assert.match(r.reply,/Comfort Slides/);
  assert.doesNotMatch(r.reply,/Denim Jeans/);
});

test('bare clear resets active draft and goal',async()=>{
  const id='switch-clear';
  let r=await msg(id,'i want black running shoes');
  assert.equal(r.capabilityId,'catalog');
  assert.ok(r.state.capabilityState.catalog?.selectedProductId);

  r=await msg(id,'clear');
  assert.equal(r.capabilityId,'system');
  assert.equal(r.intelligence.globalCommand.type,'reset');
  assert.deepEqual(r.state.capabilityState,{});
  assert.equal(r.state.context.goal,null);

  r=await msg(id,'hello can i get black shoes from you');
  assert.equal(r.capabilityId,'catalog');
  assert.equal(r.intelligence.selected.intent,'catalog.category_browse');
  assert.match(r.reply,/Running Shoes/);
  assert.match(r.reply,/Comfort Slides/);
});

test('English auxiliary do never becomes Roman Urdu quantity two',async()=>{
  const id='switch-do';
  await msg(id,'i want polo shirt');
  await msg(id,'white');
  await msg(id,'small');
  const r=await msg(id,'do you have shirts');
  assert.notEqual(r.intelligence.entities.quantity,2);
  assert.doesNotMatch(r.reply,/Quantity: 2/i);
});

test('restaurant and salon generic domain tenants load through the same core',async()=>{
  const r=await c.executionEngine.process({tenantId:'restaurant-demo',channel:'test',customerId:'domain-r',text:'what services do you offer'});
  assert.equal(r.capabilityId,'assistant');
  assert.equal(r.intelligence.domain.domainId,'restaurant');
  assert.match(r.reply,/Dine-in|Takeaway|Family seating|restaurant/i);

  const s=await c.executionEngine.process({tenantId:'salon-demo',channel:'test',customerId:'domain-s',text:'what services do you offer'});
  assert.equal(s.capabilityId,'offering');
  assert.equal(s.intelligence.domain.domainId,'salon');
  assert.match(s.reply,/Haircut|Hair styling|Facial|salon/i);
});
