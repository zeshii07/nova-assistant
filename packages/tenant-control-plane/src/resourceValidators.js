const { parseHours } = require("../../service-availability/src/staticBusinessHoursProvider");

const PRICING_MODELS = new Set(["flat", "hourly", "unit", "matrix", "linear", "custom_quote", "starting_from"]);
const DUPLICATE_SERVICE_PRICE_FIELDS = ["price", "currency", "priceType", "pricingServiceId", "pricingRuleId", "requiredPricingFields", "pricePrefix", "unitLabel", "packages"];
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function validateResource(resourceType, document, context = {}) {
  const errors = [];
  const warnings = [];
  if (resourceType === "profile") validateProfile(document, context, errors, warnings);
  else if (resourceType === "products") validateProducts(document, context, errors, warnings);
  else if (resourceType === "services") validateServices(document, context, errors, warnings);
  else if (resourceType === "hours") validateHours(document, errors, warnings);
  else if (resourceType === "calendar") validateCalendar(document, context, errors, warnings);
  else errors.push({ path: "$", code: "unsupported_resource", message: `Unsupported resource '${resourceType}'.` });
  return { valid: errors.length === 0, errors, warnings };
}

function validateProfile(value, context, errors) {
  if (!isObject(value)) return error(errors, "$", "invalid_type", "Profile must be an object.");
  requiredString(value, "id", errors);
  requiredString(value, "name", errors);
  requiredString(value, "status", errors);
  if (value.id && value.id !== context.tenantId) error(errors, "$.id", "immutable_tenant_id", "Profile ID must match the authenticated tenant.");
  if (value.status && value.status !== "active") error(errors, "$.status", "unsupported_status", "This release only publishes active tenant profiles.");
  stringArray(value.capabilities, "$.capabilities", errors, { required: true });
  stringArray(value.permissions, "$.permissions", errors);
  if (value.business != null && !isObject(value.business)) error(errors, "$.business", "invalid_type", "business must be an object.");
  if (value.branding != null && !isObject(value.branding)) error(errors, "$.branding", "invalid_type", "branding must be an object.");
}

function validateProducts(value, context, errors, warnings) {
  if (!Array.isArray(value)) return error(errors, "$", "invalid_type", "Products must be an array.");
  if (!context.capabilities?.includes("catalog")) warning(warnings, "$", "capability_missing", "The tenant profile does not currently enable the catalog capability.");
  const ids = new Set();
  const skus = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const base = `$[${index}]`;
    if (!isObject(item)) { error(errors, base, "invalid_type", "Product must be an object."); continue; }
    requiredString(item, "id", errors, base);
    requiredString(item, "name", errors, base);
    requiredString(item, "category", errors, base);
    if (item.id) unique(ids, item.id, `${base}.id`, "product ID", errors);
    if (item.sku) unique(skus, item.sku, `${base}.sku`, "SKU", errors);
    if (item.category && context.categoryIds && !context.categoryIds.has(item.category)) error(errors, `${base}.category`, "unknown_category", `Unknown category '${item.category}'.`);
    nonNegative(item.price, `${base}.price`, errors, { required: true });
    for (const field of ["pricingRuleId", "pricingRuleIds", "pricingServiceId", "priceType"]) {
      if (Object.hasOwn(item, field)) error(errors, `${base}.${field}`, "duplicate_price_source", `${field} is not allowed on a product. Keep the base price and any variant prices directly in Products & Prices.`);
    }
    if (item.inventory != null) nonNegativeInteger(item.inventory, `${base}.inventory`, errors);
    stringArray(item.aliases, `${base}.aliases`, errors);
    stringArray(item.colors, `${base}.colors`, errors);
    stringArray(item.sizes, `${base}.sizes`, errors);
    stringArray(item.tags, `${base}.tags`, errors);
    if (item.inStock != null && typeof item.inStock !== "boolean") error(errors, `${base}.inStock`, "invalid_type", "inStock must be true or false.");
    if (item.variants != null) {
      if (!Array.isArray(item.variants)) error(errors, `${base}.variants`, "invalid_type", "variants must be an array.");
      else {
        const variantIds = new Set();
        const combinations = new Set();
        for (let variantIndex = 0; variantIndex < item.variants.length; variantIndex += 1) {
          const variant = item.variants[variantIndex];
          const variantBase = `${base}.variants[${variantIndex}]`;
          if (!isObject(variant)) { error(errors, variantBase, "invalid_type", "Variant must be an object."); continue; }
          requiredString(variant, "sku", errors, variantBase);
          if (variant.sku) unique(skus, variant.sku, `${variantBase}.sku`, "SKU", errors);
          if (variant.id) unique(variantIds, variant.id, `${variantBase}.id`, "variant ID", errors);
          nonNegativeInteger(variant.inventory, `${variantBase}.inventory`, errors);
          if (variant.price != null) nonNegative(variant.price, `${variantBase}.price`, errors);
          if (variant.active != null && typeof variant.active !== "boolean") error(errors, `${variantBase}.active`, "invalid_type", "active must be true or false.");
          if (!isObject(variant.attributes) || !Object.keys(variant.attributes).length) error(errors, `${variantBase}.attributes`, "attributes_required", "Variant attributes must identify its option combination.");
          else {
            const normalizedAttributes = {};
            for (const [key, raw] of Object.entries(variant.attributes)) {
              const attribute = String(key).trim().toLowerCase();
              const selected = typeof raw === "string" ? raw.trim() : "";
              if (!attribute || !selected) { error(errors, `${variantBase}.attributes.${key}`, "invalid_value", "Variant attribute values must be non-empty strings."); continue; }
              normalizedAttributes[attribute] = selected.toLowerCase();
              const configured = attribute === "color" ? item.colors : attribute === "size" ? item.sizes : null;
              if (configured && !configured.some((value) => String(value).trim().toLowerCase() === selected.toLowerCase())) error(errors, `${variantBase}.attributes.${key}`, "unknown_attribute_value", `'${selected}' is not in the product ${attribute} options.`);
            }
            if (item.colors?.length && !normalizedAttributes.color) error(errors, `${variantBase}.attributes.color`, "variant_attribute_required", "A color is required for every variant of a product with color options.");
            if (item.sizes?.length && !normalizedAttributes.size) error(errors, `${variantBase}.attributes.size`, "variant_attribute_required", "A size is required for every variant of a product with size options.");
            const combination = JSON.stringify(Object.entries(normalizedAttributes).sort(([left],[right]) => left.localeCompare(right)));
            if (combinations.has(combination)) error(errors, `${variantBase}.attributes`, "duplicate_variant", "Variant option combinations must be unique within a product.");
            else combinations.add(combination);
          }
        }
        if (item.variants.length && item.inventory != null) warning(warnings, `${base}.inventory`, "variant_inventory_authoritative", "This product has variants, so per-variant inventory is authoritative.");
      }
    }
  }
}

function validateServices(value, context, errors, warnings) {
  if (!isObject(value)) return error(errors, "$", "invalid_type", "Services must be an object containing kind, currency, items, and pricingRules.");
  if (!["cleaning", "offering"].includes(value.kind)) error(errors, "$.kind", "invalid_kind", "Service kind must be cleaning or offering.");
  if (context.baselineServiceKind && value.kind !== context.baselineServiceKind) error(errors, "$.kind", "immutable_kind", `Service kind must remain '${context.baselineServiceKind}' for this tenant.`);
  requiredString(value, "currency", errors);
  if (!Array.isArray(value.items)) return error(errors, "$.items", "invalid_type", "Service items must be an array.");
  if (!Array.isArray(value.pricingRules)) return error(errors, "$.pricingRules", "invalid_type", "pricingRules must be an array in the same Services resource.");

  const serviceIds = new Set();
  for (let index = 0; index < value.items.length; index += 1) {
    const id = typeof value.items[index]?.id === "string" ? value.items[index].id.trim().toLowerCase() : "";
    if (id) serviceIds.add(id);
  }
  const pricingRuleIds = new Set();
  for (let index = 0; index < value.pricingRules.length; index += 1) {
    const rule = value.pricingRules[index];
    const base = `$.pricingRules[${index}]`;
    if (!isObject(rule)) { error(errors, base, "invalid_type", "Pricing rule must be an object."); continue; }
    requiredString(rule, "id", errors, base);
    requiredString(rule, "name", errors, base);
    requiredString(rule, "model", errors, base);
    if (rule.id) unique(pricingRuleIds, rule.id, `${base}.id`, "pricing rule ID", errors);
    const model = String(rule.model || "").toLowerCase();
    if (model && !PRICING_MODELS.has(model)) error(errors, `${base}.model`, "invalid_pricing_model", `Unsupported pricing model '${rule.model}'.`);
    if (rule.currency != null && (typeof rule.currency !== "string" || !rule.currency.trim())) error(errors, `${base}.currency`, "invalid_currency", "currency must be a non-empty code.");
    stringArray(rule.aliases, `${base}.aliases`, errors);
    if (["hourly", "unit"].includes(model)) nonNegative(rule.rate, `${base}.rate`, errors, { required: true });
    if (["flat", "starting_from"].includes(model)) nonNegative(rule.price, `${base}.price`, errors, { required: true });
    if (model === "linear") {
      requiredString(rule, "inputKey", errors, base);
      nonNegative(rule.baseInput, `${base}.baseInput`, errors, { required: true });
      if (rule.minimum != null) nonNegative(rule.minimum, `${base}.minimum`, errors);
      nonNegative(rule.basePrice, `${base}.basePrice`, errors, { required: true });
      nonNegative(rule.stepPrice, `${base}.stepPrice`, errors, { required: true });
    }
    if (model === "matrix") {
      stringArray(rule.keys, `${base}.keys`, errors, { required: true });
      if (!isObject(rule.prices) || !Object.keys(rule.prices).length) error(errors, `${base}.prices`, "prices_required", "A matrix pricing rule needs at least one priced combination.");
      else for (const [key, price] of Object.entries(rule.prices)) nonNegative(price, `${base}.prices.${key}`, errors, { required: true });
    }
    if (rule.operationalServiceId && !serviceIds.has(String(rule.operationalServiceId).trim().toLowerCase())) {
      error(errors, `${base}.operationalServiceId`, "unknown_operational_service", `Unknown service '${rule.operationalServiceId}'.`);
    }
  }

  const ids = new Set();
  const referencedRules = new Set();
  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index];
    const base = `$.items[${index}]`;
    if (!isObject(item)) { error(errors, base, "invalid_type", "Service must be an object."); continue; }
    requiredString(item, "id", errors, base);
    requiredString(item, "name", errors, base);
    if (item.id) unique(ids, item.id, `${base}.id`, "service ID", errors);
    stringArray(item.aliases, `${base}.aliases`, errors);
    stringArray(item.tags, `${base}.tags`, errors);
    for (const field of DUPLICATE_SERVICE_PRICE_FIELDS) {
      if (Object.hasOwn(item, field)) error(errors, `${base}.${field}`, "duplicate_price_source", `${field} is not allowed on a service item. Put all charges in this document's pricingRules and reference them with pricingRuleIds.`);
    }
    if (typeof item.description === "string" && /(?:AED|PKR|USD|Rs|\$|€|£)\s*\d/i.test(item.description)) {
      error(errors, `${base}.description`, "duplicate_price_source", "Service descriptions cannot repeat a numeric charge. Keep executable amounts only in pricingRules.");
    }
    stringArray(item.pricingRuleIds, `${base}.pricingRuleIds`, errors, { required: true });
    for (const ruleId of item.pricingRuleIds || []) {
      const normalized = String(ruleId).trim().toLowerCase();
      referencedRules.add(normalized);
      if (!pricingRuleIds.has(normalized)) error(errors, `${base}.pricingRuleIds`, "unknown_pricing_rule", `Unknown pricing rule '${ruleId}'.`);
    }
    if (item.durationMinutes != null) positiveInteger(item.durationMinutes, `${base}.durationMinutes`, errors);
    if (item.bookable != null && typeof item.bookable !== "boolean") error(errors, `${base}.bookable`, "invalid_type", "bookable must be true or false.");
  }
  for (let index = 0; index < value.pricingRules.length; index += 1) {
    const ruleId = String(value.pricingRules[index]?.id || "").trim().toLowerCase();
    if (ruleId && !referencedRules.has(ruleId)) warning(warnings, `$.pricingRules[${index}]`, "unreferenced_pricing_rule", `Pricing rule '${value.pricingRules[index].id}' is not referenced by a service item.`);
  }
  if (value.pricingPolicy != null) error(errors, "$.pricingPolicy", "duplicate_price_source", "Pricing policy text cannot own executable prices. Put policies in Knowledge Manager and numeric charges in Services pricingRules.");
  validatePriceAdjustments(value.addOns, "$.addOns", errors);
  validatePriceAdjustments(value.discounts, "$.discounts", errors);
}

function validatePriceAdjustments(value, path, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) return error(errors, path, "invalid_type", `${path.slice(2)} must be an array.`);
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index], base = `${path}[${index}]`;
    if (!isObject(item)) { error(errors, base, "invalid_type", "Pricing adjustment must be an object."); continue; }
    requiredString(item, "id", errors, base);
    if (item.id) unique(ids, item.id, `${base}.id`, "pricing adjustment ID", errors);
    for (const key of ["price", "rate", "value"]) if (item[key] != null) nonNegative(item[key], `${base}.${key}`, errors);
  }
}

function validateHours(value, errors, warnings) {
  if (!isObject(value)) return error(errors, "$", "invalid_type", "Hours must be an object.");
  const hasText = typeof value.text === "string" && value.text.trim();
  const hasSchedule = isObject(value.schedule);
  if (!hasText && !hasSchedule) return error(errors, "$", "hours_required", "Provide either hours.text or a structured hours.schedule.");
  if (hasText) {
    const parsed = parseHours(value.text);
    if (!Object.values(parsed).some((row) => row?.open)) error(errors, "$.text", "unrecognized_hours", "Hours text must identify at least one open day and time range.");
  }
  if (hasSchedule) {
    let openIntervals = 0;
    for (const [day, intervals] of Object.entries(value.schedule)) {
      if (!DAYS.includes(day.toLowerCase())) { error(errors, `$.schedule.${day}`, "invalid_day", `Unknown weekday '${day}'.`); continue; }
      if (!Array.isArray(intervals)) { error(errors, `$.schedule.${day}`, "invalid_type", "Day schedule must be an array."); continue; }
      for (let index = 0; index < intervals.length; index += 1) {
        const interval = intervals[index];
        const base = `$.schedule.${day}[${index}]`;
        if (!isObject(interval) || !CLOCK.test(String(interval.open || "")) || !CLOCK.test(String(interval.close || ""))) { error(errors, base, "invalid_interval", "Use 24-hour HH:mm open and close values."); continue; }
        if (minutes(interval.close) <= minutes(interval.open)) error(errors, base, "invalid_interval", "Closing time must be after opening time.");
        openIntervals += 1;
      }
    }
    if (!openIntervals) warning(warnings, "$.schedule", "business_always_closed", "The structured schedule has no open intervals.");
  }
  if (value.timezone != null && (typeof value.timezone !== "string" || !value.timezone.trim())) error(errors, "$.timezone", "invalid_timezone", "timezone must be a non-empty IANA timezone name.");
}

function validateCalendar(value, context, errors, warnings) {
  if (!isObject(value)) return error(errors, "$", "invalid_type", "Calendar configuration must be an object.");
  if (typeof value.enabled !== "boolean") error(errors, "$.enabled", "invalid_type", "enabled must be true or false.");
  if (!["disabled", "local", "google_calendar", "microsoft_graph"].includes(String(value.provider || ""))) error(errors, "$.provider", "invalid_provider", "provider must be disabled, local, google_calendar, or microsoft_graph.");
  if (value.enabled && value.provider === "disabled") error(errors, "$.provider", "provider_disabled", "An enabled calendar needs an active provider.");
  if (!value.enabled && value.provider !== "disabled") warning(warnings, "$.provider", "calendar_disabled", "The provider will not be used while the calendar is disabled.");
  if (!validTimezone(value.timezone)) error(errors, "$.timezone", "invalid_timezone", "Use a valid IANA timezone such as Asia/Karachi or Asia/Dubai.");
  boundedInteger(value.defaultDurationMinutes, "$.defaultDurationMinutes", errors, 1, 1440);
  boundedInteger(value.slotIntervalMinutes, "$.slotIntervalMinutes", errors, 5, 240);
  boundedInteger(value.holdTtlSeconds, "$.holdTtlSeconds", errors, 30, 86400);
  boundedInteger(value.minLeadMinutes, "$.minLeadMinutes", errors, 0, 525600);
  boundedInteger(value.maxAdvanceDays, "$.maxAdvanceDays", errors, 1, 3650);
  rejectSecretFields(value, "$", errors);
  if (!Array.isArray(value.resourcePools)) error(errors, "$.resourcePools", "invalid_type", "resourcePools must be an array.");
  else {
    const poolIds = new Set();
    for (let index = 0; index < value.resourcePools.length; index += 1) {
      const pool = value.resourcePools[index], base = `$.resourcePools[${index}]`;
      if (!isObject(pool)) { error(errors, base, "invalid_type", "Resource pool must be an object."); continue; }
      requiredString(pool, "id", errors, base); requiredString(pool, "name", errors, base);
      if (pool.id) unique(poolIds, pool.id, `${base}.id`, "resource pool ID", errors);
      boundedInteger(pool.capacity, `${base}.capacity`, errors, 1, 10000);
      stringArray(pool.serviceIds, `${base}.serviceIds`, errors);
      if (pool.active != null && typeof pool.active !== "boolean") error(errors, `${base}.active`, "invalid_type", "active must be true or false.");
      for (const serviceId of pool.serviceIds || []) if (context.serviceIds && !context.serviceIds.has(serviceId)) warning(warnings, `${base}.serviceIds`, "unknown_service", `Service '${serviceId}' is not currently configured for this tenant.`);
    }
    if (value.enabled && !value.resourcePools.some((pool) => pool?.active !== false)) error(errors, "$.resourcePools", "active_pool_required", "An enabled calendar needs at least one active resource pool.");
    if (Array.isArray(value.serviceRules)) for (let index = 0; index < value.serviceRules.length; index += 1) {
      const rule = value.serviceRules[index], base = `$.serviceRules[${index}]`;
      if (!isObject(rule)) { error(errors, base, "invalid_type", "Service rule must be an object."); continue; }
      requiredString(rule, "serviceId", errors, base); requiredString(rule, "poolId", errors, base);
      if (rule.poolId && !poolIds.has(String(rule.poolId).toLowerCase())) error(errors, `${base}.poolId`, "unknown_pool", `Resource pool '${rule.poolId}' does not exist.`);
      if (rule.serviceId && context.serviceIds && !context.serviceIds.has(rule.serviceId)) warning(warnings, `${base}.serviceId`, "unknown_service", `Service '${rule.serviceId}' is not currently configured for this tenant.`);
      if (rule.durationMinutes != null) boundedInteger(rule.durationMinutes, `${base}.durationMinutes`, errors, 1, 1440);
      if (rule.capacityRequired != null) boundedInteger(rule.capacityRequired, `${base}.capacityRequired`, errors, 1, 10000);
    }
  }
  if (["google_calendar", "microsoft_graph"].includes(value.provider) && (typeof value.credentialEnv !== "string" || !value.credentialEnv.trim())) warning(warnings, "$.credentialEnv", "credential_environment_required", "External providers should reference a server-side credential environment variable; do not paste credentials into this document.");
}

function requiredString(value, key, errors, base = "$") {
  if (typeof value?.[key] !== "string" || !value[key].trim()) error(errors, `${base}.${key}`, "required", `${key} is required.`);
}
function stringArray(value, path, errors, { required = false } = {}) {
  if (value == null && !required) return;
  if (!Array.isArray(value) || required && !value.length) return error(errors, path, "invalid_type", "A non-empty string array is required.");
  const normalized = value.map((item) => String(item).trim().toLowerCase());
  if (value.some((item) => typeof item !== "string" || !item.trim())) error(errors, path, "invalid_value", "Array values must be non-empty strings.");
  if (new Set(normalized).size !== normalized.length) error(errors, path, "duplicate_value", "Array values must be unique.");
}
function nonNegative(value, path, errors, { required = false } = {}) {
  if (value == null && !required) return;
  if (!Number.isFinite(Number(value)) || Number(value) < 0) error(errors, path, "invalid_number", "A non-negative number is required.");
}
function nonNegativeInteger(value, path, errors) { if (!Number.isInteger(Number(value)) || Number(value) < 0) error(errors, path, "invalid_integer", "A non-negative integer is required."); }
function positiveInteger(value, path, errors) { if (!Number.isInteger(Number(value)) || Number(value) <= 0) error(errors, path, "invalid_integer", "A positive integer is required."); }
function boundedInteger(value, path, errors, min, max) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) error(errors, path, "invalid_integer", `An integer between ${min} and ${max} is required.`); }
function unique(set, value, path, label, errors) { const key = String(value).trim().toLowerCase(); if (set.has(key)) error(errors, path, "duplicate_id", `Duplicate ${label} '${value}'.`); else set.add(key); }
function minutes(value) { const [hour, minute] = String(value).split(":").map(Number); return hour * 60 + minute; }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function error(list, path, code, message) { list.push({ path, code, message }); }
function warning(list, path, code, message) { list.push({ path, code, message }); }
function validTimezone(value) { try { if (typeof value !== "string" || !value.trim()) return false; new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }
function rejectSecretFields(value, path, errors) { if (!isObject(value) && !Array.isArray(value)) return; for (const [key, nested] of Object.entries(value)) { const nestedPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`; if (/^(?:apiKey|accessToken|refreshToken|clientSecret|credentials?|privateKey)$/i.test(key)) error(errors, nestedPath, "secret_not_allowed", "Secrets must stay in server environment variables, not tenant configuration."); else rejectSecretFields(nested, nestedPath, errors); } }

module.exports = { validateResource, DAYS };
