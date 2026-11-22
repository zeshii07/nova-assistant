// C4 regression: env-var drift between .env.example and config.js must be
// caught in CI. This is the structural guard: every var config.js reads must
// be documented in .env.example, and every config var documented in
// .env.example must be read by config.js (or be a known non-config / legacy
// alias). Prevents the C4 silent-ignore + boot-crash bugs from recurring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_VARS, LEGACY_ALIASES, NON_CONFIG_VARS, ENUM_VALUES } = require('../packages/config/src/envRegistry');

function repoRoot() { return require('child_process').execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }

function exampleVarNames() {
  const content = fs.readFileSync(path.join(repoRoot(), '.env.example'), 'utf8');
  const names = new Set();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    names.add(trimmed.slice(0, eq).trim());
  }
  return names;
}

test('C4 drift: every var config.js reads is documented in .env.example', () => {
  const documented = exampleVarNames();
  const missing = CONFIG_VARS.filter((v) => !documented.has(v));
  assert.deepEqual(missing, [], `config.js reads vars not in .env.example: ${missing.join(', ')}`);
});

test('C4 drift: every var in .env.example is read by config.js OR is a known non-config/legacy var', () => {
  const documented = exampleVarNames();
  const allowed = new Set([...CONFIG_VARS, ...NON_CONFIG_VARS, ...Object.keys(LEGACY_ALIASES)]);
  const unknown = [...documented].filter((v) => !allowed.has(v));
  assert.deepEqual(unknown.sort(), [], `.env.example documents vars nothing reads: ${unknown.join(', ')}`);
});

test('C4 drift: enum vars in .env.example use only their allowed values', () => {
  // Parses the literal value from .env.example and checks it against ENUM_VALUES.
  // Catches the exact bug: NOVA_NLU_STRATEGY=off (off is not a valid strategy).
  const content = fs.readFileSync(path.join(repoRoot(), '.env.example'), 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  for (const [varName, allowed] of Object.entries(ENUM_VALUES)) {
    if (env[varName] === undefined) continue;  // var not in example — skip
    assert.ok(allowed.includes(env[varName].toLowerCase()),
      `.env.example has ${varName}=${env[varName]} but only [${allowed.join('|')}] are valid (server crashes on boot otherwise)`);
  }
});

test('C4 drift: the registry covers the vars config.js actually reads (no silent drift in the registry itself)', () => {
  // Parse config.js for the env vars it reads and assert they are all in
  // CONFIG_VARS (+ LEGACY_ALIASES). This catches a developer adding a new env
  // var to config.js without updating the registry.
  const src = fs.readFileSync(path.join(repoRoot(), 'packages/config/src/config.js'), 'utf8');
  const read = new Set();
  for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) read.add(m[1]);
  for (const m of src.matchAll(/bounded(?:Integer|Number)\("([A-Z_][A-Z0-9_]*)"/g)) read.add(m[1]);
  read.delete('NODE_TEST_CONTEXT');  // test-only, intentionally undocumented
  const registry = new Set([...CONFIG_VARS, ...Object.keys(LEGACY_ALIASES)]);
  const untracked = [...read].filter((v) => !registry.has(v));
  assert.deepEqual(untracked.sort(), [], `config.js reads vars missing from envRegistry CONFIG_VARS: ${untracked.join(', ')}`);
});
