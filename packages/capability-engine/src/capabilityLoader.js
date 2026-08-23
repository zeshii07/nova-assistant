const fs = require("fs"); const path = require("path");
const { validateManifest } = require("../../capability-sdk/src/manifestValidator");
/** Discovers local capabilities from manifest.json files. */
class CapabilityLoader {
  constructor({ capabilitiesDir, logger } = {}) { this.capabilitiesDir = capabilitiesDir; this.logger = logger; }
  discover() {
    if (!fs.existsSync(this.capabilitiesDir)) return [];
    return fs.readdirSync(this.capabilitiesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
      const root = path.join(this.capabilitiesDir, entry.name); const manifestPath = path.join(root, "manifest.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); const validation = validateManifest(manifest);
      if (!validation.valid) throw new Error(`Invalid capability manifest ${entry.name}: ${validation.errors.join(" ")}`);
      return { root, manifest, entryPath: path.resolve(root, manifest.entry) };
    }).filter(Boolean);
  }
  instantiate(descriptor, services = {}) {
    const exported = require(descriptor.entryPath); const CapabilityClass = exported.Capability || exported.default || exported;
    const instance = new CapabilityClass({ manifest: descriptor.manifest, services });
    this.logger?.info("capability.loaded", { capabilityId: descriptor.manifest.id }); return instance;
  }
}
module.exports = { CapabilityLoader };
