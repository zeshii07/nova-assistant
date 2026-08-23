const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v8910-'));
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
const ask=(tenantId,customerId,text,channel='v8910')=>container.executionEngine.process({tenantId,channel,customerId,text});

test.before(async()=>{container=await buildContainer();container.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');container.llmRouter.providers=[];});
test.after(async()=>{await container.registry.shutdownAll();});

test('Roman Urdu deep-clean corrections preserve whole-home meaning and accept a flexible team time',async()=>{
  const customer='deep-roman-flexible';
  let response=await ask('cleaning-demo',customer,'mujhy ghar ki safai k liyy cleaner chahiiyy');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN001');
  assert.match(response.reply,/AED 40 per hour per cleaner/i);

  response=await ask('cleaning-demo',customer,'mujhy deep clening krani hai');
  assert.equal(response.intelligence.selected.intent,'cleaning.service_change');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN002');
  assert.match(response.reply,/Deep Home Cleaning/i);

  response=await ask('cleaning-demo',customer,'bathroom deep cleaning nhn pura ghar deep clean krana hai');
  assert.equal(response.intelligence.selected.intent,'cleaning.service_change');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN002');
  assert.equal(response.state.capabilityState.cleaning.requestedTasks,undefined);
  assert.doesNotMatch(response.reply,/Bathroom Deep Cleaning selected|Bathroom Deep Cleaning par/i);

  response=await ask('cleaning-demo',customer,'kal');
  assert.equal(response.state.capabilityState.cleaning.step,'time');

  response=await ask('cleaning-demo',customer,'jis time team available ho');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.timeFlexible,true);
  assert.equal(state.timePreference,'any_available');
  assert.equal(state.preferredTime,null);
  assert.equal(state.step,'propertyType');
  assert.match(response.reply,/koi bhi available time|any available/i);
  assert.match(response.reply,/not confirm|confirm nahi/i);
});

test('Roman Urdu clock wording is normalized and still validated against business hours',async()=>{
  const engagement=new UniversalEngagementEngine();
  assert.deepEqual(engagement.parseField('time','subha 10 bjy'),{valid:true,value:'10 am'});
  assert.deepEqual(engagement.parseField('time','shaam 6 baje'),{valid:true,value:'6 pm'});

  const response=await ask('cleaning-demo','roman-clock','book 2 bedroom apartment deep cleaning kal subha 10 bjy');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.serviceId,'CLN010');
  assert.equal(state.bedrooms,2);
  assert.equal(state.preferredTime,'10:00');
  assert.equal(state.quotedService.total,300);
  assert.equal(state.step,'address');
});

test('Groq availability interpretation enriches but cannot erase Nova flexible-time extraction',async()=>{
  const before=process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE='on';
  const remoteContainer=await buildContainer();
  try{
    remoteContainer.engagementService.now=()=>new Date('2026-08-21T12:00:00Z');
    remoteContainer.groqNluClient.complete=async()=>({
      success:true,model:'openai/gpt-oss-20b',latencyMs:1,
      data:{
        schema_version:'1.0',language:'roman_ur',message_type:'question',intent:'availability.check',
        intents:[{intent:'availability.check',message_type:'question',confidence:.99}],
        confidence:.99,workflow_relationship:'continue',entities:{},customer_fields:{},
        requested_information:['availability'],corrections:[],ambiguities:[]
      }
    });
    const customer='groq-flexible-time';
    const send=(text)=>remoteContainer.executionEngine.process({tenantId:'cleaning-demo',channel:'v8910-groq',customerId:customer,text});
    await send('book deep cleaning');
    await send('tomorrow');
    const response=await send('jis time team available ho');
    assert.equal(response.intelligence.nlu.used,true);
    assert.equal(response.intelligence.nlu.validated,true);
    assert.equal(response.intelligence.nlu.decision,'active_workflow_enriched');
    assert.equal(response.state.capabilityState.cleaning.timeFlexible,true);
    assert.equal(response.state.capabilityState.cleaning.step,'propertyType');
  }finally{
    await remoteContainer.registry.shutdownAll();
    if(before===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=before;
  }
});

test('tenant cleaning prices follow hourly, property-scope, and furniture-size models',()=>{
  const tenant=container.tenantRepository.getById('cleaning-demo');
  const pricing=container.pricingService.scope({tenant});
  assert.equal(pricing.quote({serviceId:'hourly-cleaner',hours:3,workers:2}).total,240);
  assert.equal(pricing.quote({serviceId:'deep-home-cleaning',propertyType:'apartment',bedrooms:3}).total,350);
  assert.equal(pricing.quote({serviceId:'deep-villa-cleaning',bedrooms:4,requestedOperationalServiceId:'CLN011'}).total,510);
  assert.equal(pricing.quote({serviceId:'sofa-cleaning',units:3,requestedOperationalServiceId:'CLN003'}).total,110);
  assert.equal(pricing.quote({serviceId:'mattress-cleaning',serviceVariant:'king',requestedOperationalServiceId:'CLN020'}).total,200);
  assert.equal(pricing.quote({serviceId:'curtain-cleaning',serviceVariant:'large',requestedOperationalServiceId:'CLN022'}).total,170);
});

test('return and replacement language routes to order operations, never shirt browsing',async()=>{
  const customer='return-no-order';
  let response=await ask('default',customer,'hello i want to return shirts the shirts are very small');
  assert.equal(response.capabilityId,'commerce');
  assert.equal(response.intelligence.selected.intent,'commerce.order.return_exchange');
  assert.equal(response.state.capabilityState.catalog,undefined);
  assert.equal(response.state.capabilityState.commerce.pendingOrderAction.operation,'return');
  assert.match(response.reply,/could not find a modifiable order/i);

  response=await ask('default',customer,'i want to replace the small shirt and want in large size');
  assert.equal(response.capabilityId,'commerce');
  assert.equal(response.state.capabilityState.commerce.pendingOrderAction.operation,'exchange');
  assert.equal(response.state.capabilityState.commerce.pendingOrderAction.fromSize,'S');
  assert.equal(response.state.capabilityState.commerce.pendingOrderAction.toSize,'L');
  assert.equal(response.state.capabilityState.catalog,undefined);
});

test('an exchange revises the existing tenant-scoped order and preserves its timeline',async()=>{
  const customer='existing-order-exchange';
  const tenant=container.tenantRepository.getById('default');
  const commerce=container.commerceService.scope({tenant,capabilityId:'commerce',customerId:customer});
  const catalog=container.catalogService.scope({tenant,capabilityId:'commerce',customerId:customer});
  await commerce.startCart({productId:'P001',name:'Cotton T-Shirt',color:'Black',size:'S',quantity:1,variantSelectionRequired:true});
  await commerce.updateCheckout({name:'Ali Khan',phone:'03001234567',city:'Lahore',address:'House 10, Model Town, Lahore',landmark:'Park',paymentMethod:'Cash on Delivery'});
  const created=await commerce.createOrder({catalog});

  let response=await ask('default',customer,'replace my small cotton t-shirt with large size');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/now size L/i);
  let order=await commerce.getOrder(created.id);
  assert.equal(order.revision,2);
  assert.equal(order.items[0].size,'L');
  assert.equal(order.timeline.at(-1).action,'item_exchanged');
  assert.deepEqual(order.timeline.at(-1).before,{size:'S',color:'Black'});

  response=await ask('default',customer,'return my cotton t-shirt');
  assert.equal(response.capabilityId,'commerce');
  assert.match(response.reply,/Return request recorded/i);
  order=await commerce.getOrder(created.id);
  assert.equal(order.revision,3);
  assert.equal(order.items[0].size,'L');
  assert.equal(order.returnRequests.length,1);
  assert.equal(order.timeline.at(-1).action,'return_requested');
});
