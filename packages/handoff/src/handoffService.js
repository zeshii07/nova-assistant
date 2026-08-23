class HandoffService{
 constructor({eventBus=null}){this.eventBus=eventBus;this.requests=[];}
 async create({tenantId,conversationId,customerId,reason='customer_requested',context={}}){
  const r={id:`HND-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`,tenantId,conversationId,customerId,reason,status:'open',context,createdAt:new Date().toISOString()};
  this.requests.push(r);await this.eventBus?.publish('handoff.requested.v1',r,{tenantId,conversationId,capabilityId:'system'});return r;
 }
 list({tenantId=null,status=null}={}){return this.requests.filter(x=>(!tenantId||x.tenantId===tenantId)&&(!status||x.status===status)).map(x=>structuredClone(x));}
}
module.exports={HandoffService};