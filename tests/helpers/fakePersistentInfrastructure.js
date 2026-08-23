class FakePg {
  constructor(shared=null){
    this.store=shared||{
      customers:new Map(),activities:[],carts:new Map(),orders:new Map(),bookings:new Map(),requests:new Map()
    };
  }
  clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  async transaction(fn){return fn({query:(sql,p)=>this.query(sql,p)});}
  async query(sql,params=[]){
    const q=String(sql).replace(/\s+/g,' ').trim().toLowerCase();
    const S=this.store;
    if(q.startsWith('select payload from customers')){
      const [tenant,customer]=params;const v=S.customers.get(`${tenant}:${customer}`);return {rows:v?[{payload:this.clone(v)}]:[]};
    }
    if(q.startsWith('insert into customers')){
      const [tenant,customer,name,phone,email,payload]=params;const v=JSON.parse(payload);S.customers.set(`${tenant}:${customer}`,v);return {rows:[]};
    }
    if(q.startsWith('delete from crm_activities')){const [tenant,customer]=params;S.activities=S.activities.filter(x=>!(x.tenant===tenant&&x.customer===customer));return {rows:[]};}
    if(q.startsWith('delete from customers')){const [tenant,customer]=params;S.customers.delete(`${tenant}:${customer}`);return {rows:[]};}
    if(q.startsWith('insert into crm_activities')){
      const [id,tenant,customer,type,capability,payload,createdAt]=params;S.activities.push({id,tenant,customer,type,capability,payload:JSON.parse(payload),createdAt});return {rows:[]};
    }
    if(q.startsWith('select payload from crm_activities')){
      const [tenant,customer,limit]=params;const rows=S.activities.filter(x=>x.tenant===tenant&&x.customer===customer).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map(x=>({payload:this.clone(x.payload)}));return {rows};
    }
    if(q.startsWith('select payload from customers where tenant_id=$1 and')){
      const [tenant,pattern]=params;const needle=String(pattern||'').replace(/%/g,'').toLowerCase();
      const rows=[...S.customers.values()].filter(x=>x.tenantId===tenant&&(!needle||[x.name,x.phone,x.email].filter(Boolean).some(v=>String(v).toLowerCase().includes(needle)))).map(x=>({payload:this.clone(x)}));return {rows};
    }
    if(q.startsWith('select payload from carts')){
      const [tenant,customer]=params;const v=S.carts.get(`${tenant}:${customer}`);return {rows:v?[{payload:this.clone(v)}]:[]};
    }
    if(q.startsWith('insert into carts')){
      const [id,tenant,customer,status,payload]=params;const v=JSON.parse(payload);S.carts.set(`${tenant}:${customer}`,v);return {rows:[]};
    }
    if(q.startsWith('delete from carts')){const [tenant,customer]=params;S.carts.delete(`${tenant}:${customer}`);return {rows:[]};}
    if(q.startsWith('insert into orders')){
      const [id,tenant,customer,status,total,currency,payload]=params;S.orders.set(id,{tenant,customer,payload:JSON.parse(payload)});return {rows:[]};
    }
    if(q.startsWith('select payload from orders where tenant_id=$1 and id=$2')){
      const [tenant,id]=params;const v=S.orders.get(id);return {rows:v&&v.tenant===tenant?[{payload:this.clone(v.payload)}]:[]};
    }
    if(q.startsWith('select payload from orders where tenant_id=$1 and customer_id=$2')){
      const [tenant,customer]=params;return {rows:[...S.orders.values()].filter(x=>x.tenant===tenant&&x.customer===customer).map(x=>({payload:this.clone(x.payload)}))};
    }
    if(q.startsWith('insert into bookings')){
      const [id,tenant,customer,conversation,status,payload]=params;S.bookings.set(id,{tenant,customer,payload:JSON.parse(payload)});return {rows:[]};
    }
    if(q.startsWith('select payload from bookings where tenant_id=$1 and id=$2')){
      const [tenant,id]=params;const v=S.bookings.get(id);return {rows:v&&v.tenant===tenant?[{payload:this.clone(v.payload)}]:[]};
    }
    if(q.startsWith('select payload from bookings where tenant_id=$1')){
      const [tenant,customer]=params;return {rows:[...S.bookings.values()].filter(x=>x.tenant===tenant&&(!customer||x.customer===customer)).map(x=>({payload:this.clone(x.payload)}))};
    }
    if(q.startsWith('insert into service_requests')){
      const [id,tenant,customer,kindOrStatus,statusOrPayload,payloadMaybe]=params;
      let kind,status,payload;
      if(q.includes("'cleaning'")){kind='cleaning';status=kindOrStatus;payload=statusOrPayload;}
      else if(q.includes("'offering_order'")){kind='offering_order';status=kindOrStatus;payload=statusOrPayload;}
      else {kind=kindOrStatus;status=statusOrPayload;payload=payloadMaybe;}
      S.requests.set(id,{tenant,customer,kind,payload:JSON.parse(payload)});return {rows:[]};
    }
    if(q.startsWith('select payload from service_requests where tenant_id=$1 and id=$2')){
      const [tenant,id]=params;const v=S.requests.get(id);return {rows:v&&v.tenant===tenant&&v.kind==='cleaning'?[{payload:this.clone(v.payload)}]:[]};
    }
    if(q.startsWith('select payload from service_requests where tenant_id=$1 and customer_id=$2')){
      const [tenant,customer]=params;const kind=q.includes("kind='offering_order'")?'offering_order':'cleaning';
      return {rows:[...S.requests.values()].filter(x=>x.tenant===tenant&&x.customer===customer&&x.kind===kind).map(x=>({payload:this.clone(x.payload)}))};
    }
    throw new Error(`FakePg does not support SQL: ${sql}`);
  }
}

class FakeRedisClient{
  constructor(shared=null){this.map=shared||new Map();this.isOpen=false;}
  on(){}
  async connect(){this.isOpen=true;}
  async quit(){this.isOpen=false;}
  async get(k){return this.map.get(k)||null;}
  async set(k,v){this.map.set(k,v);return 'OK';}
  async del(keys){
    const list=Array.isArray(keys)?keys:[keys];let n=0;for(const k of list){if(this.map.delete(k))n++;}return n;
  }
  async scan(cursor,{MATCH}={}){
    const prefix=String(MATCH||'').replace('*','');return {cursor:0,keys:[...this.map.keys()].filter(k=>k.startsWith(prefix))};
  }
}
module.exports={FakePg,FakeRedisClient};
