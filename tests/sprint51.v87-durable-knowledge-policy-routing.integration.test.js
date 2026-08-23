const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {TenantOperationalManager}=require('../packages/tenant-operations/src/tenantOperationalManager');

let container,dataDir,staticSourcesBefore,previousEnvironment;
async function ask(customerId,text){return container.executionEngine.process({tenantId:'cleaning-demo',channel:'v87',customerId,text});}

const POLICY_KNOWLEDGE=`
# Booking and Confirmation
A booking is confirmed only after the customer receives a booking reference and a confirmed date/time window.
A quote or availability response alone is not a confirmed booking.

# Arrival Time Policy
The normal arrival window runs from the booked time through 30 minutes afterward.
If the company is more than 60 minutes late and the customer no longer wishes to proceed, the customer may cancel without a cancellation fee.

# Rescheduling Policy
More than 24 hours before the scheduled start: rescheduling is free.
Between 6 and 24 hours before the scheduled start: one reschedule is allowed with a Rs 500 rescheduling fee.
Less than 6 hours before the scheduled start: a fee equal to 50% of the booked service price applies.

# Cancellation Policy
More than 24 hours before start: no fee.
6-24 hours before start: Rs 750.
Less than 6 hours before start: 50% of booked service price.
After team arrives or there is no access: 75% of booked service price.

# Safety and Service Limitations
Cleaning is limited to areas safely reachable from the floor or with a small household step stool.
Exterior high-rise window cleaning is not offered.

# Cleaning Team and Equipment
Fragrance-free products are available at no extra charge when requested at least 12 hours before arrival.

# Pets and Children
A Rs 1,000 pet-hair surcharge applies only when heavy pet-hair removal is requested or clearly required. Simply having a pet does not automatically trigger the fee.
`;

test.before(async()=>{
  previousEnvironment={
    localDataDir:process.env.NOVA_LOCAL_DATA_DIR,
    knowledgeDataDir:process.env.NOVA_KNOWLEDGE_DATA_DIR,
    operationalDataDir:process.env.NOVA_OPERATIONAL_DATA_DIR
  };
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v87-data-'));
  process.env.NOVA_LOCAL_DATA_DIR=dataDir;
  delete process.env.NOVA_KNOWLEDGE_DATA_DIR;
  delete process.env.NOVA_OPERATIONAL_DATA_DIR;
  const staticSources=path.join(__dirname,'..','tenants','cleaning-demo','knowledge','sources.json');
  staticSourcesBefore=fs.existsSync(staticSources)?fs.readFileSync(staticSources,'utf8'):null;
  container=await buildContainer();container.llmRouter.providers=[];
  await container.tenantKnowledgeManager.addFile('cleaning-demo',{filePath:path.join(__dirname,'fixtures','sparklecare-v81-full-knowledge.pdf'),title:'Durable PDF source',priority:60});
  container.tenantKnowledgeManager.addDocument('cleaning-demo',{title:'V87 cleaning policy acceptance',format:'md',text:POLICY_KNOWLEDGE,priority:100});
});

test.after(async()=>{
  await container?.registry?.shutdownAll?.();
  restoreEnvironment('NOVA_LOCAL_DATA_DIR',previousEnvironment.localDataDir);
  restoreEnvironment('NOVA_KNOWLEDGE_DATA_DIR',previousEnvironment.knowledgeDataDir);
  restoreEnvironment('NOVA_OPERATIONAL_DATA_DIR',previousEnvironment.operationalDataDir);
});

test('uploaded PDF and edited knowledge survive container recreation without mutating tenant source files',async()=>{
  const overlay=path.join(dataDir,'tenant-knowledge','cleaning-demo','knowledge');
  assert.equal(fs.existsSync(path.join(overlay,'sources.json')),true);
  assert.equal(fs.existsSync(path.join(overlay,'originals','durable-pdf-source.pdf')),true);
  const staticSources=path.join(__dirname,'..','tenants','cleaning-demo','knowledge','sources.json');
  assert.equal(fs.existsSync(staticSources)?fs.readFileSync(staticSources,'utf8'):null,staticSourcesBefore);

  container.tenantKnowledgeManager.setFact('cleaning-demo',{key:'policies.v87Durability',value:'retained'});
  await container.registry.shutdownAll();
  container=await buildContainer();container.llmRouter.providers=[];
  const overview=container.tenantKnowledgeManager.overview('cleaning-demo');
  assert.equal(overview.storage.mode,'durable-overlay');
  assert.equal(overview.business.policies.v87Durability,'retained');
  assert.ok(overview.sources.some(x=>x.title==='Durable PDF source'));
  assert.ok(overview.sources.some(x=>x.title==='V87 cleaning policy acceptance'));

  const other=container.knowledgeService.retrieve('what is the 6-24 hour cancellation fee',container.tenantRepository.getById('default'),{minScore:.08,minSemantic:.05});
  assert.doesNotMatch(other.context||'',/Rs 750/i);
});

test('cleaning policy questions resolve the applicable uploaded rule instead of raw chunks',async()=>{
  let r=await ask('policy-cancel','My cleaning appointment is tomorrow at 6 PM. If I cancel today at 10 PM, what cancellation fee applies?');
  assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/20 hours.*Rs 750/i);

  r=await ask('policy-move',"My appointment is 10 hours from now. I don't want to cancel it, but I need to move it to tomorrow. What fee will I pay?");
  assert.equal(r.capabilityId,'assistant');assert.match(r.reply,/10 hours.*Rs 500/i);assert.doesNotMatch(r.reply,/Rs 750/i);

  r=await ask('policy-arrival-window',"My booking is at 8:00 AM and the cleaners haven't arrived at 8:15 AM. Are they officially late?");
  assert.match(r.reply,/No.*15 minutes.*within.*30 minutes/is);

  r=await ask('policy-late-cancel',"My booking was at 8:00 AM and it's now 9:10 AM. The cleaners still haven't arrived and I don't want the service anymore. Will I be charged for cancelling?");
  assert.match(r.reply,/70 minutes late.*without a cancellation fee/is);

  r=await ask('policy-safety','I live on the 15th floor. Can your cleaners clean the outside of my windows by climbing outside? How much does that cost?');
  assert.match(r.reply,/No.*high-rise window cleaning is not offered/is);

  r=await ask('policy-confirmation','You told me that cleaning my apartment will cost Rs 6,200. Does that mean my appointment is confirmed?');
  assert.match(r.reply,/No.*quote.*not a confirmed booking.*booking reference.*date\/time window/is);
});

test('a quote-and-availability-only first turn extracts every supplied field without starting customer-detail collection',async()=>{
  const r=await ask('provided-slots','Hi, I need 2 cleaners this Saturday from 9:00 AM to 12:00 PM for a 3-bedroom apartment. I need the kitchen, bathrooms, floors, windows, and balcony cleaned. Please check availability and price before confirming anything.');
  const state=r.state.capabilityState.cleaning;
  assert.equal(r.capabilityId,'cleaning');
  const inquiry=state.pendingAvailabilityInquiry;
  assert.equal(inquiry.bedrooms,3);assert.equal(inquiry.cleanerCount,2);assert.equal(inquiry.durationHours,3);
  assert.equal(inquiry.startTime,'09:00');assert.equal(inquiry.endTime,'12:00');
  assert.equal(state.step,undefined);assert.match(r.reply,/No booking has been created/i);assert.doesNotMatch(r.reply,/share the full service address|what date|what time/i);
});

test('a fresh detailed request does not accept a stale custom-quote draft',async()=>{
  const customer='fresh-after-custom';
  let r=await ask(customer,"I have a 7-bedroom villa. What's your fixed cleaning price?");
  assert.equal(r.state.capabilityState.cleaning.customQuotePending.bedrooms,7);
  r=await ask(customer,'I need 2 cleaners tomorrow for 3 hours to clean my apartment. Please calculate the price.');
  assert.equal(r.intelligence.selected.intent,'cleaning.pricing_request');
  assert.equal(r.state.capabilityState.cleaning.cleanerCount,2);assert.equal(r.state.capabilityState.cleaning.durationHours,3);
  assert.equal(r.state.capabilityState.cleaning.customQuotePending,undefined);assert.doesNotMatch(r.reply,/created a custom quotation request/i);
});

test('a legacy reviewed pricing overlay remains a migration input before unified Services is published',async()=>{
  const published={currency:'PKR',services:[
    {id:'hourly-cleaner',name:'Hourly Cleaner Hire',model:'hourly',rate:900,currency:'PKR',operationalServiceId:'CLN-HOURLY',aliases:['cleaner','cleaning','maid']},
    {id:'property-cleaning',name:'Property Cleaning',model:'matrix',keys:['propertyType','bedrooms'],currency:'PKR',operationalServiceId:'CLN001',aliases:['apartment cleaning','standard cleaning'],prices:{'apartment|1':3500,'apartment|2':4800,'apartment|3':6200,'apartment|4':7800}}
  ],addOns:[
    {id:'balcony',name:'balcony cleaning',inputKey:'balconies',rate:800},
    {id:'interior-window',name:'interior window',inputKey:'interiorWindows',rate:300},
    {id:'inside-refrigerator',name:'inside refrigerator',inputKey:'insideRefrigerator',rate:1200},
    {id:'inside-oven',name:'inside oven',inputKey:'insideOven',rate:1500}
  ],discounts:[]};
  const legacyManager=new TenantOperationalManager({tenantsDir:container.config.tenantsDir,operationalDataDir:container.config.operationalDataDir});
  const saved=legacyManager.publishPricing('cleaning-demo',published);
  assert.equal(saved.source,'durable-published');

  let r=await ask('published-property','I have a 3-bedroom apartment and need standard cleaning plus 2 balconies and 4 interior windows. What will the total cost be? Show me the calculation.');
  assert.equal(r.capabilityId,'cleaning');assert.match(r.reply,/Rs9,000/i);assert.match(r.reply,/2 × Rs800 balcony cleaning/i);assert.match(r.reply,/4 × Rs300 interior window/i);

  const compound="I need 2 cleaners tomorrow for 3 hours to clean my apartment. I also need 2 balconies, 5 interior windows, inside refrigerator cleaning, and inside oven cleaning. I have a cat but there isn't heavy pet hair. Please calculate the complete price. I want fragrance-free products, but the appointment is only 8 hours away. Also, I might cancel 4 hours before the appointment. Tell me what would happen, what cancellation fee would apply, whether there's a pet surcharge, and whether you can guarantee fragrance-free products. Don't invent any policy that isn't in your knowledge base.";
  r=await ask('published-compound',compound);
  assert.match(r.reply,/Rs11,200/i);assert.doesNotMatch(r.reply,/not mapped as separately priced add-ons/i);
  assert.match(r.reply,/4 hours.*50%.*Rs5,600/is);assert.match(r.reply,/no pet surcharge applies/is);assert.match(r.reply,/8 hours.*12 hours.*cannot be guaranteed/is);

  await container.registry.shutdownAll();container=await buildContainer();container.llmRouter.providers=[];
  assert.equal(container.pricingService.getConfig('cleaning-demo').currency,'PKR');
  assert.equal(legacyManager.getPricing('cleaning-demo').source,'durable-published');
});

function restoreEnvironment(key,value){
  if(value===undefined)delete process.env[key];
  else process.env[key]=value;
}
