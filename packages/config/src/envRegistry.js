/**
 * C4 — single source of truth for Nova's environment variables.
 *
 * Bug report C4: .env.example and config.js drifted apart. Three bare
 * GROQ_NLU_* names in .env.example were never read by config.js (silent
 * ignores — set the value, get the default), and NOVA_NLU_STRATEGY was
 * documented as accepting "off" which crashes the server on boot. This
 * registry lets the drift test assert that every config var is documented and
 * every documented config var is read, so the drift cannot silently recur.
 *
 * Canonical = the name config.js actually reads.
 * Legacy    = an older alias still accepted (with a deprecation warning) for
 *             backward compat. Listed so the drift test does not flag them as
 *             undocumented drift.
 * Owner     = which module reads the var. "config" → packages/config; other
 *             modules read their own vars directly (emailService, etc.) and
 *             are NOT required to appear in .env.example's config section.
 */
'use strict';

// Vars read by config.js (canonical names). Keep in sync with loadConfig().
const CONFIG_VARS = [
  'NODE_ENV',
  'PORT',
  'DEFAULT_TENANT_ID',
  'TENANTS_DIR',
  'LOG_LEVEL',
  'NOVA_STORAGE_MODE',
  'NOVA_LOCAL_DATA_DIR',
  'NOVA_KNOWLEDGE_DATA_DIR',
  'NOVA_OPERATIONAL_DATA_DIR',
  'DATABASE_URL',
  'REDIS_URL',
  'NOVA_STATE_TTL_SECONDS',
  'NOVA_DB_POOL_MAX',
  'NOVA_INVENTORY_RESERVATION_TTL_SECONDS',
  'NOVA_NLU_MODE',
  'NOVA_NLU_STRATEGY',
  'NOVA_SEMANTIC_ROUTER_MODE',
  'NOVA_PUBLIC_LLM_MODE',
  'NOVA_DEFAULT_TIMEZONE',
  'NOVA_SEMANTIC_ROUTER_MIN_CONFIDENCE',
  'NOVA_SEMANTIC_ROUTER_MIN_MARGIN',
  'NOVA_SEMANTIC_ROUTER_MIN_SIMILARITY',
  'NOVA_SEMANTIC_ROUTER_MAX_LOCAL_INTENTS',
  'NOVA_GROQ_NLU_BASE_URL',
  'NOVA_GROQ_NLU_MODEL',
  'GROQ_API_KEY',
  'NOVA_GROQ_NLU_TIMEOUT_MS',
  'NOVA_GROQ_NLU_FAILURE_COOLDOWN_MS',
  'NOVA_NLU_MIN_CONFIDENCE',
  'NOVA_NLU_INFORMATION_THRESHOLD',
  'NOVA_NLU_ACTION_THRESHOLD',
  'NOVA_NLU_INVOCATION_THRESHOLD',
  'NOVA_NLU_AMBIGUITY_MARGIN',
  'NOVA_NLU_MAX_INPUT_CHARS',
];

// Legacy aliases accepted for backward compat (emit a deprecation warning).
// These are tolerated in .env.example but should be migrated to the canonical
// NOVA_-prefixed name.
const LEGACY_ALIASES = {
  'GROQ_NLU_MODEL': 'NOVA_GROQ_NLU_MODEL',
  'GROQ_NLU_BASE_URL': 'NOVA_GROQ_NLU_BASE_URL',
  'GROQ_NLU_TIMEOUT_MS': 'NOVA_GROQ_NLU_TIMEOUT_MS',
  // NOVA_GROQ_NLU_API_KEY is the older alternate name for the Groq API key.
  // GROQ_API_KEY is the documented/preferred name; both are read, the first
  // non-empty one wins. Listed as a legacy alias so the drift test tolerates
  // it being undocumented in .env.example (operators should use GROQ_API_KEY).
  'NOVA_GROQ_NLU_API_KEY': 'GROQ_API_KEY',
};

// Vars read by other modules (NOT config.js). These are legitimate and must
// NOT be flagged as drift when they appear in .env.example.
const NON_CONFIG_VARS = [
  // clusterManager (C2)
  'NOVA_WORKERS',
  'NOVA_SINGLE_WORKER',
  'NOVA_WORKER_HEARTBEAT_MS',
  'NOVA_WORKER_MAX_MISSED_BEATS',
  // emailService (notification-engine)
  'NOVA_SMTP_HOST',
  'NOVA_SMTP_PORT',
  'NOVA_SMTP_USER',
  'NOVA_SMTP_PASS',
  'NOVA_SMTP_FROM',
  // googleOAuthClient (calendar-engine)
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
];

// Valid enum values for vars that have them. Used by the regression test to
// catch the exact C4 bug (NOVA_NLU_STRATEGY=off crashes the server).
const ENUM_VALUES = {
  NOVA_STORAGE_MODE: ['memory', 'persistent'],
  NOVA_NLU_MODE: ['off', 'on'],
  NOVA_NLU_STRATEGY: ['adaptive', 'primary'],
  NOVA_SEMANTIC_ROUTER_MODE: ['off', 'on'],
  NOVA_PUBLIC_LLM_MODE: ['off', 'on'],
};

module.exports = { CONFIG_VARS, LEGACY_ALIASES, NON_CONFIG_VARS, ENUM_VALUES };
