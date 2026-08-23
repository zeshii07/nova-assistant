const {BaseCapability}=require('../../../packages/capability-sdk/src/baseCapability');
const {createCapabilityResult}=require('../../../packages/capability-sdk/src/capabilityResult');
class OfferingCapability extends BaseCapability{
 async canHandle(context){const i=context.intelligence?.selected;if(i?.capabilityId==='offering')return {confidence:i.confidence||.95,reason:i.reason};return {confidence:0};}
 async execute(context){const i=context.intelligence?.selected||{};const entities=context.intelligence?.entities||{};const svc=context.services.offering;const cfg=svc.getConfig();const lang=context.language;const previous=context.state.capabilityState?.offering||{};let reply='',intent='OFFERING_LISTED',responseItems=svc.list();
   if(i.intent==='offering.order.start'){
     const item=svc.getById(entities.offeringId);const quantity=entities.quantity||cfg.defaultQuantity||1;
     reply=`🧾 *Order Summary*\n${item.name} × ${quantity}${item.price!=null?`\nTotal: Rs${Number(item.price*quantity).toLocaleString('en-US')}`:''}\n\nSay confirm to place this order, or tell me a different quantity.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,item,quantity}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:item.id,order:{status:'ready',offeringId:item.id,quantity}}}}});
   }
   if(i.intent==='offering.order.quantity'){
     const item=svc.getById(entities.offeringId);const quantity=entities.quantity;
     reply=`Updated 👍\n${item.name} × ${quantity}${item.price!=null?`\nTotal: Rs${Number(item.price*quantity).toLocaleString('en-US')}`:''}\n\nSay confirm to place the order.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,item,quantity}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:item.id,order:{status:'ready',offeringId:item.id,quantity}}}}});
   }
   if(i.intent==='offering.order.confirm'||i.intent==='offering.order.confirm_selected'){
     const item=svc.getById(entities.offeringId||previous.selectedOfferingId);const quantity=entities.quantity||previous.order?.quantity||cfg.defaultQuantity||1;
     const record=await context.services.offeringOrder.create({item,quantity});
     reply=`✅ Order confirmed\nReference: ${record.id}\n${item.name} × ${quantity}${item.price!=null?`\nTotal: Rs${Number(record.total).toLocaleString('en-US')}`:''}`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_CREATED',payload:{legacyText:reply,record}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.created',capabilityState:{offering:{selectedOfferingId:item.id,order:{status:'completed',offeringId:item.id,quantity,orderId:record.id}}}},events:[{name:'offering.order.created.v1',payload:{orderId:record.id}}]});
   }
   if(i.intent==='offering.details' && entities.offeringId){const item=svc.getById(entities.offeringId);if(!item)return createCapabilityResult({handled:true,reply:'That option is not available.',statePatch:{lastIntent:'offering_unavailable'}});reply=formatDetails(item,cfg,lang);intent='OFFERING_VIEWED';}
   else if(i.intent==='offering.suggestion' && entities.suggestedOfferingId){const item=svc.getById(entities.suggestedOfferingId);reply=lang==='roman_urdu'?`Mujhe exact match nahi mila. Kya aap ${item?.name||'is option'} ki baat kar rahe hain?`:`I don’t see that exact option. Did you mean ${item?.name||'this option'}?`;intent='OFFERING_SUGGESTED';}
   else if(i.intent==='offering.unavailable'){const items=svc.list();const requested=entities.requestedSubject||'that option';const names=items.map(x=>x.name).join(', ');reply=lang==='roman_urdu'?`Maazrat 😊 ${requested} hamari configured offerings mein available nahi hai. Available options: ${names}.`:`Sorry 😊 I don’t see ${requested} in this business’s configured offerings. Available options: ${names}.`;intent='OFFERING_UNAVAILABLE';}
   else {const ids=new Set(entities.filterOfferingIds||[]);responseItems=ids.size?svc.list().filter(x=>ids.has(x.id)):svc.list();reply=formatList(responseItems,cfg,lang);}
   return createCapabilityResult({handled:true,reply,responseModel:{intent,payload:{legacyText:reply,items:responseItems,config:cfg}},statePatch:{activePlugin:'offering',lastIntent:i.intent||'offering.browse',capabilityState:{offering:{lastIntent:i.intent||'offering.browse',selectedOfferingId:entities.offeringId||null,suggestedOfferingId:i.intent==='offering.suggestion'?(entities.suggestedOfferingId||null):null}}},events:[{name:intent==='OFFERING_VIEWED'?'offering.viewed.v1':'offering.listed.v1',payload:{offeringId:entities.offeringId||null}}]});
 }
}
function priceText(item){if(item.price==null)return item.priceLabel||'Price on request';return `${item.pricePrefix||''}Rs${Number(item.price).toLocaleString('en-US')}`;}
function formatList(items,cfg,lang){const title=cfg.collectionLabel||'available options';const rows=items.map(x=>`• ${x.name}${x.price!=null||x.priceLabel?` — ${priceText(x)}`:''}`).join('\n');if(lang==='roman_urdu')return `Ji 😊 ${title} mein ye options available hain:\n${rows}\n\nJis option ki detail chahiye uska naam bata dein.`;return `Of course 😊 Here are our ${title}:\n${rows}\n\nTell me which option you'd like to know more about.`;}
function formatDetails(item,cfg,lang){const parts=[`*${item.name}*`,item.description||'',item.price!=null||item.priceLabel?`Price: ${priceText(item)}`:''].filter(Boolean);if(item.durationMinutes)parts.push(`Duration: ${item.durationMinutes} minutes`);if(item.colors?.length)parts.push(`Colors: ${item.colors.join(', ')}`);if(item.bookable)parts.push(lang==='roman_urdu'?'Isay book karna ho to date/time bata dein.':'If you’d like to book it, tell me your preferred date/time.');return parts.join('\n');}
module.exports={Capability:OfferingCapability,OfferingCapability};
