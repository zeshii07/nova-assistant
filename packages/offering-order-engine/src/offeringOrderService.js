const crypto=require('crypto');
class OfferingOrderService{
  constructor({repository,eventBus=null}){Object.assign(this,{repository,eventBus});}
  scope({tenant,customerId,conversationId}){const tenantId=tenant.id;return Object.freeze({
    create:(payload)=>this.create({tenantId,customerId,conversationId,...payload}),
    list:()=>this.repository.list(tenantId,customerId)
  });}
  async create({tenantId,customerId,conversationId,item,quantity=1}){
    const total=Number(item.price||0)*quantity;
    const record={id:`OFR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,tenantId,customerId,conversationId,status:'confirmed',itemId:item.id,itemName:item.name,quantity,total,currency:'PKR',createdAt:new Date().toISOString()};
    await this.repository.create(record);await this.eventBus?.publish('offering.order.created.v1',record,{source:'offering-order-engine'});return record;
  }
}
module.exports={OfferingOrderService};
