const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
const {canonicalize,hasConcept,aliasesFor}=require('../packages/universal-vocabulary/src');
let c; test.before(async()=>{c=await buildContainer();});
async function q(t,u,text){return c.executionEngine.process({tenantId:t,channel:'v43',customerId:u,text});}

test('Roman Urdu social spelling composes with address terms',async()=>{
 const r=await q('default','v43-social','bhai kysy ho');
 assert.equal(r.capabilityId,'assistant');
 assert.match(r.reply,/theek|well|shukriya|help/i);
});

test('Roman Urdu footwear aliases resolve centrally',async()=>{
 const r=await q('default','v43-shoes','joty kon kon sy hain');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/Running Shoes/i); assert.match(r.reply,/Comfort Slides/i);
});

test('generic thing/cheez language becomes offering discovery',async()=>{
 let r=await q('default','v43-things','tumhary pass aur kia chez hai');
 assert.equal(r.capabilityId,'catalog'); assert.match(r.reply,/Cotton T-Shirt/i); assert.match(r.reply,/Running Shoes/i);
 r=await q('default','v43-things2','what other things do you have');
 assert.equal(r.capabilityId,'catalog'); assert.match(r.reply,/Cotton T-Shirt/i); assert.doesNotMatch(r.reply,/not available right now/i);
});

test('central vocabulary remains editable data and exposes concepts',()=>{
 assert.equal(canonicalize('joty'),'shoes');
 assert.equal(hasConcept('bhai kysy ho','social.how_are_you'),true);
 assert.ok(aliasesFor('catalog.footwear').includes('joty'));
});
