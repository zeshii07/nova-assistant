const test=require('node:test');
const assert=require('node:assert/strict');

const {
  validateNluOutput,
  NluDecisionPolicy
}=require('../packages/multilingual-nlu/src');
const {LanguageContractBuilder}=require('../packages/ai-language-layer/src');

function v2(overrides={}){
  const entityDefaults={
    service:null,service_id:null,product:null,product_id:null,
    date_text:null,date_normalized:null,alternative_date_text:null,alternative_date_normalized:null,
    time_text:null,time_normalized:null,alternative_time_text:null,alternative_time_normalized:null,
    end_time_text:null,duration_hours:null,staff:null,quantity:null,cleaner_count:null,
    property_type:null,property_size:null,bedrooms:null,balconies:null,interior_windows:null,
    washrooms:null,halls:null,address:null,location:null,recurrence:null,
    supplies_required:null,equipment_required:null,time_flexible:null,
    booking_id:null,order_id:null,service_variant:null,size:null,color:null,unit:null
  };
  const base={
    schema_version:'2.0',language:'en',message_type:'request',
    action_semantics:'draft_request',certainty:'explicit',intent:'booking.create',intents:[],
    confidence:.98,workflow_relationship:'continue',entities:entityDefaults,
    service_items:[],product_items:[],customer_fields:{name:null,phone:null,email:null},
    requested_information:[],missing_information:[],corrections:[],ambiguities:[]
  };
  return {
    ...base,...overrides,
    entities:{...entityDefaults,...(overrides.entities||{})},
    customer_fields:{...base.customer_fields,...(overrides.customer_fields||{})}
  };
}

test('provider v2 contract is strict, multi-intent, and multi-item',()=>{
  const output=v2({
    language:'mixed',intent:'order.create',intents:[
      {intent:'order.create',message_type:'request',confidence:.99},
      {intent:'product.price',message_type:'question',confidence:.95}
    ],
    product_items:[
      {product:'Polo Shirt',product_id:'P008',quantity:2,unit:'piece',size:'S',color:'Black',variant:null,confidence:.99},
      {product:'Denim Jeans',product_id:'P002',quantity:1,unit:'piece',size:'36',color:'Blue',variant:null,confidence:.98}
    ],
    requested_information:['product_price'],missing_information:['delivery_address']
  });
  assert.equal(validateNluOutput(output).valid,true);
  const extra=structuredClone(output);extra.execute_now=true;
  assert.equal(validateNluOutput(extra).valid,false);
  const nestedExtra=structuredClone(output);nestedExtra.product_items[0].tenant_id='other';
  assert.equal(validateNluOutput(nestedExtra).valid,false);
});

test('language contract filters foreign IDs and never grants execution authority',()=>{
  const parsed=v2({
    intent:'order.create',
    product_items:[
      {product:'Polo Shirt',product_id:'P008',quantity:2,unit:'piece',size:'S',color:'Black',variant:null,confidence:.99},
      {product:'Foreign Product',product_id:'TENANT-B-P1',quantity:1,unit:'piece',size:null,color:null,variant:null,confidence:.99}
    ]
  });
  const nlu={validated:true,interpretation:parsed,allowed:{serviceIds:[],productIds:['P008']}};
  const contract=new LanguageContractBuilder().build({nlu});
  assert.equal(contract.authority.mayExecute,false);
  assert.equal(contract.authority.execution,'nova_deterministic_core');
  assert.equal(contract.items.products[0].productId,'P008');
  assert.equal(contract.items.products[1].productId,null);
  assert.equal(Object.isFrozen(contract),true);
});

test('validated AI product understanding can only start a deterministic cart draft',()=>{
  const parsed=v2({
    intent:'order.create',
    product_items:[
      {product:'Polo Shirt',product_id:'P008',quantity:2,unit:'piece',size:'S',color:'Black',variant:null,confidence:.99}
    ]
  });
  const nlu={validated:true,interpretation:parsed,allowed:{serviceIds:[],productIds:['P008']}};
  nlu.contract=new LanguageContractBuilder().build({nlu});
  const result=new NluDecisionPolicy().apply({
    tenant:{capabilities:['catalog','commerce']},deterministic:null,deterministicCandidates:[],nlu,
    invocationReason:'primary_language_layer'
  });
  assert.equal(result.selected.capabilityId,'commerce');
  assert.equal(result.selected.intent,'commerce.multi_item_request');
  assert.equal(result.decision,'cart_draft_started');
  assert.equal(result.selected.entities.items[0].productId,'P008');
  assert.notEqual(result.selected.intent,'commerce.checkout.confirm');
});

test('primary strategy interprets before adapters and preserves deterministic fallback',async()=>{
  const previousMode=process.env.NOVA_NLU_MODE;
  const previousStrategy=process.env.NOVA_NLU_STRATEGY;
  process.env.NOVA_NLU_MODE='on';
  process.env.NOVA_NLU_STRATEGY='primary';
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  let calls=0;
  container.groqNluClient.complete=async()=>{calls+=1;return {success:false,error:'timeout',model:'mock-provider',latencyMs:4};};
  try{
    const first=await container.executionEngine.process({tenantId:'default',channel:'http',customerId:`language-fallback-${Date.now()}`,text:'hello'});
    assert.equal(calls,1);
    assert.equal(first.capabilityId,'assistant');
    assert.equal(first.intelligence.nlu.strategy,'primary');
    assert.equal(first.intelligence.nlu.invocationReason,'primary_language_layer');
    assert.equal(first.intelligence.nlu.validated,false);
    assert.equal(first.intelligence.nlu.deterministicFallback,true);
  }finally{
    if(previousMode===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=previousMode;
    if(previousStrategy===undefined)delete process.env.NOVA_NLU_STRATEGY;else process.env.NOVA_NLU_STRATEGY=previousStrategy;
  }
});

test('primary strategy exposes contract but local extraction wins a model conflict',async()=>{
  const previousMode=process.env.NOVA_NLU_MODE;
  const previousStrategy=process.env.NOVA_NLU_STRATEGY;
  process.env.NOVA_NLU_MODE='on';
  process.env.NOVA_NLU_STRATEGY='primary';
  const {buildContainer}=require('../apps/api/src/container');
  const container=await buildContainer();
  container.groqNluClient.complete=async()=>({success:true,model:'mock-provider',latencyMs:2,data:v2({
    intent:'booking.create',
    entities:{service:'Haircut',service_id:'haircut',date_text:'tomorrow',date_normalized:'2026-08-25',time_text:'10 AM',time_normalized:'10:00'},
    service_items:[{service:'Haircut',service_id:'haircut',quantity:1,unit:'appointment',service_variant:null,property_type:null,bedrooms:null,staff:null,duration_hours:null,confidence:.99}]
  })});
  try{
    const result=await container.executionEngine.process({tenantId:'salon-demo',channel:'http',customerId:`language-conflict-${Date.now()}`,text:'Book a haircut tomorrow at 9 AM'});
    assert.equal(result.capabilityId,'booking');
    assert.equal(result.intelligence.nlu.validated,true);
    assert.equal(result.intelligence.nlu.languageContract.authority.mayExecute,false);
    assert.equal(result.intelligence.messageFrame.languageContractVersion,'2.0');
    assert.equal(result.intelligence.entities.time,'9 am');
    assert.notEqual(result.intelligence.entities.time,'10:00');
  }finally{
    if(previousMode===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=previousMode;
    if(previousStrategy===undefined)delete process.env.NOVA_NLU_STRATEGY;else process.env.NOVA_NLU_STRATEGY=previousStrategy;
  }
});
