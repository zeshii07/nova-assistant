const fs = require("fs");
const path = require("path");
const { NotFoundError, ValidationError } = require("../../shared/src/errors");
class FileTenantRepository {
  constructor({ tenantsDir, logger, controlPlaneRepository = null }) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.controlPlaneRepository = controlPlaneRepository;
    this.cache = new Map();
  }
  getById(tenantId) {
    if (this.cache.has(tenantId)) return structuredClone(this.cache.get(tenantId));
    const filePath = path.join(this.tenantsDir, tenantId, "profile.json");
    if (!fs.existsSync(filePath)) throw new NotFoundError(`Tenant '${tenantId}' was not found`);
    let profile;
    try { profile = this.controlPlaneRepository?.getPublished(tenantId, "profile")?.document || JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch (error) { throw new ValidationError(`Tenant '${tenantId}' profile is invalid JSON`, { cause: error.message }); }
    this.validate(profile, tenantId);
    this.cache.set(tenantId, profile);
    this.logger?.info("tenant.loaded", { tenantId });
    return structuredClone(profile);
  }
  validate(profile, expectedId) {
    if (!profile || typeof profile !== "object") throw new ValidationError("Tenant profile must be an object");
    if (profile.id !== expectedId) throw new ValidationError("Tenant profile id does not match its folder name");
    if (!profile.name || !Array.isArray(profile.capabilities)) throw new ValidationError("Tenant profile requires name and capabilities");
    if (profile.status !== "active") throw new ValidationError(`Tenant '${expectedId}' is not active`);
  }
  clearCache(tenantId) { tenantId ? this.cache.delete(tenantId) : this.cache.clear(); }
}
module.exports = { FileTenantRepository };
