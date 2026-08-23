const path = require("path");
const { LocalJsonFile } = require("../../storage/src/localJsonFile");
const { ValidationError } = require("../../shared/src/errors");

const RESOURCE_TYPES = Object.freeze(["profile", "products", "services", "hours", "calendar"]);

/**
 * Durable, tenant-scoped control-plane store.
 *
 * A single atomic JSON file owns drafts, immutable revisions, active revision
 * pointers, and audit records for one tenant. Runtime repositories only read
 * the active revision; drafts can therefore never leak into customer traffic.
 */
class FileControlPlaneRepository {
  constructor({ operationalDataDir }) {
    this.operationalDataDir = operationalDataDir;
  }

  readState(tenantId) {
    assertTenantId(tenantId);
    const state = this.#file(tenantId).read();
    return normalizeState(state, tenantId);
  }

  writeState(tenantId, state) {
    assertTenantId(tenantId);
    const normalized = normalizeState(state, tenantId);
    normalized.updatedAt = new Date().toISOString();
    this.#file(tenantId).write(normalized);
    return structuredClone(normalized);
  }

  getPublished(tenantId, resourceType) {
    assertResourceType(resourceType);
    const state = this.readState(tenantId);
    const revision = Number(state.activeRevisions[resourceType] || 0);
    if (!revision) return null;
    const entry = state.revisions[resourceType].find((item) => item.revision === revision);
    return entry ? structuredClone(entry) : null;
  }

  #file(tenantId) {
    return new LocalJsonFile(
      path.join(this.operationalDataDir, tenantId, "control-plane", "state.json"),
      initialState(tenantId)
    );
  }
}

function initialState(tenantId) {
  return {
    schemaVersion: "1.0",
    tenantId,
    activeRevisions: Object.fromEntries(RESOURCE_TYPES.map((type) => [type, 0])),
    drafts: {},
    revisions: Object.fromEntries(RESOURCE_TYPES.map((type) => [type, []])),
    audit: [],
    updatedAt: null
  };
}

function normalizeState(input, tenantId) {
  const state = input && typeof input === "object" ? structuredClone(input) : initialState(tenantId);
  if (state.tenantId && state.tenantId !== tenantId) throw new ValidationError("Control-plane tenant identity mismatch.");
  state.schemaVersion = "1.0";
  state.tenantId = tenantId;
  state.activeRevisions = state.activeRevisions && typeof state.activeRevisions === "object" ? state.activeRevisions : {};
  state.drafts = state.drafts && typeof state.drafts === "object" && !Array.isArray(state.drafts) ? state.drafts : {};
  state.revisions = state.revisions && typeof state.revisions === "object" ? state.revisions : {};
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  for (const type of RESOURCE_TYPES) {
    state.activeRevisions[type] = Number(state.activeRevisions[type] || 0);
    state.revisions[type] = Array.isArray(state.revisions[type]) ? state.revisions[type] : [];
  }
  return state;
}

function assertTenantId(tenantId) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(String(tenantId || ""))) {
    throw new ValidationError("A valid tenant ID is required.");
  }
}

function assertResourceType(resourceType) {
  if (!RESOURCE_TYPES.includes(resourceType)) throw new ValidationError(`Unsupported control-plane resource '${resourceType}'.`);
}

module.exports = { FileControlPlaneRepository, RESOURCE_TYPES, assertResourceType };
