class ServicePricingEngine{
 constructor({repository}){this.repository=repository;}
 scope({tenant}){const tenantId=tenant.id;return Object.freeze({getConfig:()=>this.getConfig(tenantId),quote:(input)=>this.quote(tenantId,input),discount:(input)=>this.discount(tenantId,input)});}
 getConfig(tenantId){return this.repository.load(tenantId);}
 quote(tenantId,input={}){
  const cfg=this.getConfig(tenantId), service=this.findService(cfg,input);
  if(!service)return {ok:false,reason:'service_not_priced'};
  const currency=service.currency||cfg.currency||'USD', model=service.model||'flat';
  let subtotal=null, formula='', missing=[];
  if(model==='custom_quote')return {ok:false,reason:'custom_quote_required',service,currency};
  if(model==='starting_from')return {ok:false,reason:'scope_required',service,currency,startingFrom:num(service.price)};
  if(model==='hourly'){
   const hours=num(input.hours??input.durationHours), workers=num(input.workers??input.cleanerCount??1);
   if(!hours)missing.push('hours'); if(!workers)missing.push('workers');
   if(!missing.length){subtotal=hours*workers*num(service.rate);formula=`${workers} × ${hours} hours × ${money(num(service.rate),currency)}`;}
  } else if(model==='unit'){
   const units=num(input.units??input.quantity??input.seats??input.chairs);
   if(!units)missing.push(service.unitLabel||'quantity');
   if(!missing.length){subtotal=units*num(service.rate);formula=`${units} ${service.unitLabel||'units'} × ${money(num(service.rate),currency)}`;}
  } else if(model==='linear'){
   const inputKey=service.inputKey||'quantity';
   const units=num(input[inputKey]??input.units??input.quantity??input.seats);
   const baseInput=num(service.baseInput),minimum=service.minimum==null?baseInput:num(service.minimum);
   if(input[inputKey]==null&&input.units==null&&input.quantity==null&&input.seats==null)missing.push(inputKey);
   else if(units<minimum)return {ok:false,reason:'below_minimum',service,currency,requested:units,minimum};
   if(!missing.length){
    const increments=Math.max(0,units-baseInput);
    subtotal=num(service.basePrice)+(increments*num(service.stepPrice));
    formula=`${inputKey}=${units}`;
   }
  } else if(model==='matrix'){
   const keys=service.keys||['propertyType','bedrooms']; const vals={...input};
   for(const k of keys)if(vals[k]==null||vals[k]==='')missing.push(k);
   if(!missing.length){
    const key=keys.map(k=>String(vals[k]).toLowerCase()).join('|');
    const row=(service.prices||{})[key];
    if(row==null)return {ok:false,reason:'combination_not_priced',service,currency,requested:key};
    const propertyCount=Math.max(1,num(input.propertyCount||1));
    subtotal=num(row)*propertyCount;
    const propertyFormula=keys.map(k=>`${k}=${vals[k]}`).join(', ');
    formula=propertyCount>1?`${propertyCount} properties × (${propertyFormula})`:propertyFormula;
   }
  } else if(model==='flat'){subtotal=num(service.price);formula='fixed price';}
  else return {ok:false,reason:'unsupported_pricing_model',service,currency,model};
  if(missing.length)return {ok:false,reason:'missing_fields',missing,service,currency};
  const operationalServiceId=service.operationalServiceId||service.bookingServiceId||service.serviceId||null;
  if(input.requestedOperationalServiceId && operationalServiceId && input.requestedOperationalServiceId!==operationalServiceId){
    return {ok:false,reason:'operational_service_conflict',service,currency,
      requestedOperationalServiceId:input.requestedOperationalServiceId,operationalServiceId};
  }
  const addOns=[];
  for(const addOn of cfg.addOns||[]){
    const raw=addOn.inputKey?input[addOn.inputKey]:null;
    const quantity=typeof raw==='boolean'?(raw?1:0):num(raw);
    if(!quantity)continue;
    const amount=quantity*num(addOn.rate??addOn.price);
    addOns.push({id:addOn.id,name:addOn.name,inputKey:addOn.inputKey,quantity,rate:num(addOn.rate??addOn.price),amount});
  }
  const addOnTotal=addOns.reduce((sum,x)=>sum+x.amount,0);
  return {ok:true,serviceId:service.id,serviceName:service.name,operationalServiceId,currency,subtotal,total:subtotal+addOnTotal,baseSubtotal:subtotal,propertyCount:model==='matrix'?Math.max(1,num(input.propertyCount||1)):undefined,addOnTotal,addOns,formula:addOns.length?`${formula} + ${addOns.map(x=>`${x.quantity} × ${money(x.rate,currency)} ${x.name}`).join(' + ')}`:formula,model};
 }
 discount(tenantId,input={}){
  const cfg=this.getConfig(tenantId), quote=input.quote||this.quote(tenantId,input);
  const active=(cfg.discounts||[]).filter(x=>x.enabled!==false);
  if(!active.length)return {ok:false,reason:'no_discount_configured',quote};
  const d=active.find(x=>!x.serviceIds?.length||x.serviceIds.includes(quote.serviceId))||null;
  if(!d)return {ok:false,reason:'discount_not_applicable',quote};
  if(!quote.ok)return {ok:false,reason:'quote_required',quote,discount:d};
  let amount=0;
  if(d.type==='percent')amount=quote.subtotal*(num(d.value)/100);
  else if(d.type==='fixed')amount=num(d.value);
  amount=Math.min(amount,quote.subtotal);
  return {ok:true,discount:d,quote,discountAmount:amount,total:quote.subtotal-amount,currency:quote.currency};
 }
 findService(cfg,input){
  const q=[input.serviceId,input.serviceName,input.text].filter(Boolean).join(' ').toLowerCase();
  // Exact pricing-service identity is authoritative. Semantic clues such as
  // propertyType may refine a service, but may never replace an explicitly
  // requested service with another operational service.
  if(input.serviceId){
    const exact=(cfg.services||[]).find(s=>s.id===input.serviceId);
    if(exact)return exact;
  }
  const requestedOperationalServiceId=input.requestedOperationalServiceId||input.serviceId||null;
  if(requestedOperationalServiceId){
    const exactOperational=(cfg.services||[]).find(s=>(s.operationalServiceId||s.bookingServiceId||s.serviceId)===requestedOperationalServiceId);
    if(exactOperational)return exactOperational;
  }
  const semanticPreferred=(cfg.services||[]).find(s=>
    (input.units && /chair/.test(q) && /chair/.test(`${s.name} ${(s.aliases||[]).join(' ')}`.toLowerCase()))
    || (input.seats && /sofa|couch|seater/.test(q) && /sofa|couch/.test(`${s.name} ${(s.aliases||[]).join(' ')}`.toLowerCase()))
    || (input.propertyType && s.model==='matrix' && [s.name,...(s.aliases||[])].some(term=>q.includes(String(term||'').toLowerCase())))
  );
  if(semanticPreferred)return semanticPreferred;
  const ranked=(cfg.services||[]).map(s=>{
    if(s.id===input.serviceId)return {s,score:10000};
    const terms=[s.name,...(s.aliases||[])].map(x=>String(x||'').toLowerCase()).filter(Boolean);
    const matched=terms.filter(t=>q.includes(t)); return {s,score:matched.length?Math.max(...matched.map(t=>t.length)):0};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return ranked[0]?.s||((cfg.services||[]).length===1?cfg.services[0]:null);
 }
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function money(n,c){const sym=c==='USD'?'$':c==='AED'?'AED ':c==='PKR'?'Rs':`${c} `;return `${sym}${Number(n).toLocaleString('en-US',{maximumFractionDigits:2})}`;}
module.exports={ServicePricingEngine,money};
