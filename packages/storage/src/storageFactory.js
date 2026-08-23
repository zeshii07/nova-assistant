const path=require("path");
const { MemoryStateRepository } = require("../../state/src/memoryStateRepository");
const { InMemoryCrmRepository } = require("../../crm-engine/src/inMemoryCrmRepository");
const { InMemoryCommerceRepository } = require("../../commerce-engine/src/inMemoryCommerceRepository");
const { InMemoryBookingRepository } = require("../../booking-engine/src/inMemoryBookingRepository");
const { InMemoryCleaningRepository } = require("../../cleaning-engine/src/inMemoryCleaningRepository");
const { InMemoryOfferingOrderRepository } = require("../../offering-order-engine/src/inMemoryOfferingOrderRepository");
const { PostgresClient } = require("./postgresClient");
const { RedisStateRepository } = require("./redisStateRepository");
const { PostgresCrmRepository } = require("./postgresCrmRepository");
const { PostgresCommerceRepository } = require("./postgresCommerceRepository");
const { PostgresBookingRepository } = require("./postgresBookingRepository");
const { PostgresCleaningRepository } = require("./postgresCleaningRepository");
const { PostgresOfferingOrderRepository } = require("./postgresOfferingOrderRepository");
const { FileInventoryRepository } = require("../../inventory-engine/src/fileInventoryRepository");
const { FileCalendarRepository } = require("../../calendar-engine/src/fileCalendarRepository");
async function buildStorage({config,logger}){
 if(config.storageMode!=="persistent"){
  const root=config.localDataDir||path.resolve(process.cwd(),'.nova-data');
  return {
    mode:"local",
    stateRepository:new MemoryStateRepository({snapshotFile:path.join(root,"state.json")}),
    crmRepository:new InMemoryCrmRepository({snapshotFile:path.join(root,"crm.json")}),
    commerceRepository:new InMemoryCommerceRepository({snapshotFile:path.join(root,"commerce.json")}),
    bookingRepository:new InMemoryBookingRepository({snapshotFile:path.join(root,"bookings.json")}),
    cleaningRequestRepository:new InMemoryCleaningRepository({snapshotFile:path.join(root,"cleaning-requests.json")}),
    offeringOrderRepository:new InMemoryOfferingOrderRepository({snapshotFile:path.join(root,"offering-orders.json")}),
    inventoryRepository:new FileInventoryRepository({snapshotFile:path.join(root,"inventory.json")}),
    calendarRepository:new FileCalendarRepository({snapshotRoot:path.join(root,"calendar")}),
    db:null,redis:null,close:async()=>{}
  };
 }
 const db=new PostgresClient({connectionString:config.databaseUrl,logger}); await db.connect();
 const redis=new RedisStateRepository({url:config.redisUrl,ttlSeconds:config.stateTtlSeconds,logger}); await redis.connect();
 const storage={mode:"persistent",db,redis,stateRepository:redis,crmRepository:new PostgresCrmRepository({db}),commerceRepository:new PostgresCommerceRepository({db}),bookingRepository:new PostgresBookingRepository({db}),cleaningRequestRepository:new PostgresCleaningRepository({db}),offeringOrderRepository:new PostgresOfferingOrderRepository({db}),inventoryRepository:new FileInventoryRepository({snapshotFile:path.join(config.operationalDataDir,"inventory.json")}),calendarRepository:new FileCalendarRepository({snapshotRoot:path.join(config.operationalDataDir,"calendar")})};
 storage.close=async()=>{await Promise.allSettled([redis.close(),db.close()]);};
 return storage;
}
module.exports={buildStorage};
