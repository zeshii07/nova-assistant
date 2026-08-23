const { ValidationError } = require("../../shared/src/errors");

/** Creates a normalized immutable catalog product. */
function createProductRecord(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Product must be an object.");
  for (const field of ["id", "name", "category"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new ValidationError(`Product ${field} is required.`);
  }
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) throw new ValidationError("Product price must be a non-negative number.");
  const variants = freezeVariants(input.variants, input.currency || "PKR");
  return Object.freeze({
    id: input.id.trim(),
    sku: String(input.sku || input.id).trim(),
    name: input.name.trim(),
    category: input.category.trim(),
    description: String(input.description || "").trim(),
    price,
    currency: String(input.currency || "PKR").toUpperCase(),
    aliases: freezeStrings(input.aliases),
    colors: freezeStrings(input.colors),
    sizes: freezeStrings(input.sizes),
    tags: freezeStrings(input.tags),
    inStock: input.inStock !== false,
    inventory: finiteNumber(input.inventory) ? Number(input.inventory) : null,
    variants,
    metadata: Object.freeze({ ...(input.metadata || {}) })
  });
}
function freezeStrings(values) { return Object.freeze((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean)); }
function freezeVariants(values, fallbackCurrency) {
  return Object.freeze((Array.isArray(values) ? values : []).map((variant, index) => {
    if (!variant || typeof variant !== "object") throw new ValidationError(`Product variant ${index + 1} must be an object.`);
    const sku = String(variant.sku || "").trim();
    if (!sku) throw new ValidationError(`Product variant ${index + 1} SKU is required.`);
    const inventory = Number(variant.inventory);
    if (!Number.isInteger(inventory) || inventory < 0) throw new ValidationError(`Product variant '${sku}' inventory must be a non-negative integer.`);
    const price = variant.price == null ? null : Number(variant.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) throw new ValidationError(`Product variant '${sku}' price must be non-negative.`);
    const attributes = Object.freeze(Object.fromEntries(Object.entries(variant.attributes || {})
      .map(([key, value]) => [String(key).trim().toLowerCase(), String(value).trim()])
      .filter(([key, value]) => key && value)));
    return Object.freeze({
      id: String(variant.id || sku).trim(), sku, attributes,
      price, currency: String(variant.currency || fallbackCurrency || "PKR").toUpperCase(),
      inventory, active: variant.active !== false,
      metadata: Object.freeze({ ...(variant.metadata || {}) })
    });
  }));
}
function resolveProductVariant(product, selection = {}) {
  if (!product?.variants?.length) return null;
  const supplied = { color: selection.color, size: selection.size };
  return product.variants.find((variant) => variant.active !== false
    && (!product.colors?.length || variant.attributes?.color)
    && (!product.sizes?.length || variant.attributes?.size)
    && Object.entries(variant.attributes || {}).every(([key, value]) => {
    const selected = supplied[key] ?? selection.attributes?.[key];
    return selected != null && normalize(selected) === normalize(value);
  })) || null;
}
function inventoryDescriptor(product, variant = null) {
  const inventory = variant ? variant.inventory : product?.inventory;
  return {
    productId: product?.id || null,
    variantId: variant?.id || null,
    sku: String(variant?.sku || product?.sku || product?.id || ""),
    inventory: finiteNumber(inventory) ? Number(inventory) : null
  };
}
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function finiteNumber(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
module.exports = { createProductRecord, resolveProductVariant, inventoryDescriptor };
