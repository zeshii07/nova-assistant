const { resolveProductVariant, inventoryDescriptor } = require("../../catalog-sdk/src/productRecord");
/** Official tenant catalog application service and capability-scoped facade. */
class CatalogService {
  constructor({ repository, matcher, permissionService, eventBus, logger, inventoryService = null }) { Object.assign(this, { repository, matcher, permissionService, eventBus, logger, inventoryService }); }
  async listProducts(tenantId) { return this.repository.listProducts(tenantId); }
  async getProductById(tenantId, productId) { return this.repository.getProductById(tenantId, productId); }
  async search(tenantId, query) { return this.matcher.search(query, await this.repository.listProducts(tenantId), await this.repository.getSynonyms(tenantId)); }
  scope({ tenant, capabilityId, customerId }) {
    const assert = (action) => this.permissionService.assert(tenant, capabilityId, action);
    return Object.freeze({
      search: async (query) => { assert("search"); const result = await this.search(tenant.id, query); await this.emit("catalog.searched.v1", { tenantId: tenant.id, customerId, query: result.query, productId: result.product?.id || null }, capabilityId); return result; },
      listProducts: async () => { assert("read"); return this.repository.listProducts(tenant.id); },
      listCategories: async () => { assert("read"); return this.repository.listCategories(tenant.id); },
      getProductById: async (productId) => { assert("read"); return this.repository.getProductById(tenant.id, productId); },
      validateSelection: async ({ productId, color, size, quantity, requireComplete = false, cartId = null }) => {
        assert("read"); const product = await this.repository.getProductById(tenant.id, productId);
        if (!product || !product.inStock) return { valid: false, reason: "product_unavailable", product: null };
        if (requireComplete && product.colors?.length && !color) return { valid:false, reason:"missing_color", product };
        if (requireComplete && product.sizes?.length && !size) return { valid:false, reason:"missing_size", product };
        if (color && !product.colors.some((value) => same(value, color))) return { valid: false, reason: "invalid_color", product };
        if (size && !product.sizes.some((value) => same(value, size))) return { valid: false, reason: "invalid_size", product };
        if (quantity && (!Number.isInteger(quantity) || quantity < 1)) return { valid: false, reason: "invalid_quantity", product };
        const variant = product.variants?.length ? resolveProductVariant(product, { color, size }) : null;
        if (product.variants?.length && !variant) return { valid:false, reason:"variant_unavailable", product };
        const descriptor = inventoryDescriptor(product, variant);
        const availableQuantity = this.inventoryService && variant
          ? await this.inventoryService.available({ tenantId:tenant.id, customerId, cartId, ...descriptor })
          : descriptor.inventory;
        if (quantity && Number.isFinite(availableQuantity) && quantity > availableQuantity) return { valid:false, reason:"insufficient_inventory", product, variant, sku:descriptor.sku, availableQuantity };
        const unitPrice = variant?.price ?? product.price;
        const currency = variant?.currency || product.currency;
        return { valid: true, product, variant, sku:descriptor.sku, inventoryTracked:Boolean(variant), unitPrice, currency, availableQuantity, subtotal: quantity ? unitPrice * quantity : null };
      }
    });
  }
  async emit(name, payload, capabilityId = "system") { await this.eventBus?.publish(name, payload, { source: "catalog-engine", capabilityId }); }
}
function same(left, right) { return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase(); }
module.exports = { CatalogService };
