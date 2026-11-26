// Phase 4 Sprint 2 — Self-serve signup service.
//
// Orchestrates the three things a business needs to go live on Nova, alone,
// from a landing page:
//   1. UniversalTenantOnboardingService.create(spec) → provision the tenant
//      tree (profile, knowledge, offerings, pricing, booking, calendar).
//   2. PlanService.provisionTrial(tenantId, planId) → start a 14-day trial
//      subscription so the billing enforcement layer lets their messages
//      through immediately.
//   3. BusinessOwnerAuthService.createOwner(...) → create the first owner
//      account, then loginWithPassword(...) → return a JWT so they land
//      straight in the dashboard.
//
// The service is idempotent-ish: a duplicate slug throws a clear error so the
// API can suggest alternatives. Owner email uniqueness is enforced by the auth
// service.
//
// Design choice: this service owns NO persistence of its own — it composes the
// three existing services. That keeps signup logic in one testable place and
// avoids a parallel tenant-creation code path.
const { getTemplate } = require("./industryTemplates");
const { DEFAULT_PLAN_ID } = require("../../billing/src/plans");

class SelfServeSignupService {
  constructor({ onboardingService, planService, businessOwnerAuthService, tenantRepository, logger = null }) {
    this.onboardingService = onboardingService;
    this.planService = planService;
    this.businessOwnerAuthService = businessOwnerAuthService;
    this.tenantRepository = tenantRepository;
    this.logger = logger;
  }

  /**
   * Sign up a new business end-to-end.
   * @param {object} input
   *   @param {string} input.businessName   Required. The business's display name.
   *   @param {string} input.email          Required. First owner's email.
   *   @param {string} input.password       Required. Min 6 chars (auth service enforces).
   *   @param {string} input.ownerName      Optional. Owner's name (defaults to email local-part).
   *   @param {string} input.industry       Required. Template id (restaurant|cleaning|salon|retail).
   *   @param {string} [input.planId]       Optional. Defaults to starter trial.
   *   @param {object} [input.overrides]    Optional. Fields layered onto the template spec.
   *   @param {string} [input.ip]           Optional. For auth rate-limit attribution.
   * @returns {{ ok:true, tenantId, token, owner, trial, nextSteps }}
   * @throws  Error with a user-facing message on validation/failure.
   */
  signup(input) {
    const { businessName, email, password, ownerName, industry, planId = DEFAULT_PLAN_ID, overrides = {}, ip = "unknown" } = input || {};
    if (!businessName) throw new Error("Business name is required");
    if (!email) throw new Error("Email is required");
    if (!password) throw new Error("Password is required");
    if (!industry) throw new Error("Industry is required");
    const template = getTemplate(industry);
    if (!template) throw new Error(`Unknown industry '${industry}'. Choose one of: restaurant, cleaning, salon, retail`);

    // 1. Build the onboarding spec: template + owner overrides. Mark
    //    billingRequired:true so the engine blocks this tenant if their trial
    //    is ever missing/expired — a self-serve tenant MUST have a subscription,
    //    unlike legacy tenants (byt, demos) which are allowed without one.
    const spec = { ...template, ...overrides, name: businessName, billingRequired: true };
    delete spec.id; // slug is derived from the name

    // 2. Provision the tenant tree (throws if slug already exists — atomic mkdir).
    let onboardingResult;
    try {
      onboardingResult = this.onboardingService.create(spec);
    } catch (err) {
      if (/already exists/i.test(err.message)) {
        throw new Error(`A business named '${businessName}' already exists. Try a more specific name.`);
      }
      throw err;
    }
    const tenantId = onboardingResult.id;

    // 3. Provision the trial subscription. FATAL on failure: a self-serve tenant
    //    without a trial would be either blocked (billingRequired) or, worse,
    //    free-unlimited if the legacy "no sub = allowed" path applied. Rolling
    //    back the tenant keeps the system consistent and the user can retry.
    let trial;
    try {
      trial = this.planService.provisionTrial(tenantId, planId);
    } catch (err) {
      this.logger?.error?.("signup.trial_failed", { tenantId, error: err.message });
      this._rollbackTenant(tenantId);
      throw new Error(`We couldn't start your free trial (${err.message}). Please try again.`);
    }

    // 4. Create the first owner account.
    let owner;
    try {
      owner = this.businessOwnerAuthService.createOwner({ tenantId, email, password, name: ownerName });
    } catch (err) {
      // Rollback the tenant AND the trial so no orphan subscription/cache remains.
      this._rollbackTenant(tenantId, { clearSubscription: true });
      throw new Error(`Could not create owner account: ${err.message}`);
    }

    // 5. Issue a JWT so they land in the dashboard immediately.
    const login = this.businessOwnerAuthService.loginWithPassword({ tenantId, email, password, ip });
    if (!login.ok) {
      // Should not happen — we just created the owner — but handle gracefully.
      this.logger?.error?.("signup.login_failed_after_create", { tenantId, email, error: login.error });
      return {
        ok: true, tenantId, token: null, owner,
        trial: trial ? { status: trial.status, planId: trial.planId, trialEnd: trial.trialEnd } : null,
        nextSteps: ["Log in at /business/login with your email and password."],
      };
    }

    this.logger?.info?.("signup.completed", { tenantId, industry, planId, ownerId: owner.id });
    return {
      ok: true,
      tenantId,
      token: login.token,
      owner: login.owner,
      trial: trial ? { status: trial.status, planId: trial.planId, trialEnd: trial.trialEnd } : null,
      nextSteps: this._nextSteps(industry),
    };
  }

  /**
   * Remove a tenant directory (rollback on partial failure). Also clears the
   * subscription cache so a rolled-back tenant can't be evaluated against a
   * stale "trialing" record that's no longer on disk.
   */
  _rollbackTenant(tenantId, { clearSubscription = false } = {}) {
    try {
      const fs = require("fs");
      const path = require("path");
      const dir = path.join(this.onboardingService.tenantsDir, tenantId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      this.tenantRepository?.clearCache?.(tenantId);
      if (clearSubscription) this.planService?.repo?.clearCache?.(tenantId);
    } catch (e) {
      this.logger?.error?.("signup.rollback_failed", { tenantId, error: e.message });
    }
  }

  /** Human-friendly next steps for the dashboard welcome screen. */
  _nextSteps(industry) {
    const steps = [
      "Review and edit your business profile in the dashboard.",
      "Connect your WhatsApp number under Channels.",
      "Add your services and pricing under Offerings.",
    ];
    if (industry === "retail") {
      steps[2] = "Add your products and prices under Catalog.";
    }
    steps.push("Test your assistant with a sample customer message.");
    return steps;
  }
}

module.exports = { SelfServeSignupService };
