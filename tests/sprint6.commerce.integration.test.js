const test = require("node:test"); const assert = require("node:assert/strict"); const { buildContainer } = require("../apps/api/src/container");
test("commerce completes catalog-backed checkout", async () => {
 const c=await buildContainer(); const base={tenantId:"default",customerId:"commerce-user",channel:"http"};
 let r=await c.executionEngine.process({...base,text:"i want 1 black wireless airbud"}); assert.equal(r.capabilityId,"catalog"); assert.match(r.reply,/Rs4,500/);
 r=await c.executionEngine.process({...base,text:"confirm order"}); assert.equal(r.capabilityId,"commerce"); assert.match(r.reply,/delivery/i);
 for(const text of ["Zeeshan Ahmad","03019299608","Lahore","Near Dogar Sajji Ali Town Lahore","skip","cash on delivery"]) r=await c.executionEngine.process({...base,text});
 assert.match(r.reply,/customer \/ delivery details|say confirm/i);
 r=await c.executionEngine.process({...base,text:"confirm"});
 assert.equal(r.capabilityId,"commerce"); assert.match(r.reply,/order is confirmed/i); assert.match(r.reply,/ORD-/);
 const orders=await c.commerceRepository.listOrders("default","commerce-user"); assert.equal(orders.length,1); assert.equal(orders[0].total,4500); assert.equal(orders[0].items[0].unitPrice,4500);
});
test("commerce validates phone and keeps pending field", async()=>{
 const c=await buildContainer(); const b={tenantId:"default",customerId:"invalid-phone",channel:"http"};
 await c.executionEngine.process({...b,text:"i want 1 black wireless airbud"}); await c.executionEngine.process({...b,text:"confirm"}); await c.executionEngine.process({...b,text:"Ali"});
 const r=await c.executionEngine.process({...b,text:"123"}); assert.equal(r.capabilityId,"commerce"); assert.match(r.reply,/phone number/i); assert.equal(r.state.capabilityState.commerce.pendingField,"phone");
});
test("commerce lists orders", async()=>{
 const c=await buildContainer(); const b={tenantId:"default",customerId:"none",channel:"http"}; const r=await c.executionEngine.process({...b,text:"my orders"}); assert.equal(r.capabilityId,"commerce"); assert.match(r.reply,/do not have any orders/i);
});
