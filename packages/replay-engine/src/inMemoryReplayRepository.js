class InMemoryReplayRepository {
  constructor(){this.items=new Map();this.byConversation=new Map();}
  async save(record){this.items.set(record.id,clone(record));const arr=this.byConversation.get(record.conversationId)||[];arr.push(record.id);this.byConversation.set(record.conversationId,arr);return clone(record);}
  async get(id){return clone(this.items.get(id)||null);}
  async list({conversationId=null,limit=50}={}){let values;if(conversationId){values=(this.byConversation.get(conversationId)||[]).map(id=>this.items.get(id)).filter(Boolean);}else values=[...this.items.values()];return values.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map(clone);}
  async clear(){this.items.clear();this.byConversation.clear();}
}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
module.exports={InMemoryReplayRepository};
