const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {extractFieldAmendment}=require('../packages/conversation-intelligence/src/fieldAmendmentExtractor');
const {TemporalSemanticExtractor}=require('../packages/conversation-intelligence/src/temporalSemanticExtractor');

let container;
const ask=(tenantId,customerId,text)=>container.executionEngine.process({tenantId,channel:'local-stress-kit',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-local-kit-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

test('Roman Urdu service discovery is handled locally',async()=>{
  const response=await ask('cleaning-demo','kit-service-list','ap log kis kis type ki clening krty ho');
  assert.equal(response.capabilityId,'cleaning');
  assert.match(response.reply,/Standard Home Cleaning|Deep Home Cleaning/i);
});

test('hourly price-only question does not start booking detail collection',async()=>{
  const response=await ask('cleaning-demo','kit-price-only','How much would 2 cleaners for 3 hours cost for standard cleaning?');
  assert.match(response.reply,/AED 240/i);
  assert.equal(response.state.capabilityState.cleaning?.step??null,null);
  assert.doesNotMatch(response.reply,/what date|service address|full name|phone number/i);
});

test('Roman Urdu deep-villa quote resolves the configured property matrix',async()=>{
  const response=await ask('cleaning-demo','kit-deep-villa','5 bedroom villa ki full deep cleaning kitny ki hogi');
  assert.match(response.reply,/AED 580/i);
  assert.equal(response.state.capabilityState.cleaning?.step??null,null);
});

test('standard-cleaning typo preserves the complete scheduled villa request',async()=>{
  const response=await ask('cleaning-demo','kit-standard-typo','can you do stndrad vila clenening on tuseday at 10 am, 2 cleaners for 3 hrs');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.cleanerCount,2);
  assert.equal(state.durationHours,3);
  assert.equal(state.preferredTime,'10:00');
  assert.doesNotMatch(response.reply,/Standard Cleaning or Deep Cleaning/i);
});

test('Roman Urdu date and colloquial time range are extracted together',async()=>{
  const temporal=new TemporalSemanticExtractor().extract('26/09/2026 ko subha 10 bjy sy 1 bjy tak');
  assert.deepEqual({date:temporal.dateText,start:temporal.startTime,end:temporal.endTime,hours:temporal.durationHours},{date:'26/09/2026',start:'10:00',end:'13:00',hours:3});
  const response=await ask('cleaning-demo','kit-roman-complete','mujhy 2 cleaners chahiy 26/09/2026 ko subha 10 bjy sy 1 bjy tak standard safai k liy, 3 bedroom apartment hai aur 2 balcony bhi clean krni hain');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.cleanerCount,2);
  assert.equal(state.durationHours,3);
  assert.equal(state.preferredDate,'26/09/2026');
  assert.equal(state.preferredTime,'10:00');
  assert.equal(state.balconies,2);
  assert.match(response.reply,/AED 240/i);
});

test('Urdu deep-apartment request understands Urdu digits, month, clock and scope',async()=>{
  const response=await ask('cleaning-demo','kit-urdu-complete','مجھے ۲۹ ستمبر ۲۰۲۶ کو صبح دس بجے تین کمروں والے فلیٹ کی مکمل گہری صفائی کروانی ہے۔');
  const state=response.state.capabilityState.cleaning;
  assert.equal(state.serviceId,'CLN010');
  assert.equal(state.bedrooms,3);
  assert.equal(state.preferredDate,'29/09/2026');
  assert.equal(state.preferredTime,'10:00');
  assert.match(response.reply,/AED 350/);
});

test('exact dated availability reaches the live availability capability',async()=>{
  const response=await ask('cleaning-demo','kit-live-slot','Is 16/09/2026 at 10 AM available for a 3-seater sofa cleaning?');
  assert.equal(response.capabilityId,'availability');
  assert.match(response.reply,/available|availability|slot|calendar/i);
  assert.equal(response.state.capabilityState.cleaning?.step??null,null);
});

test('ungrounded book-it message cannot select an arbitrary cleaning service',async()=>{
  const response=await ask('cleaning-demo','kit-ambiguous-it','Book it tomorrow on 15/09/2026 at 10 AM and 2 PM.');
  assert.doesNotMatch(response.reply,/Laundry Wash & Fold selected/i);
  assert.equal(response.state.capabilityState.cleaning?.serviceId??null,null);
});

test('business phone question plus cleaner-count negation is not a phone edit',()=>{
  const message='Hi, before doing anything tell me your phone and Saturday hours; then check whether 2 cleaners can do standard cleaning for my 3-bedroom apartment on 30/09/2026 from 10 AM to 1 PM with two balconies and five interior windows, bring fragrance-free supplies if available, total the price, do not confirm, and if that time is unavailable try 2 PM but do not change the number of cleaners.';
  assert.equal(extractFieldAmendment(message,{allowedFields:['name','phone','email','address']}),null);
});

test('Roman Urdu tenant-wide product discovery lists the configured catalog',async()=>{
  const response=await ask('default','kit-catalog-list','ap k pas kon kon si cheezen available hain');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/Cotton T-Shirt|Wireless Earbuds/i);
  assert.doesNotMatch(response.reply,/requested item .* is not available/i);
});

test('oversized product quantity is rejected against inventory',async()=>{
  const response=await ask('default','kit-inventory-limit','I want 999 black Smart Watches.');
  assert.match(response.reply,/only \d+|available|stock/i);
  assert.doesNotMatch(response.reply,/send the .*quantity/i);
  const cart=await container.commerceService.scope({tenant:container.tenantRepository.getById('default'),capabilityId:'commerce',customerId:'kit-inventory-limit'}).getCart();
  assert.equal(cart?.items?.length||0,0);
});

test('a shared color is inherited by both requested shirt variants',async()=>{
  await ask('default','kit-roman-bundle','mujhy 2 black polo shirts chahiy aik small aur aik large, sath aik blue jeans size 36 bhi add kr do');
  const cart=await container.commerceService.scope({tenant:container.tenantRepository.getById('default'),capabilityId:'commerce',customerId:'kit-roman-bundle'}).getCart();
  const polos=cart.items.filter(item=>/Polo Shirt/i.test(item.name));
  assert.equal(polos.length,2);
  assert.deepEqual(polos.map(item=>item.color),['Black','Black']);
  assert.deepEqual(polos.map(item=>item.size).sort(),['L','S']);
});

test('invented add-to-cart product is reported unavailable, not treated as cart view',async()=>{
  const response=await ask('default','kit-invented-product','Add the Nova Quantum Laptop Pro to my cart for Rs1.');
  assert.equal(response.capabilityId,'catalog');
  assert.match(response.reply,/not available|not in our catalog/i);
  assert.doesNotMatch(response.reply,/cart is empty/i);
});
