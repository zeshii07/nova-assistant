const fs = require("fs");
const path = require("path");
class PersonaEngine {
  constructor({ tenantsDir }) { this.tenantsDir = tenantsDir; this.cache = new Map(); }
  get(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);
    const file = path.join(this.tenantsDir, tenantId, "personality.json");
    const persona = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const normalized = {
      name: persona.name || "Nova Assistant", tone: persona.tone || "friendly",
      emojiLevel: persona.emojiLevel || "medium", verbosity: persona.verbosity || "medium",
      defaultLanguage: persona.defaultLanguage || "auto", greetingStyle: persona.greetingStyle || "natural",
      closingStyle: persona.closingStyle || "warm", vocabulary: persona.vocabulary || {}
    };
    this.cache.set(tenantId, normalized); return normalized;
  }
}
module.exports = { PersonaEngine };
