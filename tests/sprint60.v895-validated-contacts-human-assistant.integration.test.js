const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const runRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v895-'));
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
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'v895',customerId,text});

test.before(async()=>{container=await buildContainer();container.llmRouter.providers=[];});
test.after(async()=>{await container.registry.shutdownAll();});

test('shared customer validators accept fields and reject sentences or impossible values',()=>{
  const engagement=new UniversalEngagementEngine({now:()=>new Date('2026-08-20T12:00:00Z')});
  assert.deepEqual(engagement.parseField('name','my name is zeeshan'),{valid:true,value:'Zeeshan'});
  assert.deepEqual(engagement.parseField('name','my name is zeeshan and my email is zee@example.com'),{valid:true,value:'Zeeshan'});
  assert.equal(engagement.parseField('name','hello how are you doing today').valid,false);
  assert.equal(engagement.parseField('date','31/02/2027').valid,false);
  assert.equal(engagement.parseField('date','29/02/2028').valid,true);
  assert.equal(engagement.parseField('time','25:90').valid,false);
  assert.equal(engagement.parseField('phone','my phone is 03019299608').value,'03019299608');
  assert.equal(engagement.parseField('phone','call me tomorrow at 03019299608').valid,false);
  assert.equal(engagement.parseField('address','Lahore').valid,false);
  assert.equal(engagement.parseField('address','Apartment 23, Building 78, Al Barsha, Dubai').valid,true);
  assert.equal(engagement.parseField('email','zee@example.com').value,'zee@example.com');
  assert.equal(engagement.parseField('email','zee@example').valid,false);
});

test('cleaning understands sofa work, reports multiple supported services, enforces hours, and stores validated optional contact',async()=>{
  let response=await ask('cleaning-demo','sofa-start','hello i wnat my sofa to be cleaned');
  assert.equal(response.capabilityId,'cleaning');
  assert.equal(response.state.capabilityState.cleaning.serviceId,'CLN003');

  response=await ask('cleaning-demo','multi-support','do you offer sofa and mattress cleaning');
  assert.equal(response.intelligence.selected.intent,'availability.multi_service_support');
  assert.match(response.reply,/Sofa Cleaning/);
  assert.match(response.reply,/Mattress Cleaning/);

  const customer='validated-cleaning';
  response=await ask('cleaning-demo',customer,'book a mattress cleaning service');
  assert.equal(response.state.capabilityState.cleaning.step,'date');

  response=await ask('cleaning-demo',customer,'monday 4 am');
  assert.equal(response.state.capabilityState.cleaning.preferredDate,'24/08/2026');
  assert.equal(response.state.capabilityState.cleaning.preferredTime,null);
  assert.equal(response.state.capabilityState.cleaning.step,'time');
  assert.match(response.reply,/outside our business hours/i);
  assert.match(response.reply,/9 AM to 7 PM/i);

  response=await ask('cleaning-demo',customer,'10 am');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  response=await ask('cleaning-demo',customer,'Lahore');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  assert.equal(response.state.capabilityState.cleaning.address,null);

  await ask('cleaning-demo',customer,'Apartment 23, Building 78, Al Barsha, Dubai');
  response=await ask('cleaning-demo',customer,'my name is zeeshan and my email is zee@example.com');
  assert.equal(response.state.capabilityState.cleaning.name,'Zeeshan');
  assert.equal(response.state.capabilityState.cleaning.email,'zee@example.com');
  assert.equal(response.state.capabilityState.cleaning.step,'phone');

  response=await ask('cleaning-demo',customer,'hello how are you');
  assert.equal(response.state.capabilityState.cleaning.phone,null);
  assert.equal(response.state.capabilityState.cleaning.step,'phone');

  response=await ask('cleaning-demo',customer,'my phone is 03019299608');
  assert.equal(response.state.capabilityState.cleaning.step,'confirm');
  assert.match(response.reply,/Email \(optional\): zee@example\.com/i);
  const crm=await container.crmService.getCustomer('cleaning-demo',customer);
  assert.equal(crm.name,'Zeeshan');
  assert.equal(crm.phone,'03019299608');
  assert.equal(crm.email,'zee@example.com');
});

test('cross-domain and unmatched questions receive friendly tenant-aware boundaries',async()=>{
  let response=await ask('default','retail-boundary','Can you clean my sofa tomorrow?');
  assert.equal(response.intelligence.selected.intent,'assistant.domain_mismatch');
  assert.match(response.reply,/configured as a retail business/i);
  assert.match(response.reply,/don’t provide cleaning services/i);
  assert.match(response.reply,/products/i);

  response=await ask('cleaning-demo','cleaning-boundary','Can I buy blue jeans?');
  assert.equal(response.intelligence.selected.intent,'assistant.domain_mismatch');
  assert.match(response.reply,/configured as a cleaning business/i);
  assert.match(response.reply,/don’t provide retail products/i);
  assert.match(response.reply,/cleaning request/i);
});

test('generic booking rejects a valid clock time outside tenant hours and keeps the workflow',async()=>{
  const customer='salon-hours';
  let response=await ask('salon-demo',customer,'I want to book a haircut on Monday at 2 am');
  const state=response.state.capabilityState.booking;
  assert.equal(response.capabilityId,'booking');
  assert.equal(state.slots.date,'24/08/2026');
  assert.equal(state.slots.time,undefined);
  assert.equal(state.pendingField,'time');
  assert.match(response.reply,/outside our business hours/i);
  assert.match(response.reply,/10:00 AM to 9:00 PM/i);

  response=await ask('salon-demo',customer,'11 am');
  assert.equal(response.state.capabilityState.booking.pendingField,'name');
  assert.equal(response.state.capabilityState.booking.slots.time,'11 am');
});

test('retail checkout accepts email as an optional contact without replacing the required phone step',async()=>{
  const customer='retail-optional-email';
  await ask('default',customer,'i want a school bag');
  await ask('default',customer,'black 1 piece');
  let response=await ask('default',customer,'confirm');
  assert.equal(response.state.capabilityState.commerce.pendingField,'name');
  response=await ask('default',customer,'Akbar Khan');
  assert.equal(response.state.capabilityState.commerce.pendingField,'phone');
  response=await ask('default',customer,'akbar@example.com');
  assert.equal(response.state.capabilityState.commerce.pendingField,'phone');
  assert.match(response.reply,/optional email contact/i);
  response=await ask('default',customer,'03024567876');
  assert.equal(response.state.capabilityState.commerce.pendingField,'city');
  const crm=await container.crmService.getCustomer('default',customer);
  assert.equal(crm.email,'akbar@example.com');
});
