const fs = require("fs");
const path = require("path");
const { hydrateRuntimeServices } = require("../../service-pricing/src/unifiedServiceCatalog");

/** Reads tenant-owned cleaning service definitions from disk. */
class FileCleaningRepository {
  constructor({ tenantsDir, controlPlaneRepository = null }) { this.tenantsDir = tenantsDir; this.controlPlaneRepository = controlPlaneRepository; this.cache = new Map(); }
  loadServices(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);
    const file = path.join(this.tenantsDir, tenantId, "cleaning", "services.json");
    const published = this.controlPlaneRepository?.getPublished(tenantId, "services")?.document;
    const services = published?.kind === "cleaning" ? hydrateRuntimeServices(published) : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    this.cache.set(tenantId, services);
    return services;
  }
  clear(tenantId = null) { tenantId ? this.cache.delete(tenantId) : this.cache.clear(); }
}
module.exports = { FileCleaningRepository };
