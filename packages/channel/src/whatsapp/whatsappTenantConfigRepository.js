const fs = require("fs");
const path = require("path");
const { NotFoundError, ValidationError } = require("../../../shared/src/errors");

/**
 * Loads tenant-owned WhatsApp channel configuration.
 * Secrets are referenced by environment variable names and are never stored in JSON.
 */
class WhatsAppTenantConfigRepository {
  constructor({ tenantsDir, env = process.env }) {
    this.tenantsDir = tenantsDir;
    this.env = env;
    this.cache = new Map();
  }

  load(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);
    const file = path.join(this.tenantsDir, tenantId, "channels", "whatsapp.json");
    if (!fs.existsSync(file)) throw new NotFoundError(`WhatsApp configuration not found for tenant '${tenantId}'`);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const config = this.#resolve(raw, tenantId);
    this.cache.set(tenantId, config);
    return config;
  }

  #resolve(raw, tenantId) {
    if (!raw || raw.enabled !== true) {
      return { tenantId, enabled: false };
    }
    const required = ["graphVersion", "phoneNumberIdEnv", "accessTokenEnv", "verifyTokenEnv", "appSecretEnv"];
    for (const field of required) if (!raw[field]) throw new ValidationError(`WhatsApp config '${field}' is required for tenant '${tenantId}'`);
    const getSecret = (envName, label) => {
      const value = this.env[envName];
      if (!value) throw new ValidationError(`Environment variable '${envName}' is required for WhatsApp ${label}`);
      return value;
    };
    return {
      tenantId,
      enabled: true,
      graphVersion: raw.graphVersion,
      phoneNumberId: getSecret(raw.phoneNumberIdEnv, "phone number ID"),
      accessToken: getSecret(raw.accessTokenEnv, "access token"),
      verifyToken: getSecret(raw.verifyTokenEnv, "verify token"),
      appSecret: getSecret(raw.appSecretEnv, "app secret"),
      markRead: raw.markRead !== false,
      retries: Number.isInteger(raw.retries) ? raw.retries : 2,
      timeoutMs: Number.isInteger(raw.timeoutMs) ? raw.timeoutMs : 15000
    };
  }
}

module.exports = { WhatsAppTenantConfigRepository };
