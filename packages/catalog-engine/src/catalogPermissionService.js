/** Enforces tenant grants before a capability can read catalog truth. */
class CatalogPermissionService {
  can(tenant, capabilityId, action) {
    const granted = tenant.permissions || [];
    return granted.includes("*") || granted.includes(`catalog.${action}:${capabilityId}`) || granted.includes(`catalog.${action}:*`);
  }
  assert(tenant, capabilityId, action) {
    if (!this.can(tenant, capabilityId, action)) {
      const error = new Error(`Capability '${capabilityId}' lacks catalog.${action} permission.`);
      error.code = "CATALOG_PERMISSION_DENIED";
      error.statusCode = 403;
      throw error;
    }
  }
}
module.exports = { CatalogPermissionService };
