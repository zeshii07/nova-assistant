const test=require('node:test');const assert=require('node:assert/strict');
const {buildContainer}=require('../apps/api/src/container');
let c;
async function q(u,text){return c.executionEngine.process({tenantId:'default',channel:'v531',customerId:u,text});}
test.before(async()=>{c=await buildContainer();c.llmRouter.providers=[];});

test('exact available product is selected and its normal attribute flow starts',async()=>{
 const r=await q('exact','can i get led desk lamp');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/Yes.*LED Desk Lamp.*available/i);
 assert.match(r.reply,/What color would you like/i);
 assert.equal(r.state.capabilityState.catalog.selectedProductId,'P013');
});

test('unavailable fountain pen never becomes Gel Pen Pack but recommends it',async()=>{
 const r=await q('fountain','do you have fountain pen');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/fountain pen/i);assert.match(r.reply,/(?:not available|don.t have)/i);
 assert.match(r.reply,/Gel Pen Pack/i);
 assert.match(r.reply,/similar available options|consider/i);
 assert.equal(r.state.capabilityState.catalog?.selectedProductId??null,null);
 assert.ok(r.state.capabilityState.catalog.suggestedProductIds?.length);
});

test('unavailable plastic bottle may recommend Steel Water Bottle without selecting it',async()=>{
 const r=await q('plastic','i want to buy plastic water bottle');
 assert.equal(r.capabilityId,'catalog');
 assert.match(r.reply,/plastic water bottle/i);assert.match(r.reply,/(?:not available|don.t have)/i);
 assert.match(r.reply,/Steel Water Bottle/i);
 assert.equal(r.state.capabilityState.catalog?.selectedProductId??null,null);
});

test('unavailable ball point pen recommends but never auto-selects Gel Pen Pack',async()=>{
 const r=await q('ball','add a ball point pen into my order');
 assert.equal(r.capabilityId,'commerce');
 assert.match(r.reply,/ball point pen/i);assert.match(r.reply,/(?:not available|don.t have)/i);
 assert.match(r.reply,/Gel Pen Pack/i);
 assert.equal(r.state.capabilityState.catalog?.selectedProductId??null,null);
});

test('customer can explicitly choose a suggested alternative afterward',async()=>{
 let r=await q('choose','do you have fountain pen');
 assert.equal(r.state.capabilityState.catalog?.selectedProductId??null,null);
 r=await q('choose','ok show me gel pen pack');
 assert.match(r.reply,/Yes.*Gel Pen Pack.*available/i);
 assert.equal(r.state.capabilityState.catalog.selectedProductId,'P018');
 assert.match(r.reply,/What color would you like/i);
});

test('unrelated unavailable item does not invent an alternative',async()=>{
 const r=await q('pajama','can i get tight pajamas');
 assert.match(r.reply,/tight pajamas/i);assert.match(r.reply,/(?:not available|don.t have)/i);
 assert.equal(r.state.capabilityState.catalog?.selectedProductId??null,null);
});
