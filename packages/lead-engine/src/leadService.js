const crypto=require('crypto');
const {normalizeText}=require('../../conversation-intelligence/src/text');

const BUSINESS_CAPABILITIES=new Set(['catalog','commerce','cleaning','offering','booking','pricing','availability']);
const CONVERSION_INTENTS=new Set(['COMMERCE_ORDER_CREATED','CLEANING_REQUEST_CREATED','CLEANING_REQUESTS_CREATED','BOOKING_CREATED','OFFERING_ORDER_CREATED']);

/**
 * Cross-cutting inbound lead engine.
 *
 * It observes already-authorized conversation results, extracts business
 * interest, progressively enriches one active lead per tenant/customer and
 * marks it converted when Nova creates a transaction. It never invents
 * contact data and never gives model output execution authority.
 */
class LeadService{
  constructor({repository,eventBus=null,logger=null,now=()=>new Date()}={}){Object.assign(this,{repository,eventBus,logger,now});}

  async observe({tenantId,conversationId,customerId,channel='unknown',message,customer=null,capabilityId=null,intelligence=null,result=null,state=null}){
    if(!tenantId||!customerId||!isLeadSignal({message,capabilityId,intelligence,result}))return null;
    try{
      const now=this.now().toISOString();
      const current=await this.repository.findActiveByCustomer(tenantId,customerId);
      const interest=extractInterest({message,capabilityId,intelligence,result,state});
      const converted=CONVERSION_INTENTS.has(result?.responseModel?.intent);
      const signals=unique([...(current?.signals||[]),...interest.signals]);
      const messages=[...(current?.recentMessages||[]),{text:String(message?.text||'').slice(0,500),capabilityId,at:now}].slice(-20);
      const record={
        ...(current||{}),
        id:current?.id||createLeadId(),tenantId,customerId,conversationId,
        source:current?.source||channel,channel,lastCapabilityId:capabilityId,
        status:converted?'converted':current?.status||'new',
        contact:compact({name:customer?.name,phone:customer?.phone,email:customer?.email}),
        location:compact(customer?.customFields?.lastKnownLocation||{}),
        interests:mergeInterests(current?.interests,interest.interests),
        requirements:{...(current?.requirements||{}),...interest.requirements},
        signals,recentMessages:messages,
        transaction:converted?{intent:result.responseModel.intent,convertedAt:now}:current?.transaction||null,
        createdAt:current?.createdAt||now,updatedAt:now,revision:Number(current?.revision||0)+1
      };
      const scored=scoreLead(record);
      record.score=scored.score;record.grade=scored.grade;
      if(!converted){
        const hasStructuredNeed=Object.keys(record.requirements||{}).length>0;
        record.status=scored.qualified?'qualified':messages.length>1||hasStructuredNeed?'engaged':'new';
      }
      record.qualification={missing:scored.missing,nextBestQuestion:nextBestQuestion(scored.missing),complete:scored.missing.length===0};
      const saved=await this.repository.upsert(record);
      await this.eventBus?.publish(current?'lead.updated.v1':'lead.created.v1',{tenantId,leadId:saved.id,customerId,status:saved.status,score:saved.score,grade:saved.grade},{source:'lead-engine'});
      if(converted)await this.eventBus?.publish('lead.converted.v1',{tenantId,leadId:saved.id,customerId,transactionIntent:result.responseModel.intent},{source:'lead-engine'});
      return saved;
    }catch(error){this.logger?.warn?.('lead.observe_failed',{tenantId,customerId,error:error.message});return null;}
  }
  async get(tenantId,leadId){return this.repository.get(tenantId,leadId);}
  async list(tenantId,options){return this.repository.list(tenantId,options);}
  async summary(tenantId){return this.repository.summary(tenantId);}
}

function isLeadSignal({message,capabilityId,intelligence,result}){
  if(CONVERSION_INTENTS.has(result?.responseModel?.intent))return true;
  if(BUSINESS_CAPABILITIES.has(capabilityId)){
    const intent=String(intelligence?.selected?.intent||'');
    return !/\b(?:greeting|small.?talk|cancel|history|profile)\b/i.test(intent);
  }
  const n=normalizeText(message?.text);
  return /\b(?:want|need|looking for|interested|price|charges?|quote|available|book|reserve|order|buy|purchase|chahiye|chaheye|chahye|karwa|karani|krani|kharid|khareed|lena|leni|safai|booking)\b|چاہیے|کروان|خرید|قیمت|بکنگ/.test(n);
}
function extractInterest({message,capabilityId,intelligence,result,state}){
  const entities={...(intelligence?.messageFrame?.entities||{}),...(intelligence?.entities||{}),...(intelligence?.selected?.entities||{})};
  const payload=result?.responseModel?.payload||{};
  const interests=[];
  for(const [key,value] of Object.entries({...entities,...payload})){
    if(value==null||typeof value==='object'||!/(product|offering|service|category|item|subject)/i.test(key))continue;
    interests.push({type:key.toLowerCase(),value:String(value).slice(0,160)});
  }
  const intent=String(intelligence?.selected?.intent||result?.responseModel?.intent||'');
  if(capabilityId)interests.push({type:'capability',value:capabilityId});
  const requirements={};
  for(const key of ['date','time','startTime','timeWindow','dateReference','quantity','durationHours','partySize','budget','address','city']){
    const value=entities[key]??payload[key];if(value!=null&&typeof value!=='object')requirements[key]=value;
  }
  return {interests,requirements,signals:unique([intent&&`intent:${intent}`,capabilityId&&`capability:${capabilityId}`,...Object.keys(requirements).map(key=>`requirement:${key}`)].filter(Boolean))};
}
function scoreLead(record){
  let score=0;const missing=[];
  if(record.interests?.length)score+=20;else missing.push('interest');
  if(record.contact?.name)score+=10;else missing.push('name');
  if(record.contact?.phone||record.contact?.email)score+=25;else missing.push('contact');
  if(Object.keys(record.requirements||{}).length)score+=15;else missing.push('requirements');
  if(record.location?.address||record.requirements?.address)score+=10;else missing.push('location');
  score+=Math.min(10,Math.max(0,(record.signals?.length||0)-1)*2);
  if(record.transaction)score=100;
  score=Math.min(100,score);
  return {score,grade:score>=75?'hot':score>=40?'warm':'cold',qualified:Boolean((record.contact?.phone||record.contact?.email)&&record.interests?.length),missing};
}
function nextBestQuestion(missing){
  const prompts={interest:'What product or service is the customer interested in?',name:'What name should we use?',contact:'What phone number or email may the business use to follow up?',requirements:'What outcome, quantity, scope, or schedule does the customer need?',location:'Where is the service or delivery needed?'};
  return prompts[missing[0]]||null;
}
function mergeInterests(left=[],right=[]){const all=[...(left||[]),...(right||[])],seen=new Set();return all.filter(item=>{const key=`${item.type}:${item.value}`.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(-30);}
function unique(items){return [...new Set(items.filter(Boolean))];}
function compact(value){return Object.fromEntries(Object.entries(value||{}).filter(([,item])=>item!==null&&item!==undefined&&item!==''));}
function createLeadId(){return `LD-${crypto.randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(6,'0').slice(-6)}`;}

module.exports={LeadService,isLeadSignal,scoreLead};
