/**
 * Converts the legacy split service/pricing files into one Control Plane
 * document. Customer-facing service metadata and every executable price rule
 * live in this document; runtime compatibility fields are derived, never
 * edited as a second source of truth.
 */
function unifyServiceDocument(document = {}, legacyPricing = {}) {
  const kind = document.kind === "cleaning" ? "cleaning" : "offering";
  const sourceItems = Array.isArray(document.items) ? document.items : [];
  const configuredRules = Array.isArray(document.pricingRules)
    ? document.pricingRules
    : Array.isArray(document.pricing?.rules)
      ? document.pricing.rules
      : Array.isArray(legacyPricing.services)
        ? legacyPricing.services
        : [];
  const currency = String(document.currency || legacyPricing.currency || firstCurrency(sourceItems) || "USD").toUpperCase();
  const rules = new Map(configuredRules.map((rule) => [String(rule.id || "").trim(), normalizeRule(rule, currency)]).filter(([id]) => id));

  const items = sourceItems.map((source) => {
    const item = structuredClone(source || {});
    let pricingRuleIds = uniqueStrings(item.pricingRuleIds || [item.pricingRuleId, item.pricingServiceId].filter(Boolean));
    if (!pricingRuleIds.length) {
      pricingRuleIds = configuredRules
        .filter((rule) => String(rule.operationalServiceId || rule.bookingServiceId || rule.serviceId || "") === String(item.id || ""))
        .map((rule) => String(rule.id));
    }
    if (!pricingRuleIds.length) {
      const generated = legacyRuleFromItem(item, currency);
      rules.set(generated.id, generated);
      pricingRuleIds = [generated.id];
    }
    for (const ruleId of pricingRuleIds) {
      if (!rules.has(ruleId)) {
        const generated = legacyRuleFromItem({ ...item, pricingServiceId:ruleId }, currency);
        rules.set(ruleId, { ...generated, id:ruleId });
      }
    }
    if (typeof item.description === "string") item.description=stripLegacyPriceClaim(item.description);
    for (const key of ["price","currency","priceType","pricingServiceId","pricingRuleId","requiredPricingFields","pricePrefix","unitLabel","sourceBenchmark","packages"]) delete item[key];
    item.pricingRuleIds = pricingRuleIds;
    return item;
  });

  const { pricingPolicy, pricing, pricingRules, services, items:ignoredItems, addOns, discounts, currency:ignoredCurrency, ...rest } = document;
  return {
    ...rest,
    kind,
    currency,
    items,
    pricingRules:[...rules.values()],
    addOns:structuredClone(Array.isArray(document.addOns) ? document.addOns : Array.isArray(legacyPricing.addOns) ? legacyPricing.addOns : []),
    discounts:structuredClone(Array.isArray(document.discounts) ? document.discounts : Array.isArray(legacyPricing.discounts) ? legacyPricing.discounts : [])
  };
}

function pricingConfigFromServiceDocument(document = {}) {
  const unified = unifyServiceDocument(document);
  return {
    currency:unified.currency,
    services:structuredClone(unified.pricingRules || []),
    addOns:structuredClone(unified.addOns || []),
    discounts:structuredClone(unified.discounts || [])
  };
}

function hydrateRuntimeServices(document = {}) {
  const unified = unifyServiceDocument(document);
  const rules = new Map((unified.pricingRules || []).map((rule) => [rule.id,rule]));
  return (unified.items || []).map((source) => {
    const item=structuredClone(source),rule=rules.get(item.pricingRuleIds?.[0]) || null;
    return {
      ...item,
      price:displayPrice(rule),
      currency:rule?.currency || unified.currency,
      priceType:runtimePriceType(rule),
      pricingServiceId:rule?.id || null,
      requiredPricingFields:requiredFields(rule),
      pricePrefix:rule?.model === "starting_from" ? "From " : "",
      unitLabel:rule?.unitLabel || item.unitLabel
    };
  });
}

function normalizeRule(source = {}, defaultCurrency = "USD") {
  const rule=structuredClone(source);
  rule.id=String(rule.id || "").trim();
  rule.name=String(rule.name || rule.id || "Pricing rule").trim();
  rule.model=String(rule.model || "flat").trim().toLowerCase();
  rule.currency=String(rule.currency || defaultCurrency).trim().toUpperCase();
  rule.aliases=uniqueStrings(rule.aliases || []);
  return rule;
}

function legacyRuleFromItem(item = {}, defaultCurrency = "USD") {
  const inferredType=/^\s*from\b/i.test(String(item.pricePrefix || "")) ? "starting_from" : item.price == null ? "custom_quote" : "fixed";
  const priceType=String(item.priceType || inferredType).toLowerCase();
  const id=String(item.pricingServiceId || `service:${item.id || "unknown"}`).trim();
  const common={id,name:String(item.name || id),aliases:uniqueStrings(item.aliases || []),currency:String(item.currency || defaultCurrency).toUpperCase(),operationalServiceId:item.id || null};
  if(priceType === "hourly")return {...common,model:"hourly",rate:Number(item.price || 0)};
  if(priceType === "per_item")return {...common,model:"unit",rate:Number(item.price || 0),unitLabel:"items"};
  if(priceType === "custom_quote" || item.price == null)return {...common,model:"custom_quote"};
  if(priceType === "scope_based" || priceType === "starting_from")return {...common,model:"starting_from",price:Number(item.price || 0)};
  return {...common,model:"flat",price:Number(item.price || 0)};
}

function displayPrice(rule){
  if(!rule)return null;
  if(rule.model === "hourly" || rule.model === "unit")return finite(rule.rate);
  if(rule.model === "linear")return finite(rule.basePrice);
  if(rule.model === "matrix"){
    const values=Object.values(rule.prices || {}).map(Number).filter(Number.isFinite);
    return values.length ? Math.min(...values) : null;
  }
  if(rule.model === "flat" || rule.model === "starting_from")return finite(rule.price);
  return null;
}
function runtimePriceType(rule){
  if(!rule || rule.model === "custom_quote")return "custom_quote";
  if(rule.model === "hourly")return "hourly";
  if(rule.model === "unit")return "per_item";
  if(["matrix","linear"].includes(rule.model))return "scope_based";
  if(rule.model === "starting_from")return "starting_from";
  return "fixed";
}
function requiredFields(rule){
  if(!rule)return [];
  if(rule.model === "hourly")return ["durationHours"];
  if(rule.model === "unit")return [rule.inputKey || "units"];
  if(rule.model === "linear")return [rule.inputKey || "quantity"];
  if(rule.model === "matrix")return [...(rule.keys || [])];
  return [];
}
function firstCurrency(items){return (items || []).find((item) => item?.currency)?.currency || null;}
function finite(value){const number=Number(value);return Number.isFinite(number)?number:null;}
function uniqueStrings(values){return [...new Set((values || []).map((value)=>String(value || "").trim()).filter(Boolean))];}
function stripLegacyPriceClaim(value){
  return String(value).replace(/,?\s*charged at\s+(?:AED|PKR|USD|Rs|\$|€|£)\s*\d+(?:\.\d+)?(?:\s+per\s+[^.;]+)?(?=[.;]|$)/ig,"").replace(/\s+([.;])/g,"$1").trim();
}

module.exports={unifyServiceDocument,pricingConfigFromServiceDocument,hydrateRuntimeServices,legacyRuleFromItem};
