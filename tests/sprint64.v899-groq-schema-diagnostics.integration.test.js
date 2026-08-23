const test=require('node:test');
const assert=require('node:assert/strict');

const {
  GroqNluClient,
  GROQ_NLU_SCHEMA
}=require('../packages/multilingual-nlu/src');

function collectKeys(value,keys=[]){
  if(!value||typeof value!=='object')return keys;
  for(const [key,child] of Object.entries(value)){
    keys.push(key);
    collectKeys(child,keys);
  }
  return keys;
}

test('default Groq client uses the Groq endpoint with Groq-hosted GPT OSS',()=>{
  const client=new GroqNluClient();
  assert.equal(client.baseUrl,'https://api.groq.com/openai/v1');
  assert.equal(client.model,'openai/gpt-oss-20b');
});

test('provider schema is strict and excludes unsupported Groq constraints',()=>{
  const keys=collectKeys(GROQ_NLU_SCHEMA);
  for(const unsupported of ['const','pattern','maxItems','uniqueItems']){
    assert.equal(keys.includes(unsupported),false,`${unsupported} must not be sent to Groq strict mode`);
  }
  assert.deepEqual(GROQ_NLU_SCHEMA.properties.schema_version.enum,['1.0']);
  assert.deepEqual(GROQ_NLU_SCHEMA.required,Object.keys(GROQ_NLU_SCHEMA.properties));
  assert.equal(GROQ_NLU_SCHEMA.additionalProperties,false);
  assert.deepEqual(
    GROQ_NLU_SCHEMA.properties.entities.required.sort(),
    Object.keys(GROQ_NLU_SCHEMA.properties.entities.properties).sort()
  );
});

test('Groq request uses current completion token field and low reasoning effort',async()=>{
  let requestBody;
  const client=new GroqNluClient({
    apiKey:'test-key',
    failureCooldownMs:0,
    fetchImpl:async(_url,init)=>{
      requestBody=JSON.parse(init.body);
      return {
        ok:true,
        json:async()=>({
          model:'openai/gpt-oss-20b',
          choices:[{message:{content:JSON.stringify({ok:true})}}]
        })
      };
    }
  });
  assert.equal((await client.complete([{role:'user',content:'hello'}])).success,true);
  assert.equal(requestBody.max_completion_tokens,500);
  assert.equal(requestBody.reasoning_effort,'low');
  assert.equal(Object.hasOwn(requestBody,'max_tokens'),false);
});

test('Groq HTTP diagnostics preserve safe provider details',async()=>{
  const client=new GroqNluClient({
    apiKey:'test-key',
    failureCooldownMs:0,
    fetchImpl:async()=>({
      ok:false,
      status:400,
      headers:{get:(name)=>name==='x-request-id'?'req_test_123':null},
      text:async()=>JSON.stringify({
        error:{
          message:'Invalid schema: unsupported keyword pattern',
          type:'invalid_request_error'
        }
      })
    })
  });
  const result=await client.complete([{role:'user',content:'hello'}]);
  assert.equal(result.success,false);
  assert.equal(result.error,'http_400');
  assert.equal(result.httpStatus,400);
  assert.equal(result.providerMessage,'Invalid schema: unsupported keyword pattern');
  assert.equal(result.providerErrorType,'invalid_request_error');
  assert.equal(result.providerRequestId,'req_test_123');
});
