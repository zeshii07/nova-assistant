const { BaseCapability } = require("../../../packages/capability-sdk/src/baseCapability");
const { createCapabilityResult } = require("../../../packages/capability-sdk/src/capabilityResult");
const { normalizeCatalogText } = require("../../../packages/catalog-engine/src/attributeExtractor");
const { normalizeCatalogRequest } = require("../../../packages/catalog-engine/src/productMatcher");

/** Conversational read-only catalog capability. Orders belong to a later capability. */
class CatalogCapability extends BaseCapability {
  async canHandle(context) {
    const text = normalizeCatalogText(context.message.text);
    const selected = context.state.capabilityState?.catalog?.selectedProductId;
    if (selected && isLikelyAttributeFollowUp(text)) return { confidence: 0.995, reason: "catalog_follow_up" };
    if (isBrowseRequest(text) || isExplicitProductRequest(text)) return { confidence: 0.96, reason: "explicit_catalog_request" };
    const result = await context.services.catalogService?.search(context.tenant.id, text);
    return result?.product ? { confidence: 0.92, reason: "catalog_product_evidence" } : { confidence: 0 };
  }

  async execute(context) {
    const catalog = context.services.catalog;
    if (!catalog) throw new Error("Catalog service is unavailable.");
    const text = normalizeCatalogText(context.message.text);
    const language = detectLanguage(context.message.text, context.language);
    const previous = context.state.capabilityState?.catalog || {};

    let searchResult;
    let product;
    let attributes = {};

    // Conversation Intelligence may resolve a generic category request such as
    // "can I get shoes" before Catalog sees the message. Catalog remains the
    // source of truth and only lists products that actually belong to that
    // tenant category.
    const intelligenceIntent = context.intelligence?.selected?.intent;
    const intelligenceEntities = context.intelligence?.entities || {};
    if (intelligenceIntent === "catalog.unavailable_request") {
      const requested=intelligenceEntities.requestedText || cleanRequestedItem(context.message.text);
      const available=await catalog.listProducts();
      const recommendationIds=intelligenceEntities.recommendationIds||[];
      let recommendations=available.filter(x=>recommendationIds.includes(x.id)&&x.inStock);
      if(!recommendations.length && intelligenceEntities.suggestedProductId){
        recommendations=available.filter(x=>x.id===intelligenceEntities.suggestedProductId&&x.inStock);
      }
      const categories=await catalog.listCategories();
      const reply=unavailableWithAlternatives(requested,recommendations,language,{available,categories});
      return result(
        reply,language,
        // An unavailable add-on is informational. Keep an existing product
        // draft intact so the customer can continue or confirm it afterwards.
        {
          ...previous,
          selectedProductId:previous.selectedProductId||null,
          selectedAttributes:previous.selectedProductId?(previous.selectedAttributes||{}):{},
          suggestedProductIds:recommendations.map(x=>x.id)
        },
        "catalog_unavailable",[],
        {intent:"CATALOG_UNAVAILABLE",payload:{
          requested,
          recommendations:recommendations.map(x=>({id:x.id,name:x.name,price:x.price,currency:x.currency})),
          preferLegacyText:true,
          legacyText:reply,
          availableNames:available.filter((item)=>item.inStock).map((item)=>item.name).join(", "),
          categoryNames:categories.map((item)=>item.name).join(", ")
        }}
      );
    }
    if (intelligenceIntent === "catalog.related_browse") {
      const ids=intelligenceEntities.recommendationIds||[];
      const products=(await catalog.listProducts()).filter(x=>ids.includes(x.id)&&x.inStock);
      const reply=formatRelatedProducts(products,language);
      return result(reply,language,{...previous,selectedProductId:null,selectedAttributes:{},suggestedProductIds:products.map(x=>x.id)},"catalog_related_browse",[],{intent:"CATALOG_RELATED_BROWSE",payload:{products,legacyText:reply}});
    }
    if (intelligenceIntent === "catalog.list") {
      const products=await catalog.listProducts();
      const reply=formatProductList(products,language);
      return result(reply,language,{...previous,selectedProductId:null,selectedAttributes:{}},"catalog_list_viewed",[],{intent:"CATALOG_LIST_VIEWED",payload:{products, productLines:products.filter((item)=>item.inStock).map((item)=>`• ${item.name} — ${formatMoney(item.price,item.currency)}`).join("\n")}});
    }
    if (intelligenceIntent === "catalog.goal_selection_required") {
      const ids = intelligenceEntities.goalCandidateIds || context.intelligence?.goal?.nextGoal?.candidateIds || [];
      const products = (await catalog.listProducts()).filter((item) => ids.includes(item.id) && item.inStock);
      const reply = formatGoalSelection(products, language);
      return result(reply, language, { ...previous, selectedProductId:null, selectedAttributes:{}, browsingCategoryId:intelligenceEntities.categoryId || previous.browsingCategoryId || null }, "catalog_goal_selection_required", [{ name:"catalog.goal.selection_required.v1", payload:{ candidateIds:ids } }], { intent:"CATALOG_GOAL_SELECTION_REQUIRED", payload:{ products } });
    }
    if (intelligenceIntent === "catalog.goal_missing_details" && intelligenceEntities.productId) {
      product = await catalog.getProductById(intelligenceEntities.productId);
      if (product) {
        const merged = applyAutomaticSelections(product,previous.selectedProductId === product.id ? (previous.selectedAttributes || {}) : {});
        const reply = formatProduct(product, merged, language);
        return result(reply, language, { selectedProductId:product.id, selectedAttributes:merged }, "catalog_goal_missing_details", [{ name:"catalog.goal.details_required.v1", payload:{ productId:product.id } }], { intent:"CATALOG_PRODUCT_VIEWED", payload:{ product, selected:merged, legacyText:reply } });
      }
    }
    if (intelligenceIntent === "catalog.family_browse" && intelligenceEntities.productFamily) {
      const all = await catalog.listProducts();
      const terms = intelligenceEntities.familyTerms || [];
      const familyProducts=all.filter((item) => item.inStock && terms.some((term) => (` ${normalizeCatalogText(item.name)} `).includes(` ${normalizeCatalogText(term)} `)));
      const products = applyBrowseFilters(familyProducts, intelligenceEntities.filters);
      const reply = products.length || !Object.keys(intelligenceEntities.filters||{}).length
        ? formatFamilyProducts(intelligenceEntities.productFamily, products, language, intelligenceEntities.filters)
        : formatNoFamilyFilterMatch(intelligenceEntities.productFamily,familyProducts,language,intelligenceEntities.filters);
      return result(reply, language, { selectedProductId:null, selectedAttributes:{}, suggestedProductIds:[], browsingCategoryId:null, browsingFamily:intelligenceEntities.productFamily }, "catalog_family_viewed", [], { intent:"CATALOG_FAMILY_VIEWED", payload:{ family:intelligenceEntities.productFamily, products } });
    }
    if (intelligenceIntent === "catalog.category_browse" && intelligenceEntities.categoryId) {
      const products = applyBrowseFilters((await catalog.listProducts()).filter((item) => item.inStock && item.category === intelligenceEntities.categoryId), intelligenceEntities.filters);
      const categories = await catalog.listCategories();
      const category = categories.find((item) => item.id === intelligenceEntities.categoryId);
      const reply = formatCategoryProducts(category, products, language, intelligenceEntities.filters);
      await record(context, "catalog.category_viewed", { categoryId: intelligenceEntities.categoryId, count: products.length });
      return result(reply, language, { selectedProductId:null, selectedAttributes:{}, suggestedProductIds:[], browsingCategoryId:intelligenceEntities.categoryId, browsingFamily:null }, "catalog_category_viewed", [{ name: "catalog.responded.v1", payload: { action: "category", categoryId: intelligenceEntities.categoryId } }], {
        intent: "CATALOG_CATEGORY_VIEWED",
        payload: { categoryName: category?.name || intelligenceEntities.categoryId, productLines: products.map((item) => `• ${item.name} — ${formatMoney(item.price, item.currency)}`).join("\n") }
      });
    }

    // State-first routing applies only to a confirmed attribute follow-up.
    // Conversation Intelligence may explicitly switch subjects (e.g. from
    // Denim Jeans to a white shirt); that new intent must never be swallowed
    // by an old draft merely because the message contains a color/size word.
    if (intelligenceIntent === "catalog.product_interest" && intelligenceEntities.productId) {
      product = await catalog.getProductById(intelligenceEntities.productId);
      attributes = {
        ...(intelligenceEntities.color ? { color:intelligenceEntities.color } : {}),
        ...(intelligenceEntities.size ? { size:intelligenceEntities.size } : {}),
        ...(intelligenceEntities.quantity ? { quantity:intelligenceEntities.quantity } : {})
      };
      if (!Object.keys(attributes).length) {
        searchResult = await catalog.search(text);
        attributes = searchResult.attributes || {};
      }
    } else if (previous.selectedProductId && (intelligenceIntent === "catalog.attribute_update" || (!intelligenceIntent && isLikelyAttributeFollowUp(text)))) {
      product = await catalog.getProductById(previous.selectedProductId);
      if (product) {
        searchResult = await catalog.search(`${product.name} ${text}`);
        attributes = { ...(searchResult.attributes || {}) };
        for (const key of ['color','size','quantity']) if (intelligenceEntities[key] != null) attributes[key]=intelligenceEntities[key];
      }
    } else {
      searchResult = await catalog.search(text);
      product = searchResult.product;
      attributes = searchResult.attributes || {};
    }

    // A sentence may contain a generic word such as "products" and a concrete
    // item name. Concrete product evidence wins; pure browse requests list all.
    if (!product && isBrowseRequest(text)) {
      const products = await catalog.listProducts();
      const reply = formatProductList(products, language);
      await record(context, "catalog.list_viewed", { count: products.length });
      return result(reply, language, { ...previous, selectedProductId: null, selectedAttributes: {} }, "catalog_list_viewed", [{ name: "catalog.responded.v1", payload: { action: "list" } }], {
        intent: "CATALOG_LIST_VIEWED",
        payload: { products, productLines: products.filter((item) => item.inStock).map((item) => `• ${item.name} — ${formatMoney(item.price, item.currency)}`).join("\n") }
      });
    }

    if (!product) {
      const requested = context.intelligence?.entities?.requestedText || cleanRequestedItem(context.message.text);
      await record(context, "catalog.product_unavailable", { query: requested });
      const available = await catalog.listProducts();
      const categories = await catalog.listCategories();
      const categoryNames = categories.map((item) => item.name).join(", ");
      return result(unavailableReply(requested, available, categories, language), language, previous, "catalog_unavailable", [{ name: "catalog.product.unavailable.v1", payload: { query: requested } }], {
        intent: "CATALOG_UNAVAILABLE",
        payload: { requested, availableNames: available.filter((item) => item.inStock).map((item) => item.name).join(", "), categoryNames,preferLegacyText:true,legacyText:unavailableReply(requested,available,categories,language) }
      });
    }

    const merged = applyAutomaticSelections(product,mergeAttributes(previous.selectedProductId === product.id ? previous.selectedAttributes : {}, attributes));
    const validation = await catalog.validateSelection({ productId: product.id, ...merged });
    if (!validation.valid) return result(invalidSelectionReply(validation, product, language, merged), language, previous, "catalog_invalid_selection");

    await context.services.memory?.setPreference("lastProductViewed", product.id);
    if (merged.color) await context.services.memory?.setPreference("preferredColor", merged.color);
    await record(context, "catalog.product_viewed", { productId: product.id, attributes: merged });

    // Once a purchasable configuration is complete, synchronize it into the
    // canonical Commerce cart. Goal/Catalog state is conversational context;
    // Commerce is the single source of truth for transactional cart state.
    const complete = merged.quantity && (!product.colors.length || merged.color) && (!product.sizes.length || merged.size);
    if (complete && context.services.commerce?.syncItem) {
      await context.services.commerce.syncItem({ productId:product.id, variantId:validation.variant?.id||null, sku:validation.sku, name:product.name, color:merged.color || null, size:merged.size || null, quantity:merged.quantity, unitPrice:validation.unitPrice, currency:validation.currency, inventory:validation.variant?validation.variant.inventory:null, variantSelectionRequired:Boolean(product.colors.length||product.sizes.length) });
    }

    const reply = formatProduct(product, merged, language, {availabilityIntro:previous.selectedProductId!==product.id});
    return result(reply, language, { selectedProductId:product.id, selectedAttributes:merged, suggestedProductIds:[], browsingCategoryId:null, browsingFamily:null }, "catalog_product_viewed", [
      { name: "catalog.product.viewed.v1", payload: { productId: product.id, attributes: merged } },
      { name: "catalog.responded.v1", payload: { action: "product_detail", productId: product.id } }
    ], { intent: "CATALOG_PRODUCT_VIEWED", payload: { product, selected: merged, legacyText: reply } });
  }
}
function result(reply, language, catalogState, lastIntent, events = [], responseModel = null) {
  return createCapabilityResult({ handled: true, reply, confidence: 0.98, responseModel, statePatch: { language, activePlugin: "catalog", lastIntent, capabilityState: { catalog: catalogState } }, events });
}
function mergeAttributes(previous, next) { const output = { ...(previous || {}) }; for (const [key, value] of Object.entries(next || {})) if (value !== null && value !== undefined) output[key] = value; return output; }
function isBrowseRequest(text) {
  const normalized=String(text||'').replace(/\bwht\b/g,'what');
  return /\b(show|list|browse|catalog|products|items|collection|what do you sell|what products|which products|kya milta|kya kya hai|kia kia hai|kia kia milta|kon se products|kon sy products|konsay products|ap k pass kia kia|aap ke paas kya kya|products dikhao|مصنوعات|کیا بیچتے|کیا کیا ہے)\b/.test(normalized);
}
function isExplicitProductRequest(text) { return /\b(do you have|have you got|price of|how much|i want|i need|looking for|buy|purchase|mujhe|chahiye|ap k pass|aap ke paas|kitne ka|قیمت|مجھے|چاہیے|آپ کے پاس)\b/.test(text); }
function isLikelyAttributeFollowUp(text) {
  const value = String(text || "").trim();
  const attributeWords = /\b(black|blck|white|blue|navy|brown|silver|gold|small|medium|large|xl|xxl|kala|safed|neela|bara|chota|کالا|سفید|نیلا|بڑا|چھوٹا)\b/;
  const quantityWords = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch|che|chay|saat|aath|nau|das|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس)\b/;
  const correctionOrOrder = /\b(i meant|i said|make it|change it|i want|i need|order|pieces?|pcs?|quantity|qty|kar dein|kardo|chahiye)\b/;
  if (attributeWords.test(value)) return true;
  if (quantityWords.test(value) && (correctionOrOrder.test(value) || /^\d{1,3}$/.test(value) || /^(one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch|che|chay|saat|aath|nau|das|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس)$/.test(value))) return true;
  return /^(s|m|l|xl|xxl)$/.test(value);
}
function detectLanguage(original, fallback) { if (/[\u0600-\u06FF]/.test(original)) return "urdu"; if (/\b(aap|ap|mujhe|chahiye|hai|kya|kitne|kala|safed|bara|chota)\b/i.test(original)) return "roman_urdu"; return fallback || "english"; }
function cleanRequestedItem(value) { return normalizeCatalogRequest(String(value||"")).replace(/[?.!,]/g," ").replace(/\s+/g," ").trim() || "that item"; }
function formatProduct(product, selected, language, options={}) {
  const intro=options.availabilityIntro
    ? (language==="urdu"
        ? `جی ہاں 😊 ہمارے پاس ${product.name} دستیاب ہے۔`
        : language==="roman_urdu"
          ? `Ji haan 😊 ${product.name} available hai.`
          : `Yes 😊 We have ${product.name} available.`)
    : null;
  const lines = [intro, `📦 *${product.name}*`, product.description, `💰 ${formatMoney(product.price, product.currency)}`].filter(Boolean);
  if (product.sizes.length) lines.push(`📏 ${label(language, "sizes")}: ${product.sizes.join(", ")}`);
  if (product.colors.length) lines.push(`🎨 ${label(language, "colors")}: ${product.colors.join(", ")}`);
  lines.push(`✅ ${product.inStock ? label(language, "inStock") : label(language, "outOfStock")}`);
  if (selected.color) lines.push(`✅ ${label(language, "selectedColor")}: ${selected.color}`);
  if (selected.size) lines.push(`✅ ${label(language, "selectedSize")}: ${selected.size}`);
  if (selected.quantity) lines.push(`✅ ${label(language, "quantity")}: ${selected.quantity}`);
  if (selected.quantity) lines.push(`💵 ${label(language, "subtotal")}: ${formatMoney(product.price * selected.quantity, product.currency)}`);
  const missing=[];
  if(!selected.color&&product.colors.length)missing.push('color');
  if(!selected.size&&product.sizes.length)missing.push('size');
  if(!selected.quantity)missing.push('quantity');
  if(missing.length)lines.push("",combinedAttributeQuestion(product,missing,language));
  else lines.push("", language === "urdu" ? "تفصیلات مکمل ہیں۔ آرڈر کی تصدیق کر دیں یا جو چیز بدلنی ہو بتا دیں۔" : language === "roman_urdu" ? "Details complete hain. Order confirm kar dein, ya jo cheez change karni ho bata dein." : "Everything is ready. Confirm the order or tell me what you would like to change.");
  return lines.filter((line) => line !== undefined).join("\n");
}
function formatRelatedProducts(products,language){
  if(!products.length) return language==='roman_urdu' ? 'Is type ka koi aur available option filhal nahi hai.' : 'I don’t see another available option of that type right now.';
  if(products.length===1){
    const p=products[0];
    return language==='roman_urdu'
      ? `Is type mein filhal aik available option hai:\n• ${p.name} — ${formatMoney(p.price,p.currency)}\n\nAgar isay dekhna ho to naam bata dein.`
      : `Right now we have one matching option:\n• ${p.name} — ${formatMoney(p.price,p.currency)}\n\nTell me its name if you'd like to see the details.`;
  }
  return [
    language==='roman_urdu'?'Is type mein ye available options hain:':'Here are the matching available options:',
    ...products.map(p=>`• ${p.name} — ${formatMoney(p.price,p.currency)}`),
    '',
    language==='roman_urdu'?'Jo pasand ho uska naam bata dein.':'Tell me which one you would like to see.'
  ].join('\n');
}

function formatProductList(products, language) {
  const heading = language === "urdu" ? "دستیاب مصنوعات:" : language === "roman_urdu" ? "Available products:" : "Available products:";
  return [heading, ...products.filter((item) => item.inStock).map((item) => `• ${item.name} — ${formatMoney(item.price, item.currency)}`), "", language === "urdu" ? "کسی مصنوع کی تفصیل کے لیے اس کا نام لکھیں۔" : language === "roman_urdu" ? "Kisi product ki detail ke liye uska naam likhein." : "Mention a product name to see its details."].join("\n");
}
function formatCategoryProducts(category, products, language, filters = {}) {
  const name = category?.name || "Products";
  const filterLabel = browseFilterLabel(filters);
  const displayName = filterLabel ? `${filterLabel} ${name}` : name;
  const lines = products.map((item) => `• ${item.name} — ${formatMoney(item.price, item.currency)}`);
  if (!lines.length) return language === "roman_urdu" ? `${displayName} mein filhal koi item available nahi hai.` : `There are no available items in ${displayName} right now.`;
  if (language === "urdu") return [`${displayName} میں یہ مصنوعات دستیاب ہیں:`, ...lines, "", "جس چیز کی تفصیل چاہیے اس کا نام بتا دیں۔"].join("\n");
  if (language === "roman_urdu") return [`Ji 😊 ${displayName} mein ye options available hain:`, "", ...lines, "", "Jo item pasand ho uska naam bata dein."].join("\n");
  return [`Here are the available ${displayName} options:`, "", ...lines, "", "Tell me which one you'd like to see."].join("\n");
}

function formatFamilyProducts(family, products, language, filters = {}) {
  const labelName = family === 'shirts' ? 'shirts' : family;
  const filterLabel=browseFilterLabel(filters); const displayName=filterLabel?`${filterLabel} ${labelName}`:labelName;
  const lines=products.map((item)=>`• ${item.name} — ${formatMoney(item.price,item.currency)}`);
  if (!lines.length) return language==='roman_urdu' ? `Maazrat, ${labelName} mein filhal koi option available nahi hai.` : `Sorry, there are no ${labelName} available right now.`;
  if (language==='roman_urdu') return [`Ji 😊 ${displayName} mein ye options available hain:`, '', ...lines, '', 'Jo pasand ho uska naam bata dein.'].join('\n');
  return [`Sure 😊 Here are the ${displayName} we have:`, '', ...lines, '', `Tell me which one you'd like to see.`].join('\n');
}



function formatNoFamilyFilterMatch(family, products, language, filters={}){
  const wanted=browseFilterLabel(filters);
  const rows=products.map(item=>`• ${item.name}${item.sizes?.length?` — Sizes: ${item.sizes.join(', ')}`:''}${item.colors?.length?` — Colors: ${item.colors.join(', ')}`:''}`);
  if(language==='roman_urdu') return [`Maazrat 😊 ${family} mein ${wanted} ka exact option nahi mila.`, '', 'Available options:', ...rows].join('\n');
  return [`Sorry 😊 I don’t see a ${wanted} option in ${family}.`, '', 'Available options:', ...rows].join('\n');
}

function applyBrowseFilters(products, filters = {}) {
  return (products || []).filter((item) => {
    if (filters.color && !(item.colors || []).some((v) => normalizeCatalogText(v) === normalizeCatalogText(filters.color))) return false;
    if (filters.size && !(item.sizes || []).some((v) => normalizeCatalogText(v) === normalizeCatalogText(filters.size))) return false;
    return true;
  });
}
function browseFilterLabel(filters = {}) { return [filters.color, filters.size ? `size ${filters.size}` : null].filter(Boolean).join(' '); }

function unavailableWithAlternatives(requested,recommendations,language,{available=[],categories=[]}={}){
  const first = language==="urdu"
    ? `معذرت، ${requested} اس وقت دستیاب نہیں ہے۔`
    : language==="roman_urdu"
      ? `Maazrat 😊 ${requested} filhal available nahi hai.`
      : `Sorry 😊 The requested item “${requested}” is not available in our catalog right now.`;
  if(!recommendations?.length){
    return unavailableOverview(first,available,categories,language);
  }
  const heading = language==="roman_urdu"
    ? "Lekin ye qareebi available options dekh sakte hain:"
    : language==="urdu"
      ? "البتہ یہ ملتے جلتے دستیاب آپشنز دیکھ سکتے ہیں:"
      : "You may want to consider these similar available options:";
  const lines=recommendations.map(p=>{
    const desc=String(p.description||'').trim();
    return `• *${p.name}* — ${formatMoney(p.price,p.currency)}${desc?`\n  ${desc}`:''}`;
  });
  const close = language==="roman_urdu"
    ? "Agar in mein se koi pasand ho to uska naam bata dein. Main aapki ijazat ke baghair koi alternative select nahi karunga."
    : language==="urdu"
      ? "اگر ان میں سے کوئی پسند ہو تو اس کا نام بتا دیں۔ میں آپ کی اجازت کے بغیر کوئی متبادل منتخب نہیں کروں گا۔"
      : "If one of these works for you, tell me its name. I won't select an alternative unless you choose it.";
  return [first,"",heading,...lines,"",close].join("\n");
}

function unavailableReply(requested, products, categories, language) {
  const first=language==='urdu'?`معذرت، ہمارے کیٹلاگ میں ${requested} دستیاب نہیں ہے۔`:language==='roman_urdu'?`Maazrat 😊 Hamare catalog mein ${requested} available nahi hai.`:`Sorry 😊 We don’t currently carry ${requested}.`;
  return unavailableOverview(first,products,categories,language);
}
function unavailableOverview(first,products=[],categories=[],language='english'){
  const categoryNames=categories.map(item=>item.name).join(', ');
  const examples=products.filter(item=>item.inStock).slice(0,6).map(item=>`• ${item.name} — ${formatMoney(item.price,item.currency)}`);
  const heading=language==='urdu'?`آپ یہ کیٹیگریز دیکھ سکتے ہیں: ${categoryNames}`:language==='roman_urdu'?`Aap ye categories browse kar sakte hain: ${categoryNames}`:`You can browse these categories: ${categoryNames}`;
  const popular=language==='urdu'?'چند دستیاب مصنوعات:':language==='roman_urdu'?'Kuch available products:':'A few available products:';
  const close=language==='urdu'?'کسی کیٹیگری یا مصنوع کا نام بتائیں، میں اس کی مکمل تفصیل دکھا دوں گا۔':language==='roman_urdu'?'Kisi category ya product ka naam bata dein, main poori details dikha dunga.':'Tell me a category or product name and I’ll show its full details.';
  return [first,'',heading,'',popular,...examples,'',close].join('\n');
}
function invalidSelectionReply(validation, product, language, attempted = {}) {
  const reason = validation?.reason;
  if (reason === "invalid_color") return language === "roman_urdu" ? `Maazrat 😊 Yeh color available nahi hai. Available colors: ${product.colors.join(", ")}` : `Sorry 😊 That color isn't available. Available colors: ${product.colors.join(", ")}.`;
  if (reason === "invalid_size") return language === "roman_urdu" ? `Maazrat 😊 Yeh size available nahi hai. Available sizes: ${product.sizes.join(", ")}` : `Sorry 😊 That size isn't available. Available sizes: ${product.sizes.join(", ")}.`;
  if (reason === "insufficient_inventory") {
    const available = Number(validation.availableQuantity || product.inventory || 0);
    if (language === "urdu") return `معذرت 😊 اس انتخاب میں صرف ${available} دستیاب ہیں۔ آپ زیادہ سے زیادہ ${available} آرڈر کر سکتے ہیں۔\n\nکتنی تعداد چاہیے؟`;
    if (language === "roman_urdu") return `Maazrat 😊 Is selection mein sirf ${available} available hain. Aap maximum ${available} order kar sakte hain.\n\nQuantity kitni chahiye?`;
    return `Sorry 😊 We only have ${available} available in this selection. You can order up to ${available}.\n\nHow many would you like?`;
  }
  if (reason === "invalid_quantity") return language === "roman_urdu" ? "Maazrat 😊 Quantity valid number mein batayein." : "Sorry 😊 Please enter a valid quantity.";
  return language === "roman_urdu" ? "Maazrat 😊 Yeh selection available nahi hai." : "Sorry 😊 That selection isn't available.";
}
function question(language, field, options = []) {
  if (language === "urdu") return field === "color" ? `کون سا رنگ چاہیے؟ ${options.join(", ")}` : field === "size" ? `کون سا سائز چاہیے؟ ${options.join(", ")}` : "کتنی تعداد چاہیے؟";
  if (language === "roman_urdu") return field === "color" ? `Kaunsa color chahiye? ${options.join(", ")}` : field === "size" ? `Kaunsa size chahiye? ${options.join(", ")}` : "Quantity kitni chahiye?";
  return field === "color" ? `What color would you like: ${options.join(", ")}?` : field === "size" ? `What size would you like: ${options.join(", ")}?` : "How many would you like?";
}
function applyAutomaticSelections(product,selected={}){
  const next={...(selected||{})};
  // A sole configured value is not a customer decision. Selecting it here
  // keeps this behavior universal for every present and future retail tenant.
  if(!next.color&&product?.colors?.length===1)next.color=product.colors[0];
  if(!next.size&&product?.sizes?.length===1)next.size=product.sizes[0];
  return next;
}
function combinedAttributeQuestion(product,missing,language){
  if(missing.length===1)return question(language,missing[0],missing[0]==='color'?product.colors:missing[0]==='size'?product.sizes:[]);
  const fields=missing.join(', ').replace(/, ([^,]+)$/,' and $1');
  const options=[missing.includes('color')?`Colors: ${product.colors.join(', ')}`:null,missing.includes('size')?`Sizes: ${product.sizes.join(', ')}`:null].filter(Boolean).join('. ');
  const example=[missing.includes('color')?product.colors[0]:null,missing.includes('size')?product.sizes[0]:null,missing.includes('quantity')?'2 pieces':null].filter(Boolean).join(', ');
  if(language==='urdu')return `براہِ کرم ${fields} ایک ہی پیغام میں بھیجیں۔ ${options}۔ مثال: “${example}”`;
  if(language==='roman_urdu')return `Meherbani karke ${fields} aik hi message mein bhej dein. ${options}. Misal: “${example}”`;
  return `Please send the ${fields} together in one message. ${options}. For example: “${example}”.`;
}
function label(language, key) {
  const values = {
    english: { sizes: "Sizes", colors: "Colors", inStock: "In stock", outOfStock: "Out of stock", selectedColor: "Color", selectedSize: "Size", quantity: "Quantity", subtotal: "Subtotal" },
    roman_urdu: { sizes: "Sizes", colors: "Colors", inStock: "Stock mein", outOfStock: "Stock mein nahi", selectedColor: "Color", selectedSize: "Size", quantity: "Quantity", subtotal: "Subtotal" },
    urdu: { sizes: "سائز", colors: "رنگ", inStock: "اسٹاک میں موجود", outOfStock: "اسٹاک میں نہیں", selectedColor: "رنگ", selectedSize: "سائز", quantity: "تعداد", subtotal: "ذیلی کل" }
  };
  return (values[language] || values.english)[key];
}
function formatMoney(amount, currency) { return `${currency === "PKR" ? "Rs" : currency + " "}${Number(amount).toLocaleString("en-US")}`; }
async function record(context, type, data) { await context.services.crm?.recordActivity(type, data); }

function formatGoalSelection(products, language) {
  if (!products.length) return language === "roman_urdu" ? "Is category mein filhal koi option available nahi hai." : "There are no available options in that category right now.";
  const lines = products.map((p) => `• ${p.name} — ${formatMoney(p.price, p.currency)}`);
  if (language === "roman_urdu") return `Ji 😊 Order start karne ke liye pehle product choose kar dein:\n\n${lines.join("\n")}\n\nKonsa product order karna hai?`;
  if (language === "urdu") return `آرڈر شروع کرنے کے لیے پہلے پروڈکٹ منتخب کریں:\n\n${lines.join("\n")}\n\nکون سا پروڈکٹ آرڈر کرنا ہے؟`;
  return `Sure 😊 Before I start the order, which product would you like?\n\n${lines.join("\n")}\n\nTell me the product name.`;
}
module.exports = { Capability: CatalogCapability, CatalogCapability };
