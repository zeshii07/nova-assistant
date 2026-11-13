/**
 * PublicLeadService — §12 (qualification + scoring) and §13 (lead/demo submission).
 *
 * Responsibilities:
 *  - Validate consented lead fields (server-side email/phone validation).
 *  - Score the lead using the spec's heuristic signal table.
 *  - Persist the lead through PublicLeadRepository.
 *  - Create demo requests linked to a lead.
 *  - Emit analytics events through EventBus (public_chat.lead_submitted etc).
 *
 * Hard rules (§13, §20):
 *  - Never submit a lead without explicit consent (consent.contact_allowed === true).
 *  - Never claim success before the repository confirms the write.
 *  - Idempotent on (session_id + email) or (session_id + phone) to avoid duplicates.
 *  - Personal data (email/phone) lives only in this protected store, never in analytics.
 */
const crypto = require("crypto");

// §12 — lead scoring signals (heuristic, not validated predictors).
const LEAD_SCORE_SIGNALS = [
  { id: "identified_business", test: (f) => Boolean(f.business_name && f.business_name.trim()), points: 10 },
  { id: "described_problem", test: (f) => Boolean(f.business_problem && f.business_problem.trim().length > 8), points: 15 },
  { id: "requested_demo", test: (f) => Boolean(f.demo_requested), points: 25 },
  { id: "asked_pricing", test: (f) => Array.isArray(f.requested_workflows) && f.requested_workflows.includes("pricing"), points: 15 },
  { id: "requested_customization", test: (f) => Boolean(f.requested_customization), points: 15 },
  { id: "provided_contact", test: (f) => Boolean(f.email || f.phone), points: 15 },
  { id: "purchase_timeline", test: (f) => Boolean(f.purchase_timeline), points: 10 },
  { id: "only_researching", test: (f) => f.purchase_timeline === "just_researching", points: -5 }
];

// §12 — status bands.
function bandForScore(score) {
  if (score >= 60) return "high_intent";
  if (score >= 40) return "qualified";
  if (score >= 20) return "interested";
  return "early_research";
}

// §12 — lead statuses.
const LEAD_STATUSES = [
  "anonymous", "engaged", "identified", "qualified",
  "demo_requested", "sales_contact_requested", "contacted", "converted",
  "not_interested", "spam"
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Permissive international phone: digits, spaces, +, -, parentheses, 7-20 chars.
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{6,19}$/;

class PublicLeadService {
  constructor({ repository, eventBus = null, logger = null, now = () => new Date() } = {}) {
    this.repository = repository;
    this.eventBus = eventBus;
    this.logger = logger;
    this.now = now;
  }

  /** Compute the lead score and its component signals from a fields object. */
  scoreLead(fields) {
    const components = [];
    let total = 0;
    for (const sig of LEAD_SCORE_SIGNALS) {
      if (sig.test(fields)) {
        components.push({ signal: sig.id, points: sig.points });
        total += sig.points;
      }
    }
    return { score: total, band: bandForScore(total), components };
  }

  /** Validate contact fields. Returns {valid, errors}. */
  validateContact(fields) {
    const errors = [];
    const email = fields.email ? String(fields.email).trim() : "";
    const phone = fields.phone ? String(fields.phone).trim() : "";
    if (email && !EMAIL_RE.test(email)) errors.push("email_format");
    if (phone && !PHONE_RE.test(phone)) errors.push("phone_format");
    if (!email && !phone) errors.push("contact_required");
    if (!fields.name || !String(fields.name).trim()) errors.push("name_required");
    return { valid: errors.length === 0, errors };
  }

  /**
   * Submit a consented lead. §13.
   * @param {object} fields - { session_id, name, business_name, industry, email, phone, ... }
   * @param {object} consent - { contact_allowed: true, consent_text_version, captured_at }
   * @returns {Promise<{success, lead_id, status}>}
   */
  async submitLead(fields, consent) {
    // 1. Consent gate — hard requirement (§13, §20).
    if (!consent || consent.contact_allowed !== true) {
      return { success: false, error_code: "CONSENT_REQUIRED" };
    }
    // 2. Contact validation (server-side, §20.9).
    const check = this.validateContact(fields);
    if (!check.valid) {
      return { success: false, error_code: "VALIDATION_FAILED", errors: check.errors };
    }
    // 3. Idempotency: if a lead already exists for this session + contact, return it.
    const existing = await this._findExisting(fields);
    if (existing) {
      return { success: true, lead_id: existing.id, status: "duplicate", lead: existing };
    }
    // 4. Score.
    const scored = this.scoreLead(fields);
    // 5. Persist (success only after the repository confirms).
    const id = `PUB-${crypto.randomBytes(5).readUIntBE(0, 5).toString(36).toUpperCase().padStart(8, "0").slice(-8)}`;
    const ts = this.now().toISOString();
    const lead = {
      id,
      session_id: fields.session_id || null,
      name: String(fields.name).trim(),
      business_name: fields.business_name ? String(fields.business_name).trim() : null,
      industry: fields.industry || null,
      email: fields.email ? String(fields.email).trim().toLowerCase() : null,
      phone: fields.phone ? String(fields.phone).trim() : null,
      preferred_contact_method: fields.preferred_contact_method || (fields.email ? "email" : "phone"),
      business_problem: fields.business_problem || null,
      requested_workflows: Array.isArray(fields.requested_workflows) ? fields.requested_workflows : [],
      current_software: fields.current_software || null,
      purchase_timeline: fields.purchase_timeline || null,
      demo_requested: Boolean(fields.demo_requested),
      lead_score: scored.score,
      lead_band: scored.band,
      score_components: scored.components,
      lead_status: fields.demo_requested ? "demo_requested" : (scored.score >= 40 ? "qualified" : "engaged"),
      consent_status: "granted",
      consent_text_version: consent.consent_text_version || "v1",
      consent_at: consent.captured_at || ts,
      source: fields.source || "public_nova_assistant",
      page_context: fields.page_context || null,
      campaign: fields.campaign || null,
      created_at: ts,
      updated_at: ts
    };
    try {
      await this.repository.upsertLead(lead);
    } catch (error) {
      this.logger?.error?.("public_lead.submit_failed", { error: error.message });
      return { success: false, error_code: "LEAD_SUBMISSION_FAILED" };
    }
    // 6. Analytics — personal data is NOT included in the event (§19).
    await this.eventBus?.publish("public_chat.lead_submitted", {
      lead_id: lead.id,
      session_id: lead.session_id,
      industry: lead.industry,
      lead_band: lead.lead_band,
      demo_requested: lead.demo_requested,
      source: lead.source
    }, { source: "public-assistant" });
    return { success: true, lead_id: lead.id, status: "received", lead };
  }

  /**
   * Create a demo request linked to an existing lead. §13.
   */
  async requestDemo({ lead_id, requested_scenario, preferred_contact_method }) {
    const lead = await this.repository.getLead(lead_id);
    if (!lead) return { success: false, error_code: "LEAD_NOT_FOUND" };
    if (!lead.consent_status || lead.consent_status !== "granted") {
      return { success: false, error_code: "CONSENT_REQUIRED" };
    }
    const id = `DEMO-${crypto.randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
    const ts = this.now().toISOString();
    const demoRequest = {
      id,
      lead_id,
      requested_scenario: requested_scenario || null,
      preferred_contact_method: preferred_contact_method || lead.preferred_contact_method || "email",
      status: "requested",
      assigned_to: null,
      created_at: ts,
      updated_at: ts
    };
    try {
      await this.repository.upsertDemoRequest(demoRequest);
      // Update lead status + score (requesting a demo is a +25 signal).
      const updated = {
        ...lead,
        lead_status: "demo_requested",
        updated_at: ts
      };
      const rescored = this.scoreLead({ ...updated, demo_requested: true });
      updated.lead_score = rescored.score;
      updated.lead_band = rescored.band;
      await this.repository.upsertLead(updated);
    } catch (error) {
      this.logger?.error?.("public_lead.demo_failed", { error: error.message });
      return { success: false, error_code: "DEMO_REQUEST_FAILED" };
    }
    await this.eventBus?.publish("public_chat.demo_requested", {
      demo_id: demoRequest.id, lead_id, session_id: lead.session_id
    }, { source: "public-assistant" });
    return { success: true, demo_id: demoRequest.id, status: "requested", demo_request: demoRequest };
  }

  /** Idempotency helper: same session + same email or phone → existing lead. */
  async _findExisting(fields) {
    const sessionId = fields.session_id;
    if (!sessionId) return null;
    const email = fields.email ? String(fields.email).trim().toLowerCase() : null;
    const phone = fields.phone ? String(fields.phone).trim() : null;
    const list = await this.repository.listLeads({ limit: 500 });
    return list.find((l) =>
      l.session_id === sessionId && ((email && l.email === email) || (phone && l.phone === phone))
    ) || null;
  }

  async getLead(leadId) { return this.repository.getLead(leadId); }
  async listLeads(options) { return this.repository.listLeads(options); }
  async listDemoRequests(options) { return this.repository.listDemoRequests(options); }
  async summary() { return this.repository.summary(); }
}

module.exports = { PublicLeadService, LEAD_SCORE_SIGNALS, bandForScore, LEAD_STATUSES, EMAIL_RE, PHONE_RE };
