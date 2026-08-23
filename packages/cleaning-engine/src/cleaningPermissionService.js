/** Enforces cleaning capability permissions at tenant scope. */
class CleaningPermissionService {
  assert(tenant, capabilityId, action) {
    const grants = tenant.permissions || [];
    const permission = `cleaning.${action}:${capabilityId}`;
    if (!(grants.includes("*") || grants.includes(permission) || grants.includes(`cleaning.${action}:*`))) {
      const error = new Error(`Capability '${capabilityId}' lacks cleaning.${action} permission.`);
      error.code = "CLEANING_PERMISSION_DENIED";
      error.statusCode = 403;
      throw error;
    }
  }
}
module.exports = { CleaningPermissionService };
