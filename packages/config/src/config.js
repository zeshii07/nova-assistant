const path = require("path");
const crypto = require("crypto");
const { loadDotEnv } = require("./env");
// Process IDs are eventually reused, so PID-only test directories can revive
// state from an older test run. Keep one stable token for this worker process
// and include it in the default test storage namespace.
const testRunToken = process.env.NODE_TEST_CONTEXT
  ? `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`
  : null;
function loadConfig() {
  loadDotEnv();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");
  const localDataDir = path.resolve(process.cwd(), process.env.NOVA_LOCAL_DATA_DIR || (testRunToken ? `./.nova-data/test-${process.pid}-${testRunToken}` : "./.nova-data"));
  const nluMode = String(process.env.NOVA_NLU_MODE || "off").toLowerCase();
  if (!["off", "on"].includes(nluMode)) throw new Error("NOVA_NLU_MODE must be off or on");
  return Object.freeze({
    env: process.env.NODE_ENV || "development",
    port,
    defaultTenantId: process.env.DEFAULT_TENANT_ID || "default",
    tenantsDir: path.resolve(process.cwd(), process.env.TENANTS_DIR || "./tenants"),
    logLevel: process.env.LOG_LEVEL || "info",
    storageMode: String(process.env.NOVA_STORAGE_MODE || "memory").toLowerCase(),
    localDataDir,
    // Tenant files shipped with the application are immutable baseline truth.
    // Knowledge added in the console belongs beside CRM/state data on the
    // durable volume so a restart or new deployment cannot erase it.
    knowledgeDataDir: path.resolve(process.cwd(), process.env.NOVA_KNOWLEDGE_DATA_DIR || path.join(localDataDir, "tenant-knowledge")),
    operationalDataDir: path.resolve(process.cwd(), process.env.NOVA_OPERATIONAL_DATA_DIR || path.join(localDataDir, "tenant-operational")),
    databaseUrl: process.env.DATABASE_URL || "",
    redisUrl: process.env.REDIS_URL || "",
    stateTtlSeconds: Number.parseInt(process.env.NOVA_STATE_TTL_SECONDS || "604800", 10),
    inventoryReservationTtlSeconds: boundedNumber("NOVA_INVENTORY_RESERVATION_TTL_SECONDS", 900, 30, 86400),
    nluMode,
    groqNluBaseUrl: process.env.NOVA_GROQ_NLU_BASE_URL || "https://api.groq.com/openai/v1",
    groqNluModel: process.env.NOVA_GROQ_NLU_MODEL || "openai/gpt-oss-20b",
    groqNluApiKey: process.env.GROQ_API_KEY || process.env.NOVA_GROQ_NLU_API_KEY || "",
    defaultTimezone: process.env.NOVA_DEFAULT_TIMEZONE || "Asia/Karachi",
    groqNluTimeoutMs: boundedNumber("NOVA_GROQ_NLU_TIMEOUT_MS", 4000, 250, 30000),
    groqNluFailureCooldownMs: boundedNumber("NOVA_GROQ_NLU_FAILURE_COOLDOWN_MS", 15000, 0, 300000),
    nluMinConfidence: boundedNumber("NOVA_NLU_MIN_CONFIDENCE", 0.78, 0, 1),
    nluInformationThreshold: boundedNumber("NOVA_NLU_INFORMATION_THRESHOLD", 0.86, 0, 1),
    nluActionThreshold: boundedNumber("NOVA_NLU_ACTION_THRESHOLD", 0.92, 0, 1),
    nluInvocationThreshold: boundedNumber("NOVA_NLU_INVOCATION_THRESHOLD", 0.86, 0, 1),
    nluAmbiguityMargin: boundedNumber("NOVA_NLU_AMBIGUITY_MARGIN", 0.05, 0, 0.5),
    nluMaxInputChars: boundedNumber("NOVA_NLU_MAX_INPUT_CHARS", 4000, 256, 12000)
  });
}
function boundedNumber(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}
module.exports = { loadConfig };
