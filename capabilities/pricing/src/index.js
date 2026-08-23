const {BaseCapability}=require('../../../packages/capability-sdk/src/baseCapability');const {createCapabilityResult}=require('../../../packages/capability-sdk/src/capabilityResult');const {money}=require('../../../packages/service-pricing/src/servicePricingEngine');
class PricingCapability extends BaseCapability{
 async canHandle(c){const i=c.intelligence?.selected;return i?.capabilityId==='pricing'?{confidence:i.confidence||.99,reason:i.reason}:{confidence:0};}
 async execute(c){
  const p=c.services.pricing, e=c.intelligence?.entities||{}, text=c.message.text;
  const input={...e,text};
  if(c.intelligence?.selected?.intent==='pricing.discount_request'){
   const base=p.quote(input), d=p.discount({...input,quote:base});
   if(d.ok){
    const label=d.discount.type==='percent'?`${d.discount.value}%`:`${money(d.discount.value,d.currency)}`;
    const reply=`Yes — a ${label} discount is available for this service. Original: ${money(d.quote.subtotal,d.currency)}. Discount: ${money(d.discountAmount,d.currency)}. Total after discount: ${money(d.total,d.currency)}.`;
    return out(reply,'PRICING_DISCOUNT_APPLIED',{...d});
   }
   if(d.reason==='no_discount_configured'||d.reason==='discount_not_applicable')return out("There isn’t a configured discount for this service right now. I can still give you the standard quotation.",'PRICING_DISCOUNT_UNAVAILABLE',{reason:d.reason});
   return quoteMissing(d.quote||base);
  }
  const q=p.quote(input);
  if(!q.ok&&e.offeringId&&Number.isFinite(Number(e.offeringPrice))){
   const suffix=e.actionDeferred?' No booking has been created.':'';
   const prefix=e.offeringPricePrefix||'';
   const reply=`${e.serviceName||'Service'} — ${prefix}${money(Number(e.offeringPrice),e.offeringCurrency||'PKR')}.${suffix}`;
   return out(reply,'PRICING_OFFERING_PRICE_QUOTED',{serviceId:e.offeringId,serviceName:e.serviceName,total:Number(e.offeringPrice),currency:e.offeringCurrency||'PKR',actionDeferred:Boolean(e.actionDeferred)});
  }
  if(!q.ok)return quoteMissing(q);
  const reply=`Quotation: ${q.serviceName} — ${money(q.total,q.currency)} (${q.formula}).`;
  return out(reply,'PRICING_QUOTE_GENERATED',q);
 }
}
function quoteMissing(q){
 if(q.reason==='missing_fields'){const fields=q.missing.map(pretty).join(' and ');return out(`I can calculate that quotation. Please tell me the ${fields}.`,'PRICING_QUOTE_NEEDS_DETAILS',{missing:q.missing});}
 if(q.reason==='combination_not_priced')return out("That exact service combination is not in the business pricing table. I can hand this to the team for a custom quotation.",'PRICING_CUSTOM_QUOTE_NEEDED',{reason:q.reason});
 return out("I can prepare a quotation, but I need the service name or type first.",'PRICING_SERVICE_NEEDED',{reason:q.reason});
}
function pretty(x){return ({propertyType:'property type',bedrooms:'number of bedrooms',hours:'number of hours',workers:'number of professionals',quantity:'quantity'}[x]||x);}
function out(reply,intent,payload){return createCapabilityResult({handled:true,reply,responseModel:{intent,payload:{legacyText:reply,...payload}},statePatch:{activePlugin:'pricing',lastIntent:intent.toLowerCase()}});}
module.exports={Capability:PricingCapability,PricingCapability};
