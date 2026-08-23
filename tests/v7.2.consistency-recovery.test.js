const test=require('node:test');
const assert=require('node:assert/strict');
const {InMemoryCommerceRepository}=require('../packages/commerce-engine/src/inMemoryCommerceRepository');
const {InMemoryBookingRepository}=require('../packages/booking-engine/src/inMemoryBookingRepository');
const {BookingService}=require('../packages/booking-engine/src/bookingService');
const {fingerprint}=require('../packages/shared/src/idempotency');

test('v7.2 stable fingerprints ignore object key ordering',()=>{
 assert.equal(fingerprint('x',{a:1,b:{c:2,d:3}}),fingerprint('x',{b:{d:3,c:2},a:1}));
});

test('v7.2 commerce repository makes repeated transaction key idempotent',async()=>{
 const r=new InMemoryCommerceRepository();
 const base={tenantId:'store-a',customerId:'c1',status:'confirmed',total:100,currency:'PKR',idempotencyKey:'cart:C1'};
 const a=await r.createOrder({...base,id:'O1'}); const b=await r.createOrder({...base,id:'O2'});
 assert.equal(a.id,'O1');assert.equal(b.id,'O1');assert.equal((await r.listOrders('store-a','c1')).length,1);
 assert.equal(await r.getOrder('store-b','O1'),null);
});

test('v7.2 booking confirmation is idempotent for same conversation and slots',async()=>{
 const repository=new InMemoryBookingRepository();
 const svc=new BookingService({repository,configRepository:{load:()=>({})}});
 const scoped=svc.scope({tenant:{id:'clinic-a'},customerId:'c1',conversationId:'conv-1'});
 const slots={subject:'Dermatology',date:'24/08/2026',time:'9 am',name:'Zeeshan',phone:'03019299608'};
 const a=await scoped.create(slots); const b=await scoped.create({...slots});
 assert.equal(a.id,b.id);assert.equal((await scoped.list()).length,1);
 assert.equal(await repository.get('clinic-b',a.id),null);
});

test('v7.2 same booking details in a different conversation remain a new intentional booking',async()=>{
 const repository=new InMemoryBookingRepository();
 const svc=new BookingService({repository,configRepository:{load:()=>({})}});
 const slots={subject:'Haircut',date:'24/08/2026',time:'9 am'};
 const a=await svc.scope({tenant:{id:'salon'},customerId:'c1',conversationId:'conv-a'}).create(slots);
 const b=await svc.scope({tenant:{id:'salon'},customerId:'c1',conversationId:'conv-b'}).create(slots);
 assert.notEqual(a.id,b.id);
});
