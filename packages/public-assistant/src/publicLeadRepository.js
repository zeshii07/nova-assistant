/**
 * PublicLeadRepository — file-based store for public-assistant leads.
 *
 * Follows the existing FileLeadRepository / LocalJsonFile pattern
 * (packages/lead-engine/src/fileLeadRepository.js, packages/storage/src/localJsonFile.js):
 * a single JSON snapshot, atomic temp-file + rename writes, deep-clone on read.
 *
 * Leads are keyed by lead_id only (not by tenantId:leadId) because the public
 * assistant is a single namespace. This keeps public leads physically separate
 * from tenant lead files (leads.json) so the platform-wide LeadService cannot
 * accidentally surface them under a tenant query.
 */
const fs = require("fs");
const path = require("path");

class PublicLeadRepository {
  constructor({ snapshotFile = null } = {}) {
    this.snapshotFile = snapshotFile;
    this._initial = { leads: {}, demoRequests: {} };
  }

  _read() {
    if (!this.snapshotFile) return structuredClone(this._initial);
    try {
      const raw = fs.readFileSync(this.snapshotFile, "utf8");
      const parsed = JSON.parse(raw);
      return {
        leads: parsed.leads || {},
        demoRequests: parsed.demoRequests || {}
      };
    } catch {
      return structuredClone(this._initial);
    }
  }

  _write(data) {
    if (!this.snapshotFile) return;
    fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true });
    const tmp = `${this.snapshotFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, this.snapshotFile); // POSIX-atomic
  }

  async getLead(leadId) {
    const data = this._read();
    const lead = data.leads[leadId];
    return lead ? structuredClone(lead) : null;
  }

  async upsertLead(lead) {
    const data = this._read();
    data.leads[lead.id] = lead;
    this._write(data);
    return structuredClone(lead);
  }

  async listLeads({ status = null, limit = 100 } = {}) {
    const data = this._read();
    let rows = Object.values(data.leads);
    if (status) rows = rows.filter((r) => r.lead_status === status);
    rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return rows.slice(0, limit).map((r) => structuredClone(r));
  }

  async upsertDemoRequest(demoRequest) {
    const data = this._read();
    data.demoRequests[demoRequest.id] = demoRequest;
    this._write(data);
    return structuredClone(demoRequest);
  }

  async listDemoRequests({ leadId = null, limit = 100 } = {}) {
    const data = this._read();
    let rows = Object.values(data.demoRequests);
    if (leadId) rows = rows.filter((r) => r.lead_id === leadId);
    rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return rows.slice(0, limit).map((r) => structuredClone(r));
  }

  async summary() {
    const data = this._read();
    const leads = Object.values(data.leads);
    return {
      total: leads.length,
      by_status: leads.reduce((acc, l) => { acc[l.lead_status] = (acc[l.lead_status] || 0) + 1; return acc; }, {}),
      demo_requests: Object.keys(data.demoRequests).length
    };
  }
}

module.exports = { PublicLeadRepository };
