const fs = require("fs");
const path = require("path");
const { CatalogPort } = require("../../catalog-sdk/src/catalogPort");
const { createProductRecord } = require("../../catalog-sdk/src/productRecord");

/** Tenant-isolated JSON catalog repository. */
class FileCatalogRepository extends CatalogPort {
  constructor({ tenantsDir, logger, controlPlaneRepository = null } = {}) { super(); this.tenantsDir = tenantsDir; this.logger = logger; this.controlPlaneRepository = controlPlaneRepository; this.cache = new Map(); }
  async listProducts(tenantId) { return this.#load(tenantId).products; }
  async getProductById(tenantId, productId) { return this.#load(tenantId).products.find((item) => item.id === productId) || null; }
  async listCategories(tenantId) { return this.#load(tenantId).categories; }
  async getSynonyms(tenantId) { return this.#load(tenantId).synonyms; }
  clearCache(tenantId = null) { tenantId ? this.cache.delete(tenantId) : this.cache.clear(); }
  #load(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);
    const catalogDir = path.join(this.tenantsDir, tenantId, "catalog");
    const products = this.controlPlaneRepository?.getPublished(tenantId, "products")?.document || readJson(path.join(catalogDir, "products.json"), []);
    const categories = readJson(path.join(catalogDir, "categories.json"), []);
    const synonyms = readJson(path.join(catalogDir, "synonyms.json"), {});
    const value = Object.freeze({
      products: Object.freeze(products.map(createProductRecord)),
      categories: Object.freeze(categories.map((item) => Object.freeze({ ...item }))),
      synonyms: Object.freeze({ ...synonyms })
    });
    this.cache.set(tenantId, value);
    this.logger?.info("catalog.loaded", { tenantId, products: value.products.length });
    return value;
  }
}
function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
module.exports = { FileCatalogRepository };
