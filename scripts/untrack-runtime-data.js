#!/usr/bin/env node
/**
 * C3 fix — untrack runtime data directories that leaked customer PII into git.
 *
 * Bug report C3: .nova-data/ was in .gitignore but the .nova-feedback/ and
 * .nova-notifications/ directories were NOT ignored, and 4 runtime JSON files
 * were committed to the repo (commit 2aa8281). The notifications file holds
 * real customer PII — names (e.g. "Ahmed Khan", "Sara Ali") and phone numbers
 * (e.g. +971501234567) in lead-capture notifications; the feedback files
 * hold customer chat message text. These are runtime-only artifacts written
 * by FeedbackCollector and FileNotificationLogRepository (both recreate the
 * dir on construction via mkdirSync recursive), so untracking is safe.
 *
 * This script is IDEMPOTENT: safe to re-run. It:
 *   1. Adds .nova-feedback/ and .nova-notifications/ to .gitignore (and any
 *      other Nova runtime data dir that should never be tracked).
 *   2. Runs `git rm -r --cached` on those dirs so they are removed from the
 *      index WITHOUT deleting the on-disk files (the app still has them).
 *   3. Reports what it did.
 *
 * It does NOT rewrite git history (that requires git filter-repo + a force
 * push, which only the repo owner should do — see PURGE_HISTORY.md).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Directories that hold Nova runtime data and must NEVER be tracked.
// .nova-data/ is already ignored; the rest are the C3 additions.
const RUNTIME_DATA_DIRS = [
  '.nova-data/',
  '.nova-feedback/',
  '.nova-notifications/',
];

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function readGitignore(root) {
  const p = path.join(root, '.gitignore');
  return { path: p, exists: fs.existsSync(p), content: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' };
}

function ensureIgnored(root) {
  const gi = readGitignore(root);
  const lines = gi.exists ? gi.content.split(/\r?\n/) : [];
  const missing = RUNTIME_DATA_DIRS.filter((d) => !lines.some((l) => l.trim() === d.replace(/\/$/, '') || l.trim() === d));
  if (missing.length === 0) return { added: [], gitignorePath: gi.path };
  const newContent = (gi.exists ? gi.content.replace(/\s*$/, '\n') : '') + '\n# C3: Nova runtime data dirs — never track customer PII / runtime state\n' + missing.join('\n') + '\n';
  fs.writeFileSync(gi.path, newContent);
  return { added: missing, gitignorePath: gi.path };
}

function isTracked(root, dir) {
  try {
    const out = execFileSync('git', ['ls-files', '--', dir], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function untrackDir(root, dir) {
  // git rm -r --cached removes from index without touching the on-disk files.
  // The dir arg is the path WITH trailing slash stripped for git.
  const target = dir.replace(/\/$/, '');
  execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', target], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
}

function verifyNotTracked(root) {
  const stillTracked = [];
  for (const dir of RUNTIME_DATA_DIRS) {
    const target = dir.replace(/\/$/, '');
    try {
      const out = execFileSync('git', ['ls-files', '--', target], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (out.trim().length > 0) stillTracked.push(dir);
    } catch (_) {}
  }
  return stillTracked;
}

function main() {
  const root = repoRoot();
  const log = [];
  log.push(`[C3] repo root: ${root}`);

  // 1. Update .gitignore
  const { added, gitignorePath } = ensureIgnored(root);
  if (added.length > 0) {
    log.push(`[C3] added to ${gitignorePath}: ${added.join(', ')}`);
  } else {
    log.push(`[C3] .gitignore already covers all runtime data dirs`);
  }

  // 2. Untrack any that are currently tracked (idempotent)
  const untracked = [];
  for (const dir of RUNTIME_DATA_DIRS) {
    if (isTracked(root, dir)) {
      untrackDir(root, dir);
      untracked.push(dir);
    }
  }
  if (untracked.length > 0) {
    log.push(`[C3] untracked from git index (on-disk files kept): ${untracked.join(', ')}`);
  } else {
    log.push(`[C3] no runtime data dirs were tracked — nothing to untrack`);
  }

  // 3. Verify
  const stillTracked = verifyNotTracked(root);
  if (stillTracked.length > 0) {
    log.push(`[C3] ERROR — still tracked after untrack: ${stillTracked.join(', ')}`);
    console.error(log.join('\n'));
    process.exit(1);
  }
  log.push(`[C3] verified: none of ${RUNTIME_DATA_DIRS.join(', ')} are tracked`);

  console.log(log.join('\n'));
  console.log('[C3] done. Commit the .gitignore change + the removal from the index.');
  console.log('[C3] IMPORTANT: history still contains the leaked PII — run PURGE_HISTORY.md steps to rewrite history, then treat the phone numbers as leaked.');
}

if (require.main === module) {
  main();
}

module.exports = { RUNTIME_DATA_DIRS, ensureIgnored, isTracked, untrackDir, verifyNotTracked, repoRoot };
