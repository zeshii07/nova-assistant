const fs = require("fs");
const path = require("path");

class FileCalendarConfigRepository {
  constructor({ tenantsDir, controlPlaneRepository = null }) {
    this.tenantsDir = tenantsDir;
    this.controlPlaneRepository = controlPlaneRepository;
    this.cache = new Map();
  }

  load(tenantId) {
    const published = this.controlPlaneRepository?.getPublished?.(tenantId, "calendar");
    const key = `${tenantId}:${published?.revision || 0}`;
    if (this.cache.has(key)) return structuredClone(this.cache.get(key));
    const file = path.join(this.tenantsDir, tenantId, "calendar", "config.json");
    const baseline = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : disabledConfig();
    const value = normalizeConfig(published?.document || baseline);
    this.cache.clear();
    this.cache.set(key, value);
    return structuredClone(value);
  }

  clear(tenantId = null) {
    if (!tenantId) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${tenantId}:`)) this.cache.delete(key);
  }
}

function disabledConfig() {
  return { enabled: false, provider: "disabled", timezone: "UTC", defaultDurationMinutes: 60, slotIntervalMinutes: 30, holdTtlSeconds: 300, minLeadMinutes: 0, maxAdvanceDays: 365, resourcePools: [] };
}

function normalizeConfig(input = {}) {
  const value = { ...disabledConfig(), ...(input || {}) };
  value.enabled = value.enabled === true;
  value.provider = value.enabled ? String(value.provider || "local").toLowerCase() : "disabled";
  value.timezone = String(value.timezone || "UTC");
  value.defaultDurationMinutes = positive(value.defaultDurationMinutes, 60);
  value.slotIntervalMinutes = positive(value.slotIntervalMinutes, 30);
  value.holdTtlSeconds = positive(value.holdTtlSeconds, 300);
  value.minLeadMinutes = nonNegative(value.minLeadMinutes, 0);
  value.maxAdvanceDays = positive(value.maxAdvanceDays, 365);
  value.resourcePools = Array.isArray(value.resourcePools) ? value.resourcePools.map((pool) => ({
    id: String(pool.id || "default"),
    name: String(pool.name || pool.id || "Default capacity"),
    capacity: positive(pool.capacity, 1),
    serviceIds: Array.isArray(pool.serviceIds) ? pool.serviceIds.map(String) : [],
    active: pool.active !== false
  })) : [];
  if (value.enabled && !value.resourcePools.some((pool) => pool.active)) value.resourcePools.push({ id: "default", name: "Default capacity", capacity: 1, serviceIds: [], active: true });
  value.serviceRules = Array.isArray(value.serviceRules) ? value.serviceRules.map((rule) => ({
    serviceId: String(rule.serviceId || ""),
    poolId: String(rule.poolId || "default"),
    durationMinutes: rule.durationMinutes == null ? null : positive(rule.durationMinutes, value.defaultDurationMinutes),
    capacityRequired: rule.capacityRequired == null ? null : positive(rule.capacityRequired, 1)
  })).filter((rule) => rule.serviceId) : [];
  return value;
}

function positive(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function nonNegative(value, fallback) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : fallback; }

module.exports = { FileCalendarConfigRepository, normalizeConfig, disabledConfig };
