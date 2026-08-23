const { createGoal, getGoal, transitionGoal } = require('./goalManager');
const { normalizeText } = require('../text');

const ORDER_CUE = /\b(order|book|buy|purchase|checkout|confirm|place order|final|done|le lo|lena|leni|kar do|kardo|mangwana|mangwa|آرڈر|خرید)\b/;

class GoalResolver {
  async resolve({ tenant, message, state, services, selected, entities }) {
    const text = normalizeText(message.text);
    const current = getGoal(state);
    let nextGoal = current;
    let override = null;
    let transition = null;

    // Unmatched/unsupported catalog requests are side questions. They must not
    // destroy a completed product selection or mutate the active purchase goal.
    const sideRequest = selected?.intent === 'catalog.unavailable_request' || selected?.intent === 'assistant.unsupported_capability' || selected?.intent?.startsWith('commerce.cart.');
    // Fresh explicit Catalog interpretations supersede stale browsing/product
    // goals. Goal state may complete an ambiguous follow-up, but it must never
    // veto "I want a shirt" merely because the previous turn browsed shoes.
    const freshCatalogSubject = await this.#isFreshCatalogSubject({tenant,message,selected,entities,services});
    const commerceMode=state?.capabilityState?.commerce?.mode||null;
    const commerceOwnsTurn=selected?.intent==='commerce.order.return_exchange'||selected?.intent?.startsWith('commerce.cart.')||['checkout','review','paused_add_item'].includes(commerceMode);
    const directMultiItemTransaction=selected?.capabilityId==='commerce'&&selected?.intent==='commerce.multi_item_request';

    if (current?.type === 'purchase_product' && current.status === 'active' && !sideRequest && !freshCatalogSubject && !commerceOwnsTurn && !directMultiItemTransaction) {
      const asksAlternative = /\b(other|another|else|aur|dusre|doosre|mazeed|مزید|دوسرے)\b/.test(text);
      const concrete = asksAlternative ? null : await this.#matchCandidateProduct({ tenant, message, current, services });
      if (concrete) {
        nextGoal = transitionGoal(current, {
          selectedProductId: concrete.id,
          stage: 'product_selected',
          capabilityId: 'catalog',
          entities: { productId: concrete.id, productName: concrete.name }
        });
        transition = { type: 'goal.product_selected', productId: concrete.id };
        // Product selection always beats an early "confirm". Commerce should
        // only receive confirmation after required product details exist.
        override = {
          capabilityId: 'catalog', intent: 'catalog.product_interest', confidence: .9998,
          reason: 'goal_candidate_selected', entities: { productId: concrete.id, productName: concrete.name }
        };
      } else if (ORDER_CUE.test(text) && !current.selectedProductId && current.candidateIds?.length) {
        override = {
          capabilityId: 'catalog', intent: 'catalog.goal_selection_required', confidence: .9999,
          reason: 'goal_requires_candidate_selection',
          entities: { categoryId: current.categoryId, goalCandidateIds: current.candidateIds }
        };
        nextGoal = transitionGoal(current, { stage: 'awaiting_product_selection' });
        transition = { type: 'goal.awaiting_product_selection' };
      } else if (ORDER_CUE.test(text) && current.selectedProductId && selected?.intent !== 'catalog.attribute_update') {
        const catalogState = state.capabilityState?.catalog || {};
        const sameProduct = catalogState.selectedProductId === current.selectedProductId;
        const ready = Boolean(sameProduct && catalogState.selectedAttributes?.quantity);
        if (!ready) {
          const product = await services.catalogService?.getProductById(tenant.id, current.selectedProductId);
          override = {
            capabilityId: 'catalog', intent: 'catalog.goal_missing_details', confidence: .9997,
            reason: 'goal_product_details_incomplete',
            entities: { productId: current.selectedProductId, productName: product?.name || null }
          };
          nextGoal = transitionGoal(current, { stage: 'collecting_product_details' });
          transition = { type: 'goal.collecting_product_details' };
        } else {
          override = {
            capabilityId: 'commerce', intent: 'commerce.confirm', confidence: .9997,
            reason: 'goal_ready_for_checkout', entities: { productId: current.selectedProductId }
          };
          nextGoal = transitionGoal(current, { stage: 'checkout', capabilityId: 'commerce' });
          transition = { type: 'goal.checkout_started' };
        }
      }
    }

    // Create/refresh goals from the interpretation chosen by the ordinary
    // Conversation Intelligence adapters. This lets capabilities teach the
    // Goal Engine without the Goal Engine knowing their product vocabulary.
    const effective = override || selected;
    if (sideRequest && current) return { current, nextGoal:current, transition:{type:'goal.interrupted', reason:effective?.intent}, override:null };
    const effectiveEntities = override?.entities || entities || {};
    if (effective?.intent === 'catalog.family_browse' && effectiveEntities.productFamily) {
      const products = await services.catalogService?.listProducts(tenant.id) || [];
      const terms = effectiveEntities.familyTerms || [];
      const candidateIds=products.filter((product)=>product.inStock && terms.some((term)=>` ${normalizeText(product.name)} `.includes(` ${normalizeText(term)} `))).map((product)=>product.id);
      nextGoal=createGoal({
        type:'purchase_product',stage:'browsing_family',capabilityId:'catalog',
        categoryId:null,candidateIds,entities:{productFamily:effectiveEntities.productFamily}
      });
      transition=transition||{type:'goal.started',goalType:'purchase_product',productFamily:effectiveEntities.productFamily};
    } else if (effective?.intent === 'catalog.category_browse' && effectiveEntities.categoryId) {
      const products = await services.catalogService?.listProducts(tenant.id) || [];
      const candidateIds = products.filter((p) => p.inStock && p.category === effectiveEntities.categoryId).map((p) => p.id);
      nextGoal = createGoal({
        type: 'purchase_product', stage: 'browsing_category', capabilityId: 'catalog',
        categoryId: effectiveEntities.categoryId, candidateIds,
        entities: { categoryId: effectiveEntities.categoryId }
      });
      transition = transition || { type: 'goal.started', goalType: 'purchase_product', categoryId: effectiveEntities.categoryId };
    } else if (effective?.intent === 'catalog.attribute_update' && current?.type === 'purchase_product') {
      nextGoal = transitionGoal(current, {
        stage:'collecting_product_details', capabilityId:'catalog',
        selectedProductId: effectiveEntities.productId || current.selectedProductId,
        entities: effectiveEntities
      });
      transition = transition || { type:'goal.product_details_updated', entities:effectiveEntities };
    } else if (effective?.intent === 'catalog.product_interest' && effectiveEntities.productId) {
      if (!nextGoal || nextGoal.type !== 'purchase_product') nextGoal = createGoal({ type:'purchase_product', capabilityId:'catalog' });
      nextGoal = transitionGoal(nextGoal, {
        selectedProductId: effectiveEntities.productId, stage:'product_selected', capabilityId:'catalog',
        entities: { productId: effectiveEntities.productId, productName: effectiveEntities.productName || null }
      });
      transition = transition || { type:'goal.product_selected', productId:effectiveEntities.productId };
    } else if (effective?.intent === 'commerce.confirm' && current?.type === 'purchase_product') {
      nextGoal = transitionGoal(current, { stage:'checkout', capabilityId:'commerce' });
    }

    return { current, nextGoal, transition, override };
  }

  async #isFreshCatalogSubject({tenant,message,selected,entities,services}){
    if(selected?.capabilityId!=='catalog')return false;
    if(['catalog.category_browse','catalog.family_browse','catalog.related_browse','catalog.unavailable_request'].includes(selected?.intent))return true;
    const resolvedEntities=selected?.entities||entities||{};
    if(selected?.intent!=='catalog.product_interest'||!resolvedEntities.productId)return false;
    const product=await services.catalogService?.getProductById(tenant.id,resolvedEntities.productId);
    if(!product)return false;
    const text=normalizeText(message.text);
    // ProductMatcher has already applied the strict no-substitution boundary.
    // An explicit fresh purchase/request therefore supersedes an old family
    // goal even when the customer uses a generic exact noun such as "bottle".
    if(/\b(?:i want|i need|buy|purchase|order|can i get|can i have|do you have|do you sell|looking for)\b/.test(text))return true;
    const terms=[product.name,...(product.aliases||[])].map(normalizeText).filter(Boolean);
    return terms.some(term=>{
      if(term.split(/\s+/).length>=2)return text.includes(term);
      if(['book','order','item','product','thing'].includes(term))return false;
      return new RegExp(`(?:^|\\b)${escapeRegex(term)}(?:\\b|$)`,'i').test(text);
    });
  }

  async #matchCandidateProduct({ tenant, message, current, services }) {
    if (!current?.candidateIds?.length || !services.catalogService) return null;
    const result = await services.catalogService.search(tenant.id, message.text);
    if (!result?.product || !current.candidateIds.includes(result.product.id)) return null;
    return result.product;
  }
}
function escapeRegex(value){return String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
module.exports = { GoalResolver };
