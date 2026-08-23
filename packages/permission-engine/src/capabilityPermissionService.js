/** Resolves tenant capability enablement and scoped permissions. */
class CapabilityPermissionService {
  isEnabled(tenant, capabilityId) { return Array.isArray(tenant.capabilities) && tenant.capabilities.includes(capabilityId); }
  hasPermissions(tenant, manifest) {
    const required = manifest.permissions || [];
    const granted = tenant.permissions || [];
    return required.every((permission) => granted.includes(permission) || granted.includes("*"));
  }
  canUse(tenant, manifest) { return this.isEnabled(tenant, manifest.id) && this.hasPermissions(tenant, manifest); }
}
module.exports = { CapabilityPermissionService };
