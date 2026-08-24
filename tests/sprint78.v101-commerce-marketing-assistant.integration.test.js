const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {replyToNovaVisitor}=require('../apps/api/src/novaMarketingAssistant');

let container;
const ask=(customerId,text)=>container.executionEngine.process({tenantId:'default',channel:'v101',customerId,text});
const askCleaning=(customerId,text)=>container.executionEngine.process({tenantId:'cleaning-demo',channel:'v101-cleaning',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v101-data-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
  container.llmRouter.providers=[];
});

test.after(async()=>{await container.registry.shutdownAll();});

async function seedReturningCustomer(customerId,name='James Odin'){
  await container.crmService.updateCustomerProfile({
    tenantId:'default',customerId,name,phone:'0301926756543',email:'zeeshan@gmail.com',
    customFields:{lastDelivery:{city:'Lahore',address:'Near Ali Town, Westwood Colony, Lahore',paymentMethod:'Cash on Delivery'}}
  });
}

async function preparePanCheckout(customerId){
  await ask(customerId,'i want to buy a frying pan');
  await ask(customerId,'24cm 3 pieces');
  return ask(customerId,'confirm');
}

test('editing one saved checkout detail reuses every unchanged saved detail',async()=>{
  const customerId='partial-saved-detail-edit';
  await seedReturningCustomer(customerId);
  let response=await preparePanCheckout(customerId);
  assert.match(response.reply,/saved customer details/i);

  response=await ask(customerId,'update my name to Aryan');
  assert.equal(response.state.capabilityState.commerce.mode,'review');
  assert.match(response.reply,/Name: Aryan/);
  assert.match(response.reply,/Phone: 0301926756543/);
  assert.match(response.reply,/Near Ali Town/);
  assert.doesNotMatch(response.reply,/best contact phone/i);

  const cart=await container.commerceRepository.getCart('default',customerId);
  assert.equal(cart.checkout.name,'Aryan');
  assert.equal(cart.checkout.phone,'0301926756543');
  assert.equal(cart.checkout.city,'Lahore');
  assert.equal(cart.checkout.paymentMethod,'Cash on Delivery');
});

test('confirming a complete saved-details offer places only the current cart',async()=>{
  const customerId='saved-confirm-current-cart';
  await seedReturningCustomer(customerId,'Aryan');
  const response=await preparePanCheckout(customerId);
  assert.match(response.reply,/saved customer details/i);

  const confirmed=await ask(customerId,'ok confirm');
  assert.match(confirmed.reply,/order is confirmed/i);
  const orders=await container.commerceRepository.listOrders('default',customerId);
  assert.equal(orders.length,1);
  assert.equal(orders[0].items.length,1);
  assert.equal(orders[0].items[0].name,'Non-stick Frying Pan');
  assert.equal(await container.commerceRepository.getCart('default',customerId),null);
});

test('use my details means the complete saved checkout profile',async()=>{
  const customerId='plain-use-my-details';
  await seedReturningCustomer(customerId,'Aryan');
  await preparePanCheckout(customerId);
  const response=await ask(customerId,'use my details');
  assert.equal(response.state.capabilityState.commerce.mode,'review');
  assert.match(response.reply,/Phone: 0301926756543/);
  assert.doesNotMatch(response.reply,/best contact phone/i);
});

test('adding shoes during checkout does not re-add the previous catalog draft',async()=>{
  const customerId='checkout-add-shoes';
  await seedReturningCustomer(customerId);
  await preparePanCheckout(customerId);
  const response=await ask(customerId,'add some shoes in this order');
  assert.match(response.reply,/Running Shoes/);
  assert.match(response.reply,/color, size and quantity/i);
  assert.doesNotMatch(response.reply,/Frying Pan has been added/i);
  const cart=await container.commerceRepository.getCart('default',customerId);
  assert.equal(cart.items.length,1);
  assert.equal(cart.items[0].name,'Non-stick Frying Pan');
});

test('Nova public assistant explains the product, purpose, tasks, and creator without tenant routing',()=>{
  const intro=replyToNovaVisitor('what is nova and what can it do?');
  assert.match(intro.reply,/business/i);
  assert.match(intro.reply,/booking|customer support/i);
  assert.match(intro.reply,/do you want/i);

  const creator=replyToNovaVisitor('who made you?');
  assert.match(creator.reply,/Zeeshan made me with love/i);
  assert.match(creator.reply,/customer-related automation/i);

  const chat=replyToNovaVisitor('how are you today?');
  assert.match(chat.reply,/doing|great|well/i);
  assert.match(chat.reply,/business|assistant/i);
});

test('Nova public assistant covers common buyer, operational, trust, and technical questions',()=>{
  const cases=[
    ['Which types of businesses can use Nova?',/cleaning|retail|healthcare/i],
    ['Can Nova work on WhatsApp and a website?',/WhatsApp/i],
    ['How do you protect customer data?',/tenant|separate|isolat/i],
    ['How do I onboard my business?',/onboarding|configure/i],
    ['Which languages do you support?',/English.*Urdu|Urdu.*English/i],
    ['Can a human agent take over?',/human/i],
    ['How are you different from a basic chatbot?',/workflow|transaction/i],
    ['Can I customize Nova for my brand?',/brand|custom/i],
    ['Can Nova run without a language model?',/deterministic|language model/i],
    ['How can Nova be deployed?',/deploy|host|Render/i]
  ];
  for(const [question,pattern] of cases){
    const answer=replyToNovaVisitor(question);
    assert.match(answer.reply,pattern,question);
    assert.ok(Array.isArray(answer.suggestions)&&answer.suggestions.length>=2,question);
  }
});

test('Nova public assistant supports short contextual follow-ups',()=>{
  const answer=replyToNovaVisitor('yes please',{previousTopic:'capabilities'});
  assert.match(answer.reply,/cleaning|retail|restaurant|clinic/i);
  assert.notEqual(answer.topic,'fallback');
});

test('public assistant UI is marketing-only and tenant switches clear active carts',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../apps/public-chat/public/index.html'),'utf8');
  const publicApp=fs.readFileSync(path.join(__dirname,'../apps/public-chat/public/app.js'),'utf8');
  const developerApp=fs.readFileSync(path.join(__dirname,'../apps/developer-console/public/app.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../apps/api/src/server.js'),'utf8');
  assert.doesNotMatch(html,/Choose a business|id="tenant"/i);
  assert.match(html,/class="product-panel"/);
  assert.match(html,/class="chat-panel"/);
  assert.match(publicApp,/api\/assistant\/chat/);
  assert.match(publicApp,/previousTopic/);
  assert.match(publicApp,/renderSuggestions/);
  assert.doesNotMatch(publicApp,/api\/public\/tenants/);
  assert.match(developerApp,/clearCart:true/);
  assert.match(server,/api\/assistant\/chat/);
});

test('returning cleaning customers see their complete saved profile before any detail prompt',async()=>{
  const customerId='proactive-cleaning-profile';
  await container.crmService.updateCustomerProfile({
    tenantId:'cleaning-demo',customerId,name:'James Odin',phone:'03077374765',email:'james@example.com',
    customFields:{primaryAddress:'Villa 34, JVC Phase 2, Dubai'}
  });
  await askCleaning(customerId,'i need my apartment cleaning on tuseday around 11 am are you available');
  await askCleaning(customerId,'standard cleaning');
  const review=await askCleaning(customerId,'2 cleaners for 4 hours');
  assert.equal(review.state.capabilityState.cleaning.step,'confirm');
  assert.match(review.reply,/saved (?:customer|contact) details/i);
  assert.match(review.reply,/Villa 34, JVC Phase 2, Dubai/);
  assert.match(review.reply,/James Odin/);
  assert.match(review.reply,/03077374765/);
  assert.match(review.reply,/keep all/i);
  assert.doesNotMatch(review.reply,/share the full service address/i);

  const confirmed=await askCleaning(customerId,'keep all details the same');
  assert.match(confirmed.reply,/request has been received|booking is confirmed/i);
});

test('new cleaning customers are asked only for genuinely missing details',async()=>{
  const customerId='new-cleaning-customer';
  await askCleaning(customerId,'i need my apartment cleaning on tuseday around 11 am are you available');
  await askCleaning(customerId,'standard cleaning');
  const response=await askCleaning(customerId,'2 cleaners for 4 hours');
  assert.equal(response.state.capabilityState.cleaning.step,'address');
  assert.match(response.reply,/service address/i);
  assert.doesNotMatch(response.reply,/saved (?:customer|contact) details/i);
});
