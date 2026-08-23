const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v8911-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';
fs.cpSync(path.join(__dirname,'..','tenants'),process.env.TENANTS_DIR,{recursive:true});

const {buildContainer}=require('../apps/api/src/container');
const {UniversalEngagementEngine}=require('../packages/universal-engagement-engine/src/universalEngagementEngine');
let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v8911',customerId,text});

test.before(async()=>{container=await buildContainer();container.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');container.llmRouter.providers=[];});
test.after(async()=>{await container.registry.shutdownAll();});

test('cleaning price enquiries remain informational across contextual follow-ups',async()=>{
  const customer='cleaning-price-only';
  let response=await ask('cleaning-demo',customer,'1 bedroom villa deep cleaning what are charges for this');
  assert.equal(response.intelligence.selected.intent,'cleaning.structured_quote_request');
  assert.match(response.reply,/Deep cleaning.*1-bedroom villa.*AED 300/is);
  assert.doesNotMatch(response.reply,/price enquiry only|nothing has been booked/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);
  assert.equal(response.state.capabilityState.cleaning.serviceId,undefined);

  response=await ask('cleaning-demo',customer,'and what for 2 bedroom villa deep cleaning');
  assert.match(response.reply,/Deep cleaning.*2-bedroom villa.*AED 370/is);
  assert.doesNotMatch(response.reply,/what date|enter a date/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);

  response=await ask('cleaning-demo',customer,'actually not deep cleaning but standard home cleaning what are charges');
  assert.equal(response.intelligence.selected.intent,'cleaning.standalone_service_quote');
  assert.match(response.reply,/Standard Home Cleaning.*AED 40 per hour per cleaner/is);
  assert.equal(response.state.capabilityState.cleaning.step,null);

  response=await ask('cleaning-demo',customer,'what are charges for sofa cleaning 3 seater sofa');
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.equal(response.state.capabilityState.cleaning.step,null);

  await ask('cleaning-demo',customer,'what are charges for curtain cleaning');
  response=await ask('cleaning-demo',customer,'a small set of curtains');
  assert.match(response.reply,/Curtain Cleaning.*AED 95/is);
  assert.equal(response.state.capabilityState.cleaning.step,null);

  response=await ask('cleaning-demo',customer,'your prices are too high');
  assert.equal(response.intelligence.selected.intent,'cleaning.price_comment');
  assert.match(response.reply,/compare|discount/i);
  assert.doesNotMatch(response.reply,/booking draft|started or changed a booking/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);
});

test('an explicit cleaning booking request starts the deterministic workflow',async()=>{
  const response=await ask('cleaning-demo','cleaning-explicit-book','book 2 bedroom villa deep cleaning tomorrow at 10 am');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.structured_service_request');
  assert.equal(state.serviceId,'CLN011');
  assert.equal(state.quotedService.total,370);
  assert.equal(state.preferredTime,'10:00');
  assert.equal(state.step,'address');
});

test('multiple sizes of one named product do not create a second shirt product',async()=>{
  const response=await ask('default','same-product-variants','hello mujhy 2 large aur aik small shirt chahiyy polo shirt');
  const draft=response.state.capabilityState.commerce.pendingMultiItemDraft;
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  assert.match(response.reply,/Rs6,600/);
  assert.equal(draft.length,2);
  assert.deepEqual(draft.map(item=>({productId:item.productId,size:item.size,quantity:item.quantity})),[
    {productId:'P008',size:'L',quantity:2},
    {productId:'P008',size:'S',quantity:1}
  ]);
  assert.ok(draft.every(item=>item.name==='Polo Shirt'));
});

test('a cart variant can be changed while checkout is waiting for customer details',async()=>{
  const customer='checkout-variant-change';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P008',name:'Polo Shirt',color:'Black',size:'S',quantity:2,variantSelectionRequired:true});
  await ask('default',customer,'confirm order');

  const response=await ask('default',customer,'aysa kro aik shirt small jo hai woh change kr k uska size large kr do 2 shirts aik small aik large');
  assert.equal(response.intelligence.selected.intent,'commerce.cart.update_variant');
  assert.match(response.reply,/size S to L|size S se L/i);
  assert.match(response.reply,/naam|full name/i);
  assert.equal(response.state.capabilityState.commerce.pendingField,'name');
  const cart=await container.commerceRepository.getCart('default',customer);
  assert.deepEqual(cart.items.map(item=>({size:item.size,quantity:item.quantity})),[
    {size:'S',quantity:1},
    {size:'L',quantity:1}
  ]);
  assert.equal(cart.timeline.at(-1).action,'item_variant_changed');
});

test('assistant social replies vary wording without changing routing authority',async()=>{
  const replies=[];
  for(let index=0;index<3;index+=1){
    const response=await ask('cleaning-demo','assistant-variation','hello');
    assert.equal(response.capabilityId,'assistant');
    assert.equal(response.intelligence.selected.intent,'assistant.greet');
    replies.push(response.reply);
  }
  assert.equal(new Set(replies).size,3);
});

test('relative dates use the configured business timezone rather than the host timezone',()=>{
  const engagement=new UniversalEngagementEngine({now:()=>new Date('2026-08-22T00:30:00Z'),timezone:'Asia/Karachi'});
  assert.equal(engagement.parseDate('today').value,'22/08/2026');
  assert.equal(engagement.parseDate('tomorrow').value,'23/08/2026');
});
