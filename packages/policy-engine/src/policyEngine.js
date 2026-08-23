const fs = require("fs");
const path = require("path");
class PolicyEngine {
  constructor({ tenantsDir }) { this.tenantsDir = tenantsDir; }
  get(tenantId) {
    const file = path.join(this.tenantsDir, tenantId, "policies.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  }
  apply(text, policy = {}) {
    let output = String(text || "").trim();
    for (const phrase of policy.forbiddenPhrases || []) output = output.replace(new RegExp(escapeRegExp(phrase), "gi"), "");
    if (policy.emojiLevel === "none") output = output.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/ +\n/g, "\n");
    if (Number.isFinite(policy.maxLines) && policy.maxLines > 0) output = output.split("\n").slice(0, policy.maxLines).join("\n");
    if (Number.isFinite(policy.maxCharacters) && output.length > policy.maxCharacters) output = output.slice(0, policy.maxCharacters - 1).trimEnd() + "…";
    return output.trim();
  }
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
module.exports = { PolicyEngine };
