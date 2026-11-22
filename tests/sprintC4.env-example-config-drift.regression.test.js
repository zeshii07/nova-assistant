// C4 regression: .env.example must load through loadConfig() without crashing,
// and the NLU vars documented there must actually flow into the config object
// (they didn't before — bare GROQ_NLU_* names were silently ignored).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../packages/config/src/config');

function repoRoot() { return require('child_process').execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }

// Parse .env.example into a clean env object (skip comments + blank lines).
function parseEnvExample() {
  const content = fs.readFileSync(path.join(repoRoot(), '.env.example'), 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    env[key] = val;
  }
  return env;
}

// Run loadConfig with a specific env (without polluting process.env globally).
function loadWithEnv(env) {
  // Save every var we might touch, then wipe them all (canonical + legacy
  // aliases) so a prior test in the same process can't leak a value in.
  const touched = [
    'NODE_ENV','NOVA_STORAGE_MODE','NOVA_NLU_MODE','NOVA_NLU_STRATEGY',
    'NOVA_PUBLIC_LLM_MODE','NOVA_SEMANTIC_ROUTER_MODE','NOVA_DEFAULT_TIMEZONE',
    'GROQ_API_KEY','NOVA_GROQ_NLU_API_KEY',
    'NOVA_GROQ_NLU_MODEL','NOVA_GROQ_NLU_BASE_URL','NOVA_GROQ_NLU_TIMEOUT_MS',
    'GROQ_NLU_MODEL','GROQ_NLU_BASE_URL','GROQ_NLU_TIMEOUT_MS',
  ];
  const saved = {};
  for (const k of touched) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    for (const k of Object.keys(env)) process.env[k] = env[k];
    return loadConfig();
  } finally {
    for (const k of touched) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('C4: .env.example loads through loadConfig() without throwing', () => {
  const env = parseEnvExample();
  // Provide the Groq key so nluMode can flip to "on" if the example sets it;
  // the example ships it empty, so nluMode should stay "off".
  let cfg;
  assert.doesNotThrow(() => { cfg = loadWithEnv(env); }, '.env.example must not crash loadConfig');
  assert.ok(cfg, 'loadConfig returned a config object');
});

test('C4: NOVA_NLU_STRATEGY is documented with a valid value (adaptive|primary), not "off"', () => {
  const env = parseEnvExample();
  assert.ok(env.NOVA_NLU_STRATEGY, 'NOVA_NLU_STRATEGY is documented in .env.example');
  assert.ok(['adaptive', 'primary'].includes(env.NOVA_NLU_STRATEGY.toLowerCase()),
    `NOVA_NLU_STRATEGY="${env.NOVA_NLU_STRATEGY}" is not a valid value (adaptive|primary). "off" crashes the server.`);
});

test('C4: the documented Groq NLU vars use the NOVA_ prefix and flow into config', () => {
  const env = parseEnvExample();
  // The C4 docs bug: bare GROQ_NLU_MODEL / GROQ_NLU_BASE_URL / GROQ_NLU_TIMEOUT_MS
  // were silently ignored. The example must now use the NOVA_ prefix.
  assert.equal(env.GROQ_NLU_MODEL, undefined, '.env.example must not use the bare GROQ_NLU_MODEL (use NOVA_GROQ_NLU_MODEL)');
  assert.equal(env.GROQ_NLU_BASE_URL, undefined, '.env.example must not use the bare GROQ_NLU_BASE_URL (use NOVA_GROQ_NLU_BASE_URL)');
  assert.equal(env.GROQ_NLU_TIMEOUT_MS, undefined, '.env.example must not use the bare GROQ_NLU_TIMEOUT_MS (use NOVA_GROQ_NLU_TIMEOUT_MS)');
  assert.ok(env.NOVA_GROQ_NLU_MODEL, 'NOVA_GROQ_NLU_MODEL is documented');
  assert.ok(env.NOVA_GROQ_NLU_BASE_URL, 'NOVA_GROQ_NLU_BASE_URL is documented');
  // Verify the documented value actually reaches the config object.
  const cfg = loadWithEnv({ ...env, GROQ_API_KEY: 'k' });
  assert.equal(cfg.groqNluModel, env.NOVA_GROQ_NLU_MODEL);
  assert.equal(cfg.groqNluBaseUrl, env.NOVA_GROQ_NLU_BASE_URL);
  assert.equal(cfg.groqNluTimeoutMs, Number(env.NOVA_GROQ_NLU_TIMEOUT_MS));
});

test('C4 repro: NOVA_NLU_STRATEGY=off still crashes loadConfig (the bug is the value, not the var)', () => {
  // This proves the crash mechanism: "off" is not a valid strategy. The fix
  // is to document NOVA_NLU_MODE=off instead (which IS valid) — not to accept
  // "off" as a strategy value.
  assert.throws(
    () => loadWithEnv({ NOVA_STORAGE_MODE: 'memory', NOVA_NLU_STRATEGY: 'off' }),
    /NOVA_NLU_STRATEGY must be adaptive or primary/,
  );
  // And the correct way to disable LLM NLU works:
  const cfg = loadWithEnv({ NOVA_STORAGE_MODE: 'memory', NOVA_NLU_MODE: 'off' });
  assert.equal(cfg.nluMode, 'off');
});

test('C4 backward-compat: legacy GROQ_NLU_* aliases still work (with a deprecation warning)', () => {
  // Capture console.warn to assert the deprecation message fires.
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const cfg = loadWithEnv({
      NOVA_STORAGE_MODE: 'memory',
      GROQ_NLU_MODEL: 'legacy-model',
      GROQ_NLU_BASE_URL: 'https://legacy.example/v1',
      GROQ_NLU_TIMEOUT_MS: '7777',
    });
    assert.equal(cfg.groqNluModel, 'legacy-model', 'legacy GROQ_NLU_MODEL value is used');
    assert.equal(cfg.groqNluBaseUrl, 'https://legacy.example/v1', 'legacy GROQ_NLU_BASE_URL value is used');
    assert.equal(cfg.groqNluTimeoutMs, 7777, 'legacy GROQ_NLU_TIMEOUT_MS value is used');
    assert.ok(warns.some((w) => /deprecation.*GROQ_NLU_MODEL/i.test(w)), 'deprecation warning fires for GROQ_NLU_MODEL');
  } finally {
    console.warn = origWarn;
  }
  // Canonical name wins over the legacy alias when both are set.
  const cfg2 = loadWithEnv({
    NOVA_STORAGE_MODE: 'memory',
    NOVA_GROQ_NLU_MODEL: 'canonical',
    GROQ_NLU_MODEL: 'legacy',
  });
  assert.equal(cfg2.groqNluModel, 'canonical', 'canonical NOVA_GROQ_NLU_MODEL wins over the legacy alias');
});
