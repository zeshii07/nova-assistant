/** Enforces tenant grants before memory is exposed to a capability. */
class MemoryPermissionService {
  canRead(tenant, namespace) { return this.#has(tenant, "memory.read", namespace); }
  canWrite(tenant, namespace) { return this.#has(tenant, "memory.write", namespace); }
  canDelete(tenant, namespace) { return this.#has(tenant, "memory.delete", namespace); }
  #has(tenant, action, namespace) {
    const permissions = tenant.permissions || [];
    return permissions.includes("*") || permissions.includes(action) || permissions.includes(`${action}:${namespace}`);
  }
}
module.exports = { MemoryPermissionService };
