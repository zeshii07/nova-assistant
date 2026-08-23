class ServiceAvailabilityEngine{
 constructor({ruleRepository,hoursProvider,offeringService=null,cleaningRepository=null,slotProviders=[]}){
  Object.assign(this,{ruleRepository,hoursProvider,offeringService,cleaningRepository,slotProviders});
 }
 scope({tenant}){const tenantId=tenant.id;return Object.freeze({
  serviceSupport:(text,options)=>this.serviceSupport(tenantId,text,options),
  serviceSupports:(text)=>this.serviceSupports(tenantId,text),
  operatingDay:(day)=>this.operatingDay(tenantId,day),
  validateTime:(day,time,options)=>this.validateTime(tenantId,day,time,options),
  slot:(input)=>this.slot(tenantId,input)
 });}
 serviceSupport(tenantId,text,options={}){
  const q=norm(text),cfg=this.ruleRepository.load(tenantId);
  const rule=(cfg.rules||[]).map(r=>({r,score:scoreRule(q,r)})).sort((a,b)=>b.score-a.score)[0];
  if(rule?.score>0)return {supported:rule.r.supported!==false,serviceId:rule.r.serviceId||null,label:rule.r.label||null,reason:'configured_rule',rule:rule.r};
  if(options.allowGeneric && /\b(clean|cleaning|cleaner)\b/.test(q)){
    const generic=(cfg.rules||[]).find(r=>/home cleaning|standard home cleaning/i.test(`${r.label||''} ${(r.aliases||[]).join(' ')}`));
    if(generic)return {supported:true,serviceId:generic.serviceId||null,label:generic.label||'Cleaning',reason:'generic_service_family',rule:generic};
  }

  const offerings=this.offeringService?.list?.(tenantId)||[];
  const offering=bestOffering(q,offerings);
  if(offering)return {supported:true,serviceId:offering.id,label:offering.name,reason:'offering_match'};

  const cleaning=this.cleaningRepository?.loadServices?.(tenantId)||[];
  const c=bestOffering(q,cleaning.filter(x=>x.active!==false&&!x.hidden));
  if(c)return {supported:true,serviceId:c.id,label:c.name,reason:'service_match'};

  return {supported:false,serviceId:null,label:null,reason:'not_configured'};
 }
 serviceSupports(tenantId,text){
  const q=norm(text),cfg=this.ruleRepository.load(tenantId),seen=new Set(),matches=[];
  for(const rule of cfg.rules||[]){
   const identities=[rule.label,...(rule.aliases||[])].map(norm).filter(Boolean);
   const distinctive=new Set(identities.flatMap(identity=>identity.split(' ')).filter(token=>token.length>2&&!GENERIC_SERVICE_TOKENS.has(token)));
   const exact=identities.some(identity=>q.includes(identity));
   const distinctiveHit=[...distinctive].some(token=>new RegExp(`\\b${escapeRegExp(token)}\\b`).test(q));
   if((exact||distinctiveHit)&&rule.supported!==false&&!seen.has(rule.serviceId||rule.label)){
    seen.add(rule.serviceId||rule.label);matches.push({supported:true,serviceId:rule.serviceId||null,label:rule.label||null,reason:exact?'configured_exact_rule':'configured_distinctive_term',rule});
   }
  }
  return matches;
 }
 operatingDay(tenantId,day){return this.hoursProvider.check({tenantId,day});}
 validateTime(tenantId,day,time,{endTime=null,durationMinutes=null}={}){
  const hours=this.operatingDay(tenantId,day);
  if(hours.status==='closed')return {valid:false,status:'closed',day,hours:null,message:`We’re closed on ${title(day)}. Please choose an open business day.`};
  if(hours.status!=='open')return {valid:true,status:'hours_unknown',day,time,hours:hours.hours||null};
  const range=parseHoursRange(hours.hours),start=parseTimeMinutes(time);
  if(!range||start==null)return {valid:true,status:'hours_unparsed',day,time,hours:hours.hours};
  const explicitEnd=parseTimeMinutes(endTime);
  const calculatedEnd=explicitEnd!=null?explicitEnd:(durationMinutes?start+Number(durationMinutes):null);
  if(start<range.open||start>range.close||calculatedEnd!=null&&calculatedEnd>range.close){
   return {valid:false,status:'outside_business_hours',day,time,hours:hours.hours,openingTime:range.openLabel,closingTime:range.closeLabel,message:`${formatInputTime(time)} is outside our business hours on ${title(day)}. We’re open ${hours.hours}. Please choose a start time within those hours.`};
  }
  return {valid:true,status:'within_business_hours',day,time,hours:hours.hours,openingTime:range.openLabel,closingTime:range.closeLabel};
 }
 async slot(tenantId,input){
  for(const provider of this.slotProviders){
    const r=await provider.check?.({tenantId,...input}); if(r?.status&&r.status!=='unknown')return r;
  }
  const hours=this.operatingDay(tenantId,input.day);
  if(hours.status==='closed')return {status:'closed',source:'business_hours',day:input.day};
  if(hours.status==='open')return {status:'requires_live_check',source:'business_hours',day:input.day,hours:hours.hours};
  return {status:'unknown',source:'none'};
 }
}
const GENERIC_SERVICE_TOKENS=new Set(['clean','cleaning','service','services','home','the','and','for']);
function norm(v){return String(v||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function scoreRule(q,r){const terms=[r.label,...(r.aliases||[]),...(r.propertyTypes||[])].map(norm).filter(Boolean);return Math.max(0,...terms.map(t=>q.includes(t)?t.length:0));}
function bestOffering(q,items){let best=null,score=0;for(const x of items||[]){for(const term of [x.name,...(x.aliases||[]),...(x.tags||[])].map(norm)){if(term&&q.includes(term)&&term.length>score){best=x;score=term.length;}}}return best;}
function parseHoursRange(value){
 const m=String(value||'').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:to|-|–)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
 if(!m)return null;
 const open=clockMinutes(m[1],m[2],m[3]),close=clockMinutes(m[4],m[5],m[6]);
 if(open==null||close==null||close<=open)return null;
 return {open,close,openLabel:`${m[1]}${m[2]?`:${m[2]}`:''} ${m[3].toUpperCase()}`,closeLabel:`${m[4]}${m[5]?`:${m[5]}`:''} ${m[6].toUpperCase()}`};
}
function parseTimeMinutes(value){
 if(value==null)return null;const text=String(value).trim().toLowerCase();
 let m=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);if(m)return clockMinutes(m[1],m[2],m[3]);
 m=text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?Number(m[1])*60+Number(m[2]):null;
}
function clockMinutes(hourValue,minuteValue,period){let hour=Number(hourValue),minute=Number(minuteValue||0);if(hour<1||hour>12||minute<0||minute>59)return null;if(hour===12)hour=0;if(String(period).toLowerCase()==='pm')hour+=12;return hour*60+minute;}
function formatInputTime(value){return String(value||'That time').replace(/^./,char=>char.toUpperCase());}
function title(value){return String(value||'that day').replace(/^./,char=>char.toUpperCase());}
function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
module.exports={ServiceAvailabilityEngine,parseHoursRange,parseTimeMinutes};
