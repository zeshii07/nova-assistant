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
  const port = boundedInteger("PORT", 3000, 1, 65535);
  const localDataDir = path.resolve(process.cwd(), process.env.NOVA_LOCAL_DATA_DIR || (testRunToken ? `./.nova-data/test-${process.pid}-${testRunToken}` : "./.nova-data"));
  const storageMode = String(process.env.NOVA_STORAGE_MODE || "memory").toLowerCase();
  if (!["memory", "persistent"].includes(storageMode)) throw new Error("NOVA_STORAGE_MODE must be memory or persistent");
  const nluMode = String(process.env.NOVA_NLU_MODE || "off").toLowerCase();
  if (!["off", "on"].includes(nluMode)) throw new Error("NOVA_NLU_MODE must be off or on");
  const nluStrategy = String(process.env.NOVA_NLU_STRATEGY || "adaptive").toLowerCase();
  if (!["adaptive", "primary"].includes(nluStrategy)) throw new Error("NOVA_NLU_STRATEGY must be adaptive or primary");
  const semanticRouterMode=String(process.env.NOVA_SEMANTIC_ROUTER_MODE||"on").toLowerCase();
  if(!["off","on"].includes(semanticRouterMode))throw new Error("NOVA_SEMANTIC_ROUTER_MODE must be off or on");
  const defaultTimezone = process.env.NOVA_DEFAULT_TIMEZONE || "Asia/Karachi";
  try { new Intl.DateTimeFormat("en-US", { timeZone: defaultTimezone }).format(); }
  catch { throw new Error("NOVA_DEFAULT_TIMEZONE must be a valid IANA timezone"); }
  return Object.freeze({
    env: process.env.NODE_ENV || "development",
    port,
    defaultTenantId: process.env.DEFAULT_TENANT_ID || "default",
    tenantsDir: path.resolve(process.cwd(), process.env.TENANTS_DIR || "./tenants"),
    logLevel: process.env.LOG_LEVEL || "info",
    storageMode,
    localDataDir,
    // Tenant files shipped with the application are immutable baseline truth.
    // Knowledge added in the console belongs beside CRM/state data on the
    // durable volume so a restart or new deployment cannot erase it.
    knowledgeDataDir: path.resolve(process.cwd(), process.env.NOVA_KNOWLEDGE_DATA_DIR || path.join(localDataDir, "tenant-knowledge")),
    operationalDataDir: path.resolve(process.cwd(), process.env.NOVA_OPERATIONAL_DATA_DIR || path.join(localDataDir, "tenant-operational")),
    databaseUrl: process.env.DATABASE_URL || "",
    redisUrl: process.env.REDIS_URL || "",
    stateTtlSeconds: boundedInteger("NOVA_STATE_TTL_SECONDS", 604800, 60, 31536000),
    dbPoolMax: boundedInteger("NOVA_DB_POOL_MAX", 10, 1, 100),
    inventoryReservationTtlSeconds: boundedInteger("NOVA_INVENTORY_RESERVATION_TTL_SECONDS", 900, 30, 86400),
    nluMode,
    nluStrategy,
    semanticRouterMode,
    semanticRouterMinConfidence:boundedNumber("NOVA_SEMANTIC_ROUTER_MIN_CONFIDENCE",.72,0,1),
    semanticRouterMinMargin:boundedNumber("NOVA_SEMANTIC_ROUTER_MIN_MARGIN",.08,0,.5),
    semanticRouterMinSimilarity:boundedNumber("NOVA_SEMANTIC_ROUTER_MIN_SIMILARITY",.2,0,1),
    semanticRouterMaxLocalIntents:boundedInteger("NOVA_SEMANTIC_ROUTER_MAX_LOCAL_INTENTS",2,1,8),
    groqNluBaseUrl: process.env.NOVA_GROQ_NLU_BASE_URL || "https://api.groq.com/openai/v1",
    groqNluModel: process.env.NOVA_GROQ_NLU_MODEL || "openai/gpt-oss-20b",
    groqNluApiKey: process.env.GROQ_API_KEY || process.env.NOVA_GROQ_NLU_API_KEY || "",
    defaultTimezone,
    groqNluTimeoutMs: boundedInteger("NOVA_GROQ_NLU_TIMEOUT_MS", 4000, 250, 30000),
    groqNluFailureCooldownMs: boundedInteger("NOVA_GROQ_NLU_FAILURE_COOLDOWN_MS", 15000, 0, 300000),
    nluMinConfidence: boundedNumber("NOVA_NLU_MIN_CONFIDENCE", 0.78, 0, 1),
    nluInformationThreshold: boundedNumber("NOVA_NLU_INFORMATION_THRESHOLD", 0.86, 0, 1),
    nluActionThreshold: boundedNumber("NOVA_NLU_ACTION_THRESHOLD", 0.92, 0, 1),
    nluInvocationThreshold: boundedNumber("NOVA_NLU_INVOCATION_THRESHOLD", 0.86, 0, 1),
    nluAmbiguityMargin: boundedNumber("NOVA_NLU_AMBIGUITY_MARGIN", 0.05, 0, 0.5),
    nluMaxInputChars: boundedInteger("NOVA_NLU_MAX_INPUT_CHARS", 4000, 256, 12000)
  });
}
function boundedNumber(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}
function boundedInteger(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}
module.exports = { loadConfig };
