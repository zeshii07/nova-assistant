const fs = require("fs");
const path = require("path");
class FileTemplateRepository {
  constructor({ tenantsDir }) { this.tenantsDir = tenantsDir; this.cache = new Map(); }
  load(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);
    const dir = path.join(this.tenantsDir, tenantId, "templates");
    const output = {};
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
        Object.assign(output, JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
      }
    }
    this.cache.set(tenantId, output); return output;
  }
  clear() { this.cache.clear(); }
}
module.exports = { FileTemplateRepository };
