class CommercePermissionService {
  can(tenant, capabilityId, action) { const p = tenant.permissions || []; return p.includes("*") || p.includes(`commerce.${action}:${capabilityId}`) || p.includes(`commerce.${action}:*`); }
  assert(tenant, capabilityId, action) { if (!this.can(tenant, capabilityId, action)) { const e = new Error(`Capability '${capabilityId}' lacks commerce.${action} permission.`); e.code = "COMMERCE_PERMISSION_DENIED"; throw e; } }
}
module.exports = { CommercePermissionService };
