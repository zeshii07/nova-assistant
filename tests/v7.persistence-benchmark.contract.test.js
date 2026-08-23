const test=require('node:test');const assert=require('node:assert/strict');
const {FakePg,FakeRedisClient}=require('./helpers/fakePersistentInfrastructure');
const {RedisStateRepository}=require('../packages/storage/src/redisStateRepository');
const {PostgresCrmRepository}=require('../packages/storage/src/postgresCrmRepository');
const {PostgresCommerceRepository}=require('../packages/storage/src/postgresCommerceRepository');
const {PostgresBookingRepository}=require('../packages/storage/src/postgresBookingRepository');
const {PostgresCleaningRepository}=require('../packages/storage/src/postgresCleaningRepository');
const {buildStorage}=require('../packages/storage/src/storageFactory');

test('zero-dependency development storage is locally durable by default',async()=>{
 const root=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'nova-local-storage-'));
 const s=await buildStorage({config:{storageMode:'memory',localDataDir:root},logger:null});
 assert.equal(s.mode,'local');assert.ok(s.stateRepository);assert.ok(s.crmRepository);assert.ok(s.commerceRepository);await s.close();
});

test('restart persistence: Redis conversation state survives repository re-instantiation',async()=>{
 const shared=new Map(),client1=new FakeRedisClient(shared);await client1.connect();
 const r1=new RedisStateRepository({client:client1,ttlSeconds:3600});
 await r1.save({conversationId:'tenant-a:whatsapp:123',capabilityState:{commerce:{pendingField:'city'}}});
 const client2=new FakeRedisClient(shared);await client2.connect();
 const r2=new RedisStateRepository({client:client2,ttlSeconds:3600});
 const state=await r2.get('tenant-a:whatsapp:123');
 assert.equal(state.capabilityState.commerce.pendingField,'city');
});

test('tenant isolation: same customer identity remains separate across tenants',async()=>{
 const shared={customers:new Map(),activities:[],carts:new Map(),orders:new Map(),bookings:new Map(),requests:new Map()};
 const db=new FakePg(shared),crm=new PostgresCrmRepository({db});
 await crm.upsertCustomer({tenantId:'store-a',customerId:'92300',name:'Store A Zeeshan',phone:'92300'});
 await crm.upsertCustomer({tenantId:'clinic-b',customerId:'92300',name:'Clinic B Zeeshan',phone:'92300'});
 assert.equal((await crm.getCustomer('store-a','92300')).name,'Store A Zeeshan');
 assert.equal((await crm.getCustomer('clinic-b','92300')).name,'Clinic B Zeeshan');
 assert.equal((await crm.searchCustomers('store-a','Clinic')).length,0);
});

test('customer recognition survives CRM repository re-instantiation',async()=>{
 const db1=new FakePg();const shared=db1.store;
 await new PostgresCrmRepository({db:db1}).upsertCustomer({tenantId:'demo',customerId:'wa-1',name:'Zeeshan Ahmad',phone:'03019299608',customFields:{language:'roman_urdu'}});
 const crm2=new PostgresCrmRepository({db:new FakePg(shared)});
 const customer=await crm2.getCustomer('demo','wa-1');
 assert.equal(customer.name,'Zeeshan Ahmad');assert.equal(customer.phone,'03019299608');assert.equal(customer.customFields.language,'roman_urdu');
});

test('cart and confirmed order survive repository re-instantiation and stay tenant-scoped',async()=>{
 const db1=new FakePg(),shared=db1.store,r1=new PostgresCommerceRepository({db:db1});
 const cart={id:'CRT-1',tenantId:'demo',customerId:'c1',status:'active',items:[{productId:'P1',name:'Running Shoes',quantity:2}],total:13000,currency:'PKR'};
 await r1.saveCart(cart);
 await r1.createOrder({id:'ORD-1',tenantId:'demo',customerId:'c1',status:'confirmed',items:cart.items,total:13000,currency:'PKR'});
 const r2=new PostgresCommerceRepository({db:new FakePg(shared)});
 assert.equal((await r2.getCart('demo','c1')).items[0].quantity,2);
 assert.equal((await r2.getOrder('demo','ORD-1')).total,13000);
 assert.equal(await r2.getOrder('other-tenant','ORD-1'),null);
 assert.equal((await r2.listOrders('demo','c1')).length,1);
});

test('booking persistence survives repository re-instantiation and rejects cross-tenant lookup',async()=>{
 const db1=new FakePg(),shared=db1.store,r1=new PostgresBookingRepository({db:db1});
 await r1.create({id:'BKG-1',tenantId:'clinic',customerId:'c1',conversationId:'clinic:web:c1',status:'requested',slots:{service:'Dermatology',date:'2026-08-24',time:'17:00'}});
 const r2=new PostgresBookingRepository({db:new FakePg(shared)});
 assert.equal((await r2.get('clinic','BKG-1')).slots.service,'Dermatology');
 assert.equal(await r2.get('other','BKG-1'),null);
 assert.equal((await r2.list('clinic','c1')).length,1);
});

test('cleaning request reads require tenant scope',async()=>{
 const db1=new FakePg(),shared=db1.store,r1=new PostgresCleaningRepository({db:db1});
 await r1.save({id:'CLN-1',tenantId:'cleaning-a',customerId:'c1',status:'requested',serviceName:'Deep Home Cleaning'});
 const r2=new PostgresCleaningRepository({db:new FakePg(shared)});
 assert.equal((await r2.get('cleaning-a','CLN-1')).serviceName,'Deep Home Cleaning');
 assert.equal(await r2.get('cleaning-b','CLN-1'),null);
 await assert.rejects(()=>r2.get('CLN-1'),/tenantId and id are required/);
});
