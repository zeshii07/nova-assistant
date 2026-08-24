const test=require('node:test');
const assert=require('node:assert/strict');

const {buildContainer}=require('../apps/api/src/container');
const {GroqNluClient,NluInvocationPolicy}=require('../packages/multilingual-nlu/src');
const {ResponseEngine}=require('../packages/assistant/src/responseEngine');

function nlu(overrides={}){
  return {
    schema_version:'1.0',language:'en',message_type:'other',intent:'other',confidence:.96,
    workflow_relationship:'unrelated',entities:{},customer_fields:{},requested_information:[],
    corrections:[],ambiguities:[],...overrides
  };
}

async function withMode(mode,work){
  const before=process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE=mode;
  let container;
  try{container=await buildContainer();return await work(container);}
  finally{
    await container?.registry?.shutdownAll?.();
    if(before===undefined)delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE=before;
  }
}

test('Groq NLU client is key-gated, authenticated, schema-constrained, and tool-free',async()=>{
  const unconfigured=new GroqNluClient({apiKey:''});
  assert.equal((await unconfigured.complete([{role:'user',content:'hello'}])).error,'not_configured');

  let request;
  const output=nlu({message_type:'question',intent:'business.contact',requested_information:['business_contact']});
  const client=new GroqNluClient({
    apiKey:'secret-test-key',model:'test-model',baseUrl:'https://groq.test/openai/v1',
    fetchImpl:async(url,init)=>{
      request={url,init,body:JSON.parse(init.body)};
      return {ok:true,json:async()=>({model:'test-model',choices:[{message:{content:JSON.stringify(output)}}]})};
    }
  });
  const result=await client.complete([{role:'user',content:'contact ka kya scene hai'}]);
  assert.equal(result.success,true);
  assert.equal(request.url,'https://groq.test/openai/v1/chat/completions');
  assert.equal(request.init.headers.authorization,'Bearer secret-test-key');
  assert.equal(request.body.response_format.type,'json_schema');
  assert.equal(request.body.response_format.json_schema.strict,true);
  assert.equal(request.body.max_completion_tokens,900);
  assert.equal(request.body.reasoning_effort,'low');
  assert.ok(request.body.response_format.json_schema.schema.required.includes('intents'));
  assert.deepEqual(
    request.body.response_format.json_schema.schema.properties.entities.required.sort(),
    Object.keys(request.body.response_format.json_schema.schema.properties.entities.properties).sort()
  );
  assert.equal(Object.hasOwn(request.body,'tools'),false);
  assert.equal(Object.hasOwn(request.body,'tool_choice'),false);
});

test('adaptive gate skips clear routes and invokes for semantic conflicts and complex messages',()=>{
  const policy=new NluInvocationPolicy();
  const cleaning={capabilityId:'cleaning',intent:'cleaning.structured_service_request',confidence:1};
  assert.deepEqual(policy.evaluate({
    choice:{winner:cleaning,ordered:[cleaning]},message:{text:'clean my apartment tomorrow'},
    messageFrame:{intents:[{intent:'booking.create',confidence:.95}]}
  }),{invoke:false,reason:'deterministic_confident'});

  const availability={capabilityId:'availability',intent:'availability.day_service_question',confidence:.9999};
  assert.deepEqual(policy.evaluate({
    choice:{winner:availability,ordered:[availability,cleaning]},message:{text:'book cleaning Monday'},
    messageFrame:{intents:[{intent:'booking.create',confidence:.95}]}
  }),{invoke:true,reason:'semantic_route_conflict'});

  assert.deepEqual(policy.evaluate({
    choice:{winner:cleaning,ordered:[cleaning]},message:{text:'book it and tell price and availability'},
    messageFrame:{intents:[
      {intent:'booking.create',confidence:.95},
      {intent:'information.price',confidence:.94},
      {intent:'availability.check',confidence:.96}
    ]}
  }),{invoke:true,reason:'complex_multi_intent'});
});

test('on mode keeps a clear complete request local and preserves all extracted fields',async()=>{
  await withMode('on',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>{calls+=1;throw new Error('should not run');};
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-adaptive',customerId:`clear-${Date.now()}`,
      text:'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment, including 2 balconies and 5 windows.'
    });
    assert.equal(calls,0);
    assert.equal(response.capabilityId,'cleaning');
    assert.equal(response.intelligence.nlu.strategy,'adaptive');
    assert.equal(response.intelligence.nlu.invocationReason,'deterministic_confident');
    assert.deepEqual({
      cleaners:response.state.capabilityState.cleaning.cleanerCount,
      start:response.state.capabilityState.cleaning.startTime,
      end:response.state.capabilityState.cleaning.endTime,
      bedrooms:response.state.capabilityState.cleaning.bedrooms,
      balconies:response.state.capabilityState.cleaning.balconies,
      windows:response.state.capabilityState.cleaning.interiorWindows
    },{cleaners:2,start:'09:00',end:'12:00',bedrooms:3,balconies:2,windows:5});
  });
});

test('an unclear phrase invokes Groq once, then Nova answers only from current-tenant data',async()=>{
  await withMode('on',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>({
      success:true,model:'mock-groq',latencyMs:2,
      data:(calls+=1,nlu({
        message_type:'question',intent:'business.contact',confidence:.98,
        workflow_relationship:'unrelated',requested_information:['business_contact']
      }))
    });
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-adaptive',customerId:`unclear-${Date.now()}`,
      text:'unka reachable wala scene kya hai'
    });
    assert.equal(calls,1);
    assert.equal(response.capabilityId,'assistant');
    assert.equal(response.intelligence.nlu.validated,true);
    assert.equal(response.intelligence.nlu.executionAuthority,'nova_deterministic_core');
    assert.match(response.reply,/\+971 4 555 0199/);
    assert.doesNotMatch(response.reply,/03001234567|Prime Property/i);
  });
});

test('Groq failure never creates a false action and produces tenant-aware clarification',async()=>{
  await withMode('on',async(container)=>{
    container.groqNluClient.complete=async()=>({success:false,error:'timeout',model:'mock-groq',latencyMs:4});
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-adaptive',customerId:`failure-${Date.now()}`,
      text:'sort that other thing somehow'
    });
    assert.equal(response.capabilityId,'system');
    assert.equal(response.intelligence.requiresClarification,true);
    assert.match(response.reply,/haven.t changed or submitted/i);
    assert.match(response.reply,/cleaning/i);
    assert.equal(response.state.capabilityState.cleaning,undefined);
  });
});

test('complex-message provider failure safely falls back to the capable deterministic route',async()=>{
  await withMode('on',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>({success:false,error:(calls+=1,'request_failed'),model:'mock-groq',latencyMs:1});
    const response=await container.executionEngine.process({
      tenantId:'salon-demo',channel:'groq-adaptive',customerId:`compound-${Date.now()}`,
      text:'Hello, my name is Ahmed Khan, my phone is 03001234567, I want a Haircut on Monday at 4 PM and how much does it cost?'
    });
    assert.equal(calls,1);
    assert.equal(response.capabilityId,'booking');
    assert.equal(response.intelligence.requiresClarification,false);
    assert.equal(response.state.capabilityState.booking.slots.name,'Ahmed Khan');
    assert.equal(response.state.capabilityState.booking.slots.phone,'03001234567');
    assert.match(response.reply,/Rs1,500/);
  });
});

test('off mode never invokes Groq and Arabic assistant responses remain natural',async()=>{
  await withMode('off',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>{calls+=1;throw new Error('must not run');};
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-adaptive',customerId:`off-${Date.now()}`,text:'hello'
    });
    assert.equal(calls,0);
    assert.equal(response.intelligence.nlu.strategy,'off');
  });
  const reply=new ResponseEngine().reply({
    intent:'unsupported_capability',language:'arabic',tenant:{name:'متجر',branding:{}},fact:'التنظيف'
  });
  assert.match(reply,/عذرًا/);
  assert.match(reply,/غير متاحة/);
});
