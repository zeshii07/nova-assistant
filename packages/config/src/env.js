const fs = require("fs");
const path = require("path");
function loadDotEnv(filePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
    parsed[key] = value;
  }
  return parsed;
}
module.exports = { loadDotEnv };
