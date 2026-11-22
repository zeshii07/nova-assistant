// C3 regression: Nova runtime data directories must NEVER be tracked in git.
//
// Bug report C3: .nova-data/ was in .gitignore but .nova-feedback/ and
// .nova-notifications/ were NOT, and 4 runtime JSON files were committed
// (commit 2aa8281). The notifications file holds real customer PII (names +
// phone numbers in lead-capture notifications); the feedback files hold
// customer chat message text. This test guards against re-adding them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { RUNTIME_DATA_DIRS } = require('../scripts/untrack-runtime-data.js');

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function gitLsFiles(rel) {
  try {
    return execFileSync('git', ['ls-files', '--', rel.replace(/\/$/, '')], {
      cwd: repoRoot(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

test('C3: none of the runtime data directories are tracked in git', () => {
  for (const dir of RUNTIME_DATA_DIRS) {
    const tracked = gitLsFiles(dir);
    assert.equal(tracked, '', `git tracks files under ${dir} — run scripts/untrack-runtime-data.js. tracked: ${tracked.split('\n').slice(0, 3).join(', ')}`);
  }
});

test('C3: .gitignore covers every runtime data directory', () => {
  const gi = fs.readFileSync(path.join(repoRoot(), '.gitignore'), 'utf8');
  const lines = new Set(gi.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  for (const dir of RUNTIME_DATA_DIRS) {
    const bare = dir.replace(/\/$/, '');
    // accept either the trailing-slash form or the bare form
    assert.ok(lines.has(dir) || lines.has(bare),
      `.gitignore does not ignore ${dir} (add "${dir}" to .gitignore)`);
  }
});

test('C3: the untrack script is idempotent — re-running changes nothing', () => {
  // Run the script a second time; it must not error and must leave the index
  // with no tracked runtime data files.
  const { untrackDir, isTracked, verifyNotTracked, ensureIgnored } = require('../scripts/untrack-runtime-data.js');
  const root = repoRoot();
  // ensureIgnored must report nothing to add on a second run.
  const before = ensureIgnored(root);
  assert.equal(before.added.length, 0, `.gitignore already complete but ensureIgnored wanted to add: ${before.added.join(', ')}`);
  // No dir should be tracked.
  const stillTracked = verifyNotTracked(root);
  assert.deepEqual(stillTracked, [], `runtime data dirs are tracked after idempotent re-run: ${stillTracked.join(', ')}`);
});

test('C3 pre-commit guard: blocks a staged runtime data file', () => {
  const { isUnderRuntimeDir, RUNTIME_DATA_DIRS } = require('../scripts/pre-commit-guard.js');
  for (const dir of RUNTIME_DATA_DIRS) {
    const bare = dir.replace(/\/$/, '');
    assert.ok(isUnderRuntimeDir(`${bare}/cleaning-demo.json`),
      `guard must flag a staged file under ${dir}`);
    assert.ok(isUnderRuntimeDir(`${bare}/nested/deep.json`),
      `guard must flag nested files under ${dir}`);
  }
  // A normal source file must NOT be flagged.
  assert.equal(isUnderRuntimeDir('apps/api/src/server.js'), false, 'guard must not flag source files');
  assert.equal(isUnderRuntimeDir('packages/state/src/memoryStateRepository.js'), false, 'guard must not flag package files');
});
