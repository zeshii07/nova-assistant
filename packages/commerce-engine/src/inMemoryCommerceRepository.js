const {LocalJsonFile}=require("../../storage/src/localJsonFile");
/** Development repository. Replace with PostgreSQL without changing capabilities. */
class InMemoryCommerceRepository {
  constructor({snapshotFile=null}={}) { this.snapshot=new LocalJsonFile(snapshotFile,{carts:{},orders:{},orderKeys:{}});const d=this.snapshot.read();this.carts=new Map(Object.entries(d.carts||{}));this.orders=new Map(Object.entries(d.orders||{}));this.orderKeys=new Map(Object.entries(d.orderKeys||{})); }
  persist(){this.snapshot.write({carts:Object.fromEntries(this.carts),orders:Object.fromEntries(this.orders),orderKeys:Object.fromEntries(this.orderKeys)});}
  key(tenantId, customerId) { return `${tenantId}:${customerId}`; }
  async getCart(tenantId, customerId) { return clone(this.carts.get(this.key(tenantId, customerId)) || null); }
  async saveCart(cart) { this.carts.set(this.key(cart.tenantId, cart.customerId), clone(cart));this.persist(); return clone(cart); }
  async clearCart(tenantId, customerId) { this.carts.delete(this.key(tenantId, customerId));this.persist(); }
  async createOrder(order) { if(order.idempotencyKey){const k=`${order.tenantId}:${order.idempotencyKey}`;const existing=this.orderKeys.get(k);if(existing)return clone(this.orders.get(existing));this.orderKeys.set(k,order.id);} this.orders.set(order.id, clone(order));this.persist(); return clone(order); }
  async saveOrder(order) { const existing=this.orders.get(order.id);if(existing&&existing.tenantId!==order.tenantId)throw new Error("Order tenant mismatch");this.orders.set(order.id,clone(order));this.persist();return clone(order); }
  async findOrderByIdempotencyKey(tenantId,key){const id=this.orderKeys.get(`${tenantId}:${key}`);return id?clone(this.orders.get(id)):null;}
  async getOrder(tenantId, orderId) { const o = this.orders.get(orderId); return o && o.tenantId === tenantId ? clone(o) : null; }
  async listOrders(tenantId, customerId) { return [...this.orders.values()].filter(o => o.tenantId === tenantId && o.customerId === customerId).map(clone); }
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
module.exports = { InMemoryCommerceRepository };
