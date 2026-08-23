const assert=require('node:assert/strict');
const {loadConfig}=require('../packages/config/src/config');
const {buildStorage}=require('../packages/storage/src/storageFactory');
const {PostgresClient}=require('../packages/storage/src/postgresClient');
const fs=require('fs'),path=require('path');

async function migrate(config){
 const db=new PostgresClient({connectionString:config.databaseUrl});await db.connect();
 const dir=path.resolve(__dirname,'../database/migrations');
 for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())await db.query(fs.readFileSync(path.join(dir,name),'utf8'));
 await db.close();
}
(async()=>{
 const config=loadConfig();
 if(!config.databaseUrl||!config.redisUrl)throw new Error('DATABASE_URL and REDIS_URL are required for live persistence benchmark');
 await migrate(config);
 const suffix=`bench-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
 const tenantA=`tenant-a-${suffix}`,tenantB=`tenant-b-${suffix}`,customer=`cust-${suffix}`,conversation=`${tenantA}:benchmark:${customer}`;
 let s=await buildStorage({config:{...config,storageMode:'persistent'},logger:null});

 await s.stateRepository.save({conversationId:conversation,tenantId:tenantA,customerId:customer,capabilityState:{commerce:{pendingField:'city'}}});
 await s.crmRepository.upsertCustomer({tenantId:tenantA,customerId:customer,name:'Benchmark Customer',phone:'03010000000'});
 await s.crmRepository.upsertCustomer({tenantId:tenantB,customerId:customer,name:'Other Tenant Customer',phone:'03010000000'});
 await s.commerceRepository.saveCart({id:`CRT-${suffix}`,tenantId:tenantA,customerId:customer,status:'active',items:[{productId:'P013',name:'LED Desk Lamp',quantity:2}],total:6400,currency:'PKR'});
 await s.commerceRepository.createOrder({id:`ORD-${suffix}`,tenantId:tenantA,customerId:customer,status:'confirmed',items:[{productId:'P013',quantity:2}],total:6400,currency:'PKR'});
 await s.bookingRepository.create({id:`BKG-${suffix}`,tenantId:tenantA,customerId:customer,conversationId:conversation,status:'requested',slots:{service:'Benchmark Service',date:'2026-08-24',time:'17:00'}});
 await s.cleaningRequestRepository.save({id:`CLN-${suffix}`,tenantId:tenantA,customerId:customer,status:'requested',serviceName:'Deep Home Cleaning'});
 await s.close();

 // Simulated application restart: entirely new repository/client instances.
 s=await buildStorage({config:{...config,storageMode:'persistent'},logger:null});
 const restoredState=await s.stateRepository.get(conversation);assert.equal(restoredState?.capabilityState?.commerce?.pendingField,'city');
 assert.equal((await s.crmRepository.getCustomer(tenantA,customer)).name,'Benchmark Customer');
 assert.equal((await s.crmRepository.getCustomer(tenantB,customer)).name,'Other Tenant Customer');
 assert.equal((await s.commerceRepository.getCart(tenantA,customer)).total,6400);
 assert.equal((await s.commerceRepository.getOrder(tenantA,`ORD-${suffix}`)).status,'confirmed');
 assert.equal(await s.commerceRepository.getOrder(tenantB,`ORD-${suffix}`),null);
 assert.equal((await s.bookingRepository.get(tenantA,`BKG-${suffix}`)).slots.service,'Benchmark Service');
 assert.equal(await s.bookingRepository.get(tenantB,`BKG-${suffix}`),null);
 assert.equal((await s.cleaningRequestRepository.get(tenantA,`CLN-${suffix}`)).serviceName,'Deep Home Cleaning');
 assert.equal(await s.cleaningRequestRepository.get(tenantB,`CLN-${suffix}`),null);
 await s.close();
 console.log(JSON.stringify({ok:true,benchmark:'live-persistence',tenantIsolation:true,restartPersistence:true,customerRecognition:true,cartOrderPersistence:true,bookingPersistence:true},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
