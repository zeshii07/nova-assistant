/**
 * PublicFeatureRegistryService — §7 of the spec.
 *
 * Loads the machine-readable feature registry (tenants/public-product/feature-registry.json)
 * and answers feature-status lookups. The model must never infer feature status;
 * this service is the single source of truth for "is X available".
 *
 * Only features with public_visibility=true and status != 'not_supported' are
 * surfaced to public answers.
 */
const fs = require("fs");
const path = require("path");

class PublicFeatureRegistryService {
  constructor({ registryPath, logger = null }) {
    this.registryPath = registryPath;
    this.logger = logger;
    this._cache = null;
    this._mtime = 0;
  }

  _load() {
    // Re-read when the file changes on disk so admins can edit without a restart.
    let mtime = 0;
    try { mtime = fs.statSync(this.registryPath).mtimeMs; } catch { /* missing file → empty */ }
    if (this._cache && mtime === this._mtime) return this._cache;
    try {
      const raw = fs.readFileSync(this.registryPath, "utf8");
      const parsed = JSON.parse(raw);
      this._cache = parsed;
      this._mtime = mtime;
      return parsed;
    } catch (error) {
      this.logger?.error?.("public_feature_registry.load_failed", { error: error.message });
      this._cache = { version: 0, features: [] };
      this._mtime = 0;
      return this._cache;
    }
  }

  /** Returns the full list of public features (public_visibility=true). */
  listPublic() {
    const reg = this._load();
    return (reg.features || []).filter((f) => f.public_visibility === true);
  }

  /** Returns a single feature by feature_id, or null. */
  getStatus(featureId) {
    const reg = this._load();
    return (reg.features || []).find((f) => f.feature_id === featureId) || null;
  }

  /** Returns features that support a given industry key. */
  forIndustry(industryKey) {
    if (!industryKey) return [];
    return this.listPublic().filter((f) =>
      Array.isArray(f.supported_industries) && f.supported_industries.includes(industryKey)
    );
  }

  /** True if the feature is publicly available (not beta/planned/not_supported/unknown). */
  isAvailable(featureId) {
    const f = this.getStatus(featureId);
    if (!f || !f.public_visibility) return false;
    return f.status === "available" || f.status === "available_with_configuration";
  }

  /** True if a demo is available for the feature. */
  isDemoAvailable(featureId) {
    const f = this.getStatus(featureId);
    return Boolean(f && f.demo_available && this.isAvailable(featureId));
  }
}

module.exports = { PublicFeatureRegistryService };
