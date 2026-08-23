/** Enforces capability-scoped CRM access. */
class CrmPermissionService {
  can(tenant, capabilityId, action) {
    const granted = tenant.permissions || [];
    return granted.includes("*") || granted.includes(`crm.${action}:${capabilityId}`) || granted.includes(`crm.${action}:*`);
  }
  assert(tenant, capabilityId, action) {
    if (!this.can(tenant, capabilityId, action)) {
      const error = new Error(`Capability '${capabilityId}' lacks crm.${action} permission.`);
      error.code = "CRM_PERMISSION_DENIED";
      error.statusCode = 403;
      throw error;
    }
  }
}
module.exports = { CrmPermissionService };
