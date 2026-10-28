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
   // v35.6: Multi-item order — "chicken biryani and a beef burger"
   if(i.intent==='offering.order.multi'){
     const multiItems=entities.items||[];
     if(multiItems.length===0){reply=formatList(svc.list(),cfg,lang);intent='OFFERING_LISTED';}
     else{
       const lines=multiItems.map(mi=>{const it=svc.getById(mi.offeringId);return it?{...it,quantity:mi.quantity}:null;}).filter(Boolean);
       const total=lines.reduce((s,x)=>s+(x.price||0)*x.quantity,0);
       const itemLines=lines.map(x=>`${x.name} × ${x.quantity}`).join('\n');
       reply=`🧾 *Order Summary*\n${itemLines}${total>0?`\nTotal: Rs${Number(total).toLocaleString('en-US')}`:''}\n\nSay confirm to place this order, or tell me what to change.`;
       return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,items:lines}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:lines[0]?.id,order:{status:'ready',multiItem:true,offeringId:lines[0]?.id,quantity:1,items:lines.map(x=>({offeringId:x.id,quantity:x.quantity}))}}}}});
     }
   }
   if(i.intent==='offering.order.quantity'){
     const item=svc.getById(entities.offeringId);const quantity=entities.quantity;
     reply=`Updated 👍\n${item.name} × ${quantity}${item.price!=null?`\nTotal: Rs${Number(item.price*quantity).toLocaleString('en-US')}`:''}\n\nSay confirm to place the order.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,item,quantity}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:item.id,order:{status:'ready',offeringId:item.id,quantity}}}}});
   }
   // v36.3: Add item to existing order
   if(i.intent==='offering.order.add_item'){
     const newItem=svc.getById(entities.offeringId);const newQty=entities.quantity||1;
     // Build updated order items list
     let orderItems=[];
     if(previous.order?.multiItem&&previous.order?.items){
       orderItems=previous.order.items.map(oi=>{const it=svc.getById(oi.offeringId);return it?{offeringId:oi.offeringId,quantity:oi.quantity,name:it.name,price:it.price}:null;}).filter(Boolean);
     } else if(previous.order?.offeringId){
       const it=svc.getById(previous.order.offeringId);
       if(it) orderItems=[{offeringId:previous.order.offeringId,quantity:previous.order.quantity||1,name:it.name,price:it.price}];
     }
     // Add or merge the new item
     const existingIdx=orderItems.findIndex(x=>x.offeringId===newItem.id);
     if(existingIdx>=0){orderItems[existingIdx].quantity+=newQty;}
     else{orderItems.push({offeringId:newItem.id,quantity:newQty,name:newItem.name,price:newItem.price});}
     const itemLines=orderItems.map(x=>`${x.name} × ${x.quantity}`).join('\n');
     const total=orderItems.reduce((s,x)=>s+(x.price||0)*x.quantity,0);
     reply=`✅ Added ${newItem.name} × ${newQty}\n\n🧾 *Updated Order Summary*\n${itemLines}\nTotal: Rs${Number(total).toLocaleString('en-US')}\n\nSay confirm to place this order, or tell me what to change.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,items:orderItems}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:newItem.id,order:{status:'ready',multiItem:true,offeringId:newItem.id,quantity:1,items:orderItems.map(x=>({offeringId:x.offeringId,quantity:x.quantity}))}}}}});
   }
   // v36.3: Remove item from existing order
   if(i.intent==='offering.order.remove_item'){
     const removeItem=svc.getById(entities.offeringId);
     let orderItems=[];
     if(previous.order?.multiItem&&previous.order?.items){
       orderItems=previous.order.items.map(oi=>{const it=svc.getById(oi.offeringId);return it?{offeringId:oi.offeringId,quantity:oi.quantity,name:it.name,price:it.price}:null;}).filter(Boolean);
     } else if(previous.order?.offeringId){
       const it=svc.getById(previous.order.offeringId);
       if(it) orderItems=[{offeringId:previous.order.offeringId,quantity:previous.order.quantity||1,name:it.name,price:it.price}];
     }
     orderItems=orderItems.filter(x=>x.offeringId!==removeItem.id);
     if(orderItems.length===0){
       reply=`✅ Removed ${removeItem.name}. Your order is now empty. What would you like to order?`;
       return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_EMPTY',payload:{legacyText:reply}},statePatch:{activePlugin:'offering',lastIntent:'offering.browse',capabilityState:{offering:{...previous,selectedOfferingId:null,order:{status:'empty',offeringId:null,quantity:0,items:[]}}}}});
     }
     const itemLines=orderItems.map(x=>`${x.name} × ${x.quantity}`).join('\n');
     const total=orderItems.reduce((s,x)=>s+(x.price||0)*x.quantity,0);
     reply=`✅ Removed ${removeItem.name}\n\n🧾 *Updated Order Summary*\n${itemLines}\nTotal: Rs${Number(total).toLocaleString('en-US')}\n\nSay confirm to place this order, or tell me what to change.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,items:orderItems}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:orderItems[0]?.offeringId,order:{status:'ready',multiItem:true,offeringId:orderItems[0]?.offeringId,quantity:1,items:orderItems.map(x=>({offeringId:x.offeringId,quantity:x.quantity}))}}}}});
   }
   // v36.3: Change quantity of an item in existing order
   if(i.intent==='offering.order.change_quantity'){
     const changeItem=svc.getById(entities.offeringId);const newQty=entities.quantity||1;
     let orderItems=[];
     if(previous.order?.multiItem&&previous.order?.items){
       orderItems=previous.order.items.map(oi=>{const it=svc.getById(oi.offeringId);return it?{offeringId:oi.offeringId,quantity:oi.quantity,name:it.name,price:it.price}:null;}).filter(Boolean);
     } else if(previous.order?.offeringId){
       const it=svc.getById(previous.order.offeringId);
       if(it) orderItems=[{offeringId:previous.order.offeringId,quantity:previous.order.quantity||1,name:it.name,price:it.price}];
     }
     const idx=orderItems.findIndex(x=>x.offeringId===changeItem.id);
     if(idx>=0) orderItems[idx].quantity=newQty;
     const itemLines=orderItems.map(x=>`${x.name} × ${x.quantity}`).join('\n');
     const total=orderItems.reduce((s,x)=>s+(x.price||0)*x.quantity,0);
     reply=`✅ Updated ${changeItem.name} to × ${newQty}\n\n🧾 *Updated Order Summary*\n${itemLines}\nTotal: Rs${Number(total).toLocaleString('en-US')}\n\nSay confirm to place this order, or tell me what to change.`;
     return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_READY',payload:{legacyText:reply,items:orderItems}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.ready',capabilityState:{offering:{...previous,selectedOfferingId:changeItem.id,order:{status:'ready',multiItem:true,offeringId:orderItems[0]?.offeringId,quantity:1,items:orderItems.map(x=>({offeringId:x.offeringId,quantity:x.quantity}))}}}}});
   }
   if(i.intent==='offering.order.confirm'||i.intent==='offering.order.confirm_selected'){
     // v35.6: Multi-item order confirmation
     if(previous.order?.multiItem && previous.order?.items) {
       const orderItems = previous.order.items.map(oi => {
         const it = svc.getById(oi.offeringId);
         return it ? { ...it, quantity: oi.quantity } : null;
       }).filter(Boolean);
       const itemLines = orderItems.map(x => `${x.name} × ${x.quantity}`).join('\n');
       const total = orderItems.reduce((s, x) => s + (x.price || 0) * x.quantity, 0);
       const record = await context.services.offeringOrder.create({ item: orderItems[0], quantity: orderItems[0].quantity });
       reply = `✅ Order confirmed\nReference: ${record.id}\n${itemLines}${total > 0 ? `\nTotal: Rs${Number(total).toLocaleString('en-US')}` : ''}`;
       return createCapabilityResult({handled:true,reply,responseModel:{intent:'OFFERING_ORDER_CREATED',payload:{legacyText:reply,record}},statePatch:{activePlugin:'offering',lastIntent:'offering.order.created',capabilityState:{offering:{selectedOfferingId:orderItems[0]?.id,order:{status:'completed',multiItem:true,items:previous.order.items,orderId:record.id}}}},events:[{name:'offering.order.created.v1',payload:{orderId:record.id}}]});
     }
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
