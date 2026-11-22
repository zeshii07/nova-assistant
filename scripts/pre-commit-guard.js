#!/usr/bin/env node
/**
 * C3 pre-commit guard — refuses to commit any file under Nova's runtime data
 * directories. These dirs hold customer PII (names, phone numbers) and
 * runtime conversation state; they were accidentally committed once (commit
 * 2aa8281) and this guard prevents a recurrence.
 *
 * Install: run `node scripts/install-hooks.js` (or copy this file to
 * .git/hooks/pre-commit and chmod +x). It is also run by the test suite.
 *
 * Exits 1 (blocking) if any staged file lives under a runtime data dir;
 * exits 0 otherwise. Idempotent and dependency-free.
 */
'use strict';

const { execFileSync } = require('child_process');

const RUNTIME_DATA_DIRS = [
  '.nova-data/',
  '.nova-feedback/',
  '.nova-notifications/',
];

function stagedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames'], { encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isUnderRuntimeDir(file) {
  // Normalize to forward slashes; a file is under a runtime dir if its path
  // starts with the dir (without trailing slash).
  const f = file.replace(/\\/g, '/');
  return RUNTIME_DATA_DIRS.some((d) => f.startsWith(d) || f.startsWith(d.replace(/\/$/, '') + '/'));
}

function main() {
  const staged = stagedFiles();
  const offending = staged.filter(isUnderRuntimeDir);
  if (offending.length === 0) {
    process.exit(0);
  }
  console.error('[C3 pre-commit] BLOCKED — refusing to commit runtime data / customer PII:');
  for (const f of offending) {
    console.error('  ' + f);
  }
  console.error('');
  console.error('These directories hold runtime state and customer PII and must never be tracked.');
  console.error('If you added a new runtime data dir, add it to .gitignore and to RUNTIME_DATA_DIRS');
  console.error('in scripts/pre-commit-guard.js. To unstage: git rm -r --cached <path>');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { RUNTIME_DATA_DIRS, stagedFiles, isUnderRuntimeDir };
