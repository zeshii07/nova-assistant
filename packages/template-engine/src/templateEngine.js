/** Minimal deterministic template renderer with {{path}} interpolation. */
class TemplateEngine {
  constructor({ repository }) { this.repository = repository; }
  get(tenantId, key, language) {
    const templates = this.repository.load(tenantId);
    const entry = templates[key] || {};
    return entry[language] || entry.english || null;
  }
  render(template, data = {}) {
    return String(template || "").replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
      const value = key.trim().split(".").reduce((current, part) => current?.[part], data);
      return value === null || value === undefined ? "" : String(value);
    });
  }
}
module.exports = { TemplateEngine };
