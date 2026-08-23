const path = require("path");
const { LocalJsonFile } = require("../../storage/src/localJsonFile");

class FileCalendarRepository {
  constructor({ snapshotRoot = null } = {}) { this.snapshotRoot = snapshotRoot; }

  readState(tenantId) {
    const state = this.#file(tenantId).read();
    if (state.tenantId && state.tenantId !== tenantId) throw new Error("Calendar tenant identity mismatch.");
    return normalizeState(state, tenantId);
  }

  writeState(tenantId, state) {
    const normalized = normalizeState(state, tenantId);
    normalized.updatedAt = new Date().toISOString();
    this.#file(tenantId).write(normalized);
    return structuredClone(normalized);
  }

  #file(tenantId) {
    return new LocalJsonFile(this.snapshotRoot ? path.join(this.snapshotRoot, tenantId, "calendar.json") : null, initialState(tenantId));
  }
}

function initialState(tenantId) {
  return { schemaVersion: "1.0", tenantId, holds: {}, events: {}, idempotency: {}, audit: [], updatedAt: null };
}

function normalizeState(input, tenantId) {
  const state = input && typeof input === "object" ? structuredClone(input) : initialState(tenantId);
  state.schemaVersion = "1.0";
  state.tenantId = tenantId;
  state.holds = object(state.holds);
  state.events = object(state.events);
  state.idempotency = object(state.idempotency);
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  return state;
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
module.exports = { FileCalendarRepository, initialState };
