const {normalizeText}=require('../../../packages/conversation-intelligence/src/text');
class PricingConversationAdapter{
 constructor(){this.capabilityId='pricing';this.priority=104;}
 async analyze({tenant,message,services}){
  if(!tenant.capabilities?.includes('pricing'))return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
  if(tenant.capabilities?.includes('cleaning'))return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
  const text=normalizeText(message.text), entities=extract(text);
  const discount=/\b(discount|special offer|best price|reduce|cheaper|kam kar|riayat|رعایت)\b/.test(text);
  const quote=/\b(quote|quotation|estimate|price|cost|how much|charges?|rate|kitna|kitne|kitni|qeemat|قیمت)\b/.test(text);
  if(!discount&&!quote)return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
  const offering=mentionedOffering(text,services?.offeringService?.list?.(tenant.id)||[]);
  if(offering){
    entities.offeringId=offering.id;entities.serviceId=offering.id;entities.serviceName=offering.name;
    if(Number.isFinite(Number(offering.price)))entities.offeringPrice=Number(offering.price);
    entities.offeringPricePrefix=offering.pricePrefix||'';
    entities.offeringCurrency=offering.currency||'PKR';
  }
  entities.actionDeferred=/\b(do not|don't|dont)\s+(?:book|schedule|place|confirm)|\bwithout (?:my )?(?:approval|confirmation)|\buntil i (?:approve|confirm)|\bbefore (?:booking|confirming)\b/.test(text);
  const intent=discount?'pricing.discount_request':'pricing.quote_request';
  return {priority:this.priority,candidates:[{intent,confidence:.99999,entities:{...entities,text},reason:discount?'service_discount_request':'service_quote_request'}],entities:{...entities,text},vocabularyMatches:[{type:'pricing_intent',value:intent,score:1}]};
 }
}
function mentionedOffering(text,items){
 const exactMatches=(items||[]).map(item=>{
   const terms=[item.name,...(item.aliases||[])].map(normalizeText).filter(Boolean);
   const hit=terms.filter(term=>(` ${text} `).includes(` ${term} `)).sort((a,b)=>b.length-a.length)[0];
   return hit?{item,length:hit.length}:null;
 }).filter(Boolean).sort((a,b)=>b.length-a.length);
 if(exactMatches.length)return exactMatches[0].item;

 // Customers commonly omit generic words from configured offering names, for
 // example "valuation visit" for "Property Valuation Visit". Bind that phrase
 // only when at least two meaningful tokens point to one clear offering. This
 // avoids the unsafe full-message fuzzy matching that can turn any request
 // containing "property" or "appointment" into the wrong service.
 const queryTokens=new Set(normalizeText(text).split(' ').filter(token=>token.length>=3));
 const tokenMatches=(items||[]).map(item=>{
   let best=null;
   for(const term of [item.name,...(item.aliases||[])].map(normalizeText).filter(Boolean)){
     const tokens=[...new Set(term.split(' ').filter(token=>token.length>=3))];
     const overlap=tokens.filter(token=>queryTokens.has(token)).length;
     if(overlap<2)continue;
     const score=(overlap*10)+(overlap/Math.max(tokens.length,1));
     if(!best||score>best.score)best={item,score,overlap};
   }
   return best;
 }).filter(Boolean).sort((a,b)=>b.score-a.score);
 if(!tokenMatches.length)return null;
 if(tokenMatches[1]&&tokenMatches[0].score-tokenMatches[1].score<1)return null;
 return tokenMatches[0].item;
}
function extract(t){
 const e={};
 let m=t.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/);if(m)e.hours=Number(m[1]);
 m=t.match(/\b(\d+)\s*(?:cleaners?|workers?|professionals?|staff)\b/);if(m)e.workers=Number(m[1]);
 m=t.match(/\b(\d+)\s*(?:seater|seat)\b/);if(m){e.units=Number(m[1]);e.seats=Number(m[1]);}
 m=t.match(/\b(\d+)\s*(?:chairs?|seats?|items?|pieces?|pcs?)\b/);if(m)e.units=Number(m[1]);
 m=t.match(/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/);if(m)e.bedrooms=Number(m[1]);
 if(/\bvilla\b/.test(t))e.propertyType='villa';else if(/\b(apartment|flat)\b/.test(t))e.propertyType='apartment';else if(/\b(house|home)\b/.test(t))e.propertyType='house';
 return e;
}
module.exports={PricingConversationAdapter,mentionedOffering};
