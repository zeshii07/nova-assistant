const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {buildContainer}=require('../apps/api/src/container');
const {isConfirmation,isWorkflowAcceptance}=require('../packages/conversation-intelligence/src/confirmation');
const {UniversalEngagementEngine}=require('../packages/universal-engagement-engine/src/universalEngagementEngine');
const {replyToNovaVisitor}=require('../apps/api/src/novaMarketingAssistant');

let container;
const ask=(customerId,text)=>container.executionEngine.process({tenantId:'default',channel:'confirmation-bilingual',customerId,text});

test.before(async()=>{
  process.env.NOVA_LOCAL_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nova-confirmation-bilingual-'));
  process.env.NOVA_NLU_MODE='off';
  container=await buildContainer();
});
test.after(async()=>{await container.registry.shutdownAll();});

test('bounded confirmation language accepts reported Roman Urdu typos and send-order wording',()=>{
  for(const phrase of ['ok conirm kr do','conirm kr do','confirm kr do'])assert.equal(isConfirmation(phrase),true,phrase);
  for(const phrase of ['ok thik hai','thik hai bhyj do','theek hai bhej do','order bhj do'])assert.equal(isWorkflowAcceptance(phrase),true,phrase);
});

test('approval language is never valid customer identity or contact data',()=>{
  const engagement=new UniversalEngagementEngine();
  for(const field of ['name','phone','address','city']){
    assert.equal(engagement.parseField(field,'thik hai bhyj do').valid,false,field);
    assert.equal(engagement.parseField(field,'ok conirm kr do').valid,false,field);
  }
});

test('reported Polo Shirt flow reuses saved details and confirms without changing the customer name',async()=>{
  const customerId='roman-confirm-saved-profile';
  await container.crmService.updateCustomerProfile({
    tenantId:'default',customerId,name:'Aryan Ahmad',phone:'0301926756543',email:'zeeshan@gmail.com',
    customFields:{lastDelivery:{city:'Lahore',address:'Near Ali Town, Westwood Colony, Lahore',paymentMethod:'Cash on Delivery'}}
  });
  await ask(customerId,'mujhy polo shirt chahiyy');
  await ask(customerId,'black medium 3 pieces');
  let response=await ask(customerId,'ok conirm kr do');
  assert.equal(response.state.capabilityState.commerce.mode,'checkout');
  assert.equal(response.state.capabilityState.commerce.savedDetailsOffered,true);
  assert.match(response.reply,/Aryan Ahmad/);

  response=await ask(customerId,'thik hai bhyj do');
  assert.equal(response.state.capabilityState.commerce.mode,'idle');
  assert.match(response.reply,/order is confirmed|order confirm/i);
  assert.doesNotMatch(response.reply,/phone number bata dein|full name/i);
  const customer=await container.crmService.getCustomer('default',customerId);
  assert.equal(customer.name,'Aryan Ahmad');
  const orders=await container.commerceRepository.listOrders('default',customerId);
  assert.equal(orders.length,1);
  assert.equal(orders[0].customer.name,'Aryan Ahmad');
});

test('public Nova guide replies in English or Roman Urdu and returns matching suggestions',()=>{
  const english=replyToNovaVisitor('What can Nova do?',{language:'english'});
  assert.equal(english.language,'english');
  assert.match(english.reply,/Nova is|I can/i);

  const roman=replyToNovaVisitor('Nova kya kar sakti hai?',{language:'auto'});
  assert.equal(roman.language,'roman_urdu');
  assert.match(roman.reply,/Nova|business|kar sakti/i);
  assert.ok(roman.suggestions.some(item=>/kya|kaise|kon/i.test(item)));

  const forced=replyToNovaVisitor('Tell me about Nova',{language:'roman_urdu'});
  assert.equal(forced.language,'roman_urdu');
  assert.match(forced.reply,/Main Nova hoon/i);
});

test('public chat is fluid on large screens and exposes a bilingual language control',()=>{
  const root=path.join(__dirname,'../apps/public-chat/public');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(html,/id="language"/);
  assert.match(html,/Roman Urdu/);
  assert.match(html,/NOVA <small>10\.2<\/small>/);
  assert.match(css,/\.app-shell\{[^}]*width:100%/);
  assert.doesNotMatch(css,/body\{[^}]*overflow:hidden/);
  assert.match(css,/@media\(min-width:1600px\)/);
  assert.match(app,/language:languageMode/);
  assert.match(app,/novaPublicLanguage/);
});
