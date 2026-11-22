#!/usr/bin/env node
/**
 * Installs the C3 pre-commit guard into .git/hooks/pre-commit.
 * Safe to re-run. Dependency-free.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = (() => {
  try { return require('child_process').execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();

const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
const guardPath = path.join(repoRoot, 'scripts', 'pre-commit-guard.js');

if (!fs.existsSync(guardPath)) {
  console.error(`[install-hooks] guard script not found at ${guardPath}`);
  process.exit(1);
}

const hookContent = `#!/bin/sh
# Installed by scripts/install-hooks.js — C3 pre-commit guard.
node "${guardPath}" "$@"
`;

fs.mkdirSync(path.dirname(hookPath), { recursive: true });
fs.writeFileSync(hookPath, hookContent);
fs.chmodSync(hookPath, 0o755);
console.log(`[install-hooks] pre-commit guard installed → ${hookPath}`);
