const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContainer } = require('../apps/api/src/container');
const { NluInvocationPolicy, NluDecisionPolicy, GroqNluClient } = require('../packages/multilingual-nlu/src');

function nlu(overrides={}){
  return {
    schema_version:'1.0',language:'en',message_type:'other',intent:'other',confidence:.96,
    workflow_relationship:'unrelated',entities:{},customer_fields:{},requested_information:[],
    corrections:[],ambiguities:[],...overrides
  };
}

async function withMode(mode,work){
  const previous=process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE=mode;
  let container;
  try{
    container=await buildContainer();
    return await work(container);
  }finally{
    await container?.registry?.shutdownAll?.();
    if(previous===undefined)delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE=previous;
  }
}

test('adaptive policy skips clear messages and invokes Groq when no route exists',()=>{
  const policy=new NluInvocationPolicy({strategy:'adaptive'});
  const winner={capabilityId:'assistant',intent:'assistant.greet',confidence:1,entities:{}};
  assert.deepEqual(policy.evaluate({choice:{winner,ordered:[winner]},message:{text:'hello'}}),{invoke:false,reason:'deterministic_confident'});
  assert.deepEqual(policy.evaluate({choice:{winner:null,ordered:[]},message:{text:'anything'}}),{invoke:true,reason:'no_deterministic_route'});
});

test('on mode leaves a clear greeting on Nova core without an API call',async()=>{
  await withMode('on',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>{
      calls+=1;
      return {success:true,model:'mock-groq-light',latencyMs:1,data:nlu({message_type:'greeting'})};
    };
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-first',customerId:`greeting-${Date.now()}`,text:'hello'
    });
    assert.equal(calls,0);
    assert.equal(response.capabilityId,'assistant');
    assert.equal(response.intelligence.nlu.strategy,'adaptive');
    assert.equal(response.intelligence.nlu.invocationReason,'deterministic_confident');
    assert.equal(response.intelligence.nlu.executionAuthority,'nova_deterministic_core');
    assert.equal(response.intelligence.nlu.validated,false);
  });
});

test('adaptive arbitration selects the aligned deterministic candidate instead of an unrelated closest match',()=>{
  const policy=new NluDecisionPolicy();
  const availability={capabilityId:'availability',intent:'availability.day_service_question',confidence:.99999,reason:'keyword_overlap',entities:{}};
  const cleaning={capabilityId:'cleaning',intent:'cleaning.structured_service_request',confidence:.93,reason:'structured_request',entities:{bedrooms:2,propertyType:'apartment'}};
  const result=policy.apply({
    tenant:{capabilities:['assistant','availability','cleaning']},
    deterministic:availability,
    deterministicCandidates:[availability,cleaning],
    invocationReason:'semantic_route_conflict',
    nlu:{validated:true,allowed:{serviceIds:[],productIds:[]},interpretation:nlu({
      message_type:'request',intent:'booking.create',confidence:.98,workflow_relationship:'continue',
      entities:{property_type:'apartment',bedrooms:2}
    })}
  });
  assert.equal(result.selected.capabilityId,'cleaning');
  assert.equal(result.selected.intent,'cleaning.structured_service_request');
  assert.equal(result.decision,'adaptive_deterministic_candidate');
});

test('a clear cleaning request does not pay remote latency',async()=>{
  await withMode('on',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>({success:false,error:(calls+=1,'request_failed'),model:'mock-groq',latencyMs:1});
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-first',customerId:`fallback-${Date.now()}`,
      text:'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment.'
    });
    assert.equal(calls,0);
    assert.equal(response.capabilityId,'cleaning');
    assert.equal(response.intelligence.nlu.deterministicFallback,false);
    assert.equal(response.state.capabilityState.cleaning.cleanerCount,2);
    assert.equal(response.state.capabilityState.cleaning.startTime,'09:00');
    assert.equal(response.state.capabilityState.cleaning.endTime,'12:00');
  });
});

test('off mode never contacts Groq',async()=>{
  await withMode('off',async(container)=>{
    let calls=0;
    container.groqNluClient.complete=async()=>{calls+=1;throw new Error('must not run');};
    const response=await container.executionEngine.process({
      tenantId:'cleaning-demo',channel:'groq-first',customerId:`off-${Date.now()}`,text:'hello'
    });
    assert.equal(calls,0);
    assert.equal(response.intelligence.nlu.strategy,'off');
    assert.equal(response.intelligence.nlu.used,false);
  });
});

test('Groq client circuit prevents repeated timeout delays while the server is unavailable',async()=>{
  let now=1000;
  let fetchCalls=0;
  const client=new GroqNluClient({
    apiKey:'test-key',timeoutMs:1000,failureCooldownMs:15000,now:()=>now,
    fetchImpl:async()=>{fetchCalls+=1;throw new Error('connection refused');}
  });
  const first=await client.complete([{role:'user',content:'hello'}]);
  const second=await client.complete([{role:'user',content:'hello again'}]);
  assert.equal(first.error,'request_failed');
  assert.equal(second.error,'circuit_open');
  assert.equal(fetchCalls,1);
  assert.equal(client.circuitState().open,true);
  now+=15001;
  const third=await client.complete([{role:'user',content:'retry'}]);
  assert.equal(third.error,'request_failed');
  assert.equal(fetchCalls,2);
});
