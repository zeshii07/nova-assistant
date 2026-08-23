const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');
const tenantId='v413-karyana';const tenantDir=path.join(__dirname,'..','tenants',tenantId);let c;
async function q(u,text){return c.executionEngine.process({tenantId,channel:'v413',customerId:u,text});}
test.before(async()=>{
 fs.rmSync(tenantDir,{recursive:true,force:true});
 new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')}).create({id:tenantId,name:'Karyana 413',offerings:[
  {name:'Super Basmati Rice (1kg)',type:'product',price:340,aliases:['rice','chawal'],inStock:true},
  {name:'Dal Chana / Gram Pulse (1kg)',type:'product',price:280,aliases:['dal chana','daal chana'],inStock:true}
 ]});
 c=await buildContainer();c.llmRouter.providers=[];
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));


test('informal Roman Urdu greeting answers the social question naturally',async()=>{
 const r=await q('social','hello bhai kiaa hal hai');
 assert.equal(r.capabilityId,'assistant');
 assert.match(r.reply,/theek|shukriya/i);
 assert.match(r.reply,/bhai/i);
});

test('confirmation parser accepts polite Roman Urdu variants',async()=>{
 const {isConfirmation}=require('../packages/conversation-intelligence/src/confirmation');
 for(const x of ['confirm kro bhai jan','order confirm kar do bhai','ok confirm karo','pakka bhai','confirm my order please']) assert.equal(isConfirmation(x),true,x);
});


test('conversation-intelligence failure cannot leak a raw exception to customer',async()=>{
 const original=c.conversationIntelligenceEngine.analyze.bind(c.conversationIntelligenceEngine);
 c.conversationIntelligenceEngine.analyze=async()=>{throw new Error('forced-intelligence-failure')};
 try{
   const r=await q('safe-intel','hello');
   assert.ok(r.reply);assert.doesNotMatch(r.reply,/forced-intelligence-failure|Cannot read|TypeError|ERROR:/i);
 }finally{c.conversationIntelligenceEngine.analyze=original;}
});

test('humanization failure falls back to capability reply without crashing',async()=>{
 const original=c.humanizationEngine.humanize.bind(c.humanizationEngine);
 c.humanizationEngine.humanize=async()=>{throw new Error('forced-humanization-failure')};
 try{
   const r=await q('safe-human','hello');
   assert.ok(r.reply);assert.doesNotMatch(r.reply,/forced-humanization-failure|TypeError|ERROR:/i);
 }finally{c.humanizationEngine.humanize=original;}
});

test('replay recorder failure never blocks the user response',async()=>{
 const original=c.replayService.record.bind(c.replayService);
 c.replayService.record=async()=>{throw new Error('forced-replay-failure')};
 try{
   const r=await q('safe-replay','hello');
   assert.ok(r.reply);assert.doesNotMatch(r.reply,/forced-replay-failure|TypeError|ERROR:/i);
 }finally{c.replayService.record=original;}
});

test('multi item cart confirms without catalog draft and never throws selectedAttributes error',async()=>{
 let r=await q('x','mujhy 4 kg dal chana aur 3 kg rice dy do');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Dal Chana/);assert.match(r.reply,/Rice/);
 assert.equal(r.state.capabilityState.catalog?.selectedAttributes,undefined);
 r=await q('x','confirm kro bhai jan');
 assert.equal(r.capabilityId,'commerce');assert.match(r.reply,/Order Summary|cart/i);assert.match(r.reply,/name|naam/i);
 assert.equal(r.state.capabilityState.commerce.pendingField,'name');
});
