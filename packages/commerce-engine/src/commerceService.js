const crypto = require("crypto");
const { fingerprint } = require("../../shared/src/idempotency");
/** Authoritative cart, checkout, and order service. Catalog remains price source. */
class CommerceService {
  constructor({ repository, permissionService, eventBus, logger, inventoryService = null }) { Object.assign(this, { repository, permissionService, eventBus, logger, inventoryService }); }
  scope({ tenant, capabilityId, customerId }) {
    const assert = a => this.permissionService.assert(tenant, capabilityId, a);
    const releaseReservation = async (cart, reason) => { if (cart?.id && this.inventoryService) await this.inventoryService.releaseCart({ tenantId:tenant.id, cartId:cart.id, reason }); };
    const reserveCart = async (cart, catalog, ttlSeconds) => {
      const lines=[];
      for(const item of cart.items){
        const valid=await catalog.validateSelection({...item,cartId:cart.id,requireComplete:item.variantSelectionRequired!==false});
        if(!valid.valid){const error=new Error(`Catalog validation failed: ${valid.reason}`);error.code="CART_VALIDATION_FAILED";error.reason=valid.reason;error.product=valid.product||null;error.availableQuantity=valid.availableQuantity;error.sku=valid.sku||null;throw error;}
        lines.push({sku:valid.sku,productId:valid.product.id,variantId:valid.variant?.id||null,inventory:valid.variant?valid.variant.inventory:null,quantity:item.quantity});
      }
      if(!this.inventoryService)return null;
      const reservation=await this.inventoryService.reserveCart({tenantId:tenant.id,customerId,cartId:cart.id,lines,ttlSeconds});
      cart.reservation={id:reservation.id,status:reservation.status,expiresAt:reservation.expiresAt};cart.updatedAt=now();await this.repository.saveCart(cart);return reservation;
    };
    return Object.freeze({
      getCart: async () => { assert("read"); return this.repository.getCart(tenant.id, customerId); },
      startCart: async item => { assert("write"); const existing = await this.repository.getCart(tenant.id, customerId); if (existing) {await releaseReservation(existing,"cart_item_added");return addOrMerge(existing, item, this.repository);} const cart = { id: id("CART"), tenantId: tenant.id, customerId, status: "active", items: [item], checkout: emptyCheckout(), createdAt: now(), updatedAt: now() }; await this.repository.saveCart(cart); await this.emit("commerce.cart.created.v1", { tenantId: tenant.id, customerId, cartId: cart.id }, capabilityId); return cart; },
      addItem: async item => { assert("write"); const cart = await this.repository.getCart(tenant.id, customerId); if (!cart) { const created = { id:id("CART"), tenantId:tenant.id, customerId, status:"active", items:[item], checkout:emptyCheckout(), createdAt:now(), updatedAt:now() }; await this.repository.saveCart(created); return created; } await releaseReservation(cart,"cart_item_added");return addOrMerge(cart, item, this.repository); },
      syncItem: async item => { assert("write"); const cart = await this.repository.getCart(tenant.id, customerId); if (!cart) { const created = { id:id("CART"), tenantId:tenant.id, customerId, status:"active", items:[item], checkout:emptyCheckout(), createdAt:now(), updatedAt:now() }; await this.repository.saveCart(created); return created; } await releaseReservation(cart,"cart_item_changed");const same=cart.items.find(i=>i.productId===item.productId && i.color===item.color && i.size===item.size); if(same) same.quantity=item.quantity; else cart.items.push(item); delete cart.reservation;cart.updatedAt=now(); await this.repository.saveCart(cart); return cart; },
      removeItem: async productId => { assert("write"); const cart=await this.repository.getCart(tenant.id,customerId); if(!cart) return null;await releaseReservation(cart,"cart_item_removed"); cart.items=cart.items.filter(i=>i.productId!==productId);delete cart.reservation; cart.updatedAt=now(); if(!cart.items.length){await this.repository.clearCart(tenant.id,customerId);return null;} await this.repository.saveCart(cart); return cart; },
      updateItemQuantity: async (productId, quantity) => { assert("write"); const cart=await this.repository.getCart(tenant.id,customerId); if(!cart) return null; const item=cart.items.find(i=>i.productId===productId); if(!item) return cart;await releaseReservation(cart,"cart_quantity_changed"); item.quantity=quantity;delete cart.reservation; cart.updatedAt=now(); await this.repository.saveCart(cart); return cart; },
      updateItemVariant: async change => {
        assert("write");
        const cart=await this.repository.getCart(tenant.id,customerId);if(!cart)return null;await releaseReservation(cart,"cart_variant_changed");
        let matches=cart.items.map((item,index)=>({item,index})).filter(({item})=>item.productId===change.productId);
        if(change.fromSize)matches=matches.filter(({item})=>String(item.size||'').toUpperCase()===String(change.fromSize).toUpperCase());
        if(change.fromColor)matches=matches.filter(({item})=>String(item.color||'').toLowerCase()===String(change.fromColor).toLowerCase());
        if(matches.length!==1){const error=new Error(matches.length?'More than one cart line matches this change.':'The requested cart item was not found.');error.code=matches.length?'CART_ITEM_AMBIGUOUS':'CART_ITEM_NOT_FOUND';throw error;}
        const source=matches[0].item,quantity=Math.max(1,Number(change.quantity||1));
        if(quantity>Number(source.quantity||0)){const error=new Error('The requested change quantity exceeds the cart quantity.');error.code='CART_QUANTITY_EXCEEDED';error.availableQuantity=source.quantity;throw error;}
        const target={...source,size:change.toSize??source.size??null,color:change.toColor??source.color??null,quantity,...(change.target||{})};
        const before={size:source.size||null,color:source.color||null,quantity};
        source.quantity-=quantity;
        if(source.quantity<=0)cart.items.splice(matches[0].index,1);
        const same=cart.items.find(item=>item.productId===target.productId&&item.size===target.size&&item.color===target.color);
        if(same)same.quantity+=quantity;else cart.items.push(target);
        cart.timeline=[...(cart.timeline||[]),{action:'item_variant_changed',at:now(),productId:target.productId,before,after:{size:target.size||null,color:target.color||null,quantity}}];
        delete cart.reservation;cart.updatedAt=now();await this.repository.saveCart(cart);
        await this.emit('commerce.cart.updated.v1',{tenantId:tenant.id,customerId,cartId:cart.id,action:'item_variant_changed',productId:target.productId},capabilityId);
        return cart;
      },
      reserveCart: async ({catalog,ttlSeconds}={})=>{assert("write");const cart=await this.repository.getCart(tenant.id,customerId);if(!cart)throw new Error("No active cart");return reserveCart(cart,catalog,ttlSeconds);},
      clearCart: async () => { assert("write");const cart=await this.repository.getCart(tenant.id,customerId);await releaseReservation(cart,"cart_cleared"); await this.repository.clearCart(tenant.id,customerId); return true; },
      updateCheckout: async patch => { assert("write"); const cart = await this.repository.getCart(tenant.id, customerId); if (!cart) throw new Error("No active cart"); cart.checkout = { ...cart.checkout, ...patch }; cart.updatedAt = now(); await this.repository.saveCart(cart);await this.inventoryService?.touchCart({tenantId:tenant.id,cartId:cart.id}); return cart; },
      updateOrderCustomer: async (orderId, patch = {}) => {
        assert("order.update");
        const order=await customerOrder(this.repository,tenant.id,customerId,orderId);
        assertModifiableOrder(order);
        const allowed=new Set(['name','phone','email','city','address','landmark','paymentMethod']);
        const changes={};
        for(const [field,value] of Object.entries(patch||{}))if(allowed.has(field)&&value!==undefined&&JSON.stringify(order.customer?.[field])!==JSON.stringify(value))changes[field]=value;
        if(!Object.keys(changes).length)return order;
        const updatedAt=now();
        order.customer={...(order.customer||{}),...changes};
        if(changes.paymentMethod!==undefined)order.paymentMethod=changes.paymentMethod;
        order.revision=Number(order.revision||1)+1;order.updatedAt=updatedAt;
        order.timeline=[...(order.timeline||[]),{action:'customer_details_updated',at:updatedAt,fields:Object.keys(changes)}];
        const saved=await this.repository.saveOrder(order);
        await this.emit('commerce.order.updated.v1',{tenantId:tenant.id,customerId,orderId:saved.id,revision:saved.revision,action:'customer_details_updated',fields:Object.keys(changes)},capabilityId);
        return saved;
      },
      createOrder: async ({ catalog }) => { assert("order.create"); const cart = await this.repository.getCart(tenant.id, customerId); if (!cart) throw new Error("No active cart"); const items = []; let total = 0; for (const item of cart.items) { const valid = await catalog.validateSelection({ productId: item.productId, color: item.color, size: item.size, quantity: item.quantity,cartId:cart.id, requireComplete:item.variantSelectionRequired!==false }); if (!valid.valid) { const error=new Error(`Catalog validation failed: ${valid.reason}`); error.code='CART_VALIDATION_FAILED'; error.reason=valid.reason; error.product=valid.product||null; throw error; } const official = valid.product; const subtotal = valid.unitPrice * item.quantity; total += subtotal; items.push({ productId: official.id,variantId:valid.variant?.id||null,sku:valid.sku, name: official.name, unitPrice: valid.unitPrice, currency: valid.currency, color: item.color || null, size: item.size || null, quantity: item.quantity, subtotal,inventory:valid.variant?valid.variant.inventory:null }); }
        await reserveCart(cart,catalog);
        const idempotencyKey=fingerprint("order",{customerId,cartId:cart.id,items,checkout:cart.checkout});
        const existing=await this.repository.findOrderByIdempotencyKey?.(tenant.id,idempotencyKey); if(existing){await releaseReservation(cart,"idempotent_order_replay");await this.repository.clearCart(tenant.id,customerId);return existing;}
        const order = { id: id("ORD"), tenantId: tenant.id, customerId, status: "confirmed", items, total, currency: items[0]?.currency || "PKR", customer: { ...cart.checkout }, paymentMethod: cart.checkout.paymentMethod, idempotencyKey, sourceCartId:cart.id, revision:1, timeline: [{ action:"created",status: "confirmed", at: now() }], createdAt: now(), updatedAt: now() };
        const create=async()=>this.repository.createOrder(order);const saved=this.inventoryService?await this.inventoryService.consumeCart({tenantId:tenant.id,cartId:cart.id,work:create}):await create(); await this.repository.clearCart(tenant.id, customerId); if(saved.id!==order.id)return saved; await this.emit("commerce.order.created.v1", { tenantId: tenant.id, customerId, orderId: order.id, total }, capabilityId); return order; },
      getOrder: async (orderId) => { assert("read");const order=await this.repository.getOrder(tenant.id,orderId);return order?.customerId===customerId?order:null; },
      listOrders: async () => { assert("read"); return this.repository.listOrders(tenant.id, customerId); },
      addOrderItems: async (orderId, items) => {
        assert("order.update");
        const order=await customerOrder(this.repository,tenant.id,customerId,orderId);
        assertModifiableOrder(order);
        const work=async()=>{for(const item of items){const same=order.items.find(entry=>entry.productId===item.productId&&entry.color===(item.color||null)&&entry.size===(item.size||null));if(same){same.quantity+=item.quantity;same.subtotal=same.unitPrice*same.quantity;}else order.items.push(structuredClone(item));}return saveAmendedOrder(this.repository,order,"items_added",{items:items.map(item=>({productId:item.productId,color:item.color||null,size:item.size||null,quantity:item.quantity}))});};
        const saved=this.inventoryService?await this.inventoryService.consumeLines({tenantId:tenant.id,lines:items,referenceId:orderId,work}):await work();
        await this.emit("commerce.order.updated.v1",{tenantId:tenant.id,customerId,orderId:saved.id,revision:saved.revision,action:"items_added"},capabilityId);
        return saved;
      },
      removeOrderItems: async (orderId, productIds) => {
        assert("order.update");
        const order=await customerOrder(this.repository,tenant.id,customerId,orderId);
        assertModifiableOrder(order);
        const ids=new Set(productIds||[]),removed=order.items.filter(item=>ids.has(item.productId));
        if(!removed.length)return order;
        const work=async()=>{order.items=order.items.filter(item=>!ids.has(item.productId));if(!order.items.length)order.status="cancelled";return saveAmendedOrder(this.repository,order,"items_removed",{items:removed.map(item=>({productId:item.productId,color:item.color||null,size:item.size||null,quantity:item.quantity}))});};
        const saved=this.inventoryService?await this.inventoryService.restockLines({tenantId:tenant.id,lines:removed,referenceId:orderId,work}):await work();
        await this.emit("commerce.order.updated.v1",{tenantId:tenant.id,customerId,orderId:saved.id,revision:saved.revision,action:"items_removed"},capabilityId);
        return saved;
      },
      exchangeOrderItem: async (orderId, change = {}) => {
        assert("order.update");
        const order=await customerOrder(this.repository,tenant.id,customerId,orderId);
        assertModifiableOrder(order);
        let matches=order.items.map((item,index)=>({item,index})).filter(({item})=>item.productId===change.productId);
        if(change.fromSize)matches=matches.filter(({item})=>String(item.size||'').toLowerCase()===String(change.fromSize).toLowerCase());
        if(change.fromColor)matches=matches.filter(({item})=>String(item.color||'').toLowerCase()===String(change.fromColor).toLowerCase());
        if(matches.length!==1){const error=new Error(matches.length?'More than one order line matches this exchange.':'The requested order item was not found.');error.code=matches.length?'ORDER_ITEM_AMBIGUOUS':'ORDER_ITEM_NOT_FOUND';throw error;}
        const row=matches[0],source=structuredClone(row.item),before={size:row.item.size||null,color:row.item.color||null};
        const target=change.target||{};
        const work=async()=>{if(change.toSize!=null)row.item.size=change.toSize;if(change.toColor!=null)row.item.color=change.toColor;if(target.sku)row.item.sku=target.sku;if(target.variantId!==undefined)row.item.variantId=target.variantId;if(Number.isFinite(Number(target.unitPrice)))row.item.unitPrice=Number(target.unitPrice);if(target.currency)row.item.currency=target.currency;if(target.inventory!==undefined)row.item.inventory=target.inventory;return saveAmendedOrder(this.repository,order,"item_exchanged",{productId:row.item.productId,name:row.item.name,before,after:{size:row.item.size||null,color:row.item.color||null}});};
        const saved=this.inventoryService?await this.inventoryService.exchangeLines({tenantId:tenant.id,consume:[{...target,productId:row.item.productId,quantity:row.item.quantity}],restock:[source],referenceId:orderId,work}):await work();
        await this.emit("commerce.order.updated.v1",{tenantId:tenant.id,customerId,orderId:saved.id,revision:saved.revision,action:"item_exchanged"},capabilityId);
        return saved;
      },
      requestOrderReturn: async (orderId, productIds, reason = null) => {
        assert("order.update");
        const order=await customerOrder(this.repository,tenant.id,customerId,orderId);
        assertModifiableOrder(order);
        const ids=new Set(productIds||[]),items=order.items.filter(item=>ids.has(item.productId));
        if(!items.length){const error=new Error("The requested return item was not found.");error.code="ORDER_ITEM_NOT_FOUND";throw error;}
        const requestedAt=now();
        order.returnRequests=[...(order.returnRequests||[]),{status:"requested",requestedAt,reason:reason||null,items:items.map(item=>({productId:item.productId,name:item.name,color:item.color||null,size:item.size||null,quantity:item.quantity}))}];
        const saved=await saveAmendedOrder(this.repository,order,"return_requested",{reason:reason||null,items:items.map(item=>({productId:item.productId,name:item.name}))});
        await this.emit("commerce.order.updated.v1",{tenantId:tenant.id,customerId,orderId:saved.id,revision:saved.revision,action:"return_requested"},capabilityId);
        return saved;
      }
    });
  }
  async emit(name, payload, capabilityId) { await this.eventBus?.publish(name, payload, { source: "commerce-engine", capabilityId }); }
}
async function addOrMerge(cart, item, repository) { const same=cart.items.find(i=>i.productId===item.productId && i.color===item.color && i.size===item.size); if(same) same.quantity += item.quantity; else cart.items.push(item);delete cart.reservation; cart.updatedAt=now(); await repository.saveCart(cart); return cart; }
async function customerOrder(repository,tenantId,customerId,orderId){const order=await repository.getOrder(tenantId,orderId);if(!order||order.customerId!==customerId)throw new Error("Order was not found for this customer and tenant.");return order;}
function assertModifiableOrder(order){if(!["confirmed","requested","pending"].includes(order.status)){const error=new Error(`Order cannot be changed while it is ${order.status}.`);error.code="ORDER_NOT_MODIFIABLE";throw error;}}
async function saveAmendedOrder(repository,order,action,details){const updatedAt=now();order.total=order.items.reduce((sum,item)=>sum+Number(item.unitPrice||0)*Number(item.quantity||0),0);for(const item of order.items)item.subtotal=Number(item.unitPrice||0)*Number(item.quantity||0);order.revision=Number(order.revision||1)+1;order.updatedAt=updatedAt;order.timeline=[...(order.timeline||[]),{action,at:updatedAt,...details}];return repository.saveOrder(order);}
function emptyCheckout() { return { name: null, phone: null, email: null, city: null, address: null, landmark: null, paymentMethod: null, notes: null }; }
function id(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; }
function now() { return new Date().toISOString(); }
module.exports = { CommerceService };
