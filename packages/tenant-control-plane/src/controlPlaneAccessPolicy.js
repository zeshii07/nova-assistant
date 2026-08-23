const { ForbiddenError, ValidationError } = require("../../shared/src/errors");

const READ_ROLES = new Set(["owner", "admin", "catalog_manager", "operations_manager", "support_agent", "viewer"]);
const DRAFT_ROLES = new Set(["owner", "admin", "catalog_manager", "operations_manager"]);
const PUBLISH_ROLES = new Set(["owner", "admin"]);

class ControlPlaneAccessPolicy {
  authorize({ actor, tenantId, action, resourceType = null }) {
    if (!actor || typeof actor !== "object") throw new ForbiddenError("An authenticated control-plane actor is required.");
    if (!actor.id || !actor.role || !actor.tenantId) throw new ValidationError("Control-plane actor requires id, role, and tenantId.");
    if (actor.tenantId !== tenantId) throw new ForbiddenError("Cross-tenant control-plane access is not allowed.");
    const role = String(actor.role).toLowerCase();
    if (action === "read" && READ_ROLES.has(role)) return true;
    if (["draft.create", "draft.update", "draft.validate", "draft.preview", "draft.discard"].includes(action) && DRAFT_ROLES.has(role)) {
      if (role === "catalog_manager" && !["products", "services"].includes(resourceType)) throw new ForbiddenError("Catalog managers can edit only products and services.");
      if (role === "operations_manager" && !["services", "hours", "calendar"].includes(resourceType)) throw new ForbiddenError("Operations managers can edit only services, hours, and calendar configuration.");
      return true;
    }
    if (["publish", "rollback"].includes(action) && PUBLISH_ROLES.has(role)) return true;
    throw new ForbiddenError(`Role '${role}' cannot perform '${action}'${resourceType ? ` on '${resourceType}'` : ""}.`);
  }
}

module.exports = { ControlPlaneAccessPolicy };
