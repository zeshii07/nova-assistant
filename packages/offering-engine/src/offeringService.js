class OfferingService{
 constructor({repository,resolver,eventBus=null,logger=null}){Object.assign(this,{repository,resolver,eventBus,logger});}
 scope({tenant}){const tenantId=tenant.id;return Object.freeze({getConfig:()=>this.getConfig(tenantId),list:(options)=>this.list(tenantId,options),resolve:(query,options)=>this.resolve(tenantId,query,options),getById:(id)=>this.getById(tenantId,id)});}
 getConfig(tenantId){return this.repository.load(tenantId).config||{};}
 list(tenantId,{category=null,type=null}={}){let items=this.repository.load(tenantId).items||[];if(category)items=items.filter(x=>String(x.category||'').toLowerCase()===String(category).toLowerCase());if(type)items=items.filter(x=>x.type===type);return structuredClone(items);}
 getById(tenantId,id){return this.list(tenantId).find(x=>x.id===id)||null;}
 resolve(tenantId,query,options={}){const items=this.list(tenantId,options);return this.resolver.resolve(query,items,options);}
}
module.exports={OfferingService};
