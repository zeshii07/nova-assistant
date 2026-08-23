const REQUIRED_FIELDS = ["id", "name", "version", "entry"];
/** Validates a capability manifest before any executable code is loaded. */
function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { valid: false, errors: ["Manifest must be an object."] };
  for (const field of REQUIRED_FIELDS) if (typeof manifest[field] !== "string" || !manifest[field].trim()) errors.push(`${field} must be a non-empty string.`);
  if (manifest.id && !/^[a-z][a-z0-9-]*$/.test(manifest.id)) errors.push("id must use lowercase letters, numbers, and hyphens.");
  if (manifest.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push("version must be semantic version format.");
  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) errors.push("permissions must be an array.");
  if (manifest.events !== undefined && !Array.isArray(manifest.events)) errors.push("events must be an array.");
  return { valid: errors.length === 0, errors };
}
module.exports = { validateManifest };
