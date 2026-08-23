const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProductRecord } = require("../packages/catalog-sdk/src/productRecord");
const { CatalogService } = require("../packages/catalog-engine/src/catalogService");
const { InMemoryCommerceRepository } = require("../packages/commerce-engine/src/inMemoryCommerceRepository");
const { CommerceService } = require("../packages/commerce-engine/src/commerceService");
const { FileInventoryRepository, InventoryService } = require("../packages/inventory-engine/src");
const { validateResource } = require("../packages/tenant-control-plane/src/resourceValidators");

const product = createProductRecord({
  id:"P-VAR", sku:"POLO-PARENT", name:"Variant Polo", category:"clothing", price:2000, currency:"PKR",
  colors:["Black"], sizes:["S","L"], inStock:true,
  variants:[
    { id:"P-VAR-BLK-S", sku:"POLO-BLK-S", attributes:{color:"Black",size:"S"}, inventory:2 },
    { id:"P-VAR-BLK-L", sku:"POLO-BLK-L", attributes:{color:"Black",size:"L"}, price:2200, inventory:1 }
  ]
});

function system({ clock = () => new Date(), snapshotFile = null } = {}) {
  const inventoryRepository = new FileInventoryRepository({ snapshotFile });
  const inventoryService = new InventoryService({ repository:inventoryRepository, defaultTtlSeconds:60, clock });
  const repository = {
    async listProducts(){return [product];}, async getProductById(_tenantId,id){return id===product.id?product:null;},
    async getSynonyms(){return {};}, async listCategories(){return [{id:"clothing",name:"Clothing"}];}
  };
  const permissionService={assert(){}};
  const catalogService = new CatalogService({ repository, matcher:{search:async()=>({product:null})}, permissionService, inventoryService });
  const commerceRepository = new InMemoryCommerceRepository();
  const commerceService = new CommerceService({ repository:commerceRepository, permissionService, inventoryService });
  const tenant={id:"tenant-a",permissions:[]};
  const scoped=(customerId)=>({
    catalog:catalogService.scope({tenant,capabilityId:"commerce",customerId}),
    commerce:commerceService.scope({tenant,capabilityId:"commerce",customerId})
  });
  return {inventoryRepository,inventoryService,catalogService,commerceRepository,commerceService,tenant,scoped};
}

test("variant selection resolves an exact SKU, price, and stock",async()=>{
  const {scoped}=system();
  const {catalog}=scoped("customer-a");
  const exact=await catalog.validateSelection({productId:"P-VAR",color:"black",size:"L",quantity:1,requireComplete:true});
  assert.equal(exact.valid,true);
  assert.equal(exact.sku,"POLO-BLK-L");
  assert.equal(exact.unitPrice,2200);
  assert.equal(exact.availableQuantity,1);
  const unavailable=await catalog.validateSelection({productId:"P-VAR",color:"Black",size:"M",quantity:1,requireComplete:true});
  assert.equal(unavailable.valid,false);
  assert.ok(["invalid_size","variant_unavailable"].includes(unavailable.reason));
});

test("concurrent customers cannot reserve the same last SKU unit",async()=>{
  const {inventoryService}=system();
  const line={sku:"POLO-BLK-L",productId:"P-VAR",variantId:"P-VAR-BLK-L",inventory:1,quantity:1};
  const attempts=await Promise.allSettled([
    inventoryService.reserveCart({tenantId:"tenant-a",customerId:"one",cartId:"cart-one",lines:[line]}),
    inventoryService.reserveCart({tenantId:"tenant-a",customerId:"two",cartId:"cart-two",lines:[line]})
  ]);
  assert.deepEqual(attempts.map(result=>result.status).sort(),["fulfilled","rejected"]);
  const rejected=attempts.find(result=>result.status==="rejected");
  assert.equal(rejected.reason.code,"INSUFFICIENT_INVENTORY");
  const overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.levels[0].onHand,1);
  assert.equal(overview.levels[0].reserved,1);
  assert.equal(overview.levels[0].available,0);
});

test("expired and cleared reservations release stock",async()=>{
  let time=new Date("2026-08-23T10:00:00.000Z");
  const {inventoryService}=system({clock:()=>new Date(time)});
  const line={sku:"POLO-BLK-L",productId:"P-VAR",variantId:"P-VAR-BLK-L",inventory:1,quantity:1};
  await inventoryService.reserveCart({tenantId:"tenant-a",customerId:"one",cartId:"cart-one",lines:[line],ttlSeconds:30});
  time=new Date("2026-08-23T10:00:31.000Z");
  await inventoryService.reserveCart({tenantId:"tenant-a",customerId:"two",cartId:"cart-two",lines:[line],ttlSeconds:30});
  let overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.reservations.find(row=>row.cartId==="cart-one").status,"expired");
  await inventoryService.releaseCart({tenantId:"tenant-a",cartId:"cart-two",reason:"customer_cancelled"});
  overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.levels[0].available,1);
  assert.equal(overview.reservations.find(row=>row.cartId==="cart-two").status,"released");
});

test("checkout consumes reserved stock and an order removal restocks the same SKU",async()=>{
  const {scoped,inventoryService}=system();
  const {catalog,commerce}=scoped("buyer");
  await commerce.startCart({productId:"P-VAR",name:"Variant Polo",color:"Black",size:"L",quantity:1,variantSelectionRequired:true});
  await commerce.reserveCart({catalog,ttlSeconds:60});
  await commerce.updateCheckout({name:"Ali Khan",phone:"03001234567",city:"Lahore",address:"House 1",landmark:"Park",paymentMethod:"Cash on Delivery"});
  const order=await commerce.createOrder({catalog});
  assert.equal(order.items[0].sku,"POLO-BLK-L");
  assert.equal(order.items[0].unitPrice,2200);
  let overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.levels.find(row=>row.sku==="POLO-BLK-L").onHand,0);
  const amended=await commerce.removeOrderItems(order.id,["P-VAR"]);
  assert.equal(amended.status,"cancelled");
  overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.levels.find(row=>row.sku==="POLO-BLK-L").onHand,1);
  assert.ok(overview.movements.some(row=>row.type==="sale"));
  assert.ok(overview.movements.some(row=>row.type==="order_item_removed"));
});

test("variant exchange atomically consumes the destination and restores the source",async()=>{
  const {scoped,inventoryService}=system();
  const {catalog,commerce}=scoped("exchange-buyer");
  await commerce.startCart({productId:"P-VAR",name:"Variant Polo",color:"Black",size:"S",quantity:1,variantSelectionRequired:true});
  await commerce.updateCheckout({name:"Ali Khan",phone:"03001234567",city:"Lahore",address:"House 1",landmark:"Park",paymentMethod:"Cash on Delivery"});
  const order=await commerce.createOrder({catalog});
  const target=await catalog.validateSelection({productId:"P-VAR",color:"Black",size:"L",quantity:1,requireComplete:true});
  const amended=await commerce.exchangeOrderItem(order.id,{productId:"P-VAR",fromSize:"S",toSize:"L",target:{sku:target.sku,variantId:target.variant.id,unitPrice:target.unitPrice,currency:target.currency,inventory:target.variant.inventory}});
  assert.equal(amended.items[0].sku,"POLO-BLK-L");
  assert.equal(amended.items[0].size,"L");
  const overview=await inventoryService.overview("tenant-a");
  assert.equal(overview.levels.find(row=>row.sku==="POLO-BLK-S").onHand,2);
  assert.equal(overview.levels.find(row=>row.sku==="POLO-BLK-L").onHand,0);
});

test("the same SKU is isolated between tenants",async()=>{
  const {inventoryService}=system();
  const line={sku:"POLO-BLK-L",productId:"P-VAR",variantId:"P-VAR-BLK-L",inventory:1,quantity:1};
  await inventoryService.reserveCart({tenantId:"tenant-a",customerId:"a",cartId:"a-cart",lines:[line]});
  await inventoryService.reserveCart({tenantId:"tenant-b",customerId:"b",cartId:"b-cart",lines:[line]});
  assert.equal((await inventoryService.overview("tenant-a")).levels[0].reserved,1);
  assert.equal((await inventoryService.overview("tenant-b")).levels[0].reserved,1);
});

test("inventory ledger survives repository recreation",async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nova-v910-inventory-"));
  const file=path.join(root,"inventory.json");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const first=system({snapshotFile:file});
  await first.inventoryService.setOnHand({tenantId:"tenant-a",sku:"POLO-BLK-L",productId:"P-VAR",variantId:"P-VAR-BLK-L",quantity:7,actorId:"owner"});
  const second=system({snapshotFile:file});
  assert.equal((await second.inventoryService.overview("tenant-a")).levels[0].onHand,7);
});

test("Control Plane rejects duplicate SKUs and invalid variant attributes",()=>{
  const base={id:"P-VAR",name:"Variant Polo",category:"clothing",price:2000,currency:"PKR",colors:["Black"],sizes:["S"],aliases:[],tags:[],inStock:true};
  const good=validateResource("products",[{...base,variants:[{id:"one",sku:"POLO-BLK-S",attributes:{color:"Black",size:"S"},inventory:2}]}],{tenantId:"tenant-a",capabilities:["catalog"],categoryIds:new Set(["clothing"])});
  assert.equal(good.valid,true);
  const bad=validateResource("products",[
    {...base,id:"one",variants:[{sku:"DUP",attributes:{color:"Blue",size:"S"},inventory:2}]},
    {...base,id:"two",variants:[{sku:"DUP",attributes:{color:"Black",size:"S"},inventory:-1}]}
  ],{tenantId:"tenant-a",capabilities:["catalog"],categoryIds:new Set(["clothing"])});
  assert.equal(bad.valid,false);
  assert.ok(bad.errors.some(row=>row.code==="duplicate_id"));
  assert.ok(bad.errors.some(row=>row.code==="unknown_attribute_value"));
  assert.ok(bad.errors.some(row=>row.code==="invalid_integer"));
});

test("Developer Console exposes tenant-scoped inventory controls",()=>{
  const server=fs.readFileSync(path.resolve(__dirname,"../apps/api/src/server.js"),"utf8");
  const page=fs.readFileSync(path.resolve(__dirname,"../apps/developer-console/public/index.html"),"utf8");
  assert.match(server,/control-plane\\\/\(\[\^\/\]\+\)\\\/inventory/);
  assert.match(server,/controlPlaneAccessPolicy\.authorize/);
  assert.match(page,/Live SKU inventory/);
  assert.match(page,/cpInventoryQuantity/);
});
