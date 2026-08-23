/**
 * Port implemented by catalog repositories.
 * Infrastructure adapters may use JSON files, PostgreSQL, an API, or another store.
 */
class CatalogPort {
  async listProducts() { throw new Error("CatalogPort.listProducts() is not implemented."); }
  async getProductById() { throw new Error("CatalogPort.getProductById() is not implemented."); }
  async listCategories() { throw new Error("CatalogPort.listCategories() is not implemented."); }
  async getSynonyms() { throw new Error("CatalogPort.getSynonyms() is not implemented."); }
}
module.exports = { CatalogPort };
