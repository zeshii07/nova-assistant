const { normalizeText, numberFromText } = require('../../../packages/conversation-intelligence/src/text');
const { extractMultiProducts, extractProductRequests, splitRequests } = require('../../../packages/catalog-engine/src/multiProductExtractor');
const { AttributeExtractor } = require('../../../packages/catalog-engine/src/attributeExtractor');
const { isConfirmation, isWorkflowAcceptance } = require('../../../packages/conversation-intelligence/src/confirmation');
const { extractFieldAmendment } = require('../../../packages/conversation-intelligence/src/fieldAmendmentExtractor');
const pendingAttributeExtractor=new AttributeExtractor();
class CommerceConversationAdapter {
  constructor(){this.capabilityId='commerce';this.priority=110;}
  async analyze({ tenant, message, state, services, interruption, correction }) {
    const text=normalizeText(message.text); const cs=state.capabilityState?.commerce;
    const candidates=[]; let entities={};let groundedProductRequest=false;
    const pendingFieldEdit=cs?.pendingFieldEdit||null;
    const explicitFieldAmendment=extractFieldAmendment(message.text,{allowedFields:['name','phone','email','city','address','landmark','paymentMethod']});
    const fieldAmendment=explicitFieldAmendment||(pendingFieldEdit
      ? {field:pendingFieldEdit.field,rawValue:message.text,action:'replace',explicit:true}
      : null);
    if(fieldAmendment&&(cs?.mode==='checkout'||cs?.mode==='review'||cs?.lastOrderId||pendingFieldEdit)){
      entities={fieldAmendment,target:pendingFieldEdit?.target||(cs?.mode==='checkout'||cs?.mode==='review'?'checkout':'order'),orderId:pendingFieldEdit?.orderId||cs?.lastOrderId||null};
      return {priority:this.priority,candidates:[{intent:'commerce.customer_field_edit',confidence:1,priority:235,entities,reason:pendingFieldEdit?'pending_commerce_field_edit_value':'explicit_commerce_field_edit'}],entities,vocabularyMatches:[{type:'customer_field_edit',value:fieldAmendment.field,score:1}]};
    }
    if(tenant?.capabilities?.includes('catalog') && services?.catalogService){
      const products=await services.catalogService.listProducts(tenant.id);

      // Cart-level commands own the turn even while a multi-item draft is
      // waiting for variants. Otherwise "clear my cart" is misread as another
      // color/size reply and the durable cart survives unexpectedly.
      if(/\b(clear|empty|remove everything from)\s+(my\s+)?cart\b/.test(text)){
        entities={};
        return {priority:this.priority,candidates:[{intent:'commerce.cart.clear',confidence:1,priority:230,entities,reason:'cart_clear_global_commerce'}],entities,vocabularyMatches:[{type:'commerce_operation',value:'commerce.cart.clear',score:1}]};
      }
      const inlineProductMutation=/\b(?:i want|i need|add|buy|purchase|order)\b[\s\S]{0,1000}\b(?:what(?:'s| is) in|show|view|see)\s+(?:my\s+)?(?:full\s+)?cart\b/.test(text);
      if(/\b(show|view|see|open|what(?:'s| is) in)\s+(my\s+)?(?:full\s+)?cart\b|\bmy\s+(?:full\s+)?cart\b/.test(text)&&!/\b(track|status)\b/.test(text)&&!inlineProductMutation&&!/\b(?:add|put|include|buy|purchase)\b/.test(text)){
        const checkoutToo=/\b(confirm|checkout|place order)\b/.test(text);
        entities={};
        return {priority:this.priority,candidates:[{intent:checkoutToo?'commerce.cart.view_checkout':'commerce.cart.view',confidence:1,priority:225,entities,reason:checkoutToo?'cart_view_checkout':'cart_view'}],entities,vocabularyMatches:[{type:'commerce_operation',value:checkoutToo?'commerce.cart.view_checkout':'commerce.cart.view',score:1}]};
      }

      // Returns and exchanges are order operations, never product browsing.
      // They own the turn even when words such as "small shirt" also look like
      // catalog attributes. Pending product-selection fields are left intact.
      const returnOrExchange=/\b(return|exchange|replace|swap)\b/.test(text);
      const policyOnly=/\b(?:return|exchange|replacement)\s+(?:policy|rules?|window|period|fee)\b|\bwhat\s+(?:is|are|happens)\b[\s\S]{0,25}\b(?:return|exchange)\b/.test(text);
      if((returnOrExchange&&!policyOnly)||cs?.pendingOrderAction){
        const request=extractProductRequests(message.text,products);
        const productIds=[...new Set([
          ...request.items.map(item=>item.productId),
          ...request.ambiguous.flatMap(item=>(item.candidates||[]).map(candidate=>candidate.productId)),
          ...familyProductIds(text,products),
          ...(cs?.pendingOrderAction?.productId?[cs.pendingOrderAction.productId]:[])
        ])];
        const sizes=orderedSizes(text);
        const operation=/\b(?:exchange|replace|swap)\b/.test(text)?'exchange':/\breturn\b/.test(text)?'return':cs?.pendingOrderAction?.operation||'exchange';
        entities={operation,requestedText:text,productIds,orderId:cs?.pendingOrderAction?.orderId||cs?.lastOrderId||null,fromSize:sizes.length>1?sizes[0]:operation==='return'?sizes[0]||null:cs?.pendingOrderAction?.fromSize||null,toSize:operation==='exchange'?(sizes.length>1?sizes[sizes.length-1]:sizes[0]||cs?.pendingOrderAction?.toSize||null):null};
        return {priority:this.priority,candidates:[{intent:'commerce.order.return_exchange',confidence:1,priority:200,entities,reason:cs?.pendingOrderAction?'pending_order_return_exchange':'explicit_order_return_exchange'}],entities,vocabularyMatches:[{type:'commerce_operation',value:operation,score:1},...productIds.map(id=>({type:'product',value:id,canonical:id,score:1}))]};
      }

      // Variant amendments are transactional even while checkout is waiting
      // for a customer field. "Change one small shirt to large" must update the
      // existing cart line and then resume checkout; it is never a delivery
      // name and never a fresh catalog browse.
      const variantChangeRequested=/\b(?:change|update|make|switch)\b[\s\S]{0,70}\b(?:size|colou?r|small|medium|large|xl|black|white|blue|navy)\b|\b(?:size|colou?r)\b[\s\S]{0,45}\b(?:change|update|switch)\b/.test(text);
      const pendingVariantAssignment=cs?.pendingMultiItemDraft?.length
        && /^\s*make\b/.test(text)
        && !/\b(?:change|update|switch|cart|order|current|existing)\b/.test(text);
      if(variantChangeRequested&&!pendingVariantAssignment){
        const scopedCommerce=services.commerceService?.scope?.({tenant,capabilityId:'commerce',customerId:message.customerId});
        const cart=await scopedCommerce?.getCart?.();
        const change=extractVariantChange(message.text,products,cart);
        const targetOrder=/\border\b/.test(text)&&!['checkout','review'].includes(cs?.mode);
        entities={...change,target:targetOrder?'order':'cart',orderId:cs?.lastOrderId||null};
        const intent=targetOrder?'commerce.order.return_exchange':'commerce.cart.update_variant';
        if(targetOrder)entities.operation='exchange';
        return {priority:this.priority,candidates:[{intent,confidence:1,priority:198,entities,reason:targetOrder?'explicit_order_variant_change':'active_cart_variant_change'}],entities,vocabularyMatches:[{type:'commerce_operation',value:intent,score:1},...(change.productIds||[]).map(id=>({type:'product',value:id,canonical:id,score:1}))]};
      }

      // Transaction amendments own the utterance before generic product
      // discovery. Otherwise "remove a shirt from my order" looks like a new
      // shirt purchase and the stored transaction can never be changed.
      const removalRequested=/\b(?:remove|delete|take out)\b/.test(text);
      const removalSubject=/\b(?:cart|order|items?|products?)\b/.test(text)||products.some(product=>text.includes(normalizeText(product.name)));
      const mutation=extractCartMutation(message.text,products);
      if(mutation.removals.length&&mutation.additions.length){
        entities={...mutation,target:'cart'};
        return {priority:this.priority,candidates:[{intent:'commerce.cart.mutate_request',confidence:1,priority:195,entities,reason:'compound_cart_mutation'}],entities,vocabularyMatches:[{type:'commerce_operation',value:'commerce.cart.mutate_request',score:1}]};
      }
      // v22.2: If pendingRemoval is active but the user is now trying to ADD
      // items (not remove), exit the removal flow and process the add request.
      // Previously, "ok now add 1 polo shirt" was hijacked by the pendingRemoval
      // handler and treated as a removal request.
      const addRequested=/\b(?:add|include|buy|purchase|order|i want|i need)\b/i.test(text);
      if(cs?.pendingRemoval && addRequested && !removalRequested){
        // Clear pendingRemoval and fall through to normal add/multi-item processing
        // by NOT entering the removal block below.
      } else if((removalRequested&&removalSubject)||cs?.pendingRemoval){
        const removal=extractProductRequests(message.text,products);
        const productIds=[...new Set(removal.items.map(item=>item.productId))];
        entities={requestedText:text,productIds,removals:removal.items.map(removalRequest),target:/\border\b/.test(text)||cs?.pendingRemoval?.target==='order'?'order':'auto',orderId:cs?.pendingRemoval?.orderId||cs?.lastOrderId||null};
        return {priority:this.priority,candidates:[{intent:'commerce.cart.remove_request',confidence:1,priority:190,entities,reason:cs?.pendingRemoval?'pending_transaction_removal':'explicit_transaction_removal'}],entities,vocabularyMatches:productIds.map(id=>({type:'product_removal',value:id,canonical:id,score:1}))};
      }

      if(/\b(?:show|view|list|see|open|what(?:'s| is))\b[\s\S]{0,25}\b(?:my\s+)?(?:orders|order history|purchase history)\b|\bmy\s+(?:order|purchase)\s+history\b/.test(text)){
        entities={};
        return {priority:this.priority,candidates:[{intent:'commerce.orders',confidence:1,priority:185,entities,reason:'commerce_order_history'}],entities,vocabularyMatches:[{type:'commerce_operation',value:'commerce.orders',score:1}]};
      }

      const explicitOrderAdd=/\b(?:add|include|put)\b[\s\S]{0,80}\b(?:to|into|in)\s+(?:my\s+)?order\b|\badd\b[\s\S]{0,80}\b(?:my\s+)?order\b/.test(text);
      if(explicitOrderAdd&&cs?.lastOrderId&&!['checkout','review','paused_add_item'].includes(cs?.mode)){
        const addition=extractProductRequests(message.text,products);
        if(addition.items.length||addition.ambiguous.length){
          entities={items:addition.items,ambiguous:addition.ambiguous,targetOrder:true,orderId:cs?.lastOrderId||null};
          return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,priority:188,entities,reason:'confirmed_order_item_addition'}],entities,vocabularyMatches:addition.items.map(x=>({type:'product',value:x.name,canonical:x.productId,score:1}))};
        }
      }

      // v22.2: If pendingMultiItemDraft exists but the user explicitly says
      // "add" a NEW item, clear the stale draft and process as a new request.
      // Previously, "add 1 polo shirt white small" was merged into the stale
      // draft (which had "3 polo shirts" from the original "3 shirts" message),
      // causing the wrong quantity.
      const explicitAdd=/\b(?:add|include|also add|now add|i want|i need|buy|purchase)\b/i.test(text);
      if(cs?.pendingMultiItemDraft?.length && explicitAdd){
        // Check if this is a NEW product request (not just attributes for the draft)
        const draftProductIds=new Set(cs.pendingMultiItemDraft.map(x=>x.productId));
        const newRequests=extractProductRequests(message.text,products);
        const isNewProduct=newRequests.items.some(item=>!draftProductIds.has(item.productId));
        const hasExplicitQuantity=/(?:add|include)\s+\d+\s/i.test(text);
        if(isNewProduct || hasExplicitQuantity){
          // Clear the draft by emitting entities without the draft context.
          // The capability will start fresh with these items.
          if(newRequests.items.length){
            const entities={items:newRequests.items,ambiguous:newRequests.ambiguous||[]};
            return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,entities,reason:'new_product_request_clearing_draft'}],entities,vocabularyMatches:newRequests.items.map(x=>({type:'product',value:x.name,canonical:x.productId,score:1}))};
          }
        }
      }

      // Narrow pending extraction to the products already being configured.
      // "shirt white" is then deterministic when only one pending shirt exists.
      if(cs?.pendingMultiItemDraft?.length){
        const draftIds=new Set(cs.pendingMultiItemDraft.map(x=>x.productId));
        const pendingProducts=products.filter(product=>draftIds.has(product.id));
        const pendingRequests=extractProductRequests(message.text,pendingProducts);
        if(pendingRequests.items.length||pendingRequests.ambiguous.length){
          entities={items:pendingRequests.items,ambiguous:pendingRequests.ambiguous,targetOrder:Boolean(cs.pendingOrderEdit),orderId:cs.pendingOrderEdit?.orderId||null};
          return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,entities,reason:'pending_multi_product_variant_update'}],entities,vocabularyMatches:pendingRequests.items.map(x=>({type:'product',value:x.name,canonical:x.productId,score:1}))};
        }
      }

      const requests=extractProductRequests(message.text,products);
      groundedProductRequest=Boolean(requests.items.length);
      const alternativeChoice=/\b(?:like|either)\b/.test(text);
      if(!alternativeChoice && (requests.items.length>1 || (requests.items.length && requests.ambiguous.length) || requests.ambiguous.length>1)){
        const entities={items:requests.items,ambiguous:requests.ambiguous};
        return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,entities,reason:'multi_product_request'}],entities,vocabularyMatches:requests.items.map(x=>({type:'product',value:x.name,canonical:x.productId,score:1}))};
      }
      if(cs?.pendingMultiItemDraft?.length && !requests.items.length && !requests.ambiguous.length){
        const reply=resolvePendingMultiItemAttributes(message.text,cs.pendingMultiItemDraft,products);
        if(reply?.items?.length){
          const entities={items:reply.items,ambiguous:[],targetOrder:Boolean(cs.pendingOrderEdit),orderId:cs.pendingOrderEdit?.orderId||null};
          return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,entities,reason:'pending_multi_product_shorthand_attributes'}],entities,vocabularyMatches:reply.matches};
        }
        if(reply?.ambiguity){
          const entities={items:[],ambiguous:[],attributeAmbiguity:reply.ambiguity,targetOrder:Boolean(cs.pendingOrderEdit),orderId:cs.pendingOrderEdit?.orderId||null};
          return {priority:this.priority,candidates:[{intent:'commerce.multi_item_request',confidence:1,entities,reason:'pending_multi_product_attribute_ambiguity'}],entities,vocabularyMatches:reply.matches||[]};
        }
      }
    }

    if(/\badd\b/.test(text) && groundedProductRequest && tenant?.capabilities?.includes('catalog') && services?.catalogService){
      const found=await services.catalogService.search(tenant.id,message.text);
      if(found?.product) candidates.push({intent:'commerce.cart.add_request',confidence:.99975,entities:{requestedText:text},reason:'catalog_product_add_request'});
    }

    // v37.0: UNIVERSAL product order detection — works for ALL product-based tenants
    // (retail, restaurant, grocery, pharmacy, electronics, etc.)
    // Detects natural order language: "i want X", "send me N X", "add X to cart/order",
    // "give me N X", "i'll take X", "can i get X", "order N X", "pack N X"
    // BUT defers to catalog adapter when the query is about product details,
    // prices, or attributes (color/size) rather than ordering.
    if(!candidates.length && tenant?.capabilities?.includes('catalog') && services?.catalogService){
      const orderIntent = detectUniversalOrderIntent(text);
      // v37.1: Skip universal order if this is clearly a price/detail query
      // ("what is price of X", "how much is X", "tell me about X")
      const isPriceQuery = /\b(?:what(?:'s| is)?\s+(?:the\s+)?(?:price|cost)|how much|price of|cost of|rate of)\b/i.test(text);
      const isDetailQuery = /\b(?:tell me about|details? of|info(?:rmation)? (?:about|on)|what is|what's|describe)\b/i.test(text);
      if(orderIntent && !isPriceQuery && !isDetailQuery){
        // v37.1: Also skip if query has attribute words (color/size) —
        // that's a product detail + attribute request, not a cart add
        const hasAttribute = /\b(?:black|white|blue|navy|red|green|yellow|pink|gray|grey|brown|silver|gold|small|medium|large|xl|xxl|s\b|m\b|l\b)\b/i.test(text);
        if(!hasAttribute){
          // Try to resolve the product from the text
          const cleaned = cleanProductQuery(text, orderIntent);
          if(cleaned){
            const found = await services.catalogService.search(tenant.id, cleaned);
            if(found?.product){
              const qty = numberFromText(text) || 1;
              candidates.push({
                intent: 'commerce.cart.add_request',
                confidence: .9998,
                entities: { requestedText: text, productId: found.product.id, quantity: qty },
                reason: `universal_${orderIntent}`,
              });
            }
          }
        }
      }
    }

    // v37.0: UNIVERSAL cart operations — expanded vocabulary for all business types
    // View cart: "show my cart", "show my order", "what's in my order", "view basket",
    // "mera order dikhao", "cart kya hai", "order summary"
    if (/\b(show|view|see|open|what(?:'s| is) in)\s+(my\s+)?(?:full\s+)?(?:cart|order|basket|bag)\b|\bmy\s+(?:full\s+)?(?:cart|order|basket|bag)\b|(?:^|\b)show\s+(?:me\s+)?my\s+order\b|mera\s+order\s+dikhao|cart\s+kya\s+h(?:ai|e)|order\s+summary/.test(text) && !/\b(track|status)\b/.test(text) && !/\b(?:add|put|include|buy|purchase)\b/.test(text)) {
      const checkoutToo=/\b(confirm|checkout|place order)\b/.test(text);
      candidates.push({intent:checkoutToo?'commerce.cart.view_checkout':'commerce.cart.view',confidence:.9998,entities:{},reason:checkoutToo?'cart_view_checkout':'cart_view'});
    }
    // Clear cart: "clear my cart", "empty cart", "remove everything", "cancel order"
    if (/\b(clear|empty|remove everything from|cancel)\s+(my\s+)?(?:cart|order|basket|bag)\b/.test(text)) candidates.push({intent:'commerce.cart.clear',confidence:.9998,entities:{},reason:'cart_clear'});
    // v37.0: Expanded add-to-cart: handles restaurant + retail + grocery vocabulary
    // "add X to cart", "add X to my order", "i want X also", "send me X",
    // "give me N X", "i'll take X", "can i get X", "order N X", "pack N X",
    // "X please", "one plate of X", "2 pieces of X", "bhej do X",
    // "X chahiye", "X lena hai", "X ka order karna hai"
    if ((groundedProductRequest||Boolean(cs?.mode))&&(
      /\b(add|include|put|send|give|bring|pack|deliver|ship|prepare|make)\b.*\b(order|cart|basket|bag|plate|piece|serving|portion)?\b/.test(text) ||
      /\badd\b.+\b(also|too|bhi|aur)\b/.test(text) ||
      /\bi want .* (also|too|bhi)\b/.test(text) ||
      /\b(do you have|do you sell|do you offer|can i get|can i have|can i order)\b/.test(text) ||
      /\b(i'?ll|i will|i would|i'?d like|i need|i want|let me|let me get|let me have|let me order)\b/.test(text) ||
      /\b(?:mujhy|mujhe|mujhay|mai|main)?[^.]{0,40}\b(?:bhi)\b[^.]{0,30}\b(?:chahiye|chahiyy|chahy|lyni|leni|lyna|lena)\b/.test(text) ||
      /\b(?:chahiye|chahiyy|chahy)\b.*\b(?:bhi|also|too)\b/.test(text) ||
      /\b(?:order|khana|food)\s+(?:karna|karna|chahiye|chahiyy)\b/.test(text)
    )) {
      // v37.1: Skip if query has color/size attribute — that's a catalog
      // product detail + attribute request, not a cart add
      const hasAttribute = /\b(?:black|white|blue|navy|red|green|yellow|pink|gray|grey|brown|silver|gold|small|medium|large|xl|xxl|size)\b/i.test(text);
      if (!hasAttribute) {
        candidates.push({intent:'commerce.cart.add_request',confidence:.9997,entities:{requestedText:text},reason:'universal_cart_add'});
      }
    }
    // v37.0: Expanded remove: "remove X", "cancel X", "delete X", "take X off", "X hata do"
    if (/\b(remove|delete|take out|take off|drop|cancel|hata|hatado)\b.*\b(from )?(my )?(?:cart|order|basket|bag)?\b/.test(text)) candidates.push({intent:'commerce.cart.remove_request',confidence:.9996,entities:{requestedText:text,target:/\border\b/.test(text)?'order':'auto'},reason:'cart_remove_request'});
    // v37.0: Expanded quantity change: "change X to N", "update X quantity", "make it N",
    // "reduce X to N", "increase X to N", "X quantity N kar do", "X kam kar do"
    if (/\b(change|update|make|set|reduce|decrease|lower|increase|raise)\b.*\b(?:quantity|qty|pieces?|pcs?|plates?|servings?|portions?|to|less|more)\b/.test(text) ||
        /\b(?:quantity|qty)\s+(?:to|kar do|kardo|set|change)\s*\d/i.test(text) ||
        /\b(?:kam|zyada|less|more)\s+kar/i.test(text)
    ) candidates.push({intent:'commerce.cart.update_quantity',confidence:.9996,entities:{requestedText:text},reason:'cart_quantity_update'});
    if (/\badd\s+\d{1,3}\s+more\b/.test(text)) candidates.push({intent:'commerce.cart.increment_quantity',confidence:.9999,entities:{requestedText:text},reason:'cart_quantity_increment'});
    // v37.0: Checkout: "checkout", "place order", "confirm order", "done", "finalize"
    if (/\b(checkout|place order|place the order|confirm order|confirm my order|finalize|finalise|done|complete|submit|place)\b/i.test(text) && (cs?.mode || cs?.lastOrderId)) {
      candidates.push({intent:'commerce.cart.view_checkout',confidence:.9999,entities:{},reason:'checkout_request'});
    }
    if (candidates.length) return {priority:this.priority,candidates,entities:candidates[0].entities,vocabularyMatches:[{type:'commerce_operation',value:candidates[0].intent,score:1}]};

    if (cs?.mode==='paused_add_item' && isWorkflowAcceptance(text)) {
      return {priority:this.priority,candidates:[{intent:'commerce.confirm',confidence:.99995,entities:{},reason:'paused_add_item_confirm'}],entities:{},vocabularyMatches:[{type:'workflow',value:'paused_add_item',score:1}]};
    }
    if (cs?.mode==='review') {
      if (isConfirmation(text)||isWorkflowAcceptance(text))
        return {priority:this.priority,candidates:[{intent:'commerce.review.confirm',confidence:.9999,entities:{},reason:'checkout_final_confirmation'}],entities:{},vocabularyMatches:[{type:'workflow',value:'checkout_review',score:1}]};
      if (/\b(change|edit|update|wrong|correct)\b/.test(text))
        return {priority:this.priority,candidates:[{intent:'commerce.review.change',confidence:.9998,entities:{},reason:'checkout_review_change'}],entities:{},vocabularyMatches:[{type:'workflow',value:'checkout_review',score:1}]};
    }
    if (cs?.mode==='checkout') {
      const optionalEmail=String(message.text||'').match(/^\s*(?:(?:my\s+)?email(?:\s+address)?\s*(?:is|=|:)?\s*)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*[.!]?\s*$/i);
      if(optionalEmail){
        entities={email:optionalEmail[1].toLowerCase(),pendingField:cs.pendingField||null};
        return {priority:this.priority,candidates:[{intent:'commerce.optional_email_update',confidence:1,entities,reason:'optional_email_during_checkout'}],entities,vocabularyMatches:[{type:'customer_field',value:'email',score:1}]};
      }
      // A confirmation while required checkout details are still missing means
      // "continue/finish my order", not a value for name/city/address.
      if(isConfirmation(text)||isWorkflowAcceptance(text)){
        entities={pendingField:cs.pendingField||null};
        return {priority:this.priority,candidates:[{intent:'commerce.checkout_continue',confidence:.9998,entities,reason:cs.savedDetailsOffered?'checkout_saved_profile_accepted':'checkout_confirmation_before_required_field'}],entities,vocabularyMatches:[{type:'workflow',value:'checkout_continue',score:1}]};
      }

      if(interruption?.type==='price_comment'){
        entities={pendingField:cs.pendingField||null,interruption};
        return {priority:this.priority,candidates:[{intent:'commerce.price_comment',confidence:.9998,entities,reason:'checkout_price_comment'}],entities,vocabularyMatches:[{type:'workflow',value:'checkout_price_comment',score:1}]};
      }

      // Field-aware natural answers must beat generic request words. Example:
      // pending city + "I want it in Lahore" is a city answer, while
      // "I want another watch" remains a shopping interruption.
      if(cs.pendingField && services?.engagementService?.parseField){
        const opts=cs.pendingField==='phone'?{minDigits:10,maxDigits:15}:{};
        const parsedPending=services.engagementService.parseField(cs.pendingField,message.text,opts);
        if(parsedPending?.valid){
          entities={pendingField:cs.pendingField,contextualFieldAnswer:true};
          return {priority:this.priority,candidates:[{intent:'commerce.checkout_input',confidence:.99975,entities,reason:'natural_pending_field_answer'}],entities,vocabularyMatches:[{type:'workflow',value:`checkout_${cs.pendingField}_answer`,score:1}]};
        }
      }

      // Profile/identity questions are side questions, never values for the pending checkout field.
      if(/\b(what is my name|what's my name|tell me my name|mera naam (?:kya|kia)|mera name (?:kya|kia))\b/.test(text)){
        return {priority:this.priority,candidates:[],entities:{interruption:{type:'profile_question'}},vocabularyMatches:[{type:'workflow',value:'checkout_paused_for_profile_question',score:1}]};
      }
      const draft=state?.capabilityState?.catalog||{};
      if(draft.selectedProductId && services?.catalogService){
        const product=await services.catalogService.getProductById?.(tenant.id,draft.selectedProductId)
          || await services.catalogService.scope?.({tenant})?.getProductById?.(draft.selectedProductId);
        const colorMatch=product?.colors?.some(c=>normalizeText(c)===text);
        const sizeMatch=product?.sizes?.some(sz=>normalizeText(String(sz))===text);
        const quantityOnly=/^\s*(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:pieces?|pcs?|units?)?\s*$/.test(text);
        if(colorMatch||sizeMatch||quantityOnly){
          return {priority:this.priority,candidates:[],entities:{interruption:{type:'catalog_draft'}},vocabularyMatches:[{type:'workflow',value:'catalog_draft_outweighs_checkout_field',score:1}]};
        }
      }
      // Universal interruption safety: a fresh product/offering question is
      // never consumed as a delivery name/phone/address.
      const newSubject=/\b(do you have|do you sell|do you offer|can i get|can i have|i want|i need|show me|looking for|can i see|other products?|more products?|browse products?|mujhy|mujhe|mujhay|chahiye|chahiyy|chahy|lyni|leni|lyna|lena|jota|joota|jootay|joty|jotay|cheezen|chezyn|samaan)\b/.test(text);
      if(newSubject) return {priority:this.priority,candidates:[],entities:{interruption:{type:'new_subject'}},vocabularyMatches:[{type:'workflow',value:'checkout_paused_for_new_subject',score:1}]};
      entities={ pendingField:cs.pendingField || null };
      if (correction) candidates.push({intent:'commerce.correction',confidence:.999,entities:{...entities,correction},reason:'checkout_correction'});
      else if (interruption?.type === 'price_comment') candidates.push({intent:'commerce.price_comment',confidence:.998,entities:{...entities,interruption},reason:'checkout_price_comment'});
      else if (interruption) return {priority:this.priority,candidates:[],entities:{...entities,interruption},vocabularyMatches:[{type:'workflow',value:'checkout_paused',score:1}]};
      else candidates.push({intent:'commerce.checkout_input',confidence:.997,entities,reason:'active_checkout'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'workflow',value:'checkout',score:1}]};
    }
    const readyProduct=Boolean(state.capabilityState?.catalog?.selectedProductId && state.capabilityState?.catalog?.selectedAttributes?.quantity);
    if (isConfirmation(text) || /\b(checkout|تصدیق)\b/.test(text) || (readyProduct && isWorkflowAcceptance(text)))
      candidates.push({intent:'commerce.confirm',confidence:.99,entities:{},reason:readyProduct&&!isConfirmation(text)?'commerce_contextual_acceptance':'commerce_confirm_phrase'});
    if (/\b(my orders|order history|purchase history|track (?:my )?order|order status|mera order|میرے آرڈر)\b/.test(text)) candidates.push({intent:'commerce.orders',confidence:.96,entities:{},reason:'commerce_tracking_phrase'});
    return {priority:this.priority,candidates,entities,vocabularyMatches:[]};
  }
}

function familyProductIds(text,products=[]){
  const families=[];
  if(/\b(?:shirts?|tshirts?|t shirts?|tees?)\b/.test(text))families.push(/\b(?:shirt|tshirt|tee)\b/);
  if(/\b(?:shoes?|footwear|slides?|sandals?)\b/.test(text))families.push(/\b(?:shoe|footwear|slide|sandal)\b/);
  if(/\b(?:jeans?|pants?|trousers?)\b/.test(text))families.push(/\b(?:jean|pant|trouser)\b/);
  if(!families.length)return [];
  return products.filter(product=>{
    const identity=normalizeText([product.name,...(product.aliases||[]),...(product.tags||[])].join(' '));
    return families.some(pattern=>pattern.test(identity));
  }).map(product=>product.id);
}
function orderedSizes(text){
  const out=[];
  const pattern=/\b(extra[ -]?large|xl|large|small|medium|xs|s|m|l)\b/gi;
  for(const match of String(text||'').matchAll(pattern)){
    const key=normalizeText(match[1]).replace(/\s+/g,'');
    const value=({xs:'XS',small:'S',s:'S',medium:'M',m:'M',large:'L',l:'L',extralarge:'XL',xl:'XL'})[key];
    if(value&&(out[out.length-1]!==value))out.push(value);
  }
  return out;
}

function extractVariantChange(text,products=[],cart=null){
  const normalized=normalizeText(text),sizes=orderedSizes(text);
  const changeIndex=normalized.search(/\b(?:change|update|make|switch)\b/);
  const before=changeIndex>=0?normalized.slice(0,changeIndex):normalized;
  const after=changeIndex>=0?normalized.slice(changeIndex):normalized;
  const beforeSizes=orderedSizes(before),afterSizes=orderedSizes(after);
  let fromSize=beforeSizes.at(-1)||null,toSize=afterSizes[0]||null;
  const explicit=normalized.match(/\b(extra[ -]?large|xl|large|small|medium|xs|s|m|l)\b[\s\S]{0,30}\b(?:to|se|sy|say)\b[\s\S]{0,20}\b(extra[ -]?large|xl|large|small|medium|xs|s|m|l)\b/);
  if(explicit){fromSize=canonicalSize(explicit[1]);toSize=canonicalSize(explicit[2]);}
  if(!toSize&&sizes.length)toSize=sizes.at(-1);
  if(fromSize===toSize&&sizes.length>1){fromSize=sizes[0];toSize=sizes.at(-1);}
  const colors=[...new Set(products.flatMap(product=>product.colors||[]))];
  const beforeColors=orderedColors(before,colors),afterColors=orderedColors(after,colors);
  let fromColor=beforeColors.at(-1)||null,toColor=afterColors.at(-1)||null;
  const colorTransition=orderedColors(normalized,colors);
  if(!toColor&&colorTransition.length)toColor=colorTransition.at(-1);
  if(fromColor===toColor&&colorTransition.length>1){fromColor=colorTransition[0];toColor=colorTransition.at(-1);}
  const qtyMatch=before.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s+(?:\w+\s+){0,2}(?:shirts?|t[ -]?shirts?|polos?|items?|products?|pieces?|pcs?)\b/);
  const quantity=Math.max(1,Number(qtyMatch?numberFromText(qtyMatch[1]):1));
  const requests=extractProductRequests(text,products);
  const cartIds=new Set((cart?.items||[]).map(item=>item.productId));
  let productIds=[...new Set([
    ...requests.items.map(item=>item.productId),
    ...requests.ambiguous.flatMap(item=>(item.candidates||[]).map(candidate=>candidate.productId)),
    ...familyProductIds(normalized,products)
  ])];
  if(cartIds.size)productIds=productIds.filter(id=>cartIds.has(id));
  if(!productIds.length&&cartIds.size===1)productIds=[...cartIds];
  if(productIds.length>1&&fromSize){
    const matching=[...new Set((cart?.items||[]).filter(item=>String(item.size||'').toUpperCase()===fromSize&&productIds.includes(item.productId)).map(item=>item.productId))];
    if(matching.length===1)productIds=matching;
  }
  return {requestedText:normalized,productIds,fromSize,toSize,fromColor,toColor,quantity};
}

function orderedColors(value,colors=[]){
  const source=` ${normalizeText(value)} `,hits=[];
  for(const color of colors){
    const canonical=String(color),needle=normalizeText(canonical);
    if(!needle)continue;
    const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`,'g');
    for(const match of source.matchAll(pattern))hits.push({index:match.index,value:canonical});
  }
  return hits.sort((a,b)=>a.index-b.index).map(hit=>hit.value);
}

function canonicalSize(value){
  const key=normalizeText(value).replace(/\s+/g,'');
  return ({xs:'XS',small:'S',s:'S',medium:'M',m:'M',large:'L',l:'L',extralarge:'XL',xl:'XL'})[key]||null;
}

function extractCartMutation(text,products){
  const segments=splitRequests(text);
  const removeSegments=segments.filter(segment=>/\b(?:remove|delete|take out)\b/.test(segment));
  const addSegments=segments.filter(segment=>/\b(?:add|include|put)\b/.test(segment));
  if(!removeSegments.length||!addSegments.length)return {removals:[],additions:[],ambiguous:[]};
  const removed=extractProductRequests(removeSegments.join(' and '),products);
  const added=extractProductRequests(addSegments.join(' and '),products);
  return {
    removals:removed.items.map(removalRequest),
    additions:added.items,
    ambiguous:[...(removed.ambiguous||[]),...(added.ambiguous||[])]
  };
}

function removalRequest(item){
  const explicit=/\b(?:remove|delete|take out)\s+(?:only\s+)?(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\b/.test(normalizeText(item.segment));
  return {...item,requestedQuantity:explicit?Number(item.quantity||1):null};
}

function resolvePendingMultiItemAttributes(text,draft,products){
  const productById=new Map((products||[]).map(product=>[product.id,product]));
  const slots=[];
  (draft||[]).forEach((entry,draftIndex)=>{
    const product=productById.get(entry.productId);if(!product)return;
    if(product.colors?.length&&!entry.color)slots.push({id:`${draftIndex}:color`,draftIndex,field:'color',entry,product});
    if(product.sizes?.length&&!entry.size)slots.push({id:`${draftIndex}:size`,draftIndex,field:'size',entry,product});
  });
  if(!slots.length)return null;
  const pendingProducts=[...new Set(slots.map(slot=>slot.product.id))];
  if(pendingProducts.length===1&&new Set(slots.map(slot=>slot.draftIndex)).size===1){
    const slot=slots[0],attrs=pendingAttributeExtractor.extract(text,slot.product);
    const item={productId:slot.entry.productId,name:slot.entry.name,quantity:1,draftIndex:slot.draftIndex,segment:text};
    for(const pending of slots)if(attrs[pending.field]!=null)item[pending.field]=attrs[pending.field];
    if(item.color!=null||item.size!=null)return {items:[item],matches:slots.filter(pending=>item[pending.field]!=null).map(pending=>({type:'pending_attribute',value:item[pending.field],canonical:`${pending.product.id}.${pending.field}`,score:1}))};
  }
  const segments=splitRequests(text);
  if(!segments.length||segments.length>10)return null;
  const choices=segments.map(segment=>{
    const out=[];
    for(const slot of slots){
      const attrs=pendingAttributeExtractor.extract(segment,slot.product);
      if(attrs.size&&slot.entry.size&&String(attrs.size)!==String(slot.entry.size))continue;
      if(attrs.color&&slot.entry.color&&normalizeText(attrs.color)!==normalizeText(slot.entry.color))continue;
      const value=attrs[slot.field];
      if(value!=null)out.push({...slot,value,segment});
    }
    return out;
  });
  if(choices.every(row=>!row.length))return null;
  if(choices.some(row=>!row.length))return {
    ambiguity:attributeAmbiguity(slots,segments,'unrecognized_value'),
    matches:[]
  };

  const outcomes=new Map();
  function visit(index,used,assignments){
    if(outcomes.size>32)return;
    if(index===choices.length){
      const rows=[...assignments].sort((a,b)=>a.id.localeCompare(b.id));
      const signature=rows.map(row=>`${row.id}=${String(row.value)}`).join('|');
      if(!outcomes.has(signature))outcomes.set(signature,rows);
      return;
    }
    for(const option of choices[index]){
      if(used.has(option.id))continue;
      used.add(option.id);assignments.push(option);
      visit(index+1,used,assignments);
      assignments.pop();used.delete(option.id);
    }
  }
  visit(0,new Set(),[]);
  if(outcomes.size!==1){
    return {
      ambiguity:attributeAmbiguity(slots,segments,outcomes.size?'multiple_products_match':'too_many_values'),
      matches:slots.map(slot=>({type:'pending_attribute',value:slot.field,canonical:slot.product.id,score:1}))
    };
  }
  const assignment=[...outcomes.values()][0];
  const grouped=new Map();
  for(const row of assignment){
    const current=grouped.get(row.draftIndex)||{productId:row.entry.productId,name:row.entry.name,quantity:1,draftIndex:row.draftIndex,segment:text};
    current[row.field]=row.value;grouped.set(row.draftIndex,current);
  }
  return {
    items:[...grouped.values()],
    matches:assignment.map(row=>({type:'pending_attribute',value:row.value,canonical:`${row.product.id}.${row.field}`,score:1}))
  };
}

function attributeAmbiguity(slots,segments,reason){
  const products=[...new Set(slots.map(slot=>slot.product.name))];
  const fields=[...new Set(slots.map(slot=>slot.field))];
  return {reason,receivedValues:segments.length,pendingSlots:slots.length,products,fields};
}
module.exports={CommerceConversationAdapter,extractCartMutation,removalRequest};

// v37.0: UNIVERSAL order intent detection — works for ALL product-based tenants.
// Returns the detected order intent type, or null if not an order request.
// Supports: English, Roman Urdu, Urdu script for order verbs.
function detectUniversalOrderIntent(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  // Direct order verbs (English)
  if (/\b(?:i want|i need|i'?d like|i'?ll|i will|i would)\s+(?:to\s+)?(?:order|get|have|buy|eat|take)\b/.test(t)) return 'want_order';
  if (/\b(?:send|deliver|ship|bring|pack|prepare|make)\s+(?:me\s+)?/.test(t)) return 'send';
  if (/\b(?:give|get)\s+(?:me\s+)?/.test(t) && !/\b(?:information|details|price|cost)\b/.test(t)) return 'give';
  if (/\b(?:can i|could i)\s+(?:get|have|order|buy)\b/.test(t)) return 'can_i';
  if (/\b(?:let me)\s+(?:get|have|order|take)\b/.test(t)) return 'let_me';
  if (/\b(?:add|include|put)\b/.test(t) && !/\b(?:to\s+my\s+(?:cart|order))/.test(t)) return 'add';
  if (/\b(?:order|buy|purchase)\s+\d/i.test(t)) return 'order_direct';
  // Roman Urdu
  if (/\b(?:mujhe|mujhy|mujhay)\s+.*\b(?:chahiye|chahiyy|chahy|lena|leni|lyna|lyni)\b/.test(t)) return 'roman_want';
  if (/\b(?:order|khana|food)\s+(?:karna|chahiye|chahiyy|chahy)\b/.test(t)) return 'roman_order';
  if (/\b(?:bhej|bhejo|laga|laga\s*do|kar\s*do|kardo)\b/.test(t)) return 'roman_send';
  // Short phrases: just the product name + "please" (≤ 5 words)
  if (t.split(/\s+/).length <= 5 && /\bplease\b/.test(t) && !/\b(?:what|which|how|why|where|when|who)\b/.test(t)) return 'short_please';
  // Quantity + product: "2 chicken biryani", "one burger"
  if (/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch)\b/.test(t) &&
      !/\b(?:what|which|how|why|where|when|who)\b/.test(t) &&
      t.split(/\s+/).length <= 6) return 'quantity_product';
  return null;
}

// v37.0: Clean product query from order text — strips action verbs, quantity words,
// and filler words to get just the product name for entity resolution.
function cleanProductQuery(text, intentType) {
  let cleaned = String(text || '')
    // Fix common typos
    .replace(/\bchiken\b/gi, 'chicken')
    .replace(/\bbiriyani\b/gi, 'biryani')
    .replace(/\bburgers\b/gi, 'burger')
    .replace(/\bwnt\b/gi, 'want')
    .replace(/\bresturant\b/gi, 'restaurant')
    .replace(/\bsomw\b/gi, 'some')
    .replace(/\bwht\b/gi, 'what')
    .replace(/\bordr\b/gi, 'order')
    // Strip order verbs
    .replace(/\b(?:i want|i need|i'?d like|i'?ll|i will|i would|let me|can i|could i|please|ok|okay|a|an|the|some|of|to|do|does)\b/gi, '')
    .replace(/\b(?:order|buy|purchase|eat|get|have|take|deliver|send|give|bring|pack|ship|prepare|make|add|include|put)\b/gi, '')
    .replace(/\b(?:want|need|like|will|would|let|can|could|please|ok|okay|just|only|also|too|bhi|aur)\b/gi, '')
    // Strip quantity words
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch)\b/gi, '')
    .replace(/\b\d+\s*(?:x|×|pcs?|pieces?|plates?|servings?|portions?|bags?|units?)?\b/gi, '')
    // Strip Roman Urdu
    .replace(/\b(?:mujhe|mujhy|mujhay|chahiye|chahiyy|chahy|lena|leni|lyna|lyni|karna|bhej|bhejo|laga|kar|kardo|kar\s*do)\b/gi, '')
    // Strip connectors + filler
    .replace(/\b(?:and|or|with|plus|also|too|from|in|on|at|for|my|your|this|that|it|is|are|was|were)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove leading/trailing punctuation
  cleaned = cleaned.replace(/^[,.]+|[,.]+$/g, '').trim();
  return cleaned.length >= 3 ? cleaned : null;
}
