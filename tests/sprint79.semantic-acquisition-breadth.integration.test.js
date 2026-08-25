const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {acquisitionIntent}=require('../packages/conversation-intelligence/src/acquisitionIntent');
const {NluInvocationPolicy}=require('../packages/multilingual-nlu/src/nluInvocationPolicy');
const {loadConfig}=require('../packages/config/src/config');

let container;
const ask=(tenantId,customerId,text,channel='semantic-breadth')=>container.executionEngine.process({tenantId,channel,customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-semantic-breadth-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

test('a greeting plus natural service-acquisition wording starts the villa workflow',async()=>{
  const response=await ask('cleaning-demo','looking-for-villa','hello i was looking for a cleaning service for my villa');
  assert.equal(response.intelligence.selected.capabilityId,'cleaning');
  assert.equal(response.intelligence.selected.intent,'cleaning.booking_type_clarification');
  assert.equal(response.state.capabilityState.cleaning.step,'cleaningType');
  assert.match(response.reply,/Standard Cleaning/i);
  assert.match(response.reply,/Deep Cleaning/i);
  assert.doesNotMatch(response.reply,/approved information/i);
});

test('a specific service-availability question answers briefly and offers the useful next choice',async()=>{
  const response=await ask('cleaning-demo','villa-availability-question','do you provide cleaning service for villa');
  assert.equal(response.intelligence.selected.capabilityId,'cleaning');
  assert.match(response.reply,/Yes .*provide cleaning/i);
  assert.match(response.reply,/Standard Cleaning/i);
  assert.match(response.reply,/Deep Cleaning/i);
  assert.doesNotMatch(response.reply,/Our services:/i);
});

test('minor property typos still resolve a clear cleaning request',async()=>{
  const response=await ask('cleaning-demo','typo-villa','ok i want a service for my vill cleaning');
  assert.equal(response.intelligence.selected.capabilityId,'cleaning');
  assert.equal(response.state.capabilityState.cleaning.step,'cleaningType');
  assert.match(response.reply,/villa\/house/i);
});

test('domain-neutral acquisition semantics cover varied service and product wording',()=>{
  for(const phrase of [
    'I was looking to get my apartment cleaned',
    'Could your team come clean my house?',
    'Help me arrange a consultation',
    'Save us a table for Friday evening'
  ])assert.equal(acquisitionIntent(phrase).requested,true,phrase);

  for(const phrase of [
    'I am looking for running shoes',
    'Trying to find a kettle',
    'Help me find a black shirt'
  ]){
    const result=acquisitionIntent(phrase);
    assert.equal(result.requested,true,phrase);
    assert.equal(result.product,true,phrase);
  }
});

test('natural product-search wording reaches Catalog without a fixed command format',async()=>{
  const response=await ask('default','natural-product-search','trying to find running shoes');
  assert.equal(response.intelligence.selected.capabilityId,'catalog');
  assert.match(response.reply,/Running Shoes/i);
  assert.doesNotMatch(response.reply,/not available in our catalog/i);
});

test('natural offering wording starts a config-driven tenant booking',async()=>{
  const response=await ask('salon-demo','natural-salon-booking','could you set me up with a haircut next monday at 2 pm');
  assert.equal(response.intelligence.selected.capabilityId,'booking');
  assert.match(response.reply,/Haircut|haircut/i);
  assert.ok(response.state.capabilityState.booking?.status);
});

test('adaptive NLU escalates an uncertain semantic route despite a high-scored generic abstention',()=>{
  const policy=new NluInvocationPolicy({strategy:'adaptive'});
  const response=policy.evaluate({
    choice:{winner:{capabilityId:'assistant',intent:'assistant.knowledge_question',confidence:1,reason:'knowledge_question_abstention'},ordered:[]},
    localSemantic:{accepted:false,escalation:{recommended:true,reason:'low_semantic_similarity'}},
    semanticPolicy:{aligned:false},message:{text:'could somebody sort this out for me'}
  });
  assert.equal(response.invoke,true);
  assert.equal(response.reason,'local_semantic_uncertain');
});

test('a configured Groq key enables adaptive NLU unless off is explicit',()=>{
  const previousMode=process.env.NOVA_NLU_MODE;
  const previousKey=process.env.GROQ_API_KEY;
  try{
    delete process.env.NOVA_NLU_MODE;
    process.env.GROQ_API_KEY='test-key-not-sent';
    assert.equal(loadConfig().nluMode,'on');
    process.env.NOVA_NLU_MODE='off';
    assert.equal(loadConfig().nluMode,'off');
  }finally{
    if(previousMode===undefined)delete process.env.NOVA_NLU_MODE;else process.env.NOVA_NLU_MODE=previousMode;
    if(previousKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=previousKey;
  }
});

test('returning cleaning customers reuse CRM details after service-specific fields are known',async()=>{
  const customerId='semantic-returning-customer';
  await container.crmService.updateCustomerProfile({
    tenantId:'cleaning-demo',customerId,name:'James Odin',phone:'03077374765',email:'james@example.com',
    customFields:{primaryAddress:'Villa 34, JVC Phase 2, Dubai'}
  });
  await ask('cleaning-demo',customerId,'i was hoping to get my villa cleaned','returning-semantic');
  await ask('cleaning-demo',customerId,'deep cleaning','returning-semantic');
  await ask('cleaning-demo',customerId,'2 bedrooms','returning-semantic');
  const review=await ask('cleaning-demo',customerId,'friday at 4 pm','returning-semantic');
  assert.equal(review.state.capabilityState.cleaning.step,'confirm');
  assert.match(review.reply,/saved (?:customer|contact) details/i);
  assert.match(review.reply,/James Odin/);
  assert.match(review.reply,/03077374765/);
  assert.match(review.reply,/Villa 34, JVC Phase 2, Dubai/);
  assert.doesNotMatch(review.reply,/May I have your full name|best contact phone|share the full service address/i);
});
