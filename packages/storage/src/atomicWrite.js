// v35.3: Atomic file write helpers — prevents race conditions when multiple
// requests write to the same file concurrently.
//
// Strategy: write to a unique .tmp file, then rename atomically. On POSIX
// systems, rename() is atomic — readers always see either the old or the
// new file, never a partially-written one.
//
// Also includes a simple in-process file lock for sequential writes to
// the same path (prevents two concurrent writes to the same JSON file
// from interleaving).

const fs = require('fs');
const path = require('path');
const os = require('os');

const _locks = new Map();

/**
 * Acquire a sequential lock for a file path. Releases automatically after
 * the async callback completes (success or failure).
 *
 * Usage:
 *   await withFileLock(filePath, async () => {
 *     const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
 *     data.push(newItem);
 *     await atomicWriteJson(filePath, data);
 *   });
 */
async function withFileLock(filePath, fn) {
  // Wait for any existing lock on this path
  while (_locks.has(filePath)) {
    await _locks.get(filePath);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      _locks.delete(filePath);
    }
  })();
  _locks.set(filePath, promise.catch(() => {})); // swallow rejection in lock
  return promise;
}

/**
 * Atomically write JSON to a file. Writes to a temp file first, then renames.
 * Ensures readers never see a partial write.
 *
 * @param {string} filePath - destination path
 * @param {any} data - JSON-serializable data
 * @param {object} [opts] - { pretty: true } for 2-space indent
 */
function atomicWriteJson(filePath, data, opts = {}) {
  const json = opts.pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data);
  return atomicWriteFile(filePath, json);
}

/**
 * Atomically write text to a file. Writes to a temp file first, then renames.
 */
function atomicWriteFile(filePath, text) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Use a unique temp file per process + random suffix to avoid collisions
  const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, text, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Read JSON safely — returns fallback if file doesn't exist or is invalid.
 */
function readJsonSync(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read JSON asynchronously — returns fallback if file doesn't exist or is invalid.
 */
async function readJson(filePath, fallback = null) {
  return new Promise((resolve) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return resolve(fallback);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(fallback);
      }
    });
  });
}

module.exports = {
  withFileLock,
  atomicWriteJson,
  atomicWriteFile,
  readJsonSync,
  readJson,
};
