const { normalizeCatalogRequest } = require('../../../packages/catalog-engine/src/productMatcher');
const { normalizeText, hasAny, numberFromText } = require('../../../packages/conversation-intelligence/src/text');
const { aliasesFor, hasConcept } = require('../../../packages/universal-vocabulary/src');
const { AttributeExtractor } = require('../../../packages/catalog-engine/src/attributeExtractor');
const { extractMultiProducts, extractProductRequests } = require('../../../packages/catalog-engine/src/multiProductExtractor');
const { hasAcquisitionCue } = require('../../../packages/conversation-intelligence/src/acquisitionIntent');

const CATEGORY_ALIASES = {
  footwear:aliasesFor('catalog.footwear'),
  clothing:aliasesFor('catalog.clothing'),
  electronics:aliasesFor('catalog.electronics'),
  accessories:aliasesFor('catalog.accessories'),
  bags:aliasesFor('catalog.bags'),
  stationery:aliasesFor('catalog.stationery'),
  'home-office':aliasesFor('catalog.home_office'),
  'personal-care':['personal care','skin care','skincare','beauty'],
  kitchen:['kitchen','cookware'],
  fitness:['fitness','exercise','gym'],
  'mobile-accessories':['mobile accessories','phone accessories','mobile accessory'],
  travel:['travel','travel accessories']
};
const REQUEST_CUES = ['do you have','do you sell','can i get','can i have','could i get','i want','i need','show me','looking for','searching for','shopping for','trying to find','interested in','help me find','buy','purchase','order','mujhe','mujhy','mujhay','chahiye','chahiyy','chahy','lyni','leni','lyna','lena','ap k pass','aap ke paas','dikhao','ہے','چاہیے','قیمت','ریٹ','مل','دستانی','دستیاب','بتائیں','کرنا','ہوگا','ہوگی','ہوں گے','بنے گا','بتا'];
const PRODUCT_FAMILIES = { shirts:aliasesFor('catalog.shirts'), jeans:aliasesFor('catalog.jeans') };
const BROWSE_COLORS = { black:'Black', white:'White', blue:'Blue', navy:'Navy', grey:'Grey', gray:'Grey', brown:'Brown', silver:'Silver', gold:'Gold', olive:'Olive', maroon:'Maroon', red:'Red' };
const BROWSE_SIZES = { small:'S', s:'S', medium:'M', m:'M', large:'L', l:'L', xl:'XL', xxl:'XXL' };
const LIST_CUES = ['what products','what other products','other products','which products','what do you have','what do you sell','show products','show me your products','list products','list items','ap k pass kia kia','ap k pass kya kya','aap ke paas kya kya hai','kon sy products','konsay products','products dikhao','konsy chezyn ap k pss hain','konsi cheezen ap k pas hain','ap k pass kon kon c chez hai','ap k pas kon kon si cheezein hain','ap k pas kon kon si cheezen available hain','kon kon c chez','kya kya cheezen hain','kia kia cheezen hain'];

const activeAttributeExtractor = new AttributeExtractor();

class CatalogConversationAdapter {
  constructor() { this.capabilityId='catalog'; this.priority=80; }
  async analyze({ tenant, message, state, services, normalizedText, correction }) {
    const matches=[]; const candidates=[]; let entities={}; let concreteProductCount=0;let tenantProducts=[];
    if(tenant.capabilities?.includes('commerce') && services.catalogService){
      tenantProducts=await services.catalogService.listProducts(tenant.id);
      const requests=extractProductRequests(message.text,tenantProducts);
      concreteProductCount=requests.items.length+requests.ambiguous.length;
      const multiple=(requests.items.length+requests.ambiguous.length)>1;
      // Choice language such as "t-shirt or polo" is family discovery, not a
      // request to add both products. Let family semantics resolve it.
      const choiceLanguage=/\b(or|either|ya|yani|like)\b/i.test(message.text);
      if(multiple && !choiceLanguage) return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
    }
    // Payment/delivery/policy vocabulary describes business facts, not catalog items.
    if(/\b(payment|payment method|pay|jazz\s*cash|easypaisa|easy\s*paisa|bank transfer|cash on delivery|refund|return policy|warranty)\b/.test(normalizedText)) {
      return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
    }
    // A deeper active workflow owns its pending field. Catalog must not steal a
    // phone number, address, payment choice, etc. just because a product is
    // still selected underneath Commerce.
    const checkoutActive = state.capabilityState?.commerce?.mode === "checkout";
    const explicitCatalogInterruption = hasAny(normalizedText, REQUEST_CUES)||hasAcquisitionCue(normalizedText);
    const referentialCheckoutValue=/\b(?:i want|send|deliver|ship)(?: it)? (?:in|to)\b/.test(normalizedText);
    if(checkoutActive&&referentialCheckoutValue){
      return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
    }
    if (checkoutActive && !explicitCatalogInterruption) return { priority:this.priority, candidates:[], entities:{}, vocabularyMatches:[] };
    const selectedId = state.capabilityState?.catalog?.selectedProductId;
    const selectedAttrs = state.capabilityState?.catalog?.selectedAttributes || {};

    // If the customer is already configuring a product, a same-category phrase
    // that contains valid attributes belongs to that product. Example:
    // selected Urban Backpack + "black color 5 bags" => Black × 5 Backpack,
    // not a fresh browse of the Bags category.
    const previewCategory=matchCategory(normalizedText);
    if(selectedId && previewCategory && !/\b(other|else|another|aur|mazeed|dusre|doosre)\b/.test(normalizedText)){
      const activeProduct=await services.catalogService.getProductById(tenant.id,selectedId);
      if(activeProduct && normalizeText(activeProduct.category)===normalizeText(previewCategory.id)){
        const attrs=activeAttributeExtractor.extract(message.text,activeProduct);
        const q=numberFromText(message.text);
        if(q!=null && /\b(?:pieces?|pcs?|bags?|units?|quantity|qty|chahiye|chahiyy|chahy)\b/.test(normalizedText)) attrs.quantity=q;
        if(Object.values(attrs).some(v=>v!==null&&v!==undefined&&v!=='')){
          entities={productId:activeProduct.id,productName:activeProduct.name,...attrs};
          candidates.push({intent:'catalog.attribute_update',confidence:.9993,entities,reason:'active_product_same_category_attributes'});
          return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'state',value:'active_product_attributes',score:1}]};
        }
      }
    }

    // IMPORTANT: a new product/family request must beat the old draft.
    // "white shirt" is a new catalog subject, not "white" for the jeans
    // currently being configured. Attribute follow-up handling therefore runs
    // only after new-subject/list/family/category intent checks below.

    const listText = normalizedText.replace(/\bwht\b/g,'what').replace(/\bpss\b/g,'pass').replace(/\bchezyn\b/g,'cheezen').replace(/\bchez\b/g,'cheez');
    const genericProductDiscovery=concreteProductCount===0&&/\b(?:products?|items?)\b/.test(listText)
      && /\b(?:what|which|show|see|list|browse|have|sell|buy|purchase|catalog)\b/.test(listText)
      && !/\b(?:price|cost|how much)\b/.test(listText);
    const tenantWideCollection=isTenantWideCollectionQuery(listText,tenant,tenantProducts);
    if (genericProductDiscovery || tenantWideCollection || hasConcept(listText,'discovery.list_offerings') || (hasConcept(listText,'discovery.other_more') && hasConcept(listText,'discovery.generic_item')) || hasAny(listText, LIST_CUES) || /\b(konsy|konsi|kon kon|kya kya|kia kia).*\b(products?|cheezen|cheez).*\b(pass|pas|paas)\b/.test(listText)) {
      candidates.push({ intent:'catalog.list', confidence:.985, entities:{}, reason:'catalog_list_phrase' });
      return { priority:this.priority, candidates, entities:{}, vocabularyMatches:[{type:'phrase',value:'catalog_list',score:.98}] };
    }

    const family = matchFamily(normalizedText);
    const browseFilters = extractBrowseFilters(normalizedText);
    const familyChoice = family && /\b(or|either|ya|yani|like)\b/.test(normalizedText);
    if (family && hasAny(normalizedText, REQUEST_CUES) && (isGenericFamilyBrowse(normalizedText) || familyChoice) && !hasIdentityModifier(normalizedText)) {
      entities = { productFamily:family.id, familyTerms:family.terms, filters:browseFilters };
      candidates.push({ intent:'catalog.family_browse', confidence:.996, entities, reason:'catalog_product_family_filtered' });
      matches.push({ type:'product_family', value:family.id, canonical:family.id, score:.996 });
      addFilterMatches(matches,browseFilters);
      return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
    }
    const asksOtherFamily = family && /\b(other|else|another|aur|koi aur|mazeed|dusre|doosre|nhn|nahi|nahin)\b/.test(normalizedText);
    if (asksOtherFamily) {
      entities={productFamily:family.id,familyTerms:family.terms,filters:browseFilters};
      candidates.push({intent:'catalog.family_browse',confidence:.9992,entities,reason:'catalog_other_family_options'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'product_family',value:family.id,canonical:family.id,score:.9992}]};
    }
    const category = matchCategory(normalizedText);
    const genericBrowse = category && isGenericCategoryBrowse(normalizedText, category.term);
    const filteredGenericBrowse = category && hasAny(normalizedText, REQUEST_CUES) && isGenericCategoryWithFilters(normalizedText, category.term);
    if (genericBrowse || filteredGenericBrowse) {
      entities = { categoryId:category.id, categoryTerm:category.term, semanticLevel:'product_family', filters:browseFilters };
      candidates.push({ intent:'catalog.category_browse', confidence:.9994, entities, reason:filteredGenericBrowse?'generic_family_filtered_browse':'generic_family_browse' });
      matches.push({ type:'product_family', value:category.term, canonical:category.id, score:.9994 });
      addFilterMatches(matches,browseFilters);
      return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
    }
    const asksOther = /\b(other|else|another|aur|dusre|doosre|mazeed|مزید|دوسرے)\b/.test(normalizedText);
    if (category && asksOther) {
      entities = { categoryId:category.id, categoryTerm:category.term };
      candidates.push({ intent:'catalog.category_browse', confidence:.999, entities, reason:'catalog_other_category_options' });
      matches.push({ type:'category', value:category.term, canonical:category.id, score:.999 });
      return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
    }
    if (category && (hasAny(normalizedText, REQUEST_CUES) || category.exact)) {
      entities = { categoryId:category.id, categoryTerm:category.term };
      candidates.push({ intent:'catalog.category_browse', confidence:.97, entities, reason:'catalog_category_alias' });
      matches.push({ type:'category', value:category.term, canonical:category.id, score:.97 });
    }

    const result = await services.catalogService.search(tenant.id, message.text);

    // A category plus an unsupported style is not an exact product request.
    // "old style bags" must report that phrase as unavailable and offer real
    // bags; it must not silently become a generic bag or ordinary browse.
    const descriptorRemainder=category ? unmatchedCategoryDescriptors(normalizedText) : [];
    if(category && descriptorRemainder.length && (!result?.product || !isExactRequestedProductPhrase(message.text,result.product))){
      const productText=result?.product
        ? normalizeText([result.product.name,result.product.description,...(result.product.aliases||[]),...(result.product.tags||[])].join(' '))
        : '';
      const unsupported=descriptorRemainder.filter(token=>!productText.includes(token));
      if(unsupported.length){
        const available=(await services.catalogService.listProducts(tenant.id)).filter(x=>x.inStock&&x.category===category.id).slice(0,4);
        entities={requestedText:cleanRequestedText(message.text),recommendationIds:available.map(x=>x.id)};
        candidates.push({intent:'catalog.unavailable_request',confidence:.9987,entities,reason:'unsupported_category_descriptor'});
        return {priority:this.priority,candidates,entities,vocabularyMatches:available.map(x=>({type:'category_alternative',value:x.name,canonical:x.id,score:.9}))};
      }
    }

    // "other/more <product family>" is discovery, not an unavailable-item
    // assertion. If semantic search has related in-stock evidence, expose it as
    // related options without selecting an alternative.
    const relatedBrowse=/\b(other|more|else|another|check other|show other|any other)\b/.test(normalizedText);
    if(relatedBrowse && !result?.product && (result?.alternatives||[]).length){
      const recommendations=(result.alternatives||[]).filter(x=>x.inStock).slice(0,5);
      entities={
        requestedText:cleanRequestedText(message.text),
        recommendationIds:recommendations.map(x=>x.id)
      };
      candidates.push({intent:'catalog.related_browse',confidence:.997,entities,reason:'related_product_browse'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:recommendations.map(x=>({type:'related_product',value:x.name,canonical:x.id,score:.95}))};
    }

    // If the message explicitly names a different concrete product, switch the
    // active subject instead of treating any color/size word as an attribute of
    // the previous product draft.
    const explicitNewProduct = Boolean(result?.product && selectedId && result.product.id !== selectedId && hasAny(normalizedText, REQUEST_CUES));

    // Only a true attribute-only/correction message belongs to the active
    // product. New product/family requests have already been handled above.
    // We also let the official attribute extractor recognize typo variants
    // such as "blck"; an unrelated request like "milk" produces no active
    // attributes and therefore continues to normal unavailable-item routing.
    if (selectedId && !explicitNewProduct && !category && !family) {
      const product = await services.catalogService.getProductById(tenant.id, selectedId);
      if (product) {
        const activeAttributes = { ...activeAttributeExtractor.extract(message.text, product) };
        // A bare lexical number ("five", "ten", "das") is a quantity when
        // Catalog is explicitly waiting on product attributes.
        const lexicalQuantity = numberFromText(message.text);
        if (lexicalQuantity != null && /^(one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch|che|chay|saat|aath|nau|das)$/.test(normalizedText)) {
          activeAttributes.quantity = lexicalQuantity;
        }
        const hasActiveAttribute = Object.values(activeAttributes).some((value) => value !== null && value !== undefined && value !== "");
        const workflowControl=/^(?:ok\s+)?(?:confirm|confirm order|confirm my order|confirm oredr|checkout|place order|done|final|yes)$/.test(normalizedText)
          || /\b(jazz\s*cash|easypaisa|payment method|pay by|do you offer)\b/.test(normalizedText);
        if (!workflowControl && (correction || looksLikeAttribute(normalizedText) || hasActiveAttribute)) {
          entities = { productId:product.id, productName:product.name, ...activeAttributes };
          if (correction?.target === 'quantity' && correction.value) entities.quantity = correction.value;
          candidates.push({ intent:'catalog.attribute_update', confidence:.998, entities, reason:'active_catalog_attribute' });
          matches.push({ type:'state', value:selectedId, score:1 });
          return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
        }
      }
    }

    if (result?.product) {
      // Strict resolution: a partial/fuzzy product hit is evidence, not identity.
      // Example: "skinny jeans" must not silently become "Denim Jeans".
      const explicitRequest = hasAny(normalizedText, REQUEST_CUES)||hasAcquisitionCue(normalizedText)||/\badd\b/.test(normalizedText);
      const unmatchedModifiers = findUnmatchedProductModifiers(normalizedText, result);
      // Description/tag overlap alone is not product identity. A fabricated
      // "Quantum Laptop" must not become a backpack merely because that real
      // product mentions a laptop compartment in its approved description.
      const weakSemanticEvidence=Number(result.score||0)<60&&!category&&!family&&catalogIdentityTerms(normalizedText).length>1;
      const weakPartial = explicitRequest && (unmatchedModifiers.length > 0||weakSemanticEvidence);
      if (weakPartial) {
        const recommendations=[result.product,...(result.alternatives||[])].filter((x,i,a)=>x&&a.findIndex(y=>y.id===x.id)===i).slice(0,3);
        entities = {
          requestedText:cleanRequestedText(message.text),
          suggestedProductId:result.product.id,
          suggestedProductName:result.product.name,
          recommendationIds:recommendations.map(x=>x.id)
        };
        candidates.push({ intent:'catalog.unavailable_request', confidence:.997, entities, reason:'strict_partial_product_rejected' });
        matches.push({ type:'strict_resolution', value:result.product.name, score:result.confidence || 0 });
        return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
      }
      entities = { ...entities, productId:result.product.id, productName:result.product.name, ...(result.attributes || {}) };
      const genericCategoryOnly = category && isGenericCategoryQuery(normalizedText, category.term);
      candidates.push({ intent:'catalog.product_interest', confidence:genericCategoryOnly ? .90 : Math.max(.975, result.confidence || .91), entities, reason:'catalog_product_match' });
      for (const term of result.matchedTerms || []) matches.push({ type:'product_term', value:term, canonical:result.product.id, score:result.confidence || .9 });
    } else if (category) {
      candidates.push({ intent:'catalog.category_browse', confidence:.9, entities:{ categoryId:category.id, categoryTerm:category.term }, reason:'category_without_request_cue' });
    } else if ((hasAny(normalizedText, REQUEST_CUES)||hasAcquisitionCue(normalizedText)) && /\b(do you sell|do you have|can i get|can i have|could i get|i want|i need|looking for|searching for|shopping for|trying to find|interested in|help me find|buy|purchase|mujhe|chahiye|ap k pass|aap ke paas)\b/.test(normalizedText)) {
      // v22.1: If the search found alternatives (e.g., "watches" → Smart Watch
      // as an alternative), surface them as product_interest instead of
      // unavailable_request. This handles plural/category queries like
      // "what watches do you have" when the catalog has "Smart Watch".
      const safeAlternatives=(result?.alternatives||[]).filter(product=>isRelevantAlternative(message.text,product));
      if (safeAlternatives.length > 0) {
        // Show the first alternative as a product interest
        const primary = safeAlternatives[0];
        entities = { ...entities, productId:primary.id, productName:primary.name, ...(primary.attributes || {}) };
        candidates.push({ intent:'catalog.product_interest', confidence:.92, entities, reason:'alternative_match_for_request' });
        for (const alt of safeAlternatives.slice(0,3)) {
          matches.push({ type:'product_term', value:alt.name, canonical:alt.id, score:.92 });
        }
      } else {
        entities = {
          requestedText: cleanRequestedText(message.text),
          recommendationIds:[]
        };
        candidates.push({ intent:'catalog.unavailable_request', confidence:1, priority:180, entities, reason:'explicit_unmatched_catalog_request' });
        matches.push({ type:'request', value:'unmatched_catalog_item', score:.955 });
      }
    }
    return { priority:this.priority, candidates, entities, vocabularyMatches:matches };
  }
}
function matchCategory(text) {
  for (const [id, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const alias of aliases) {
      const n=normalizeText(alias); const padded=` ${text} `;
      if (padded.includes(` ${n} `)) return { id, term:alias, exact:text===n };
    }
  }
  return null;
}

// A tenant-wide merchandise noun must browse the collection, not select the
// alphabetically/highest-scoring item that happens to repeat that noun. This
// is derived from the tenant identity, so "do you have fruits" works for a
// fruit market without hard-coding fruit, while "do you have red apples"
// remains a concrete product request.
function isTenantWideCollectionQuery(text,tenant,products=[]){
  if(!/\b(do you have|do you sell|what|which|show|list|available|stock|carry)\b/.test(text))return false;
  const stripped=normalizeText(text)
    .replace(/\b(hello|hi|hey|please|some|any|all|the|your|available|stock)\b/g,' ')
    .replace(/\b(do you have|do you sell|what do you have|what do you sell|what kind of|what kinds of|what type of|what types of|which|show me|show|list|carry)\b/g,' ')
    .replace(/\b(products?|items?|things?|options?)\b/g,' ')
    .replace(/\s+/g,' ').trim();
  if(!stripped)return false;
  const tokens=stripped.split(' ').filter((token)=>token.length>2);
  if(!tokens.length||tokens.length>2)return false;
  const identity=normalizeText([tenant.name,tenant.domain,tenant.business?.description,tenant.description].filter(Boolean).join(' '));
  if(!identity)return false;
  const identityTokens=identity.split(' ');
  const singular=(value)=>value.endsWith('ies')?`${value.slice(0,-3)}y`:value.endsWith('s')&&!value.endsWith('ss')?value.slice(0,-1):value;
  const identityMatch=tokens.every((token)=>identityTokens.some((candidate)=>singular(candidate)===singular(token)));
  if(!identityMatch)return false;
  // Preserve an exact product request even when the business name repeats it.
  const concrete=(products||[]).some((product)=>[product.name,...(product.aliases||[])].some((name)=>normalizeText(name)===stripped));
  return !concrete;
}

function isGenericFamilyBrowse(text) {
  const t=normalizeText(text);
  if (/\b(t ?shirt|tshirt|t-shirt|polo)\b/.test(t)) return false;
  if (/\bdenim jeans?\b/.test(t)) return false;
  return /\b(shirt|shirts|tees?|tops?|jeans?|pants|trousers)\b/.test(t);
}
function isGenericCategoryBrowse(text, term) {
  const t=normalizeText(text);
  if (/\b(what|which|konsy|konsi|kon se|kon sy|kis kis|types? of|kind of|kinds of|options?|available|show me)\b/.test(t)) return true;
  return isGenericCategoryQuery(t, term);
}

function isGenericCategoryQuery(text, term) {
  const stripped = normalizeText(text)
    .replace(/\b(hello|hi|hey|salam|assalam|please|from here|from you|here|ok|okay)\b/g, ' ')
    .replace(/\b(do you have|do you sell|can i get|can i have|show me|i want|i need|mujhe|chahiye|ap k pass|aap ke paas)\b/g, ' ')
    .replace(/\s+/g,' ').trim();
  return ['shoes','shoe','shirts','shirt','clothes','clothing','electronics','gadgets','bags','bag','accessories','stationery','footwear'].includes(stripped);
}

function extractBrowseFilters(text) {
  const t=normalizeText(text); const filters={};
  for (const [token,canonical] of Object.entries(BROWSE_COLORS)) if ((` ${t} `).includes(` ${token} `)) { filters.color=canonical; break; }
  for (const [token,canonical] of Object.entries(BROWSE_SIZES)) if ((` ${t} `).includes(` ${token} `)) { filters.size=canonical; break; }
  const numeric=t.match(/\b(\d{2})\s*(?:size)?\b/); if(numeric) filters.size=numeric[1];
  return filters;
}
function addFilterMatches(matches, filters){ for(const [key,value] of Object.entries(filters||{})) matches.push({type:`filter_${key}`,value,canonical:value,score:.995}); }
function isGenericCategoryWithFilters(text, term) {
  let stripped=normalizeText(text)
    .replace(/\b(hello|hi|hey|salam|assalam|please|from here|from you|here|ok|okay)\b/g,' ')
    .replace(/\b(do you have|do you sell|can i get|can i have|show me|i want|i need|mujhe|chahiye|ap k pass|aap ke paas)\b/g,' ');
  for(const aliases of Object.values(CATEGORY_ALIASES)) for(const alias of aliases) stripped=stripped.replace(new RegExp(`\\b${escapeRegex(normalizeText(alias))}\\b`,'g'),' ');
  for(const token of Object.keys(BROWSE_COLORS)) stripped=stripped.replace(new RegExp(`\\b${escapeRegex(token)}\\b`,'g'),' ');
  for(const token of Object.keys(BROWSE_SIZES)) stripped=stripped.replace(new RegExp(`\\b${escapeRegex(token)}\\b`,'g'),' ');
  stripped=stripped.replace(/\b\d{2}\s*(?:size)?\b/g,' ').replace(/\s+/g,' ').trim();
  return stripped==='';
}
function escapeRegex(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function looksLikeAttribute(text) {
  if (/^(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)$/.test(text)) return true;
  if (/\b(black|white|blue|navy|brown|silver|gold|grey|gray|red|maroon|small|medium|large|xl|xxl|size|color|colour|qty|quantity|pieces?|pcs?)\b/.test(text)) return true;
  return numberFromText(text) != null && /\b(i meant|make it|instead|pieces?|qty|quantity)\b/.test(text);
}
function matchFamily(text){ for(const [id,terms] of Object.entries(PRODUCT_FAMILIES)){ if(terms.some(t=>` ${text} `.includes(` ${normalizeText(t)} `))) return {id,terms}; } return null; }
function cleanRequestedText(value){
  return normalizeCatalogRequest(String(value||''))
    .replace(/^\s*(?:i am |i m |im )?(?:looking|searching) for\s+/i,'')
    .replace(/^\s*(?:do you have|do you sell|i want|i need|can i get|can i have)\s+/i,'')
    .replace(/\s+(?:do you have|have you got) (?:one|it|this)\s*$/i,'')
    .replace(/^\s*(?:a|an|the)\s+/i,' ')
    .replace(/[?.!,]/g,' ').replace(/\s+/g,' ').trim() || 'that item';
}
function isRelevantAlternative(requested,product={}){
  const ignored=new Set(['i','am','is','are','a','an','the','for','my','your','do','you','have','want','need','one','it','this','looking','searching','get','can','with','of','what','kon','si','hain','ap','k','pass','mujhy','aik','yeh','btao','bta']);
  const tokens=normalizeText(cleanRequestedText(requested)).split(' ').filter(token=>token.length>2&&!ignored.has(token));
  const productText=normalizeText([product.name,product.description,...(product.aliases||[]),...(product.tags||[])].join(' '));
  // v22.1: Fixed plural→singular conversion. Old: "watches"→"watche" (wrong).
  // New: handles "ies"→"y", "ches"→"ch", "shes"→"sh", "ses"→"s", "s"→"".
  const singular=value=>{
    if(/ies$/i.test(value))return value.slice(0,-3)+'y';  // "categories"→"category"
    if(/ches$/i.test(value))return value.slice(0,-2);       // "watches"→"watch"
    if(/shes$/i.test(value))return value.slice(0,-2);      // "wishes"→"wish"
    if(/ses$/i.test(value))return value.slice(0,-2);        // "houses"→"house"
    if(/xes$/i.test(value))return value.slice(0,-2);       // "boxes"→"box"
    if(/zes$/i.test(value))return value.slice(0,-2);       // "buzzes"→"buzz"
    if(/s$/i.test(value)&&!/ss$/i.test(value))return value.slice(0,-1); // "shirts"→"shirt"
    return value;
  };
  return tokens.some(token=>productText.split(' ').some(candidate=>singular(candidate)===singular(token)));
}
function isExactRequestedProductPhrase(value,product){
  const core=normalizeText(normalizeCatalogRequest(String(value||'')));
  return [product.name,...(product.aliases||[])].some(candidate=>normalizeText(candidate)===core);
}
function unmatchedCategoryDescriptors(text){
  const normalized=normalizeText(text),out=[];
  if(/\b(old[ -]?style|vintage|retro)\b/.test(normalized))out.push('style');
  return out;
}
function hasIdentityModifier(text){
  return /\b(skinny|slim|bootcut|straight|cargo|formal|maxi|girls?|boys?|women|mens?|men)\b/.test(normalizeText(text));
}
function catalogIdentityTerms(value){
  const ignored=new Set(['i','we','a','an','the','my','your','to','for','from','of','in','into','do','you','have','want','need','please','add','buy','purchase','order','get','can','could','would','show','me','cart','item','product','products','color','colour','size','black','white','blue','navy','brown','silver','gold','rs','chahiye','chahiyy','chahy','mujhe','mujhy','mujhay','kro','kar','do']);
  return normalizeText(value).split(' ').filter(token=>token.length>=3&&!ignored.has(token)&&!/^\d+$/.test(token)&&!/^rs\d+$/.test(token));
}
function findUnmatchedProductModifiers(text,result){
  // Domain-semantic modifiers that materially change product identity. They
  // cannot be discarded just because a broader product token matched.
  const identityModifiers=new Set(['skinny','slim','maxi','bootcut','straight-fit','straight','cargo','formal','girls','boys','women','mens','men']);
  const productText=normalizeText(result?.product?.name||'');
  return normalizeText(text).split(' ').filter(token=>identityModifiers.has(token) && !productText.includes(token));
}
module.exports = { CatalogConversationAdapter, CATEGORY_ALIASES, PRODUCT_FAMILIES };
