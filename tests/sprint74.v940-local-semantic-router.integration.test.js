const test=require('node:test');
const assert=require('node:assert/strict');

const {LightweightSemanticRouter}=require('../packages/semantic-router/src');

test('local statistical router recognizes multilingual paraphrases and abstains on unknown language',async()=>{
  const router=new LightweightSemanticRouter({minConfidence:.72});
  const tenant={id:'router-test',domain:'universal',capabilities:['assistant','catalog','commerce','cleaning','booking','availability']};
  const route=async text=>router.analyze({tenant,message:{text},state:{},services:{},messageFrame:{}});

  const roman=await route('mujhy kal ghar saaf krwana hai');
  assert.equal(roman.accepted,true);
  assert.equal(roman.primaryIntent.name,'booking.create');
  assert.equal(roman.language,'roman_ur');

  const arabic=await route('ما المنتجات المتوفرة');
  assert.equal(arabic.accepted,true);
  assert.equal(arabic.primaryIntent.name,'product.list');
  assert.equal(arabic.language,'ar');

  const exchange=await route('actually exchange the small shirt from my last order for large');
  assert.equal(exchange.accepted,true);
  assert.equal(exchange.primaryIntent.name,'order.exchange');

  const unknown=await route('green unicorn quantum maybe');
  assert.equal(unknown.accepted,false);
  assert.equal(unknown.escalation.recommended,true);
  assert.equal(unknown.authority.mayExecute,false);
  assert.equal(unknown.authority.execution,'nova_deterministic_core');
});

test('local tenant vocabulary is scoped and cannot surface another tenant identifier',async()=>{
  const contextBuilder={build:async()=>({
    tenant:{enabled_capabilities:['catalog','commerce']},
    vocabulary:[{kind:'product',id:'LOCAL-P1',name:'Alpha Widget',aliases:['alpha device']}]
  })};
  const router=new LightweightSemanticRouter({contextBuilder,minConfidence:.7});
  const result=await router.analyze({
    tenant:{id:'tenant-a',capabilities:['catalog','commerce']},
    message:{text:'I want to buy the Alpha Widget'},state:{},services:{},messageFrame:{}
  });
  assert.equal(result.tenantMatches[0].id,'LOCAL-P1');
  assert.equal(result.tenantMatches.some(item=>item.id==='OTHER-TENANT-P1'),false);
});

test('adaptive routing handles clear paraphrases locally and calls Groq for unresolved ambiguity',async()=>{
  const previousMode=process.env.NOVA_NLU_MODE;
  const previousStrategy=process.env.NOVA_NLU_STRATEGY;
  process.env.NOVA_NLU_MODE='on';
  process.env.NOVA_NLU_STRATEGY='adaptive';
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  let calls=0;
  container.groqNluClient.complete=async()=>{calls+=1;return {success:false,error:'mock_unavailable',model:'mock-provider',latencyMs:2};};
  try{
    const clear=await container.executionEngine.process({tenantId:'default',channel:'http',customerId:`semantic-clear-${Date.now()}`,text:'show what is sitting in my basket'});
    assert.equal(clear.capabilityId,'commerce');
    assert.equal(clear.intelligence.semanticRouter.accepted,true);
    assert.equal(clear.intelligence.semanticRouter.primaryIntent.name,'cart.view');
    assert.equal(clear.intelligence.nlu.used,false);
    assert.equal(calls,0);

    const unclear=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:`semantic-unclear-${Date.now()}`,text:'please sort the other one around then unless it shifts'});
    assert.equal(unclear.intelligence.semanticRouter.accepted,false);
    assert.equal(unclear.intelligence.nlu.used,true);
    assert.equal(calls,1);
  }finally{
    await container.registry.shutdownAll();
    if(previousMode===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=previousMode;
    if(previousStrategy===undefined)delete process.env.NOVA_NLU_STRATEGY;else process.env.NOVA_NLU_STRATEGY=previousStrategy;
  }
});

test('generic villa or apartment booking asks cleaning type and preserves supplied schedule',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const customerId=`cleaning-type-${Date.now()}`;
    const first=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId,text:'I want villa cleaning tomorrow at 9 AM'});
    assert.match(first.reply,/Standard Cleaning/i);
    assert.match(first.reply,/Deep Cleaning/i);
    assert.equal(first.state.capabilityState.cleaning.step,'cleaningType');
    assert.equal(first.state.capabilityState.cleaning.pendingBookingType.scope.startTime,'09:00');

    const deep=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId,text:'Deep Cleaning'});
    assert.equal(deep.state.capabilityState.cleaning.step,'bedrooms');
    assert.equal(deep.state.capabilityState.cleaning.preferredTime,'09:00');

    const bedrooms=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId,text:'3'});
    assert.equal(bedrooms.state.capabilityState.cleaning.total,440);
    assert.match(bedrooms.reply,/AED 440|estimate/i);
    assert.equal(bedrooms.state.capabilityState.cleaning.step,'address');
  }finally{await container.registry.shutdownAll();}
});

test('Standard Cleaning collects cleaner count and hours; explicit Deep Cleaning collects bedrooms',async()=>{
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  try{
    const standardId=`standard-type-${Date.now()}`;
    const start=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:standardId,text:'I want apartment cleaning Friday at 2 PM'});
    assert.equal(start.state.capabilityState.cleaning.step,'cleaningType');
    const standard=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:standardId,text:'Standard Cleaning'});
    assert.equal(standard.state.capabilityState.cleaning.step,'cleanerCount');
    const cleaners=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:standardId,text:'2 cleaners'});
    assert.equal(cleaners.state.capabilityState.cleaning.step,'duration');
    const hours=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:standardId,text:'3 hours'});
    assert.equal(hours.state.capabilityState.cleaning.total,240);
    assert.equal(hours.state.capabilityState.cleaning.step,'address');

    const deepId=`deep-type-${Date.now()}`;
    const explicit=await container.executionEngine.process({tenantId:'cleaning-demo',channel:'http',customerId:deepId,text:'I want Deep Cleaning for my apartment tomorrow at 9 AM'});
    assert.equal(explicit.state.capabilityState.cleaning.step,'bedrooms');
    assert.match(explicit.reply,/bedrooms/i);
  }finally{await container.registry.shutdownAll();}
});
