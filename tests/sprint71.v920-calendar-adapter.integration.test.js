const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CalendarService, FileCalendarRepository, assertCalendarProvider } = require("../packages/calendar-engine/src");
const { BookingService } = require("../packages/booking-engine/src/bookingService");
const { InMemoryBookingRepository } = require("../packages/booking-engine/src/inMemoryBookingRepository");
const { CleaningService } = require("../packages/cleaning-engine/src/cleaningService");
const { InMemoryCleaningRepository } = require("../packages/cleaning-engine/src/inMemoryCleaningRepository");
const { validateResource } = require("../packages/tenant-control-plane/src/resourceValidators");
const { AvailabilityConversationAdapter } = require("../capabilities/availability/conversation");

function fixture(t, { capacity = 1, holdTtlSeconds = 60 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-v920-calendar-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let now = new Date("2026-08-23T06:00:00.000Z");
  const config = {
    enabled:true, provider:"local", timezone:"Asia/Karachi", defaultDurationMinutes:60,
    slotIntervalMinutes:30, holdTtlSeconds, minLeadMinutes:0, maxAdvanceDays:365,
    resourcePools:[{ id:"staff", name:"Staff", capacity, serviceIds:[], active:true }], serviceRules:[]
  };
  const configRepository = { load:() => structuredClone(config) };
  const repository = new FileCalendarRepository({ snapshotRoot:path.join(root,"calendar") });
  const hoursProvider = { check:({day}) => day === "sunday" ? { status:"closed", day } : { status:"open", day, hours:"9 AM to 5 PM" } };
  const calendar = new CalendarService({ configRepository, repository, hoursProvider, clock:() => new Date(now) });
  return { root, config, repository, calendar, setNow:(value) => { now = new Date(value); } };
}

test("live calendar checks, holds, confirms, and survives repository recreation", async (t) => {
  const { root, calendar } = fixture(t);
  const available = await calendar.check({ tenantId:"tenant-a", date:"24/08/2026", time:"10:00", durationMinutes:60, serviceId:"haircut" });
  assert.equal(available.status,"available");
  assert.equal(available.timezone,"Asia/Karachi");
  const held = await calendar.hold({ tenantId:"tenant-a", customerId:"alice", conversationId:"conv-a", date:"24/08/2026", time:"10:00", durationMinutes:60, serviceId:"haircut" });
  assert.equal(held.status,"held");
  const confirmed = await calendar.confirmHold({ tenantId:"tenant-a", customerId:"alice", holdId:held.hold.id, referenceType:"booking", referenceId:"BKG-1", subject:"Haircut" });
  assert.equal(confirmed.event.status,"confirmed");
  assert.equal(confirmed.event.referenceId,"BKG-1");
  const recreated = new FileCalendarRepository({ snapshotRoot:path.join(root,"calendar") });
  assert.equal(Object.values(recreated.readState("tenant-a").events).length,1);
});

test("concurrent customers cannot hold the same final capacity unit", async (t) => {
  const { calendar } = fixture(t,{capacity:1});
  const input = { tenantId:"tenant-a", date:"24/08/2026", time:"11:00", durationMinutes:60, serviceId:"consultation" };
  const results = await Promise.all([
    calendar.hold({ ...input, customerId:"one", conversationId:"one" }),
    calendar.hold({ ...input, customerId:"two", conversationId:"two" })
  ]);
  assert.deepEqual(results.map((row) => row.status).sort(),["held","unavailable"]);
  assert.equal(calendar.listHolds({tenantId:"tenant-a"}).length,1);
});

test("expired holds free capacity and return deterministic alternatives", async (t) => {
  const { calendar, setNow } = fixture(t,{capacity:1,holdTtlSeconds:30});
  await calendar.hold({ tenantId:"tenant-a", customerId:"one", conversationId:"one", date:"24/08/2026", time:"11:00", durationMinutes:60 });
  const conflict = await calendar.check({ tenantId:"tenant-a", date:"24/08/2026", time:"11:00", durationMinutes:60 });
  assert.equal(conflict.status,"unavailable");
  assert.ok(conflict.alternatives.length > 0);
  setNow("2026-08-23T06:00:31.000Z");
  assert.equal((await calendar.check({ tenantId:"tenant-a", date:"24/08/2026", time:"11:00", durationMinutes:60 })).status,"available");
});

test("unavailable reschedule preserves the event, successful move and cancellation free capacity", async (t) => {
  const { calendar } = fixture(t,{capacity:1});
  const first = await calendar.hold({ tenantId:"tenant-a", customerId:"alice", conversationId:"a", date:"24/08/2026", time:"10:00", durationMinutes:60 });
  const event = (await calendar.confirmHold({ tenantId:"tenant-a", customerId:"alice", holdId:first.hold.id, referenceId:"BKG-1" })).event;
  const blocker = await calendar.hold({ tenantId:"tenant-a", customerId:"bob", conversationId:"b", date:"24/08/2026", time:"12:00", durationMinutes:60 });
  const rejected = await calendar.reschedule({ tenantId:"tenant-a", customerId:"alice", eventId:event.id, date:"24/08/2026", time:"12:00" });
  assert.equal(rejected.status,"unavailable");
  assert.equal(calendar.listEvents({tenantId:"tenant-a",customerId:"alice"})[0].localTime,"10:00");
  await calendar.releaseHold({tenantId:"tenant-a",customerId:"bob",holdId:blocker.hold.id,reason:"test"});
  const moved = await calendar.reschedule({ tenantId:"tenant-a", customerId:"alice", eventId:event.id, date:"24/08/2026", time:"12:00" });
  assert.equal(moved.status,"rescheduled");
  assert.equal(moved.event.localTime,"12:00");
  await calendar.cancel({tenantId:"tenant-a",customerId:"alice",eventId:event.id,reason:"customer_requested"});
  assert.equal((await calendar.check({tenantId:"tenant-a",date:"24/08/2026",time:"12:00",durationMinutes:60})).status,"available");
});

test("calendar records and equal resource IDs remain tenant isolated", async (t) => {
  const { calendar } = fixture(t,{capacity:1});
  const input={date:"24/08/2026",time:"13:00",durationMinutes:60};
  assert.equal((await calendar.hold({tenantId:"tenant-a",customerId:"a",conversationId:"a",...input})).status,"held");
  assert.equal((await calendar.hold({tenantId:"tenant-b",customerId:"b",conversationId:"b",...input})).status,"held");
  assert.equal(calendar.listHolds({tenantId:"tenant-a"})[0].tenantId,"tenant-a");
  assert.equal(calendar.listHolds({tenantId:"tenant-b"})[0].tenantId,"tenant-b");
});

test("generic booking confirmation consumes a hold and owns the calendar event", async (t) => {
  const { calendar, root } = fixture(t,{capacity:2});
  const repository = new InMemoryBookingRepository({snapshotFile:path.join(root,"bookings.json")});
  const service = new BookingService({ configRepository:{load:()=>({enabled:true,mode:"appointment"})}, repository, calendarService:calendar });
  const booking = service.scope({tenant:{id:"tenant-a"},customerId:"alice",conversationId:"conversation-a"});
  const slots={subject:"Haircut",items:[{id:"haircut",name:"Haircut",quantity:1,metadata:{durationMinutes:45}}],date:"24/08/2026",time:"14:00",name:"Alice",phone:"03001234567"};
  const held=await booking.holdSlot(slots),record=await booking.create(slots,{holdId:held.hold.id});
  assert.equal(record.status,"confirmed");
  assert.ok(record.calendarEventId);
  assert.equal((await booking.list()).length,1);
});

test("cleaning requests share one confirmed visit event", async (t) => {
  const { calendar } = fixture(t,{capacity:3});
  const requestRepository = new InMemoryCleaningRepository();
  const services=[{id:"standard",name:"Standard Cleaning",active:true},{id:"sofa",name:"Sofa Cleaning",active:true}];
  const cleaningService = new CleaningService({serviceRepository:{loadServices:()=>services},requestRepository,permissionService:{assert(){}},calendarService:calendar});
  const cleaning=cleaningService.scope({tenant:{id:"tenant-a"},customerId:"alice",conversationId:"clean-a",capabilityId:"cleaning"});
  const base={serviceId:"standard",serviceName:"Standard Cleaning",preferredDate:"24/08/2026",preferredTime:"09:00",durationHours:2,cleanerCount:2,address:"House 1",name:"Alice",phone:"03001234567"};
  const held=await cleaning.holdSlot(base);
  const requests=await cleaning.createRequests([base,{...base,serviceId:"sofa",serviceName:"Sofa Cleaning"}],{holdId:held.hold.id});
  assert.equal(requests.length,2);
  assert.ok(requests.every((request)=>request.status==="confirmed"&&request.calendarEventId===requests[0].calendarEventId));
  assert.equal(calendar.listEvents({tenantId:"tenant-a"}).length,1);
  const cancellation=await cleaning.cancelRequest(requests[0].id);
  assert.equal(cancellation.requests.length,2);
  assert.ok(cancellation.requests.every((request)=>request.status==="cancelled"));
  assert.equal((await calendar.check({tenantId:"tenant-a",date:"24/08/2026",time:"09:00",durationMinutes:120,capacityRequired:2})).status,"available");
});

test("exact-time availability questions route to the live slot checker instead of hours", async () => {
  const adapter=new AvailabilityConversationAdapter();
  const analysis=await adapter.analyze({
    tenant:{id:"tenant-a",capabilities:["availability"]},
    message:{text:"Are you available Monday at 2 PM for a consultation?"},
    services:{}
  });
  assert.equal(analysis.candidates[0].intent,"availability.slot_question");
  assert.equal(analysis.candidates[0].reason,"exact_live_slot_question");
});

test("operator calendar blocks are stored as block events", async (t) => {
  const { calendar }=fixture(t,{capacity:2});
  const created=await calendar.createBlock({tenantId:"tenant-a",date:"24/08/2026",time:"15:00",durationMinutes:60,capacityRequired:1,actorId:"owner-1",subject:"Team meeting"});
  assert.equal(created.status,"confirmed");
  assert.equal(created.event.type,"block");
  assert.equal(calendar.listEvents({tenantId:"tenant-a"})[0].type,"block");
});

test("calendar Control Plane validation rejects secrets and invalid capacity", () => {
  const document={enabled:true,provider:"google_calendar",timezone:"Asia/Karachi",defaultDurationMinutes:60,slotIntervalMinutes:30,holdTtlSeconds:300,minLeadMinutes:0,maxAdvanceDays:365,apiKey:"must-not-be-here",resourcePools:[{id:"staff",name:"Staff",capacity:0,active:true}],serviceRules:[]};
  const result=validateResource("calendar",document,{tenantId:"tenant-a",serviceIds:new Set()});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some((row)=>row.code==="secret_not_allowed"));
  assert.ok(result.errors.some((row)=>row.code==="invalid_integer"));
});

test("provider adapters must implement the complete calendar contract", () => {
  assert.throws(()=>assertCalendarProvider({check(){}}),/missing 'hold/);
  const provider=Object.fromEntries(["check","hold","confirmHold","releaseHold","reschedule","cancel","listEvents"].map((name)=>[name,()=>null]));
  assert.equal(assertCalendarProvider(provider),provider);
});

test("registered external adapters receive normalized slots for the complete lifecycle", async (t) => {
  const { calendar,config }=fixture(t,{capacity:2});
  config.provider="google_calendar";
  const calls=[];
  const provider={
    check:async(input)=>{calls.push(["check",input]);return {status:"available",source:"google_calendar"};},
    hold:async(input)=>{calls.push(["hold",input]);return {status:"held",hold:{id:"EXT-HOLD"}};},
    confirmHold:async(input)=>{calls.push(["confirmHold",input]);const result=await input.work?.();return {event:{id:"EXT-EVENT",status:"confirmed",provider:"google_calendar"},result};},
    releaseHold:async(input)=>{calls.push(["releaseHold",input]);return {status:"released"};},
    reschedule:async(input)=>{calls.push(["reschedule",input]);return {status:"rescheduled",event:{id:input.eventId,localTime:input.time}};},
    cancel:async(input)=>{calls.push(["cancel",input]);return {status:"cancelled",event:{id:input.eventId,status:"cancelled"}};},
    listEvents:async(input)=>{calls.push(["listEvents",input]);return [{id:"EXT-EVENT"}];}
  };
  calendar.registerProvider("google_calendar",provider);
  await calendar.check({tenantId:"tenant-a",date:"24/08/2026",time:"2 pm",durationMinutes:60});
  await calendar.hold({tenantId:"tenant-a",customerId:"alice",conversationId:"c",date:"24/08/2026",time:"2 pm",durationMinutes:60});
  await calendar.confirmHold({tenantId:"tenant-a",customerId:"alice",holdId:"EXT-HOLD",referenceId:"BKG-1",work:async()=>({id:"BKG-1"})});
  await calendar.releaseHold({tenantId:"tenant-a",customerId:"alice",holdId:"EXT-HOLD"});
  await calendar.reschedule({tenantId:"tenant-a",customerId:"alice",eventId:"EXT-EVENT",date:"24/08/2026",time:"3 pm",durationMinutes:60});
  await calendar.cancel({tenantId:"tenant-a",customerId:"alice",eventId:"EXT-EVENT"});
  assert.deepEqual(await calendar.listEvents({tenantId:"tenant-a",customerId:"alice"}),[{id:"EXT-EVENT"}]);
  assert.deepEqual(calls.map(([name])=>name),["check","hold","confirmHold","releaseHold","reschedule","cancel","listEvents"]);
  assert.equal(calls[0][1].time,"14:00");
  assert.equal(calls[4][1].time,"15:00");
});

test("Developer Console exposes calendar configuration and live block controls", () => {
  const server=fs.readFileSync(path.resolve(__dirname,"../apps/api/src/server.js"),"utf8");
  const page=fs.readFileSync(path.resolve(__dirname,"../apps/developer-console/public/index.html"),"utf8");
  assert.match(server,/calendarBlocksMatch/);
  assert.match(server,/calendarService\.createBlock/);
  assert.match(page,/Calendar & capacity/);
  assert.match(page,/cpCalendarBlock/);
});
