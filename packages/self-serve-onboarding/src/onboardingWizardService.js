// Phase 4 Sprint 2 — Onboarding wizard service.
//
// After signup, the owner lands in the dashboard and completes their setup via
// a wizard: confirm business profile, set hours/location/contact, add or edit
// offerings + pricing, add FAQs. This service applies those edits incrementally
// to the tenant tree WITHOUT re-running full onboarding (which would overwrite).
//
// Each method reads the current file, merges the patch, validates minimally,
// and writes back — then clears the relevant repository cache so the engine
// picks up the change on the next message.
const fs = require("fs");
const path = require("path");

class OnboardingWizardService {
  constructor({ tenantsDir, tenantRepository, knowledgeRepository, logger = null }) {
    this.tenantsDir = tenantsDir;
    this.tenantRepository = tenantRepository;
    this.knowledgeRepository = knowledgeRepository;
    this.logger = logger;
  }

  _readJson(tenantId, relPath, fallback = null) {
    const filePath = path.join(this.tenantsDir, tenantId, relPath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  _writeJson(tenantId, relPath, value) {
    const filePath = path.join(this.tenantsDir, tenantId, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  }

  _clearCaches(tenantId) {
    this.tenantRepository?.clearCache?.(tenantId);
    this.knowledgeRepository?.clearCache?.(tenantId);
  }

  /** Update the business profile (name, description, contact, hours, location). */
  updateProfile(tenantId, patch) {
    const profile = this._readJson(tenantId, "profile.json");
    if (!profile) throw new Error(`Tenant '${tenantId}' not found`);
    if (patch.name) profile.name = patch.name;
    if (patch.assistantName) profile.branding = { ...profile.branding, assistantName: patch.assistantName };
    if (patch.welcomeMessage) profile.branding = { ...profile.branding, welcomeMessage: patch.welcomeMessage };
    profile.business = {
      ...(profile.business || {}),
      ...(patch.description != null && { description: patch.description }),
      ...(patch.contact != null && { contact: patch.contact }),
      ...(patch.whatsapp != null && { whatsapp: patch.whatsapp }),
      ...(patch.phone != null && { phone: patch.phone }),
      ...(patch.email != null && { email: patch.email }),
      ...(patch.hours != null && { hours: patch.hours }),
      ...(patch.location != null && { location: patch.location }),
      ...(patch.website != null && { website: patch.website }),
    };
    this._writeJson(tenantId, "profile.json", profile);
    // Mirror key fields into the knowledge business.json so the assistant cites them.
    const kb = this._readJson(tenantId, "knowledge/business.json", {});
    const merged = { ...kb, name: profile.name, description: profile.business?.description || kb.description || "", hours: profile.business?.hours || kb.hours || "", location: profile.business?.location || kb.location || "", contact: profile.business?.contact || kb.contact || "" };
    this._writeJson(tenantId, "knowledge/business.json", merged);
    this._clearCaches(tenantId);
    this.logger?.info?.("wizard.profile_updated", { tenantId });
    return { ok: true, profile };
  }

  /** Replace or append FAQs. */
  updateFaqs(tenantId, faqs) {
    if (!Array.isArray(faqs)) throw new Error("faqs must be an array");
    const cleaned = faqs.filter((f) => f.question && f.answer).map((f) => ({ question: String(f.question), answer: String(f.answer) }));
    this._writeJson(tenantId, "knowledge/faqs.json", cleaned);
    this._clearCaches(tenantId);
    this.logger?.info?.("wizard.faqs_updated", { tenantId, count: cleaned.length });
    return { ok: true, count: cleaned.length };
  }

  /** Update hours (stored in knowledge/business.json). */
  updateHours(tenantId, hours) {
    const kb = this._readJson(tenantId, "knowledge/business.json", {});
    kb.hours = String(hours || "");
    this._writeJson(tenantId, "knowledge/business.json", kb);
    // Also reflect in profile.business.hours for the dashboard.
    const profile = this._readJson(tenantId, "profile.json");
    if (profile) {
      profile.business = { ...(profile.business || {}), hours: kb.hours };
      this._writeJson(tenantId, "profile.json", profile);
    }
    this._clearCaches(tenantId);
    return { ok: true, hours: kb.hours };
  }

  /** Get the full onboarding state for the wizard UI. */
  getState(tenantId) {
    const profile = this._readJson(tenantId, "profile.json");
    if (!profile) throw new Error(`Tenant '${tenantId}' not found`);
    const business = this._readJson(tenantId, "knowledge/business.json", {});
    const faqs = this._readJson(tenantId, "knowledge/faqs.json", []);
    const offerings = this._readJson(tenantId, "offerings/items.json", []);
    const pricing = this._readJson(tenantId, "pricing/services.json", null);
    return {
      tenantId,
      businessName: profile.name,
      assistantName: profile.branding?.assistantName,
      welcomeMessage: profile.branding?.welcomeMessage,
      description: profile.business?.description || business.description || "",
      contact: profile.business?.contact || business.contact || "",
      hours: profile.business?.hours || business.hours || "",
      location: profile.business?.location || business.location || "",
      faqs,
      offerings,
      pricing,
      capabilities: profile.capabilities || [],
    };
  }

  /** Mark onboarding complete (sets a flag the dashboard reads to hide the wizard). */
  complete(tenantId) {
    const profile = this._readJson(tenantId, "profile.json");
    if (!profile) throw new Error(`Tenant '${tenantId}' not found`);
    profile.onboardingCompletedAt = new Date().toISOString();
    this._writeJson(tenantId, "profile.json", profile);
    this._clearCaches(tenantId);
    this.logger?.info?.("wizard.completed", { tenantId });
    return { ok: true, completedAt: profile.onboardingCompletedAt };
  }
}

module.exports = { OnboardingWizardService };
