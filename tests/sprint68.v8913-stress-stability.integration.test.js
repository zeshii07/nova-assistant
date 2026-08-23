const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v8913-'));
process.env.TENANTS_DIR=path.join(runRoot,'tenants');
process.env.NOVA_LOCAL_DATA_DIR=path.join(runRoot,'data');
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(runRoot,'knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(runRoot,'operations');
process.env.NOVA_NLU_MODE='off';
process.env.LOG_LEVEL='error';
fs.cpSync(path.join(__dirname,'..','tenants'),process.env.TENANTS_DIR,{recursive:true});

const {buildContainer}=require('../apps/api/src/container');
let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v8913',customerId,text});

test.before(async()=>{
  container=await buildContainer();
  container.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');
  container.llmRouter.providers=[];
});
test.after(async()=>{await container.registry.shutdownAll();});

test('cart commands outrank pending multi-product attribute collection',async()=>{
  const customer='clear-pending-cart';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P013',name:'Urban Backpack',color:'Black',size:null,quantity:1,variantSelectionRequired:true});
  await ask('default',customer,'I want 2 fleece hoodies and 3 cotton t-shirts');
  let response=await ask('default',customer,'ok clear my cart');
  assert.equal(response.intelligence.selected.intent,'commerce.cart.clear');
  assert.match(response.reply,/cart.*empty|cart clear/i);
  assert.equal((await commerce.getCart()),null);
  assert.equal(response.state.capabilityState.commerce.pendingMultiItemDraft.length,0);

  response=await ask('default',customer,'what is in my cart now?');
  assert.match(response.reply,/cart.*empty/i);
});

test('a multiline bundle can attach shorthand variants and add once',async()=>{
  const customer='multiline-retail-bundle';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  const response=await ask('default',customer,`I want 2 fleece hoodies, 3 cotton t-shirts, 1 urban backpack and 2 steel water bottles.
hoodies black size large; t-shirts white size small; backpack navy; bottles blue 1L
what is in my cart now?`);
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  assert.match(response.reply,/Added to your cart/i);
  const cart=await commerce.getCart();
  assert.deepEqual(cart.items.map(item=>[item.productId,item.color,item.size,item.quantity]),[
    ['P007','Black','L',2],['P001','White','S',3],['P015','Navy',null,1],['P014','Blue','1L',2]
  ]);
  assert.equal(response.state.capabilityState.commerce.pendingMultiItemDraft,undefined);
});

test('pending variants of one product are anchored by their stated sizes',async()=>{
  const customer='pending-same-product-variants';
  await ask('default',customer,'I want two polo shirts, one small and one large');
  const response=await ask('default',customer,'make the small one white and the large one black');
  assert.equal(response.intelligence.selected.intent,'commerce.multi_item_request');
  assert.match(response.reply,/Added to your cart/i);
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  const cart=await commerce.getCart();
  assert.deepEqual(cart.items.map(item=>[item.color,item.size,item.quantity]),[['White','S',1],['Black','L',1]]);
});

test('one cart variant amendment changes both size and color while preserving checkout',async()=>{
  const customer='variant-size-color';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P008',name:'Polo Shirt',color:'Black',size:'S',quantity:2,variantSelectionRequired:true});
  await ask('default',customer,'confirm order');
  const response=await ask('default',customer,'change one small black polo shirt to large white');
  assert.equal(response.intelligence.selected.intent,'commerce.cart.update_variant');
  assert.match(response.reply,/size S to L/i);
  assert.match(response.reply,/color Black to White/i);
  assert.equal(response.state.capabilityState.commerce.pendingField,'name');
  const cart=await commerce.getCart();
  assert.deepEqual(cart.items.map(item=>({color:item.color,size:item.size,quantity:item.quantity})),[
    {color:'Black',size:'S',quantity:1},
    {color:'White',size:'L',quantity:1}
  ]);
});

test('order-history interruption preserves final checkout review and okay can confirm it',async()=>{
  const customer='review-history-resume';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P003',name:'Wireless Earbuds',color:'Black',size:null,quantity:1,variantSelectionRequired:true});
  await ask('default',customer,'confirm order');
  for(const value of ['Ali Khan','03001234567','Lahore','House 12 Model Town Lahore','skip','cod'])await ask('default',customer,value);
  let response=await ask('default',customer,'show my order history');
  assert.equal(response.intelligence.selected.intent,'commerce.orders');
  assert.equal(response.state.capabilityState.commerce.mode,'review');
  response=await ask('default',customer,'ok');
  assert.match(response.reply,/order is confirmed/i);
  assert.equal((await commerce.listOrders()).length,1);
});

test('return and exchange language routes to the durable order instead of catalog browsing',async()=>{
  const customer='return-exchange-order';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P008',name:'Polo Shirt',color:'Black',size:'S',quantity:1,variantSelectionRequired:true});
  await ask('default',customer,'confirm order');
  for(const value of ['Akbar Khan','03024567876','Lahore','House 24 Ali Town Lahore','skip','cod','confirm'])await ask('default',customer,value);
  const response=await ask('default',customer,'I want to replace the small polo shirt with a large one');
  assert.equal(response.intelligence.selected.intent,'commerce.order.return_exchange');
  assert.match(response.reply,/now size L|replacement/i);
  const order=(await commerce.listOrders())[0];
  assert.equal(order.items[0].size,'L');
  assert.ok(order.revision>1);
});

test('another tenant business query is rejected as a domain mismatch',async()=>{
  const response=await ask('default','other-tenant-property-query','what properties does Prime Property Advisors have?');
  assert.equal(response.intelligence.selected.intent,'assistant.domain_mismatch');
  assert.match(response.reply,/retail business|retail products/i);
  assert.doesNotMatch(response.reply,/team would need to confirm/i);
});

test('invalid phone validation stays local when Groq mode is on',async()=>{
  const customer='provider-failure-phone';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P003',name:'Wireless Earbuds',color:'Black',size:null,quantity:1,variantSelectionRequired:true});
  await ask('default',customer,'confirm order');
  await ask('default',customer,'Ali Khan');
  container.remoteNluInterpreter.mode='on';
  const original=container.groqNluClient.complete;
  let calls=0;
  container.groqNluClient.complete=async()=>{calls+=1;return {success:false,error:'http_429',model:'mock-groq',latencyMs:1,httpStatus:429};};
  try{
    const response=await ask('default',customer,'123');
    assert.equal(response.capabilityId,'commerce');
    assert.equal(calls,0);
    assert.equal(response.intelligence.nlu.invocationReason,'deterministic_confident');
    assert.equal(response.intelligence.requiresClarification,false);
    assert.match(response.reply,/phone/i);
    assert.equal(response.state.capabilityState.commerce.pendingField,'phone');
  }finally{
    container.remoteNluInterpreter.mode='off';
    container.groqNluClient.complete=original;
  }
});

test('a failed Groq arbitration still lets the cleaning owner validate its pending field',async()=>{
  const customer='provider-failure-date';
  await ask('cleaning-demo',customer,'book 2 bedroom villa deep cleaning');
  container.remoteNluInterpreter.mode='on';
  const original=container.groqNluClient.complete;
  let calls=0;
  container.groqNluClient.complete=async()=>{calls+=1;return {success:false,error:'http_429',model:'mock-groq',latencyMs:1,httpStatus:429};};
  try{
    const response=await ask('cleaning-demo',customer,'some confusing words');
    assert.equal(calls,1);
    assert.equal(response.capabilityId,'cleaning');
    assert.equal(response.intelligence.nlu.deterministicFallback,true);
    assert.equal(response.intelligence.requiresClarification,false);
    assert.equal(response.state.capabilityState.cleaning.step,'date');
    assert.match(response.reply,/date/i);
  }finally{
    container.remoteNluInterpreter.mode='off';
    container.groqNluClient.complete=original;
  }
});

test('flexible-time spelling variants advance a cleaning request safely',async()=>{
  const customer='flexible-time-typo';
  await ask('cleaning-demo',customer,'book 2 bedroom villa deep cleaning tomorrow');
  const response=await ask('cleaning-demo',customer,'jis time team avaialable ho');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.state.capabilityState.cleaning.timeFlexible,true);
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  assert.match(response.reply,/address/i);
});

test('negated standard cleaning selects whole-home deep cleaning',async()=>{
  const customer='negated-cleaning-type';
  await ask('cleaning-demo',customer,'mujhy ghar ki standard safai chahiyy');
  const response=await ask('cleaning-demo',customer,'actually standard nhn deep cleaning chahiyy');
  assert.equal(response.intelligence.selected.intent,'cleaning.service_change');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN002');
  assert.match(response.reply,/Deep Home Cleaning/i);
});

test('Roman-Urdu sofa price interruption preserves the active booking draft',async()=>{
  const customer='roman-sofa-price-interrupt';
  await ask('cleaning-demo',customer,'book 3 bedroom villa deep cleaning');
  const response=await ask('cleaning-demo',customer,'sofa 5 seater k charges bhi bata do lekin booking change mt krna');
  assert.equal(response.intelligence.selected.intent,'cleaning.active_quote_question');
  assert.match(response.reply,/5-seater sofa.*AED 170/is);
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN011');
  assert.equal(response.state.capabilityState.cleaning.step,'date');
  assert.equal(response.state.capabilityState.cleaning.priceEnquiry.quote.total,170);
});

test('an explicit five-seat sofa booking carries its exact priced scope',async()=>{
  const response=await ask('cleaning-demo','book-five-seat-sofa','book a 5-seater sofa cleaning tomorrow at 10 am');
  const state=response.state.capabilityState.cleaning;
  assert.equal(response.intelligence.selected.intent,'cleaning.structured_service_request');
  assert.equal(state.serviceId,'CLN003');
  assert.equal(state.units,5);
  assert.equal(state.quotedService.total,170);
  assert.equal(state.step,'address');
  assert.match(response.reply,/AED 170/i);
});

test('policy and high-rise questions use only configured tenant knowledge',async()=>{
  let response=await ask('cleaning-demo','policy-knowledge','My cleaning appointment is tomorrow at 6 PM. If I cancel today at 10 PM, what cancellation fee applies?');
  assert.equal(response.capabilityId,'assistant');
  assert.match(response.reply,/don.t have approved information|team.*confirm/i);

  response=await ask('cleaning-demo','policy-highrise','Can your cleaners climb outside my 15th-floor window?');
  assert.equal(response.capabilityId,'assistant');
  assert.match(response.reply,/not offered|No\.|unsafe|rope access/i);
});

test('compound multi-service quote keeps exact and custom-priced services separate',async()=>{
  const response=await ask('cleaning-demo','office-sofa-quote','what are charges for office cleaning and 3 seater sofa cleaning?');
  assert.equal(response.intelligence.selected.intent,'cleaning.multi_service_quote_request');
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/Office Cleaning.*scope|Office Cleaning.*quotation/is);
  assert.equal(response.state.capabilityState.cleaning.step,null);
});

test('multiline cleaning-type answers remain part of a compound price enquiry',async()=>{
  let response=await ask('cleaning-demo','multiline-deep-quote',`what are charges for 2 bedroom villa cleaning and a 3 seater sofa?
deep cleaning`);
  assert.equal(response.intelligence.selected.intent,'cleaning.multi_service_quote_request');
  assert.match(response.reply,/Deep cleaning.*2-bedroom villa.*AED 370/is);
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/Total: AED 480/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);

  response=await ask('cleaning-demo','multiline-standard-quote',`what are charges for 2 bedroom villa cleaning and a 3 seater sofa?
standard cleaning
2 cleaners for 3 hours`);
  assert.equal(response.intelligence.selected.intent,'cleaning.multi_service_quote_request');
  assert.match(response.reply,/AED 240/is);
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.match(response.reply,/Total: AED 350/i);
  assert.equal(response.state.capabilityState.cleaning.step,null);
});

test('price interruption on an active multi-service request lists every service',async()=>{
  const customer='active-office-sofa';
  await ask('cleaning-demo',customer,'I want office cleaning and a 3-seater sofa cleaning tomorrow at 10 AM');
  const response=await ask('cleaning-demo',customer,'what are charges for this');
  assert.equal(response.intelligence.selected.intent,'cleaning.active_quote_question');
  assert.match(response.reply,/Office Cleaning.*scope review/is);
  assert.match(response.reply,/3-seater sofa.*AED 110/is);
  assert.equal(response.state.capabilityState.cleaning.step,'address');
});
