/**
 * UnansweredQuestionRepository — file-based store for questions the public
 * assistant could not answer with confirmed evidence (§18, §24).
 *
 * Each record captures: the question, the intent the router guessed, the
 * session that asked it, whether it was escalated, and how many times it has
 * been asked. Repeated questions increase `occurrence_count` so the Nova team
 * can prioritise which new FAQ or feature to add next.
 *
 * Follows the FileLeadRepository / PublicLeadRepository pattern: single JSON
 * snapshot, atomic temp-file + rename writes, deep-clone on read.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class UnansweredQuestionRepository {
  constructor({ snapshotFile = null } = {}) {
    this.snapshotFile = snapshotFile;
    this._initial = { questions: {} };
  }

  _read() {
    if (!this.snapshotFile) return structuredClone(this._initial);
    try {
      const raw = fs.readFileSync(this.snapshotFile, "utf8");
      const parsed = JSON.parse(raw);
      return { questions: parsed.questions || {} };
    } catch {
      return structuredClone(this._initial);
    }
  }

  _write(data) {
    if (!this.snapshotFile) return;
    fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true });
    const tmp = `${this.snapshotFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, this.snapshotFile);
  }

  /** Stable hash of a normalised question so repeats collapse into one record. */
  _key(question) {
    const norm = String(question || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\s]/g, " ").replace(/\s+/g, " ").trim();
    return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 16);
  }

  /**
   * Record an unanswered question. If the same normalised question was asked
   * before, increment occurrence_count and last_seen_at instead of duplicating.
   */
  async record({ question, session_id, intent, outcome, industry, language, source = "public_assistant" }) {
    const data = this._read();
    const key = this._key(question);
    const ts = new Date().toISOString();
    let rec = data.questions[key];
    if (!rec) {
      rec = {
        id: `UNANS-${key}`,
        question: String(question || "").trim(),
        normalized_key: key,
        intent: intent || null,
        outcome: outcome || "escalate",
        industry: industry || null,
        language: language || "en",
        source,
        occurrence_count: 0,
        first_seen_at: ts,
        last_seen_at: ts,
        sessions: [],
        status: "open"
      };
      data.questions[key] = rec;
    }
    rec.occurrence_count = (rec.occurrence_count || 0) + 1;
    rec.last_seen_at = ts;
    if (session_id && !rec.sessions.includes(session_id)) {
      rec.sessions.push(session_id);
      if (rec.sessions.length > 50) rec.sessions = rec.sessions.slice(-50);
    }
    if (intent && !rec.intent) rec.intent = intent;
    if (industry && !rec.industry) rec.industry = industry;
    this._write(data);
    return structuredClone(rec);
  }

  async get(id) {
    const data = this._read();
    const rec = Object.values(data.questions).find((q) => q.id === id);
    return rec ? structuredClone(rec) : null;
  }

  async list({ status = null, limit = 100, sortBy = "occurrence_count" } = {}) {
    const data = this._read();
    let rows = Object.values(data.questions);
    if (status) rows = rows.filter((r) => r.status === status);
    rows.sort((a, b) => {
      if (sortBy === "last_seen_at") return (b.last_seen_at || "").localeCompare(a.last_seen_at || "");
      return (b.occurrence_count || 0) - (a.occurrence_count || 0);
    });
    return rows.slice(0, limit).map((r) => structuredClone(r));
  }

  async resolve(id, resolution = "resolved") {
    const data = this._read();
    const rec = Object.values(data.questions).find((q) => q.id === id);
    if (!rec) return null;
    rec.status = resolution;
    rec.resolved_at = new Date().toISOString();
    this._write(data);
    return structuredClone(rec);
  }

  async summary() {
    const data = this._read();
    const rows = Object.values(data.questions);
    return {
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      resolved: rows.filter((r) => r.status === "resolved").length,
      total_occurrences: rows.reduce((sum, r) => sum + (r.occurrence_count || 0), 0),
      top_unanswered: rows
        .filter((r) => r.status === "open")
        .sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0))
        .slice(0, 5)
        .map((r) => ({ question: r.question, count: r.occurrence_count }))
    };
  }
}

module.exports = { UnansweredQuestionRepository };
