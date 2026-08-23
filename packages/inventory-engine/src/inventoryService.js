const crypto = require("crypto");

class InventoryService {
  constructor({ repository, defaultTtlSeconds = 900, clock = () => new Date(), eventBus = null, logger = null }) {
    Object.assign(this, { repository, defaultTtlSeconds, clock, eventBus, logger });
    this.locks = new Map();
  }

  async available(input) {
    if (!finiteInventory(input.inventory)) return null;
    return this.#locked(input.tenantId, async () => {
      const state = this.repository.readState();
      this.#expire(state);
      const level = this.#ensureLevel(state, input);
      const held = Object.values(state.reservations).filter((reservation) => reservation.tenantId === input.tenantId && reservation.status === "active" && (!input.cartId || reservation.cartId !== input.cartId))
        .flatMap((reservation) => reservation.lines).filter((line) => line.sku === level.sku).reduce((sum, line) => sum + line.quantity, 0);
      this.repository.writeState(state);
      return Math.max(0, level.onHand - held);
    });
  }

  async reserveCart({ tenantId, customerId, cartId, lines, ttlSeconds = this.defaultTtlSeconds }) {
    return this.#locked(tenantId, async () => {
      const state = this.repository.readState();
      this.#expire(state);
      const active = Object.values(state.reservations).find((item) => item.tenantId === tenantId && item.cartId === cartId && item.status === "active");
      if (active) { active.status = "released"; active.releaseReason = "reservation_replaced"; active.updatedAt = this.#now(); }
      const finite = aggregate(lines.filter((line) => finiteInventory(line.inventory)));
      for (const line of finite) {
        const level = this.#ensureLevel(state, { tenantId, ...line });
        const held = this.#held(state, tenantId, line.sku);
        const available = Math.max(0, level.onHand - held);
        if (line.quantity > available) throw inventoryError("INSUFFICIENT_INVENTORY", `Only ${available} unit(s) of ${line.sku} are available.`, { sku:line.sku, availableQuantity:available, requestedQuantity:line.quantity });
      }
      const now = this.#now();
      const reservation = { id:id("RSV"), tenantId, customerId, cartId, status:"active", lines:finite.map(copyLine), createdAt:now, updatedAt:now, expiresAt:new Date(this.clock().getTime() + Math.max(30, Number(ttlSeconds)||this.defaultTtlSeconds) * 1000).toISOString() };
      state.reservations[reservation.id] = reservation;
      this.repository.writeState(state);
      await this.#emit("inventory.reservation.created.v1", reservation);
      return structuredClone(reservation);
    });
  }

  async touchCart({ tenantId, cartId, ttlSeconds = this.defaultTtlSeconds }) {
    return this.#locked(tenantId, async () => {
      const state=this.repository.readState(); this.#expire(state);
      const reservation=Object.values(state.reservations).find((item)=>item.tenantId===tenantId&&item.cartId===cartId&&item.status==="active");
      if(!reservation)return null;
      reservation.updatedAt=this.#now(); reservation.expiresAt=new Date(this.clock().getTime()+Math.max(30,Number(ttlSeconds)||this.defaultTtlSeconds)*1000).toISOString();
      this.repository.writeState(state); return structuredClone(reservation);
    });
  }

  async releaseCart({ tenantId, cartId, reason = "cart_changed" }) {
    return this.#locked(tenantId, async () => {
      const state=this.repository.readState(); this.#expire(state); let released=null;
      for(const reservation of Object.values(state.reservations))if(reservation.tenantId===tenantId&&reservation.cartId===cartId&&reservation.status==="active"){reservation.status="released";reservation.releaseReason=reason;reservation.updatedAt=this.#now();released=reservation;}
      this.repository.writeState(state); if(released)await this.#emit("inventory.reservation.released.v1",released); return released?structuredClone(released):null;
    });
  }

  async consumeCart({ tenantId, cartId, work }) {
    return this.#locked(tenantId, async () => {
      const state=this.repository.readState(); this.#expire(state);
      const reservation=Object.values(state.reservations).find((item)=>item.tenantId===tenantId&&item.cartId===cartId&&item.status==="active");
      if(!reservation)throw inventoryError("RESERVATION_REQUIRED","The stock reservation has expired or is missing.",{cartId});
      for(const line of reservation.lines){const level=this.#ensureLevel(state,{tenantId,...line});if(level.onHand<line.quantity)throw inventoryError("INSUFFICIENT_INVENTORY",`Only ${level.onHand} unit(s) of ${line.sku} remain.`,{sku:line.sku,availableQuantity:level.onHand,requestedQuantity:line.quantity});}
      const result=await work(reservation);
      for(const line of reservation.lines){const level=this.#ensureLevel(state,{tenantId,...line});level.onHand-=line.quantity;level.updatedAt=this.#now();state.movements.push(movement({tenantId,line,type:"sale",quantity:-line.quantity,referenceType:"cart",referenceId:cartId,at:this.#now()}));}
      reservation.status="consumed";reservation.updatedAt=this.#now();reservation.consumedAt=this.#now();
      this.repository.writeState(state);await this.#emit("inventory.reservation.consumed.v1",reservation);return result;
    });
  }

  async consumeLines({ tenantId, lines, referenceType = "order", referenceId = null, type = "order_item_added", work = async()=>null }) {
    return this.#locked(tenantId, async()=>{
      const state=this.repository.readState();this.#expire(state);const finite=aggregate(lines.filter(line=>finiteInventory(line.inventory)));
      for(const line of finite){const level=this.#ensureLevel(state,{tenantId,...line});const available=Math.max(0,level.onHand-this.#held(state,tenantId,line.sku));if(line.quantity>available)throw inventoryError("INSUFFICIENT_INVENTORY",`Only ${available} unit(s) of ${line.sku} are available.`,{sku:line.sku,availableQuantity:available,requestedQuantity:line.quantity});}
      const result=await work();
      for(const line of finite){const level=this.#ensureLevel(state,{tenantId,...line});level.onHand-=line.quantity;level.updatedAt=this.#now();state.movements.push(movement({tenantId,line,type,quantity:-line.quantity,referenceType,referenceId,at:this.#now()}));}
      this.repository.writeState(state);return result;
    });
  }

  async restockLines({ tenantId, lines, referenceType = "order", referenceId = null, type = "order_item_removed", work = async()=>null }) {
    return this.#locked(tenantId,async()=>{const result=await work();const state=this.repository.readState();this.#expire(state);for(const line of aggregate(lines.filter(line=>line.sku&&finiteInventory(line.inventory)))){const level=this.#ensureLevel(state,{tenantId,...line});level.onHand+=line.quantity;level.updatedAt=this.#now();state.movements.push(movement({tenantId,line,type,quantity:line.quantity,referenceType,referenceId,at:this.#now()}));}this.repository.writeState(state);return result;});
  }

  async exchangeLines({ tenantId, consume, restock, referenceId = null, work }) {
    return this.#locked(tenantId,async()=>{const state=this.repository.readState();this.#expire(state);const outgoing=aggregate((consume||[]).filter(line=>finiteInventory(line.inventory)));const incoming=aggregate((restock||[]).filter(line=>line.sku&&finiteInventory(line.inventory)));for(const line of outgoing){const level=this.#ensureLevel(state,{tenantId,...line});const available=Math.max(0,level.onHand-this.#held(state,tenantId,line.sku));if(line.quantity>available)throw inventoryError("INSUFFICIENT_INVENTORY",`Only ${available} unit(s) of ${line.sku} are available.`,{sku:line.sku,availableQuantity:available,requestedQuantity:line.quantity});}const result=await work();for(const line of outgoing){const level=this.#ensureLevel(state,{tenantId,...line});level.onHand-=line.quantity;level.updatedAt=this.#now();state.movements.push(movement({tenantId,line,type:"exchange_out",quantity:-line.quantity,referenceType:"order",referenceId,at:this.#now()}));}for(const line of incoming){const level=this.#ensureLevel(state,{tenantId,...line});level.onHand+=line.quantity;level.updatedAt=this.#now();state.movements.push(movement({tenantId,line,type:"exchange_in",quantity:line.quantity,referenceType:"order",referenceId,at:this.#now()}));}this.repository.writeState(state);return result;});
  }

  async setOnHand({ tenantId, sku, productId = null, variantId = null, quantity, actorId = "system", reason = "manual_adjustment" }) {
    if(!Number.isInteger(Number(quantity))||Number(quantity)<0)throw inventoryError("INVALID_INVENTORY","Stock must be a non-negative integer.");
    return this.#locked(tenantId,async()=>{const state=this.repository.readState();this.#expire(state);const key=levelKey(tenantId,sku);const previous=state.levels[key]?.onHand||0;const level=state.levels[key]||{tenantId,sku,productId,variantId,configuredInventory:Number(quantity),createdAt:this.#now()};Object.assign(level,{onHand:Number(quantity),updatedAt:this.#now()});state.levels[key]=level;state.movements.push(movement({tenantId,line:{sku,productId,variantId},type:"manual_adjustment",quantity:Number(quantity)-previous,referenceType:"actor",referenceId:actorId,reason,at:this.#now()}));this.repository.writeState(state);return this.stockView(state,tenantId,sku);});
  }

  async syncCatalog({ tenantId, products, actorId = "control-plane" }) {
    return this.#locked(tenantId,async()=>{const state=this.repository.readState();this.#expire(state);const seen=new Set();for(const product of products||[]){const rows=product.variants?.length?product.variants.map(variant=>({sku:variant.sku,productId:product.id,variantId:variant.id,inventory:variant.inventory,active:variant.active!==false})).filter(row=>finiteInventory(row.inventory)):[];for(const row of rows){const key=levelKey(tenantId,row.sku);seen.add(key);const existing=state.levels[key];if(!existing){this.#ensureLevel(state,{tenantId,...row});state.movements.push(movement({tenantId,line:row,type:"catalog_sync",quantity:Number(row.inventory),referenceType:"actor",referenceId:actorId,at:this.#now()}));}else if(Number(existing.configuredInventory)!==Number(row.inventory)){const delta=Number(row.inventory)-Number(existing.onHand);state.movements.push(movement({tenantId,line:row,type:"catalog_sync",quantity:delta,referenceType:"actor",referenceId:actorId,at:this.#now()}));Object.assign(existing,{configuredInventory:Number(row.inventory),onHand:Number(row.inventory),productId:row.productId,variantId:row.variantId,active:row.active,updatedAt:this.#now()});}else Object.assign(existing,{productId:row.productId,variantId:row.variantId,active:row.active,updatedAt:this.#now()});}}
      for(const [key,row] of Object.entries(state.levels))if(row.tenantId===tenantId&&!seen.has(key)){row.active=false;row.updatedAt=this.#now();}
      this.repository.writeState(state);return this.overviewUnlocked(state,tenantId);});
  }

  async overview(tenantId) { return this.#locked(tenantId,async()=>{const state=this.repository.readState();this.#expire(state);this.repository.writeState(state);return this.overviewUnlocked(state,tenantId);}); }
  overviewUnlocked(state,tenantId){return {tenantId,levels:Object.values(state.levels).filter(row=>row.tenantId===tenantId).map(row=>({...row,reserved:this.#held(state,tenantId,row.sku),available:Math.max(0,row.onHand-this.#held(state,tenantId,row.sku))})),reservations:Object.values(state.reservations).filter(row=>row.tenantId===tenantId),movements:state.movements.filter(row=>row.tenantId===tenantId).slice(-100).reverse()};}
  stockView(state,tenantId,sku){const row=state.levels[levelKey(tenantId,sku)];if(!row)return null;const reserved=this.#held(state,tenantId,sku);return {...row,reserved,available:Math.max(0,row.onHand-reserved)};}
  #ensureLevel(state,input){const key=levelKey(input.tenantId,input.sku);if(!state.levels[key])state.levels[key]={tenantId:input.tenantId,sku:input.sku,productId:input.productId||null,variantId:input.variantId||null,configuredInventory:Number(input.inventory),onHand:Number(input.inventory),createdAt:this.#now(),updatedAt:this.#now()};return state.levels[key];}
  #held(state,tenantId,sku){return Object.values(state.reservations).filter(row=>row.tenantId===tenantId&&row.status==="active").flatMap(row=>row.lines).filter(line=>line.sku===sku).reduce((sum,line)=>sum+line.quantity,0);}
  #expire(state){const now=this.clock().getTime();for(const row of Object.values(state.reservations))if(row.status==="active"&&new Date(row.expiresAt).getTime()<=now){row.status="expired";row.updatedAt=this.#now();}}
  #now(){return this.clock().toISOString();}
  async #emit(name,payload){await this.eventBus?.publish(name,payload,{source:"inventory-engine",capabilityId:"commerce"});}
  async #locked(tenantId,work){const previous=this.locks.get(tenantId)||Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve;});const queued=previous.then(()=>gate);this.locks.set(tenantId,queued);await previous;try{return await work();}finally{release();if(this.locks.get(tenantId)===queued)this.locks.delete(tenantId);}}
}
function aggregate(lines){const map=new Map();for(const raw of lines||[]){if(!raw?.sku)continue;const line=copyLine(raw);const key=String(line.sku).toLowerCase();const current=map.get(key);if(current)current.quantity+=line.quantity;else map.set(key,line);}return [...map.values()];}
function copyLine(line){return {sku:String(line.sku),productId:line.productId||null,variantId:line.variantId||null,inventory:finiteInventory(line.inventory)?Number(line.inventory):null,quantity:Math.max(1,Number(line.quantity||1))};}
function levelKey(tenantId,sku){return `${tenantId}:${String(sku).toLowerCase()}`;}
function movement(input){return {id:id("MOV"),tenantId:input.tenantId,sku:input.line.sku,productId:input.line.productId||null,variantId:input.line.variantId||null,type:input.type,quantity:input.quantity,referenceType:input.referenceType||null,referenceId:input.referenceId||null,reason:input.reason||null,at:input.at};}
function inventoryError(code,message,details={}){const error=new Error(message);error.code=code;Object.assign(error,details);return error;}
function finiteInventory(value){return value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value));}
function id(prefix){return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;}
module.exports={InventoryService,inventoryError};
