const { createCapabilityResult } = require("./capabilityResult");

/** Base contract for all local Nova capabilities. */
class BaseCapability {
  constructor({ manifest }) {
    if (!manifest || !manifest.id) throw new TypeError("A capability manifest with an id is required.");
    this.manifest = Object.freeze({ ...manifest });
    this.id = manifest.id;
    this.initialized = false;
  }
  async initialize() { this.initialized = true; }
  async shutdown() { this.initialized = false; }
  async health() { return { ok: this.initialized, capabilityId: this.id }; }
  async canHandle() { return { confidence: 0, reason: "not_implemented" }; }
  async execute() { return createCapabilityResult({ handled: false, confidence: 0 }); }
}
module.exports = { BaseCapability };
