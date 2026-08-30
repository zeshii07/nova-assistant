/**
 * Nova State Machine with Schema Validation
 *
 * Replaces the flat JSON state blob with a typed state machine that:
 * - Validates state shape against a schema
 * - Deep-merges state patches (not shallow)
 * - Guards against invalid state transitions
 * - Provides rollback when a capability handler throws
 *
 * Design principles:
 * - Backward compatible: existing state blobs still work
 * - Progressive: schema validation only warns (doesn't throw) for now
 * - Auditable: every state transition is logged
 */

/**
 * State schema definition.
 * Describes the expected shape of conversation state.
 */
const STATE_SCHEMA = Object.freeze({
  schemaVersion: { type: 'number', required: true, default: 2 },
  tenantId: { type: 'string', required: true },
  conversationId: { type: 'string', required: true },
  channel: { type: 'string', required: true },
  customerId: { type: 'string', required: true },
  language: { type: 'string', required: true, default: 'english', enum: ['english', 'roman_urdu', 'urdu', 'arabic'] },
  mode: { type: 'string', required: true, default: 'chatting', enum: ['chatting', 'collecting', 'reviewing', 'confirmed', 'cancelled'] },
  activePlugin: { type: 'string', required: false, default: null },
  pendingQuestion: { type: 'string', required: false, default: null },
  lastIntent: { type: 'string', required: false, default: null },
  context: { type: 'object', required: false, default: {} },
  capabilityState: { type: 'object', required: false, default: {} },
  createdAt: { type: 'string', required: true },
  updatedAt: { type: 'string', required: true },
});

/**
 * Valid state transitions.
 * Key: current mode, Value: set of allowed next modes.
 */
const TRANSITIONS = Object.freeze({
  chatting: new Set(['chatting', 'collecting', 'cancelled']),
  collecting: new Set(['collecting', 'reviewing', 'chatting', 'cancelled']),
  reviewing: new Set(['reviewing', 'confirmed', 'collecting', 'chatting', 'cancelled']),
  confirmed: new Set(['confirmed', 'chatting', 'cancelled']),
  cancelled: new Set(['cancelled', 'chatting']),
});

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 * Null/undefined values are skipped (don't overwrite existing).
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return source;
  if (Array.isArray(source)) return [...source]; // Arrays: replace
  if (Array.isArray(target)) return source; // Replace array with object

  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    if (sourceVal === null || sourceVal === undefined) continue; // Skip null/undefined
    if (typeof sourceVal === 'object' && !Array.isArray(sourceVal) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

/**
 * Validate a state object against the schema.
 * Returns { valid, warnings, errors }.
 */
function validateState(state) {
  const warnings = [];
  const errors = [];

  if (!state || typeof state !== 'object') {
    return { valid: false, warnings, errors: ['State is not an object'] };
  }

  for (const [key, rule] of Object.entries(STATE_SCHEMA)) {
    if (rule.required && !(key in state)) {
      if (rule.default !== undefined) {
        warnings.push(`Missing required field '${key}', using default: ${JSON.stringify(rule.default)}`);
      } else {
        errors.push(`Missing required field '${key}'`);
      }
    }
    if (key in state && rule.type) {
      const actualType = Array.isArray(state[key]) ? 'array' : typeof state[key];
      if (actualType !== rule.type && actualType !== 'array') {
        warnings.push(`Field '${key}' has type '${actualType}', expected '${rule.type}'`);
      }
    }
    if (rule.enum && key in state && !rule.enum.includes(state[key])) {
      warnings.push(`Field '${key}' has value '${state[key]}', expected one of: ${rule.enum.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Check if a mode transition is valid.
 */
function isValidTransition(fromMode, toMode) {
  if (!fromMode || !toMode) return true; // Allow null/undefined
  const allowed = TRANSITIONS[fromMode];
  if (!allowed) return true; // Unknown mode: allow (backward compat)
  return allowed.has(toMode);
}

/**
 * Create initial state with schema defaults applied.
 */
function createInitialState({ tenantId, conversationId, channel, customerId, language = 'english' }) {
  const now = new Date().toISOString();
  const state = {};
  for (const [key, rule] of Object.entries(STATE_SCHEMA)) {
    if (rule.default !== undefined) state[key] = rule.default;
  }
  Object.assign(state, {
    schemaVersion: 2,
    tenantId,
    conversationId,
    channel,
    customerId,
    language,
    mode: 'chatting',
    activePlugin: null,
    pendingQuestion: null,
    context: {},
    capabilityState: {},
    createdAt: now,
    updatedAt: now,
  });
  return state;
}

/**
 * Apply a state patch using deep merge.
 * Validates the result and logs warnings.
 * Returns the new state.
 */
function applyStatePatch(state, patch = {}, logger = null) {
  if (!patch || Object.keys(patch).length === 0) return state;

  // Deep merge the patch into the state
  const newState = deepMerge(state, patch);

  // Update timestamp
  newState.updatedAt = new Date().toISOString();

  // Check mode transition
  if (patch.mode && state.mode && patch.mode !== state.mode) {
    if (!isValidTransition(state.mode, patch.mode)) {
      if (logger) {
        logger.warn('state.invalid_transition', {
          from: state.mode,
          to: patch.mode,
          conversationId: state.conversationId,
        });
      }
    }
  }

  // Validate (warn only, don't throw — backward compat)
  const validation = validateState(newState);
  if (logger && validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      logger.debug('state.validation_warning', { warning: w, conversationId: newState.conversationId });
    }
  }

  return newState;
}

/**
 * Snapshot state for rollback.
 * Returns a deep clone of the state.
 */
function snapshotState(state) {
  try {
    return structuredClone(state);
  } catch {
    return JSON.parse(JSON.stringify(state));
  }
}

/**
 * Rollback to a previous state snapshot.
 * Merges the snapshot's capabilityState with current (preserves durable data).
 */
function rollbackState(currentState, snapshot) {
  if (!snapshot) return currentState;
  return {
    ...currentState,
    ...snapshot,
    // Preserve durable data from current state (CRM, orders, etc.)
    context: {
      ...currentState.context,
      ...snapshot.context,
    },
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  STATE_SCHEMA,
  TRANSITIONS,
  deepMerge,
  validateState,
  isValidTransition,
  createInitialState,
  applyStatePatch,
  snapshotState,
  rollbackState,
};
