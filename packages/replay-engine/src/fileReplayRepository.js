// v35.3: File-based replay repository — persists conversations to disk so
// they survive server restarts. Used as a backing store for the in-memory
// repository (write-through pattern).
const fs = require('fs');
const path = require('path');

class FileReplayRepository {
  constructor({ dir, logger = null }) {
    this.dir = dir;
    this.logger = logger;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _filePath(id) {
    // Sanitize id — only allow alphanumeric + dash + underscore
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  async save(record) {
    if (!record?.id) throw new Error('record.id is required');
    const filePath = this._filePath(record.id);
    const data = JSON.stringify(record, null, 2);
    // v35.3: atomic write — write to .tmp then rename
    const tmpPath = filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, data, 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }

  async get(id) {
    const filePath = this._filePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  async list({ limit = 50 } = {}) {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        records.push(r);
      } catch {}
    }
    return records
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit);
  }

  async clear() {
    if (!fs.existsSync(this.dir)) return;
    for (const file of fs.readdirSync(this.dir)) {
      if (file.endsWith('.json')) {
        try { fs.unlinkSync(path.join(this.dir, file)); } catch {}
      }
    }
  }
}

function createFileReplayRepository(opts) {
  return new FileReplayRepository(opts);
}

module.exports = { FileReplayRepository, createFileReplayRepository };
