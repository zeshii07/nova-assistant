const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {normalizeWeekdayTypos}=require('../packages/conversation-intelligence/src/text');
const {TemporalSemanticExtractor}=require('../packages/conversation-intelligence/src/temporalSemanticExtractor');
const {UniversalEngagementEngine}=require('../packages/universal-engagement-engine/src/universalEngagementEngine');
const {acquisitionIntent}=require('../packages/conversation-intelligence/src/acquisitionIntent');
const {EntityResolver}=require('../packages/entity-resolution-engine/src/entityResolver');

let container;
const ask=(tenantId,customerId,text,channel='v1020')=>container.executionEngine.process({tenantId,channel,customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v1020-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
});
test.after(async()=>{await container.registry.shutdownAll();});

test('shared temporal language understands Roman Urdu, Urdu script, weekdays and Urdu digits',()=>{
  const engagement=new UniversalEngagementEngine({now:()=>new Date('2026-08-25T12:00:00Z'),timezone:'Asia/Karachi'});
  const temporal=new TemporalSemanticExtractor();
  assert.equal(normalizeWeekdayTypos('hafta waly din'),'saturday waly din');
  assert.equal(normalizeWeekdayTypos('jumma waly din'),'friday waly din');
  assert.match(normalizeWeekdayTypos('جمعہ والے دن'),/^friday /);
  assert.equal(engagement.parseDate('hafta waly din',{now:new Date('2026-08-25T12:00:00Z'),timezone:'Asia/Karachi'}).value,'29/08/2026');
  assert.equal(engagement.parseDate('jumma waly din',{now:new Date('2026-08-25T12:00:00Z'),timezone:'Asia/Karachi'}).value,'28/08/2026');
  assert.deepEqual(temporal.extract('kal subha 10 baje'),{version:'1.0',startTime:'10:00',dateReference:'tomorrow',timeWindow:'morning'});
  assert.equal(temporal.extract('پرسوں شام ۶ بجے').startTime,'18:00');
  assert.equal(engagement.parseTime('رات ۸ بجے').value,'8 pm');
  assert.equal(engagement.parseTime('10 bjy raat').value,'10 pm');
});

test('the reported Roman Urdu flat-cleaning conversation advances without English weekday fallback',async()=>{
  const user='roman-flat-customer';
  let response=await ask('cleaning-demo',user,'hello mai ny apny flat ki safai krani hai');
  assert.equal(response.state.capabilityState.cleaning.step,'cleaningType');
  response=await ask('cleaning-demo',user,'mi ny deep cleaning krani hai');
  assert.equal(response.state.capabilityState.cleaning.step,'bedrooms');
  response=await ask('cleaning-demo',user,'3 bedroom');
  assert.equal(response.state.capabilityState.cleaning.step,'date');
  response=await ask('cleaning-demo',user,'hafta waly din');
  assert.equal(response.state.capabilityState.cleaning.step,'time');
  const [day,month,year]=response.state.capabilityState.cleaning.preferredDate.split('/').map(Number);
  assert.equal(new Date(Date.UTC(year,month-1,day)).getUTCDay(),6);
  response=await ask('cleaning-demo',user,'time subha 10 bjy k thik hai');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  assert.equal(response.state.capabilityState.cleaning.preferredTime,'10 am');
});

test('universal acquisition language covers Roman Urdu and Urdu without tenant phrase configuration',()=>{
  for(const phrase of ['mai ny apny flat ki safai krani hai','mujhe haircut karwana hai','mujhe shoes khareedne hain','مجھے صفائی کروانی ہے','مجھے یہ سامان خریدنا ہے']){
    assert.equal(acquisitionIntent(phrase).requested,true,phrase);
  }
});

test('offering resolution ignores request grammar and tolerates bounded noun typos',()=>{
  const resolver=new EntityResolver();
  const records=[{id:'haircut',name:'Haircut',aliases:['hair cut']},{id:'facial',name:'Facial',aliases:[]}];
  assert.equal(resolver.resolve('mujhe haircut karwana hai',records).record.id,'haircut');
  assert.equal(resolver.resolve('mujhe hairct karwana hai',records).record.id,'haircut');
});

test('lead engine progressively enriches one tenant-isolated lead and converts it on a transaction',async()=>{
  const customerId='lead-progressive-customer';
  await ask('cleaning-demo',customerId,'mujhe apne flat ki safai karwani hai');
  let leads=await container.leadService.list('cleaning-demo');
  let lead=leads.find(item=>item.customerId===customerId);
  assert.ok(lead);
  assert.equal(lead.status,'new');
  assert.equal(lead.contact.phone,undefined);

  await container.crmService.updateCustomerProfile({tenantId:'cleaning-demo',customerId,name:'Ali Raza',phone:'03012345678'});
  await ask('cleaning-demo',customerId,'deep cleaning karwani hai');
  leads=await container.leadService.list('cleaning-demo');
  const enriched=leads.find(item=>item.customerId===customerId);
  assert.equal(enriched.id,lead.id);
  assert.equal(enriched.contact.name,'Ali Raza');
  assert.equal(enriched.contact.phone,'03012345678');
  assert.equal(enriched.status,'qualified');
  assert.ok(enriched.score>lead.score);

  await container.leadService.observe({tenantId:'cleaning-demo',conversationId:'cleaning-demo:v1020:'+customerId,customerId,channel:'v1020',message:{text:'confirm'},customer:{name:'Ali Raza',phone:'03012345678'},capabilityId:'cleaning',intelligence:{selected:{intent:'cleaning.confirm',entities:{serviceName:'Deep Villa Cleaning'}}},result:{responseModel:{intent:'CLEANING_REQUEST_CREATED',payload:{serviceName:'Deep Villa Cleaning'}}}});
  const converted=(await container.leadService.list('cleaning-demo')).find(item=>item.customerId===customerId);
  assert.equal(converted.status,'converted');
  assert.equal(converted.score,100);
  assert.equal(converted.grade,'hot');

  assert.equal((await container.leadService.list('default')).some(item=>item.customerId===customerId),false);
  const summary=await container.leadService.summary('cleaning-demo');
  assert.ok(summary.converted>=1);
});
