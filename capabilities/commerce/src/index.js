const { normalizeCatalogRequest } = require("../../../packages/catalog-engine/src/productMatcher");
const { BaseCapability } = require("../../../packages/capability-sdk/src/baseCapability");
const { createCapabilityResult } = require("../../../packages/capability-sdk/src/capabilityResult");
const { isConfirmation, isWorkflowAcceptance } = require("../../../packages/conversation-intelligence/src/confirmation");
const { numberFromText } = require("../../../packages/conversation-intelligence/src/text");
class CommerceCapability extends BaseCapability {
  async canHandle(context) {
    const text = normalize(context.message.text); const cs = context.state.capabilityState?.commerce;
    if (context.intelligence?.selected?.capabilityId === 'commerce') return {confidence:context.intelligence.selected.confidence||.99,reason:context.intelligence.selected.reason||'commerce_intelligence'};
    if (cs?.mode === "paused_add_item" && isWorkflowAcceptance(text)) return {confidence:1,reason:"paused_add_item_confirm"};
    const freshBrowse=/\b(can i see|show me|other products?|more products?|browse products?|do you have|do you sell|do you offer|can i get|can i have|i want|i need|looking for)\b/.test(text);
    if (cs?.mode === "checkout" && freshBrowse) return { confidence: 0 };
    if (cs?.mode === "checkout" && context.intelligence?.interruption?.type === "new_subject") return { confidence: 0 };
    if (cs?.mode === "checkout" && context.intelligence?.selected?.capabilityId && context.intelligence.selected.capabilityId !== "commerce") return { confidence: 0 };
    if (cs?.mode === "checkout") return { confidence: 1 };
    if ((/\b(confirm|checkout|place order|order confirm|confirm order|done|final|order karo|confirm kar|pakka|تصدیق|آرڈر کریں)\b/.test(text) || isWorkflowAcceptance(text)) && readyCatalog(context.state)) return { confidence: .99 };
    if (/\b(track (?:my )?order|my orders|orders|order status|mera order|میرے آرڈر)\b/.test(text)) return { confidence: .92 };
    return { confidence: 0 };
  }
  async execute(context) {
    const commerce = context.services.commerce; const catalog = context.services.catalog; const language = detectLanguage(context.message.text, context.state.language);
    const state = context.state.capabilityState?.commerce || {};
    const intent = context.intelligence?.selected?.intent;
    if(intent==='commerce.customer_field_edit')return this.editCustomerField(context,commerce,language,state);
    if(intent==='commerce.optional_email_update'){
      const parsed=context.services.engagement.parseField('email',context.intelligence?.entities?.email||context.message.text);
      if(!parsed.valid)return result(`${parsed.message}\n${state.pendingField?ask(state.pendingField,language):''}`,language,state,'commerce_optional_email_invalid');
      await commerce.updateCheckout({email:parsed.value});
      await context.services.crm?.updateCustomer?.({email:parsed.value,preferredLanguage:language});
      const cart=await commerce.getCart();
      const resume=state.mode==='review'?await checkoutReview(context,cart,language):ask(state.pendingField||'name',language);
      return result(`Thanks — I’ve saved ${parsed.value} as an optional email contact.\n\n${resume}`,language,state,'commerce_optional_email_saved');
    }
    if(state.mode==='review' && (isConfirmation(context.message.text)||isWorkflowAcceptance(context.message.text))) return this.finalizeOrder(context,commerce,catalog,language,state);
    if (intent === "commerce.cart.view") return this.showCart(context, commerce, language, state);
    if (intent === "commerce.cart.view_checkout") return this.showCartAndCheckout(context, commerce, catalog, language, state);
    if (intent === "commerce.cart.clear") return this.clearCart(context, commerce, language);
    if (intent === "commerce.order.return_exchange") return this.returnOrExchangeOrder(context, commerce, catalog, language, state);
    if (intent === "commerce.cart.mutate_request") return this.mutateCartRequest(context, commerce, catalog, language, state);
    if (intent === "commerce.cart.update_variant") return this.updateCartVariant(context, commerce, catalog, language, state);
    if (intent === "commerce.multi_item_request") return this.multiItemRequest(context,commerce,catalog,language,state);
    if (intent === "commerce.cart.add_request") return this.addItemRequest(context, commerce, catalog, language, state);
    if (intent === "commerce.cart.remove_request") return this.removeItemRequest(context, commerce, language, state);
    if (intent === "commerce.cart.update_quantity") return this.updateQuantity(context, commerce, catalog, language, state);
    if (intent === "commerce.cart.increment_quantity") return this.incrementQuantity(context, commerce, catalog, language, state);
    if (intent === "commerce.orders") return this.showOrders(context, commerce, language, state);
    if (intent === "commerce.review.confirm") return this.finalizeOrder(context,commerce,catalog,language,state);
    if (intent === "commerce.confirm" && state.mode === "checkout") {
      const field=state.pendingField||"name";
      const msg=language==="roman_urdu"
        ? `Cart ready hai 👍 Order complete karne ke liye abhi ${checkoutFieldLabel(field,language)} chahiye. ${ask(field,language)}`
        : `Your cart is ready 👍 I still need your ${checkoutFieldLabel(field,language)} before I can place the order. ${ask(field,language)}`;
      return result(msg,language,state,"commerce_checkout_continue");
    }
    if (intent === "commerce.review.change") return this.reviewChange(context,commerce,language,state);
    if (intent === "commerce.checkout_continue") {
      const field=state.pendingField||"name";
      const msg=language==="roman_urdu"
        ? `Cart ready hai 👍 Order complete karne ke liye abhi ${checkoutFieldLabel(field,language)} chahiye. ${ask(field,language)}`
        : `Your cart is ready 👍 I still need your ${checkoutFieldLabel(field,language)} before I can place the order. ${ask(field,language)}`;
      return result(msg,language,state,"commerce_checkout_continue");
    }
    if (/\b(track (?:my )?order|my orders|orders|order status|mera order|میرے آرڈر)\b/.test(normalize(context.message.text)) && state.mode !== "checkout") return this.showOrders(context, commerce, language, state);
    if (state.mode === "review") return this.reviewOrder(context,commerce,language,state);
    if (state.mode !== "checkout") return this.startCheckout(context, commerce, catalog, language);
    return this.continueCheckout(context, commerce, catalog, state, language);
  }
  async startCheckout(context, commerce, catalog, language) {
    const existingCart = await commerce.getCart();
    const catalogState = context.state.capabilityState?.catalog || {};
    const selected = catalogState.selectedAttributes || {};
    let stagedProductId = null;

    // Cart is authoritative. A complete multi-item Commerce request may have no
    // Catalog draft at all, so checkout must never require catalog state.
    if (!existingCart?.items?.length) {
      if (!catalogState.selectedProductId) {
        return result(language === "roman_urdu" ? "Cart abhi empty hai. Pehle koi product add kar dein." : "Your cart is empty. Add a product before checkout.", language, {}, "commerce_empty_cart_checkout");
      }
      const valid = await catalog.validateSelection({ productId: catalogState.selectedProductId, ...selected });
      if (!valid.valid || !selected.quantity) {
        return result(language === "roman_urdu" ? "Product details complete nahi hain." : "Please complete the product details first.", language, {}, "commerce_incomplete_item");
      }
      await commerce.syncItem(cartItemFromValidation(valid,selected));
      stagedProductId = valid.product.id;
    } else if (catalogState.selectedProductId && selected.quantity) {
      // If there is an active Catalog draft after "add another item", merge it
      // only when it is valid and not already represented in the cart.
      const valid = await catalog.validateSelection({ productId: catalogState.selectedProductId, ...selected });
      if (valid.valid) {
        const staged = existingCart.items.some((i) => i.productId === valid.product.id && i.color === (selected.color || null) && i.size === (selected.size || null) && i.quantity === selected.quantity);
        if (!staged) await commerce.syncItem(cartItemFromValidation(valid,selected));
        stagedProductId = valid.product.id;
      }
    }

    const cartForValidation=await commerce.getCart();
    const issues=await validateCart(cartForValidation,catalog);
    if(issues.length){
      const safeState=context.state.capabilityState?.commerce||{};
      return result(`${formatCartIssues(issues)}\n\nYour cart is unchanged. Complete these options before checkout.`,language,{...safeState,mode:'paused_add_item',pendingField:null},'commerce_cart_needs_variants');
    }

    try { await commerce.reserveCart({catalog}); }
    catch(error) { return result(inventoryFailureReply(error),language,{mode:"paused_add_item",pendingField:null},"commerce_inventory_reservation_failed"); }

    await context.services.crm?.recordActivity("commerce.checkout_started", { productId: stagedProductId, cartItems: cartForValidation?.items?.length || 0 });
    const paused = context.state.capabilityState?.commerce?.resumeCheckout;
    const nextField = paused?.pendingField || "name";
    const next = { mode: "checkout", pendingField: nextField };
    const added = context.state.capabilityState?.commerce?.mode === "paused_add_item";
    const cartNow = await commerce.getCart();
    const cartText = await cartSummary(context, cartNow, language);
    const intro = added && stagedProductId
      ? `${language === "roman_urdu" ? "Added 👍 Item cart mein add ho gaya." : "Added 👍 The item is now in your cart."}\n\n${cartText}`
      : cartText;
    return result(intro + "\n\n" + ask(nextField, language), language, next, added ? "commerce_item_added_checkout_resumed" : "commerce_checkout_started", [{ name: "commerce.checkout.started.v1", payload: { productId: stagedProductId, cartItems: cartNow?.items?.length || 0 } }]);
  }
  async editCustomerField(context,commerce,language,state){
    const amendment=context.intelligence?.entities?.fieldAmendment||{};
    const field=amendment.field;
    const allowed=new Set(['name','phone','email','city','address','landmark','paymentMethod']);
    if(!allowed.has(field))return result('Tell me whether you want to change the name, phone, email, city, address, landmark, or payment method.',language,state,'commerce_field_edit_unknown');
    const target=context.intelligence?.entities?.target||state.pendingFieldEdit?.target||(state.mode==='checkout'||state.mode==='review'?'checkout':'order');
    const orderId=context.intelligence?.entities?.orderId||state.pendingFieldEdit?.orderId||state.lastOrderId||null;
    const rawValue=amendment.rawValue;
    if(rawValue==null||String(rawValue).trim()===''){
      const returnToReview=state.mode==='review'||state.returnToReview===true;
      const next={...state,pendingField:field,returnToReview,pendingFieldEdit:{field,target,orderId,resumeMode:state.mode,resumePendingField:state.pendingField}};
      return result(`What should I use as the new ${checkoutFieldLabel(field,language)}?`,language,next,'commerce_field_edit_needs_value');
    }
    const parsed=context.services.engagement.parseField(field,rawValue,field==='phone'?{minDigits:10,maxDigits:15}:{});
    if(!parsed.valid){
      const resumeMode=state.pendingFieldEdit?.resumeMode||state.mode;
      const next={...state,pendingField:field,returnToReview:resumeMode==='review'||state.returnToReview===true,pendingFieldEdit:{field,target,orderId,resumeMode,resumePendingField:state.pendingFieldEdit?.resumePendingField||state.pendingField}};
      return result(`${parsed.message} The existing ${checkoutFieldLabel(field,language)} has not been changed. Please provide the new ${checkoutFieldLabel(field,language)}.`,language,next,'commerce_field_edit_invalid');
    }
    const resumeMode=state.pendingFieldEdit?.resumeMode||state.mode;
    const resumePendingField=state.pendingFieldEdit?.resumePendingField||state.pendingField;
    let next={...state};delete next.pendingFieldEdit;
    if(target==='order'){
      if(!orderId)return result('I could not find a recent order to update, so no customer or delivery detail was changed.',language,next,'commerce_order_field_edit_missing');
      const order=await commerce.updateOrderCustomer(orderId,{[field]:parsed.value});
      next={mode:'idle',pendingField:null,lastOrderId:order.id};
      await syncCheckoutFieldToCrm(context,field,parsed.value,language);
      return result(`Updated — order ${order.id} now uses ${parsed.value} for its ${checkoutFieldLabel(field,language)}. Revision: ${order.revision}.`,language,next,'commerce_order_customer_field_updated');
    }
    await commerce.updateCheckout({[field]:parsed.value});
    await syncCheckoutFieldToCrm(context,field,parsed.value,language);
    if(resumeMode==='review'){
      const cart=await commerce.getCart();
      const review=await checkoutReview(context,cart,language);
      return result(`Updated — the ${checkoutFieldLabel(field,language)} is now ${parsed.value}.\n\n${review}`,language,{mode:'review',pendingField:'confirmation'},'commerce_review_customer_field_updated');
    }
    if(resumeMode==='checkout'&&resumePendingField===field){
      const fields=['name','phone','city','address','landmark','paymentMethod'];
      const nextField=fields[fields.indexOf(field)+1]||null;
      if(nextField)return result(`Updated — the ${checkoutFieldLabel(field,language)} is now ${parsed.value}.\n\n${ask(nextField,language)}`,language,{mode:'checkout',pendingField:nextField},'commerce_checkout_customer_field_updated');
      const cart=await commerce.getCart();
      return result(await checkoutReview(context,cart,language),language,{mode:'review',pendingField:'confirmation'},'commerce_checkout_review');
    }
    next={...next,mode:resumeMode||'checkout',pendingField:resumePendingField||'name'};
    const continuation=next.mode==='checkout'&&next.pendingField?`\n\n${ask(next.pendingField,language)}`:'';
    return result(`Updated — the ${checkoutFieldLabel(field,language)} is now ${parsed.value}.${continuation}`,language,next,'commerce_checkout_customer_field_updated');
  }
  async continueCheckout(context, commerce, catalog, state, language) {
    const field = state.pendingField; const raw = String(context.message.text || "").trim();
    const correction = context.intelligence?.correction;
    const interruption = context.intelligence?.interruption;

    if(context.services.engagement.isFieldRefusal?.(raw)){
      if(field==='landmark'){
        await commerce.updateCheckout({landmark:''});
        return result(`${ack(field,'',language)}\n\n${ask('paymentMethod',language)}`,language,{...state,pendingField:'paymentMethod'},'commerce_optional_landmark_skipped');
      }
      const reply=`I understand. ${checkoutFieldLabel(field,language)} is required to complete delivery. You can provide it, cancel this checkout, or ask for human support.`;
      return result(reply,language,state,'commerce_required_field_refused');
    }

    // Corrections have higher priority than the currently pending field. A user
    // can say "that's not my name" even after Nova has already moved to phone.
    if (correction?.target === "name" && correction.type === "invalidate") {
      await commerce.updateCheckout({ name: null });
      return result(language === "roman_urdu" ? "Theek hai — pehla naam remove kar diya. Delivery ke liye sahi naam bata dein." : "No problem — I removed the previous name. What name should I use for delivery?", language, { ...state, pendingField: "name" }, "commerce_name_correction");
    }
    if (correction?.target === "phone" && correction.type === "invalidate") {
      await commerce.updateCheckout({ phone: null });
      return result(language === "roman_urdu" ? "Theek hai — phone number update kar lete hain. Sahi delivery number bata dein." : "No problem — let's update the phone number. What is the correct delivery number?", language, { ...state, pendingField: "phone" }, "commerce_phone_correction");
    }

    // Contextual comments are interruptions, not checkout field values. Answer
    // with verified Catalog facts, then resume the same pending checkout field.
    if (interruption?.type === "price_comment") {
      const selected = context.state.capabilityState?.catalog || {};
      const product = selected.selectedProductId ? await catalog.getProductById(selected.selectedProductId) : null;
      const fact = product ? `${product.name} ${money(product.price, product.currency)}` : "this item";
      const reply = language === "roman_urdu"
        ? `Haan 😅 ${fact} ka price thora premium lag sakta hai. Agar order continue karna hai to ${ask(field, language)}`
        : `I understand 😅 ${fact} can feel a little expensive. If you'd like to continue the order, ${lowerFirst(ask(field, language))}`;
      return result(reply, language, state, "commerce_price_comment");
    }

    if(field==="city"){
      const products=await catalog.listProducts();
      const productValues=new Set(products.flatMap(p=>[...(p.colors||[]),...(p.sizes||[])].map(x=>normalize(String(x)))));
      if(productValues.has(normalize(raw))){
        const draft=context.state.capabilityState?.catalog||{};
        const product=draft.selectedProductId?await catalog.getProductById(draft.selectedProductId):null;
        const msg=product
          ? `That looks like a ${product.name} option, not a delivery city. Your order is safe. ${ask("city",language)}`
          : `That doesn't look like a delivery city. ${ask("city",language)}`;
        return result(msg,language,state,"commerce_city_rejected_product_attribute");
      }
    }

    const parsed = context.services.engagement.parseField(field, raw, field==='phone'?{minDigits:10,maxDigits:15}:{});
    const intelligenceValidation = context.intelligence?.validation?.pending;
    if (intelligenceValidation && intelligenceValidation.valid === false && !parsed.valid) {
      return result(`${parsed.message}\n${ask(field, language)}`, language, state, "commerce_invalid_contextual_field");
    }
    if (!parsed.valid) return result(`${parsed.message}\n${ask(field, language)}`, language, state, "commerce_invalid_field");
    await commerce.updateCheckout({ [field]: parsed.value });
    await syncCheckoutFieldToCrm(context, field, parsed.value, language);

    // A field opened from Review is an isolated edit. Saving it must return to
    // the existing review instead of restarting the sequential checkout flow.
    // All other already-collected checkout values remain authoritative in the
    // cart checkout record.
    if (state.returnToReview) {
      const cart = await commerce.getCart();
      const reply = await checkoutReview(context, cart, language);
      return result(
        `${ack(field, parsed.value, language)}\n\n${reply}`,
        language,
        { mode:"review", pendingField:"confirmation" },
        `commerce_${field}_edited_review`
      );
    }

    const fields = ["name", "phone", "city", "address", "landmark", "paymentMethod"]; const nextIndex = fields.indexOf(field) + 1;
    if (nextIndex < fields.length) { const next = { ...state, pendingField: fields[nextIndex] }; return result(ack(field, parsed.value, language) + "\n\n" + ask(fields[nextIndex], language), language, next, `commerce_${field}_saved`); }
    const cart=await commerce.getCart();
    const reply=await checkoutReview(context,cart,language);
    return result(reply,language,{mode:"review",pendingField:"confirmation"},"commerce_checkout_review");
  }


  async finalizeOrder(context,commerce,catalog,language,state){
    const cart=await commerce.getCart();
    const issues=await validateCart(cart,catalog);
    if(issues.length){
      return result(`${formatCartIssues(issues)}\n\nI have kept your cart and checkout details unchanged so you can repair the item safely.`,language,state,'commerce_order_preflight_failed');
    }
    let order;
    try{order=await commerce.createOrder({catalog});}
    catch(error){
      if(error?.code==='CART_VALIDATION_FAILED')return result(`I could not place the order because ${humanValidationReason(error.reason,error.product)}. Your cart and checkout details are unchanged.`,language,state,'commerce_order_preflight_failed');
      if(error?.code==='INSUFFICIENT_INVENTORY'||error?.code==='RESERVATION_REQUIRED')return result(`${inventoryFailureReply(error)} Your cart and delivery details are still saved.`,language,state,'commerce_order_inventory_failed');
      throw error;
    }
    await syncOrderCustomerToCrm(context, order, language);
    await context.services.crm?.recordActivity("commerce.order_created",{orderId:order.id,total:order.total});
    await context.services.memory?.setPreference("lastOrderId",order.id);
    const reply=confirm(order,language);
    return result(reply,language,{mode:"idle",pendingField:null,lastOrderId:order.id},"commerce_order_created",
      [{name:"commerce.order.completed.v1",payload:{orderId:order.id,total:order.total}}],
      {intent:"COMMERCE_ORDER_CREATED",payload:{orderId:order.id,total:order.total,totalText:money(order.total,order.currency),paymentMethod:order.paymentMethod}},
      {catalog:{selectedProductId:null,selectedAttributes:{}}});
  }
  async reviewOrder(context,commerce,language,state){
    const cart=await commerce.getCart();
    return result(await checkoutReview(context,cart,language),language,state,"commerce_checkout_review");
  }
  async reviewChange(context,commerce,language,state){
    const text=normalize(context.message.text);
    const fields=[["name",/\bname\b/],["phone",/\b(phone|number)\b/],["city",/\bcity\b/],["address",/\baddress\b/],["landmark",/\blandmark\b/],["paymentMethod",/\b(payment|method|cash|jazz|easy|bank)\b/]];
    const found=fields.find(([,r])=>r.test(text));
    if(found){
      const prefix = language === "roman_urdu" ? "Bilkul — sirf yahi detail update karte hain." : "Sure — I'll update only that detail.";
      return result(`${prefix} ${ask(found[0],language)}`,language,{mode:"checkout",pendingField:found[0],returnToReview:true,editingField:found[0]},"commerce_review_edit_field");
    }
    return result("Sure. Tell me what you want to change: an item/quantity, name, phone, city, address, landmark, or payment method.",language,state,"commerce_review_change_prompt");
  }

  async removeItemRequest(context, commerce, language, state) {
    const requestedIds=[...new Set(context.intelligence?.entities?.productIds||[])];
    const removalRequests=new Map((context.intelligence?.entities?.removals||[]).map(item=>[item.productId,item]));
    const cart=await commerce.getCart();
    if(cart?.items?.length){
      const matched=cart.items.filter(item=>requestedIds.includes(item.productId));
      if(!matched.length){
        const reply=`I can remove items without changing anything else. Your current cart has: ${cart.items.map(item=>item.name).join(', ')}. Tell me the exact item or items to remove.`;
        return result(reply,language,{...state,pendingRemoval:{target:'cart'}},'commerce_cart_remove_needs_item');
      }
      const changes=[];
      for(const productId of [...new Set(matched.map(item=>item.productId))]){
        const rows=matched.filter(item=>item.productId===productId),request=removalRequests.get(productId),quantity=request?.requestedQuantity;
        if(quantity!=null&&rows.length!==1){
          return result(`I found more than one ${rows[0]?.name||'matching item'} variant in the cart. Name the color or size to reduce; nothing has been changed.`,language,state,'commerce_cart_remove_variant_ambiguous');
        }
        if(quantity!=null&&quantity>rows[0].quantity){
          return result(`Your cart has ${rows[0].quantity} ${rows[0].name}, so I cannot remove ${quantity}. Nothing has been changed.`,language,state,'commerce_cart_remove_quantity_invalid');
        }
        if(quantity!=null&&quantity<rows[0].quantity){
          await commerce.updateItemQuantity(productId,rows[0].quantity-quantity);
          changes.push(`reduced ${rows[0].name} by ${quantity}; ${rows[0].quantity-quantity} remains`);
        }else{
          await commerce.removeItem(productId);
          changes.push(`removed ${[...new Set(rows.map(item=>item.name))].join(', ')}`);
        }
      }
      const updated=await commerce.getCart();
      if(!updated)return result(`Done 👍 ${sentenceList(changes)}. Your cart is now empty.`,language,{mode:'idle',pendingField:null},'commerce_cart_items_removed');
      let resume='';
      if(state.mode==='review')resume=`\n\n${await checkoutReview(context,updated,language)}`;
      else if(state.mode==='checkout'&&state.pendingField)resume=`\n\n${ask(state.pendingField,language)}`;
      else resume=`\n\n${await cartSummary(context,updated,language)}`;
      const next={...state};delete next.pendingRemoval;
      return result(`Done 👍 ${sentenceList(changes)}.${resume}`,language,next,'commerce_cart_items_removed');
    }

    const orders=await commerce.listOrders();
    const preferredId=context.intelligence?.entities?.orderId||state.pendingRemoval?.orderId||state.lastOrderId;
    const order=(preferredId?orders.find(entry=>entry.id===preferredId):null)||[...orders].filter(entry=>['confirmed','requested','pending'].includes(entry.status)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0];
    if(!order)return result('I could not find a modifiable cart or order for this customer in this tenant.',language,state,'commerce_transaction_remove_not_found');
    const matched=order.items.filter(item=>requestedIds.includes(item.productId));
    if(!matched.length){
      const reply=`I found order ${order.id}. It contains: ${order.items.map(item=>item.name).join(', ')}. Tell me the exact item or items to remove; nothing has been changed yet.`;
      return result(reply,language,{...state,lastOrderId:order.id,pendingRemoval:{target:'order',orderId:order.id}},'commerce_order_remove_needs_item');
    }
    const updated=await commerce.removeOrderItems(order.id,[...new Set(matched.map(item=>item.productId))]);
    const next={mode:'idle',pendingField:null,lastOrderId:updated.id};
    const removedNames=[...new Set(matched.map(item=>item.name))];
    return result(`Updated order ${updated.id} (revision ${updated.revision}) 👍 Removed ${removedNames.join(', ')}.\n\n${orderSummary(updated)}`,language,next,'commerce_order_items_removed');
  }

  async returnOrExchangeOrder(context,commerce,catalog,language,state){
    const entities=context.intelligence?.entities||{};
    const orders=await commerce.listOrders();
    const preferredId=entities.orderId||state.pendingOrderAction?.orderId||state.lastOrderId||null;
    const order=(preferredId?orders.find(entry=>entry.id===preferredId):null)||[...orders].filter(entry=>['confirmed','requested','pending'].includes(entry.status)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0]||null;
    const operation=entities.operation||state.pendingOrderAction?.operation||'exchange';
    if(!order){
      const reply=`I can help with ${operation==='exchange'?'an exchange':'a return'}, but I could not find a modifiable order for this customer in this tenant. Share the order reference and exact product name; I have not opened a new catalog purchase or changed anything.`;
      return result(reply,language,{...state,pendingOrderAction:{operation,orderId:null,fromSize:entities.fromSize||null,toSize:entities.toSize||null}},'commerce_order_action_not_found');
    }
    const requestedIds=[...new Set(entities.productIds||[])];
    let matched=order.items.filter(item=>requestedIds.includes(item.productId));
    if(entities.fromSize)matched=matched.filter(item=>String(item.size||'').toUpperCase()===String(entities.fromSize).toUpperCase());
    if(matched.length!==1){
      const choices=order.items.map(item=>`${item.name}${item.color?` (${item.color}`:' ('}${item.size?`${item.color?', ':''}${item.size}`:''})`).join(', ');
      const reply=`I found order ${order.id}, but I need the exact order item for this ${operation}. It contains: ${choices}. Tell me the exact product${operation==='exchange'?' and the replacement size/color':''}. Nothing has been changed.`;
      return result(reply,language,{...state,lastOrderId:order.id,pendingOrderAction:{operation,orderId:order.id,fromSize:entities.fromSize||null,toSize:entities.toSize||null}},'commerce_order_action_needs_item');
    }
    const item=matched[0];
    if(operation==='return'){
      const updated=await commerce.requestOrderReturn(order.id,[item.productId],/\b(?:small|tight|doesn t fit|does not fit)\b/.test(normalize(context.message.text))?'size_issue':null);
      const reply=`Return request recorded for ${item.name} from order ${updated.id} (revision ${updated.revision}). The product remains in the order history; this is a return request, not a promised refund. The business team must approve the return under this tenant’s policy.`;
      const next={mode:'idle',pendingField:null,lastOrderId:updated.id};
      return result(reply,language,next,'commerce_order_return_requested');
    }
    const toSize=entities.toSize||state.pendingOrderAction?.toSize||null;
    if(!toSize){
      const product=await catalog.getProductById(item.productId);
      const choices=(product?.sizes||[]).join(', ');
      const reply=`I found ${item.name}${item.size?` in size ${item.size}`:''} in order ${order.id}. Which replacement size would you like${choices?`: ${choices}`:'?'} Nothing has been changed yet.`;
      return result(reply,language,{...state,lastOrderId:order.id,pendingOrderAction:{operation:'exchange',orderId:order.id,productId:item.productId,fromSize:item.size||null}},'commerce_order_exchange_needs_size');
    }
    const product=await catalog.getProductById(item.productId);
    const valid=await catalog.validateSelection({productId:item.productId,color:item.color||null,size:toSize,quantity:item.quantity,requireComplete:true});
    if(!valid.valid){
      const choices=(product?.sizes||[]).join(', ');
      const reply=`Size ${toSize} is not available for ${item.name}.${choices?` Available sizes: ${choices}.`:''} The order is unchanged.`;
      return result(reply,language,{...state,lastOrderId:order.id,pendingOrderAction:{operation:'exchange',orderId:order.id,productId:item.productId,fromSize:item.size||null}},'commerce_order_exchange_invalid_size');
    }
    const updated=await commerce.exchangeOrderItem(order.id,{productId:item.productId,fromSize:item.size||null,toSize,target:{sku:valid.sku,variantId:valid.variant?.id||null,unitPrice:valid.unitPrice,currency:valid.currency,inventory:valid.variant?valid.variant.inventory:null}});
    const reply=`Updated order ${updated.id} (revision ${updated.revision}) 👍 ${item.name} is now size ${toSize}; the previous size remains recorded in the order timeline.`;
    return result(reply,language,{mode:'idle',pendingField:null,lastOrderId:updated.id},'commerce_order_item_exchanged');
  }

  async mutateCartRequest(context,commerce,catalog,language,state){
    const entities=context.intelligence?.entities||{},removals=entities.removals||[],additions=entities.additions||[],ambiguous=entities.ambiguous||[];
    const cart=await commerce.getCart();
    if(!cart?.items?.length)return result('Your cart is empty, so there is nothing to remove. I have not added anything.',language,state,'commerce_cart_mutation_empty');
    if(ambiguous.length)return result('One of the requested products matches more than one catalog item. Name the exact product; your cart is unchanged.',language,state,'commerce_cart_mutation_ambiguous');

    const removalPlan=[];
    for(const request of removals){
      const rows=cart.items.filter(item=>item.productId===request.productId);
      if(!rows.length)return result(`${request.name||'That item'} is not in your cart. Nothing has been changed.`,language,state,'commerce_cart_mutation_remove_missing');
      if(request.requestedQuantity!=null&&rows.length!==1)return result(`I found more than one ${request.name} variant. Name the color or size to reduce; your cart is unchanged.`,language,state,'commerce_cart_mutation_remove_ambiguous');
      if(request.requestedQuantity!=null&&request.requestedQuantity>rows[0].quantity)return result(`Your cart has ${rows[0].quantity} ${rows[0].name}, so I cannot remove ${request.requestedQuantity}. Nothing has been changed.`,language,state,'commerce_cart_mutation_remove_quantity_invalid');
      removalPlan.push({request,rows});
    }

    const additionPlan=[],issues=[];
    for(const request of additions){
      const product=await catalog.getProductById(request.productId);
      if(!product){issues.push({reason:'product_unavailable',product:{name:request.name}});continue;}
      const quantity=Math.max(1,Number(request.quantity||1));
      const variantSelectionRequired=Boolean(product.colors?.length||product.sizes?.length);
      const selection={productId:product.id,color:request.color||null,size:request.size||null,quantity,cartId:cart.id,requireComplete:variantSelectionRequired};
      const valid=await catalog.validateSelection(selection);
      if(!valid.valid){issues.push(valid);continue;}
      additionPlan.push({product,quantity,color:request.color||null,size:request.size||null,variantSelectionRequired,valid});
    }
    if(issues.length)return result(`${formatCartIssues(issues)}\n\nYour cart is unchanged. Complete the missing product options and try the combined change again.`,language,state,'commerce_cart_mutation_addition_invalid');

    const changes=[];
    for(const {request,rows} of removalPlan){
      const quantity=request.requestedQuantity;
      if(quantity!=null&&quantity<rows[0].quantity){
        await commerce.updateItemQuantity(request.productId,rows[0].quantity-quantity);
        changes.push(`Reduced ${rows[0].name} by ${quantity}; ${rows[0].quantity-quantity} remains`);
      }else{
        await commerce.removeItem(request.productId);
        changes.push(`Removed ${[...new Set(rows.map(item=>item.name))].join(', ')}`);
      }
    }
    for(const item of additionPlan){
      await commerce.addItem(cartItemFromValidation(item.valid,{color:item.color,size:item.size,quantity:item.quantity}));
      changes.push(`Added ${item.product.name} × ${item.quantity}`);
    }
    const updated=await commerce.getCart();
    const next={...state,pendingProductChoices:[]};delete next.pendingRemoval;delete next.pendingMultiItemDraft;
    return result(`Done 👍\n• ${changes.join('\n• ')}\n\n${await cartSummary(context,updated,language)}`,language,next,'commerce_cart_mutated');
  }
  async updateCartVariant(context,commerce,catalog,language,state){
    const entities=context.intelligence?.entities||{},cart=await commerce.getCart();
    if(!cart?.items?.length)return result(language==='roman_urdu'?'Cart abhi empty hai, is liye size ya color change nahi hua.':'Your cart is empty, so no size or color was changed.',language,state,'commerce_cart_variant_empty');
    const requestedIds=[...new Set(entities.productIds||[])];
    if(requestedIds.length!==1){
      const choices=[...new Set(cart.items.map(item=>item.name))].join(', ');
      const reply=language==='roman_urdu'
        ? `Cart mein ${choices} hain. Kis exact product ka size ya color change karna hai? Maine abhi kuch change nahi kiya.`
        : `Your cart contains ${choices}. Tell me the exact product whose size or color should change; nothing has been changed.`;
      return result(reply,language,state,'commerce_cart_variant_needs_product');
    }
    const productId=requestedIds[0],fromSize=entities.fromSize||null,fromColor=entities.fromColor||null,toSize=entities.toSize||null,toColor=entities.toColor||null;
    let sourceRows=cart.items.filter(item=>item.productId===productId);
    if(fromSize)sourceRows=sourceRows.filter(item=>String(item.size||'').toUpperCase()===String(fromSize).toUpperCase());
    if(fromColor)sourceRows=sourceRows.filter(item=>String(item.color||'').toLowerCase()===String(fromColor).toLowerCase());
    if(sourceRows.length!==1){
      const choices=cart.items.filter(item=>item.productId===productId).map(item=>`${item.name}${item.color?` ${item.color}`:''}${item.size?` size ${item.size}`:''} × ${item.quantity}`).join(', ');
      const reply=`I found more than one matching cart variant. Current choices: ${choices}. Name the current size/color and the new size/color; nothing has been changed.`;
      return result(reply,language,state,'commerce_cart_variant_ambiguous');
    }
    const source=sourceRows[0],quantity=Math.max(1,Number(entities.quantity||1));
    if(!toSize&&!toColor)return result(`Tell me the new size or color for ${source.name}; your cart is unchanged.`,language,state,'commerce_cart_variant_needs_target');
    if(quantity>Number(source.quantity||0))return result(`Your cart has ${source.quantity} ${source.name}${source.size?` in size ${source.size}`:''}, so I cannot change ${quantity}. Nothing has been changed.`,language,state,'commerce_cart_variant_quantity_invalid');
    const product=await catalog.getProductById(productId);
    const targetSize=toSize||source.size||null,targetColor=toColor||source.color||null;
    const existingTarget=cart.items.find(item=>item!==source&&item.productId===productId&&item.size===targetSize&&item.color===targetColor);
    const validation=await catalog.validateSelection({productId,color:targetColor,size:targetSize,quantity:Number(existingTarget?.quantity||0)+quantity,cartId:cart.id,requireComplete:true});
    if(!validation.valid){
      const options=validation.reason==='invalid_size'?(product?.sizes||[]).join(', '):validation.reason==='invalid_color'?(product?.colors||[]).join(', '):null;
      return result(`That ${toSize?'size':'color'} is not available for ${source.name}.${options?` Available options: ${options}.`:''} Your cart is unchanged.`,language,state,'commerce_cart_variant_invalid');
    }
    const updated=await commerce.updateItemVariant({productId,fromSize:source.size||null,fromColor:source.color||null,toSize:targetSize,toColor:targetColor,quantity,target:{sku:validation.sku,variantId:validation.variant?.id||null,unitPrice:validation.unitPrice,currency:validation.currency,inventory:validation.variant?validation.variant.inventory:null}});
    const changed=[];
    if(targetSize!==source.size)changed.push(`size ${source.size||'-'} to ${targetSize}`);
    if(targetColor!==source.color)changed.push(`color ${source.color||'-'} to ${targetColor}`);
    let resume=`\n\n${await cartSummary(context,updated,language)}`;
    if(state.mode==='review')resume=`\n\n${await checkoutReview(context,updated,language)}`;
    else if(state.mode==='checkout'&&state.pendingField)resume+=`\n\n${ask(state.pendingField,language)}`;
    const reply=language==='roman_urdu'
      ? `Ho gaya 👍 ${quantity} ${source.name} ka ${changed.join(' aur ')} change kar diya hai.${resume}`
      : `Done 👍 I changed ${quantity} ${source.name} from ${changed.join(' and ')}.${resume}`;
    return result(reply,language,state,'commerce_cart_variant_updated');
  }
  async updateQuantity(context, commerce, catalog, language, state) {
    const cart=await commerce.getCart(); if(!cart?.items?.length) return result("Your cart is empty 😊",language,state,"commerce_cart_empty");
    const text=normalize(context.message.text); const target=text.match(/\b(?:to|down to|at|=)\s*(?:only\s*)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/); const qty=target?numberFromText(target[1]):null; const item=cart.items.find(i=>text.includes(normalize(i.name)) || (cart.items.length===1));
    if(!item||!qty) return result("Tell me which cart item to update and the new quantity.",language,state,"commerce_cart_quantity_needs_details");
    const valid=await catalog.validateSelection({...item,quantity:qty,cartId:cart.id}); if(!valid.valid) return result(valid.reason==='insufficient_inventory'?`Sorry, only ${valid.availableQuantity} ${item.name} are available right now.`:"That quantity isn't available.",language,state,"commerce_cart_quantity_invalid");
    await commerce.updateItemQuantity(item.productId,qty);
    let resume='';
    if(state.mode==='checkout'&&state.pendingField)resume=`\n\n${ask(state.pendingField,language)}`;
    else if(state.mode==='review')resume=`\n\n${await checkoutReview(context,await commerce.getCart(),language)}`;
    return result(`Updated 👍 ${item.name} quantity is now ${qty}.${resume}`,language,state,"commerce_cart_quantity_updated");
  }

  async incrementQuantity(context, commerce, catalog, language, state) {
    const cart=await commerce.getCart(); if(!cart?.items?.length) return result("Your cart is empty 😊",language,state,"commerce_cart_empty");
    const text=normalize(context.message.text); const m=text.match(/\b(?:add\s+)?(\d{1,3})\s+more\b/); const delta=m?Number(m[1]):null;
    const item=cart.items.find(i=>text.includes(normalize(i.name))) || (cart.items.length===1?cart.items[0]:null);
    if(!item||!delta) return result("Tell me which cart item you want more of and how many to add.",language,state,"commerce_cart_increment_needs_details");
    const target=item.quantity+delta; const valid=await catalog.validateSelection({...item,quantity:target,cartId:cart.id});
    if(!valid.valid){
      if(valid.reason==='insufficient_inventory'){ const canAdd=Math.max(0,Number(valid.availableQuantity)-item.quantity); return result(`You already have ${item.quantity} ${item.name} in your cart. Only ${valid.availableQuantity} are available in total, so I can add up to ${canAdd} more.`,language,state,"commerce_cart_increment_inventory_limit"); }
      return result("That additional quantity isn't available.",language,state,"commerce_cart_increment_invalid");
    }
    await commerce.updateItemQuantity(item.productId,target); return result(`Added 👍 ${delta} more ${item.name}. Your cart now has ${target}.`,language,state,"commerce_cart_quantity_incremented");
  }

  async showCart(context, commerce, language, state) {
    const cart = await commerce.getCart();
    if (!cart?.items?.length) {
      const draft = context.state.capabilityState?.catalog || {};
      if (draft.selectedProductId) {
        const product = await context.services.catalog.getProductById(draft.selectedProductId);
        if (product) {
          const selected = draft.selectedAttributes || {};
          const parts = [product.name];
          if (selected.color) parts.push(selected.color);
          if (selected.size) parts.push(`Size ${selected.size}`);
          const pending = !selected.quantity ? (language === "roman_urdu" ? "Quantity abhi select nahi hui." : "Quantity hasn't been selected yet.") : null;
          const intro = language === "roman_urdu" ? "Aapka cart abhi empty hai, lekin ek product selection progress mein hai 😊" : "Your cart is currently empty, but you have a product selection in progress 😊";
          const next = language === "roman_urdu" ? "Agar continue karna ho to quantity bata dein." : "If you'd like to continue, tell me the quantity.";
          return result([intro, "", `• ${parts.join(" — ")}`, pending ? `  ${pending}` : "", "", next].filter(Boolean).join("\n"), language, state, "commerce_cart_empty_with_draft");
        }
      }
      return result(language === "roman_urdu" ? "Aapka cart filhal empty hai 😊 Agar chahein to available products dekh sakte hain." : "Your cart is currently empty 😊 If you'd like, I can show you the available products.", language, state, "commerce_cart_empty");
    }
    const lines = [language === "roman_urdu" ? "🛒 *Aapka cart*" : "🛒 *Your cart*", ""];
    let total=0; for(const item of cart.items){ const p=await context.services.catalog.getProductById(item.productId); const unitPrice=Number.isFinite(Number(item.unitPrice))?Number(item.unitPrice):Number(p?.price||0);const subtotal=unitPrice*item.quantity; total+=subtotal; lines.push(`• ${item.name}${item.color?` (${item.color})`:""}${item.size?` (${item.size})`:""} × ${item.quantity} — ${money(subtotal,item.currency||p?.currency||"PKR")}`); }
    lines.push("", `${language === "roman_urdu" ? "Total" : "Total"}: ${money(total,"PKR")}`);
    if (state?.mode === "checkout" && state.pendingField) lines.push("", language === "roman_urdu" ? `Checkout abhi paused nahi hua — ${ask(state.pendingField, language)}` : `Your checkout is still active. ${ask(state.pendingField, language)}`);
    return result(lines.join("\n"), language, state, "commerce_cart_viewed");
  }
  async showCartAndCheckout(context, commerce, catalog, language, state) {
    const cart=await commerce.getCart();
    if(!cart?.items?.length) return this.showCart(context,commerce,language,state);
    try { await commerce.reserveCart({catalog}); }
    catch(error) { return result(inventoryFailureReply(error),language,state,'commerce_inventory_reservation_failed'); }
    const intro=await cartSummary(context,cart,language);
    const next={mode:'checkout',pendingField:'name'};
    return result(`${intro}\n\n${language==='roman_urdu'?'Theek hai — checkout start karte hain.':'Looks good — let’s continue checkout.'}\n${ask('name',language)}`,language,next,'commerce_cart_view_checkout');
  }
  async clearCart(context, commerce, language) {
    await commerce.clearCart();
    return result(language === "roman_urdu" ? "Theek hai 👍 Cart clear kar diya hai." : "Done 👍 Your cart is now empty.", language, {mode:"idle",pendingField:null,pendingMultiItemDraft:[],pendingProductChoices:[]}, "commerce_cart_cleared",[],null,{catalog:{selectedProductId:null,selectedAttributes:{}}});
  }
  async multiItemRequest(context,commerce,catalog,language,state){
    const incoming=context.intelligence?.entities?.items||[], ambiguous=context.intelligence?.entities?.ambiguous||[];
    const attributeAmbiguity=context.intelligence?.entities?.attributeAmbiguity||null;
    const targetOrderRequested=Boolean(context.intelligence?.entities?.targetOrder||state?.pendingOrderEdit);
    let pendingOrderEdit=state?.pendingOrderEdit||null;
    if(targetOrderRequested&&!pendingOrderEdit){
      const orders=await commerce.listOrders();
      const preferredId=context.intelligence?.entities?.orderId||state?.lastOrderId;
      const order=(preferredId?orders.find(entry=>entry.id===preferredId):null)||[...orders].filter(entry=>['confirmed','requested','pending'].includes(entry.status)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0];
      if(!order)return result('I could not find a modifiable confirmed order for this customer. I have not added anything.',language,state,'commerce_order_add_not_found');
      pendingOrderEdit={type:'add',orderId:order.id};
    }
    if(attributeAmbiguity){
      const products=attributeAmbiguity.products||[];
      const field=(attributeAmbiguity.fields||[]).join(' or ')||'attribute';
      const count=Number(attributeAmbiguity.pendingSlots||products.length||0);
      const received=Number(attributeAmbiguity.receivedValues||0);
      const mismatch=count!==received
        ? `I have ${count} pending ${field} selections across ${products.length} product${products.length===1?'':'s'}, but received ${received} unlabeled value${received===1?'':'s'}.`
        : `Those ${field} values can match more than one pending product.`;
      const example=products.length?` Please name each product, for example: ${products.map(name=>`${name} — ${field}`).join('; ')}.`:'';
      const reply=`${mismatch}${example}\n\nI have not changed your cart or any saved product option.`;
      return result(reply,language,{...state,pendingMultiItemDraft:state?.pendingMultiItemDraft||[],...(pendingOrderEdit?{pendingOrderEdit}:{})} ,'commerce_multi_item_attribute_ambiguous');
    }
    const items=mergeMultiItemDraft(state?.pendingMultiItemDraft||[],incoming);
    const prepared=[], issues=[], recognized=[];
    for(const item of items){
      const p=await catalog.getProductById(item.productId);
      if(!p||!p.inStock){issues.push({reason:'product_unavailable',product:p||{name:item.name}});continue;}
      const quantity=Math.max(1,Number(item.quantity||1));
      recognized.push({p,quantity});
      const variantSelectionRequired=Boolean(p.colors?.length||p.sizes?.length);
      const selection={productId:p.id,color:item.color||null,size:item.size||null,quantity,requireComplete:variantSelectionRequired};
      const valid=await catalog.validateSelection(selection);
      if(!valid.valid){issues.push(valid);continue;}
      prepared.push({p,quantity,color:item.color||null,size:item.size||null,variantSelectionRequired,valid});
    }
    if(!items.length&&!ambiguous.length)return result("Sorry, I couldn't find those products in the catalog.",language,state,"commerce_multi_item_missing");
    const lines=[];
    if(recognized.length){
      const subtotal=recognized.reduce((sum,item)=>sum+Number(item.p.price||0)*item.quantity,0);
      const currency=recognized[0].p.currency||'PKR';
      lines.push(`Provisional merchandise subtotal (assuming the requested sizes and colors are available): ${money(subtotal,currency)}.`);
    }
    for(const a of ambiguous){
      lines.push("",`I found more than one match for “${a.term||a.segment}”. Which one do you mean?`,...a.candidates.map(x=>`• ${x.name}`));
    }
    if(issues.length)lines.push('',formatCartIssues(issues),'','I have not changed your cart. Tell me the missing option for each item and I can add the complete request.');
    if(ambiguous.length||issues.length){
      if(prepared.length)lines.unshift(`Recognized but not added yet: ${prepared.map(x=>`${x.p.name} × ${x.quantity}`).join(', ')}.`);
      return result(lines.filter((x,i)=>!(x===''&&lines[i-1]==='')).join('\n'),language,{...state,pendingProductChoices:ambiguous,pendingMultiItemDraft:items,...(pendingOrderEdit?{pendingOrderEdit}:{})},'commerce_multi_item_needs_details');
    }
    if(pendingOrderEdit){
      const officialItems=prepared.map(item=>({productId:item.p.id,variantId:item.valid.variant?.id||null,sku:item.valid.sku,name:item.p.name,unitPrice:item.valid.unitPrice,currency:item.valid.currency,color:item.color,size:item.size,quantity:item.quantity,subtotal:item.valid.unitPrice*item.quantity,inventory:item.valid.variant?item.valid.variant.inventory:null}));
      const order=await commerce.addOrderItems(pendingOrderEdit.orderId,officialItems);
      lines.push(`Updated order ${order.id} (revision ${order.revision}) 👍`,...prepared.map(x=>`• Added ${x.p.name}${x.color?` (${x.color})`:''}${x.size?` (Size ${x.size})`:''} × ${x.quantity}`),'',orderSummary(order));
      return result(lines.filter((x,i)=>!(x===''&&lines[i-1]==='')).join('\n'),language,{mode:'idle',pendingField:null,lastOrderId:order.id},'commerce_order_items_added');
    }
    for(const item of prepared)await commerce.syncItem(cartItemFromValidation(item.valid,{color:item.color,size:item.size,quantity:item.quantity}));
    const cart=await commerce.getCart();
    lines.push("Added to your cart 👍",...prepared.map(x=>`• ${x.p.name}${x.color?` (${x.color})`:''}${x.size?` (Size ${x.size})`:''} × ${x.quantity} — ${money(x.valid.unitPrice*x.quantity,x.valid.currency)}`),"",await cartSummary(context,cart,language),"","You can add more items or say confirm order.");
    return result(lines.filter((x,i)=>!(x===""&&lines[i-1]==="")).join("\n"),language,{mode:"paused_add_item",pendingField:null,pendingProductChoices:[],resumeCheckout:state?.mode==="checkout"?state:null},"commerce_multi_item_added");
  }

  async addItemRequest(context, commerce, catalog, language, state) {
    const raw=String(context.message.text||"");
    const activeDraft=context.state.capabilityState?.catalog||{};
    const refersToDraft=/\b(this|it|this one|that one|that item|this item)\b/i.test(raw);
    const draftProductId=activeDraft.selectedProductId || (refersToDraft && activeDraft.suggestedProductIds?.length===1 ? activeDraft.suggestedProductIds[0] : null);
    if(draftProductId && refersToDraft){
      const p=await catalog.getProductById(draftProductId);
      if(p){
        const attrs={...(activeDraft.selectedAttributes||{})};
        const normalizedRaw=normalize(raw);
        const color=p.colors?.find(c=>normalizedRaw.includes(normalize(c)));
        const size=p.sizes?.find(sz=>new RegExp(`\\b${String(sz).replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\b`,'i').test(raw));
        const qMatch=normalizedRaw.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:pieces?|pcs?|units?)\b/);
        const qty=qMatch?numberFromText(qMatch[1]):null;
        if(color)attrs.color=color;if(size)attrs.size=String(size);if(qty)attrs.quantity=qty;
        const valid=await catalog.validateSelection({productId:p.id,...attrs});
        const missing=!attrs.color&&p.colors?.length?`What color would you like: ${p.colors.join(", ")}?`
          :!attrs.size&&p.sizes?.length?`What size would you like: ${p.sizes.join(", ")}?`
          :!attrs.quantity?"How many would you like?":null;
        if(missing){
          return createCapabilityResult({handled:true,confidence:.99,reply:`Got it — we're still working with ${p.name}.\n\n${missing}`,statePatch:{language,activePlugin:"commerce",lastIntent:"commerce_add_item_draft_updated",capabilityState:{catalog:{selectedProductId:p.id,selectedAttributes:attrs},commerce:{mode:"paused_add_item",pendingField:null,resumeCheckout:state?.mode==="checkout"?state:state?.resumeCheckout||null}}}});
        }
        if(valid.valid){
          await commerce.syncItem(cartItemFromValidation(valid,attrs));
          const cart=await commerce.getCart();
          const resume=state?.mode==="checkout"?state:state?.resumeCheckout;
          const next=resume?.pendingField||null;
          const reply=`Added 👍 ${p.name} has been added to your cart.\n\n${await cartSummary(context,cart,language)}${next?`\n\n${ask(next,language)}`:''}`;
          return result(reply,language,next?{...resume,mode:"checkout",pendingField:next}:{mode:"paused_add_item",pendingField:null},"commerce_draft_item_added");
        }
      }
    }
    const cleaned=raw.replace(/\b(i want to|i want|please|can you|could you|add|include|put|some|also|too|in|into|to|my|the|order|cart|is|me|mein|mi|bhi|kr|kar|do|aik|ek|one)\b/gi," ").replace(/[?.!,]/g," ").replace(/\s+/g," ").trim();
    const products=await catalog.listProducts(); const categories=await catalog.listCategories();
    const genericCategory=categories.find(c=> (c.id==='footwear'&&/^(shoe|shoes|footwear)$/.test(normalize(cleaned))) || normalize(c.name)===normalize(cleaned));
    if(genericCategory){ const options=products.filter(p=>p.inStock&&p.category===genericCategory.id); return result(`Sure 😊 You can add one of these ${genericCategory.name} options:\n\n${options.map(p=>`• ${p.name} — ${money(p.price,p.currency)}`).join("\n")}\n\nTell me which one you'd like.`,language,{mode:"paused_add_item",pendingField:null,resumeCheckout:state?.mode==="checkout"?state:null},"commerce_add_item_browse"); }
    const found=await context.services.catalogService.search(context.tenant.id, cleaned || raw);
    if (found?.product) {
      const p=found.product; const attrs={...(found.attributes||{})};
      // Product search is responsible for identity/variants, but Commerce owns
      // transaction quantities. Preserve explicit quantities such as
      // "is mi 2kg daal add kr do" even when the catalog search strips units.
      if(!attrs.quantity){
        const qMatch=normalize(raw).match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s*(?:kg|kgs|kilograms?|lit(?:er|re)s?|l|packs?|pieces?|pcs?|units?)\b/);
        const q=qMatch ? numberFromText(qMatch[1]) : null;
        if(Number.isFinite(q) && q>0) attrs.quantity=q;
      }
      const patch={ selectedProductId:p.id, selectedAttributes:attrs };
      const detail=[`📦 *${p.name}*`,p.description,`💰 ${money(p.price,p.currency)}`];
      if(p.sizes?.length) detail.push(`📏 Sizes: ${p.sizes.join(", ")}`); if(p.colors?.length) detail.push(`🎨 Colors: ${p.colors.join(", ")}`);
      const missing=!attrs.color&&p.colors?.length?`What color would you like: ${p.colors.join(", ")}?`:!attrs.size&&p.sizes?.length?`What size would you like: ${p.sizes.join(", ")}?`:!attrs.quantity?"How many would you like?":"Say confirm to add it to your cart.";
      return createCapabilityResult({handled:true,confidence:.99,reply:`Yes 😊 We have ${p.name} available. Let's add it to your order.\n\n${detail.join("\n")}\n\n${missing}`,statePatch:{language,activePlugin:"commerce",lastIntent:"commerce_add_item_started",capabilityState:{catalog:patch,commerce:{mode:"paused_add_item",pendingField:null,resumeCheckout:state?.mode==="checkout"?state:null}}}});
    }
    const category=categories.find(c=>normalize(c.name).includes(normalize(cleaned))||normalize(cleaned).includes(normalize(c.name))|| (c.id==='footwear'&&/shoe|shoes|footwear/.test(normalize(cleaned))));
    if(category){ const options=products.filter(p=>p.inStock&&p.category===category.id); return result(`Sure 😊 You can add one of these ${category.name} options:\n\n${options.map(p=>`• ${p.name} — ${money(p.price,p.currency)}`).join("\n")}\n\nTell me which one you'd like.`,language,{mode:"paused_add_item",pendingField:null,resumeCheckout:state?.mode==="checkout"?state:null},"commerce_add_item_browse"); }
    const recommendations=(found?.alternatives||[]).filter(x=>x.inStock).slice(0,3);
    const resume=state?.mode==="checkout"&&state.pendingField
      ? `\n\n${language==="roman_urdu"?"Aapka current order safe hai. ":"Your current order is still safe. "}${ask(state.pendingField,language)}`
      : "";
    const unavailable=commerceUnavailableWithAlternatives(cleaned||"that item",recommendations,language);
    return result(unavailable+resume,language,{...state,suggestedProductIds:recommendations.map(x=>x.id)},"commerce_add_item_unavailable");
  }

  async showOrders(context, commerce, language, state={}) { const orders = await commerce.listOrders(); if (!orders.length) return result(language === "roman_urdu" ? "Abhi koi order nahi hai." : "You do not have any orders yet.", language, state, "commerce_orders_empty"); const recent=[...orders].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,5);const lines = [language === "roman_urdu" ? "📦 *Aap ke orders*" : "📦 *Your order history*"]; recent.forEach(order=>lines.push('',orderSummary(order))); if(state.mode==='review')lines.push('',language==='roman_urdu'?'Aap ka current checkout review bhi safe hai. Confirm karne ke liye “confirm order” likhein.':'Your current checkout review is still active. Say “confirm order” when you are ready.'); else if(state.mode==='checkout'&&state.pendingField)lines.push('',ask(state.pendingField,language)); return result(lines.join("\n"), language, {...state,lastOrderId:recent[0].id}, "commerce_orders_viewed"); }
}
function result(reply, language, commerceState, lastIntent, events=[], responseModel=null, extraCapabilityState={}) { return createCapabilityResult({ handled: true, confidence: .99, reply, responseModel, statePatch: { language, activePlugin: "commerce", lastIntent, capabilityState: { commerce: commerceState, ...extraCapabilityState } }, events }); }
function commerceUnavailableWithAlternatives(requested,recommendations,language){
  const first=language==="roman_urdu"
    ? `Maazrat 😊 ${requested} filhal available nahi hai.`
    : language==="urdu"
      ? `معذرت، ${requested} اس وقت دستیاب نہیں ہے۔`
      : `Sorry 😊 We don't have ${requested} available right now.`;
  if(!recommendations.length)return first;
  const heading=language==="roman_urdu"
    ? "Lekin ye qareebi available options hain:"
    : language==="urdu"
      ? "البتہ یہ ملتے جلتے دستیاب آپشنز ہیں:"
      : "You may want to consider these similar available options:";
  const lines=recommendations.map(p=>`• *${p.name}* — ${money(p.price,p.currency)}${p.description?`\n  ${p.description}`:''}`);
  const close=language==="roman_urdu"
    ? "Agar koi option pasand ho to uska naam bata dein. Main khud se alternative select nahi karunga."
    : language==="urdu"
      ? "اگر کوئی آپشن پسند ہو تو اس کا نام بتا دیں۔ میں خود سے کوئی متبادل منتخب نہیں کروں گا۔"
      : "If one of these works for you, tell me its name. I won't select an alternative unless you choose it.";
  return [first,"",heading,...lines,"",close].join("\n");
}

async function cartSummary(context,cart,language){
  const lines=[language==='roman_urdu'?'📋 *Order Summary*':'📋 *Order Summary*'];let total=0;
  for(const item of cart?.items||[]){const p=await context.services.catalog.getProductById(item.productId);const unitPrice=Number.isFinite(Number(item.unitPrice))?Number(item.unitPrice):Number(p?.price||0);const subtotal=unitPrice*item.quantity;total+=subtotal;lines.push(`${item.name}${item.color?` (${item.color})`:''}${item.size?` (${item.size})`:''} × ${item.quantity} — ${money(subtotal,item.currency||p?.currency||'PKR')}`);}
  lines.push(`${language==='roman_urdu'?'Total':'Total'}: ${money(total,'PKR')}`);return lines.join('\n');
}
function orderSummary(order){
  const lines=[`Order ${order.id} — ${order.status}${order.revision>1?` — revision ${order.revision}`:''}`];
  for(const item of order.items||[])lines.push(`• ${item.name}${item.color?` (${item.color})`:''}${item.size?` (${item.size})`:''} × ${item.quantity} — ${money(item.subtotal??Number(item.unitPrice||0)*Number(item.quantity||0),item.currency||order.currency)}`);
  lines.push(`Total: ${money(order.total,order.currency)}`);
  return lines.join('\n');
}
function sentenceList(values){
  const removed=[],other=[];
  for(const value of values){
    const text=String(value);
    const match=text.match(/^removed\s+(.+)$/i);
    if(match)removed.push(match[1]);else other.push(text);
  }
  if(removed.length)other.push(`Removed ${removed.join(', ')}`);
  return other.map(value=>String(value).replace(/^./,char=>char.toUpperCase())).join('; ');
}

async function checkoutReview(context,cart,language){
  const lines=[await cartSummary(context,cart,language),"",language==='roman_urdu'?'👤 *Customer / Delivery Details*':'👤 *Customer / Delivery Details*'];
  const c=cart?.checkout||{};
  lines.push(`Name: ${c.name||'-'}`,`Phone: ${c.phone||'-'}`,`Email (optional): ${c.email||'Not provided'}`,`City: ${c.city||'-'}`,`Address: ${c.address||'-'}`,`Landmark: ${c.landmark||'Skipped'}`,`Payment: ${c.paymentMethod||'-'}`);
  lines.push("",language==='roman_urdu'?"Sab details check kar lein. Agar theek hain to confirm karein; warna jo cheez change karni ho bata dein.":"Please check the products and customer details. If everything is correct, say confirm. Otherwise tell me what you want to change.");
  return lines.join('\n');
}

async function validateCart(cart,catalog){
  if(!cart?.items?.length)return [{reason:'empty_cart',product:null}];
  const issues=[];
  for(const item of cart.items){
    const validation=await catalog.validateSelection({...item,cartId:cart.id,requireComplete:item.variantSelectionRequired!==false});
    if(!validation.valid)issues.push(validation);
  }
  return issues;
}
function cartItemFromValidation(valid,selected){return {productId:valid.product.id,variantId:valid.variant?.id||null,sku:valid.sku,name:valid.product.name,color:selected.color||null,size:selected.size||null,quantity:Number(selected.quantity||1),unitPrice:valid.unitPrice,currency:valid.currency,inventory:valid.variant?valid.variant.inventory:null,variantSelectionRequired:Boolean(valid.product.variants?.length||selected.color||selected.size||valid.product.sizes?.length)};}
function inventoryFailureReply(error){if(error?.code==='INSUFFICIENT_INVENTORY'||error?.code==='CART_VALIDATION_FAILED'&&error?.reason==='insufficient_inventory')return `Sorry, only ${Number(error.availableQuantity||0)} unit(s) of ${error.sku||error.product?.name||'that selection'} are available right now. Please reduce the quantity or choose another option.`;if(error?.code==='RESERVATION_REQUIRED')return 'The stock hold expired before confirmation. Please review the cart again so I can reserve the current items.';return `I could not reserve the requested stock${error?.message?`: ${error.message}`:'.'}`;}
function formatCartIssues(issues){
  return issues.map((issue)=>`• ${humanValidationReason(issue.reason,issue.product,issue.availableQuantity)}`).join('\n');
}
function mergeMultiItemDraft(existing=[],incoming=[]){
  if(!(existing||[]).length)return coalesceInitialMultiItems(incoming);
  const draft=(existing||[]).map(item=>({...item}));
  for(const item of incoming||[]){
    const candidates=draft.map((entry,index)=>({entry,index})).filter(x=>x.entry.productId===item.productId);
    // Most multi-product requests contain one line per product. When variants
    // of the same product exist, prefer a line sharing a supplied attribute,
    // then the first line still missing one of those attributes.
    let target=Number.isInteger(item.draftIndex)&&draft[item.draftIndex]?.productId===item.productId
      ? {entry:draft[item.draftIndex],index:item.draftIndex}
      : candidates.find(x=>(item.color&&x.entry.color===item.color)||(item.size&&x.entry.size===item.size));
    if(!target)target=candidates.find(x=>(item.color&&!x.entry.color)||(item.size&&!x.entry.size));
    if(!target&&candidates.length===1)target=candidates[0];
    if(!target){draft.push({...item,quantity:Math.max(1,Number(item.quantity||1))});continue;}
    const current=target.entry;
    draft[target.index]={
      ...current,
      name:item.name||current.name,
      color:item.color||current.color||null,
      size:item.size||current.size||null,
      // The extractor uses 1 as its neutral default. Do not erase a previously
      // explicit quantity merely because a later variant-only reply defaults.
      quantity:Number(item.quantity||1)!==1?Number(item.quantity):Math.max(1,Number(current.quantity||1)),
      segment:item.segment||current.segment
    };
  }
  return draft;
}
function coalesceInitialMultiItems(incoming=[]){
  const draft=[];
  for(const raw of incoming||[]){
    const item={...raw,quantity:Math.max(1,Number(raw.quantity||1))};
    const candidates=draft.map((entry,index)=>({entry,index})).filter(row=>row.entry.productId===item.productId);
    const target=candidates.find(row=>
      (!row.entry.color&&item.color)||(!row.entry.size&&item.size)
    );
    if(!target){draft.push(item);continue;}
    const current=target.entry;
    draft[target.index]={...current,color:item.color||current.color||null,size:item.size||current.size||null,segment:item.segment||current.segment};
  }
  return draft;
}
function humanValidationReason(reason,product,availableQuantity){
  const name=product?.name||'an item';
  if(reason==='missing_color')return `${name} needs a color. Available colors: ${(product.colors||[]).join(', ')}.`;
  if(reason==='missing_size')return `${name} needs a size. Available sizes: ${(product.sizes||[]).join(', ')}.`;
  if(reason==='invalid_color')return `${name} has an invalid color. Available colors: ${(product.colors||[]).join(', ')}.`;
  if(reason==='invalid_size')return `${name} has an invalid size. Available sizes: ${(product.sizes||[]).join(', ')}.`;
  if(reason==='insufficient_inventory')return `only ${availableQuantity} ${name} are available.`;
  if(reason==='empty_cart')return 'the cart is empty.';
  return `${name} is not currently available.`;
}


async function syncCheckoutFieldToCrm(context,field,value,language){
  const crm=context.services.crm;if(!crm?.updateCustomer)return;
  if(field==="name")return crm.updateCustomer({name:value,preferredLanguage:language||null});
  if(field==="phone")return crm.updateCustomer({phone:value,preferredLanguage:language||null});
  if(field==="email")return crm.updateCustomer({email:value,preferredLanguage:language||null});
  if(["city","address","landmark","paymentMethod"].includes(field)){
    const current=await crm.getCustomer?.();
    const lastDelivery={...(current?.customFields?.lastDelivery||{}),[field]:value};
    return crm.updateCustomer({
      preferredLanguage:language||current?.preferredLanguage||null,
      customFields:{...(current?.customFields||{}),lastDelivery}
    });
  }
}
async function syncOrderCustomerToCrm(context,order,language){
  const crm=context.services.crm;if(!crm?.updateCustomer||!order?.customer)return;
  const current=await crm.getCustomer?.();const c=order.customer;
  return crm.updateCustomer({
    name:c.name||current?.name||null,
    phone:c.phone||current?.phone||null,
    email:c.email||current?.email||null,
    preferredLanguage:language||current?.preferredLanguage||null,
    customFields:{
      ...(current?.customFields||{}),
      lastDelivery:{city:c.city||null,address:c.address||null,landmark:c.landmark||null,paymentMethod:c.paymentMethod||order.paymentMethod||null},
      lastOrderId:order.id
    }
  });
}

function readyCatalog(state) { const c = state.capabilityState?.catalog; return Boolean(c?.selectedProductId && c?.selectedAttributes?.quantity); }
function normalize(v) { return String(v||"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim(); }
function detectLanguage(v, fallback) { if (/[\u0600-\u06FF]/.test(v)) return "urdu"; if (/\b(aap|ap|mujhe|mujhy|hai|hain|kya|kia|kar|karo|kro|kr|dein|dy|mera|meri|bhai|bhaijan|yaar|yar|chahiye|chahiy|aur)\b/i.test(v)) return "roman_urdu"; return fallback || "english"; }
function parseField(field, raw) {
  if (field === "name") {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    const looksLikeComment = /\b(expensive|price|shoes|shirt|order|thanks|hello|cancel|mehng|delivery|phone|address|kia bat|kya baat|not my name)\b/i.test(raw);
    return { valid: words.length >= 1 && words.length <= 5 && raw.length >= 2 && raw.length <= 70 && !looksLikeComment, value: raw.trim() };
  }
  if (field === "phone") { const v = raw.replace(/[^0-9+]/g,""); return { valid: v.replace(/\D/g,"").length >= 10, value:v }; }
  if (field === "landmark" && /^(skip|none|nahi|نہیں)$/i.test(raw)) return {valid:true,value:""};
  if (field === "paymentMethod") { const t=normalize(raw); const map=[["Cash on Delivery",/cash|cod|delivery/],["JazzCash",/jazz/],["EasyPaisa",/easy/],["Bank Transfer",/bank/]]; const m=map.find(([,r])=>r.test(t)); return m?{valid:true,value:m[0]}:{valid:false}; }
  const min = field === "address" ? 8 : 2; return { valid: raw.length >= min, value: raw };
}
function checkoutFieldLabel(field,l){
  const en={name:"full name",phone:"contact phone number",city:"delivery city",address:"delivery address",landmark:"landmark",paymentMethod:"payment method"};
  const ru={name:"delivery name",phone:"phone number",city:"delivery city",address:"full address",landmark:"landmark",paymentMethod:"payment method"};
  return (l==="roman_urdu"?ru:en)[field]||field;
}
function ask(field,l){const e={name:"May I have your full name for delivery?",phone:"What is the best contact phone number to reach you on for delivery? You may also provide an email address as an optional contact.",city:"Which city should we deliver to?",address:"Please provide the full delivery address.",landmark:"Share a nearby landmark, or say 'skip'.",paymentMethod:"Choose a payment method: Cash on Delivery, JazzCash, EasyPaisa, or Bank Transfer."};const r={name:"Delivery ke liye naam bata dein.",phone:"Delivery phone number bata dein. Email optional hai agar aap dena chahein.",city:"Kis city mein delivery chahiye?",address:"Full delivery address bata dein.",landmark:"Nearby landmark bata dein, ya 'skip' likhein.",paymentMethod:"Payment method choose karein: Cash on Delivery, JazzCash, EasyPaisa, ya Bank Transfer."};const u={name:"ڈیلیوری کے لیے نام بتائیں۔",phone:"ڈیلیوری فون نمبر بتائیں۔ ای میل اختیاری ہے۔",city:"کس شہر میں ڈیلیوری چاہیے؟",address:"مکمل ڈیلیوری پتہ بتائیں۔",landmark:"قریبی نشانی بتائیں یا skip لکھیں۔",paymentMethod:"ادائیگی کا طریقہ منتخب کریں: کیش آن ڈیلیوری، جاز کیش، ایزی پیسہ، یا بینک ٹرانسفر۔"};return (l==="urdu"?u:l==="roman_urdu"?r:e)[field];}
function ack(field,value,l){if(l==="roman_urdu")return "Theek hai, save kar liya.";if(l==="urdu")return "ٹھیک ہے، محفوظ کر لیا۔";return "Got it.";}
function summary(p,s,l){return `📋 *Order Summary*\n${p.name}${s.color?` (${s.color})`:""}${s.size?` (${s.size})`:""} × ${s.quantity}\n💰 ${money(p.price*s.quantity,p.currency)}`;}
function confirm(o,l){if(l==="roman_urdu")return `✅ Aap ka order confirm ho gaya!\nOrder ID: *${o.id}*\nTotal: ${money(o.total,o.currency)}\nPayment: ${o.paymentMethod}\n\nShukriya 😊`;if(l==="urdu")return `✅ آپ کا آرڈر تصدیق ہو گیا!\nآرڈر آئی ڈی: *${o.id}*\nکل: ${money(o.total,o.currency)}\nادائیگی: ${o.paymentMethod}`;return `✅ Your order is confirmed!\nOrder ID: *${o.id}*\nTotal: ${money(o.total,o.currency)}\nPayment: ${o.paymentMethod}\n\nThank you 😊`;}
function lowerFirst(value){return value ? value.charAt(0).toLowerCase()+value.slice(1) : value;}
function money(n,c){return `${c==="PKR"?"Rs":c+" "}${Number(n).toLocaleString("en-US")}`;}
module.exports={Capability:CommerceCapability,CommerceCapability};
