const test=require('node:test');const assert=require('node:assert/strict');
const {KnowledgeService}=require('../packages/assistant/src/knowledgeService');
const {AssistantService}=require('../packages/assistant/src/assistantService');
const {CleaningConversationAdapter}=require('../capabilities/cleaning/conversation');

test('knowledge query expansion covers serving areas and parking paraphrases',()=>{
 const svc=new KnowledgeService({knowledgeRepository:{search:(id,q)=>[{semanticScore:.8,text:q,sourceKind:'document'}],getForTenant:()=>({})}});
 assert.match(svc.expandQuery('What are your serving areas?'),/service area/);
 assert.match(svc.expandQuery('who will pay for parking?'),/customer responsible/);
});
test('extractive knowledge answer strips markdown heading',()=>{
 const svc=new AssistantService({});
 assert.equal(svc.extractiveAnswer({matches:[{text:'## Pets in the Home\nYes, cleaners can work in homes with dogs.'}]}),'Yes, cleaners can work in homes with dogs.');
});
test('active cleaning date step lets deep-cleaning change outrank slot validation',async()=>{
 const a=new CleaningConversationAdapter();
 const tenant={id:'cleaning-demo',capabilities:['cleaning']};
 const services={cleaningService:{scope:()=>({findService:async()=>({service:{id:'CLN-DEEP',name:'Deep Home Cleaning'},score:99})})}};
 const r=await a.analyze({tenant,message:{text:'actually i want deep cleaning',customerId:'x',channel:'test'},state:{capabilityState:{cleaning:{step:'date',serviceId:'CLN-HOME'}}},services,normalizedText:'actually i want deep cleaning'});
 assert.equal(r.candidates[0].intent,'cleaning.service_change');
 assert.equal(r.entities.serviceName,'Deep Home Cleaning');
});
test('generic villa cleaning asks for its pricing model before starting the request',async()=>{
 const a=new CleaningConversationAdapter();
 const tenant={id:'cleaning-demo',capabilities:['cleaning']};
 const r=await a.analyze({tenant,message:{text:'i want my villa cleaned',customerId:'x',channel:'test'},state:{capabilityState:{}},services:{},normalizedText:'i want my villa cleaned'});
 assert.equal(r.candidates[0].intent,'cleaning.booking_type_clarification');
 assert.equal(r.entities.propertyType,'villa');
});
