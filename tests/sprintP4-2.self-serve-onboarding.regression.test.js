// Phase 4 Sprint 2 — Self-serve onboarding: signup + trial + wizard.
//
// Covers the full self-serve path a business takes from the landing page to a
// working assistant, plus the post-signup wizard edits.
//
// Test matrix:
//   1. Industry templates: 4 templates exist, are well-formed, clone safely.
//   2. Signup — happy path: provisions tenant + trial + owner + JWT, returns nextSteps.
//   3. Signup — validation: missing fields, unknown industry, duplicate name, short password.
//   4. Signup — tenant is immediately usable (trial lets the engine process).
//   5. Signup — tenant files are written (profile, subscription, knowledge, offerings).
//   6. Wizard: getState returns full snapshot.
//   7. Wizard: updateProfile edits name/contact/hours and mirrors to knowledge.
//   8. Wizard: updateFaqs replaces the FAQ list.
//   9. Wizard: updateHours reflects in both knowledge and profile.
//  10. Wizard: complete sets onboardingCompletedAt.
//  11. Each industry template produces a usable tenant (smoke each vertical).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");
const { INDUSTRY_TEMPLATES, getTemplate, listTemplates } = require("../packages/self-serve-onboarding/src");

let container;
let tenantsRoot;
const ORIG_NOW = Date.now;

test.before(async () => {
  tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s2-onboarding-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s2-data-"));
  process.env.NOVA_LOCAL_DATA_DIR = root;
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(root, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(root, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  process.env.TENANTS_DIR = tenantsRoot;
  container = await buildContainer();
});
test.after(async () => {
  Date.now = ORIG_NOW;
  if (container) await container.registry.shutdownAll().catch(() => {});
});

// ── Helpers ──────────────────────────────────────────────────────────────
function signup(overrides = {}) {
  return container.selfServeSignupService.signup({
    businessName: overrides.businessName || `Test Biz ${Math.random().toString(36).slice(2, 8)}`,
    email: overrides.email || `owner${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: overrides.password || "secret123",
    ownerName: overrides.ownerName || "Test Owner",
    industry: overrides.industry || "cleaning",
    overrides: overrides.overrides || {},
    ...overrides,
  });
}

function tenantDir(tenantId) { return path.join(tenantsRoot, tenantId); }
function readTenantFile(tenantId, relPath) {
  const p = path.join(tenantDir(tenantId), relPath);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Industry templates
// ═══════════════════════════════════════════════════════════════════════════
test("templates: four verticals exist (restaurant, cleaning, salon, retail)", () => {
  const ids = listTemplates().map((t) => t.id).sort();
  assert.deepEqual(ids, ["cleaning", "restaurant", "retail", "salon"]);
});

test("templates: each has name, domain, offerings, hours", () => {
  for (const t of Object.values(INDUSTRY_TEMPLATES)) {
    assert.ok(t.name, `${t.id} needs a name`);
    assert.ok(t.domain, `${t.id} needs a domain`);
    assert.ok(Array.isArray(t.offerings) && t.offerings.length > 0, `${t.id} needs offerings`);
    assert.ok(t.hours, `${t.id} needs hours`);
  }
});

test("templates: getTemplate returns a deep clone (mutating doesn't affect the original)", () => {
  const t1 = getTemplate("cleaning");
  t1.offerings.push({ id: "mutated", name: "mutated" });
  const t2 = getTemplate("cleaning");
  assert.ok(!t2.offerings.find((o) => o.id === "mutated"), "template must be cloned per-call");
});

test("templates: unknown template returns null", () => {
  assert.equal(getTemplate("nonexistent"), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Signup — happy path
// ═══════════════════════════════════════════════════════════════════════════
test("signup: happy path provisions tenant + trial + owner + JWT", async () => {
  const r = await signup({ businessName: "Happy Path Cleaners", email: "happy@test.com", industry: "cleaning" });
  assert.equal(r.ok, true);
  assert.ok(r.tenantId, "tenantId must be returned");
  assert.equal(r.tenantId, "happy-path-cleaners");
  assert.ok(r.token, "JWT must be issued");
  assert.equal(r.owner.email, "happy@test.com");
  assert.equal(r.trial.status, "trialing");
  assert.equal(r.trial.planId, "starter");
  assert.ok(r.trial.trialEnd, "trialEnd must be set");
  assert.ok(r.nextSteps.length >= 3, "nextSteps must guide the owner");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Signup — validation
// ═══════════════════════════════════════════════════════════════════════════
test("signup: rejects missing business name", async () => {
  await assert.rejects(() => container.selfServeSignupService.signup({ email: "a@b.com", password: "secret123", industry: "cleaning" }), /business name/i);
});

test("signup: rejects missing email", async () => {
  await assert.rejects(() => container.selfServeSignupService.signup({ businessName: "X", password: "secret123", industry: "cleaning" }), /email/i);
});

test("signup: rejects missing password", async () => {
  await assert.rejects(() => container.selfServeSignupService.signup({ businessName: "X", email: "a@b.com", industry: "cleaning" }), /password/i);
});

test("signup: rejects missing industry", async () => {
  await assert.rejects(() => container.selfServeSignupService.signup({ businessName: "X", email: "a@b.com", password: "secret123" }), /industry/i);
});

test("signup: rejects unknown industry with a helpful message", async () => {
  await assert.rejects(() => signup({ industry: "spaceship-repair" }), /Unknown industry/i);
});

test("signup: rejects short password (auth service enforces >=6)", async () => {
  await assert.rejects(() => signup({ password: "123" }), /at least 6/i);
});

test("signup: rejects duplicate business name with a clear message", async () => {
  await signup({ businessName: "Duplicate Cleaners", email: "d1@test.com" });
  await assert.rejects(() => signup({ businessName: "Duplicate Cleaners", email: "d2@test.com" }), /already exists/i);
});

test("signup: rejects duplicate email within same tenant", async () => {
  const r = await signup({ businessName: "Dup Email Co", email: "shared@test.com" });
  // Second signup with same email but different business name should still work
  // (different tenant). But creating a second owner on the SAME tenant with the
  // same email must fail — exercised at the auth service level.
  assert.throws(() => container.businessOwnerAuthService.createOwner({ tenantId: r.tenantId, email: "shared@test.com", password: "secret123" }), /already exists/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Signup — tenant is immediately usable
// ═══════════════════════════════════════════════════════════════════════════
test("signup: new tenant is immediately usable (trial lets engine process)", async () => {
  const r = await signup({ businessName: "Usable Cleaners", email: "usable@test.com", industry: "cleaning" });
  const reply = await container.executionEngine.process({ tenantId: r.tenantId, customerId: "u1", channel: "p4s2-test", text: "hello, do you do deep cleaning?" });
  assert.notEqual(reply.capabilityId, "billing_blocked");
  assert.equal(reply.billingBlocked, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Signup — tenant files are written
// ═══════════════════════════════════════════════════════════════════════════
test("signup: writes profile.json, subscription.json, knowledge, offerings", async () => {
  const r = await signup({ businessName: "Files Written Co", email: "files@test.com", industry: "salon" });
  assert.ok(readTenantFile(r.tenantId, "profile.json"), "profile.json must exist");
  assert.ok(readTenantFile(r.tenantId, "subscription.json"), "subscription.json must exist");
  assert.ok(readTenantFile(r.tenantId, "knowledge/business.json"), "knowledge/business.json must exist");
  assert.ok(readTenantFile(r.tenantId, "knowledge/faqs.json"), "knowledge/faqs.json must exist");
  assert.ok(readTenantFile(r.tenantId, "offerings/items.json"), "offerings/items.json must exist");
  const profile = readTenantFile(r.tenantId, "profile.json");
  assert.equal(profile.name, "Files Written Co");
  assert.equal(profile.status, "active");
});

test("signup: subscription.json has trialing status + starter plan", async () => {
  const r = await signup({ businessName: "Sub Check Co", email: "subcheck@test.com", industry: "restaurant" });
  const sub = readTenantFile(r.tenantId, "subscription.json");
  assert.equal(sub.status, "trialing");
  assert.equal(sub.planId, "starter");
  assert.ok(sub.trialEnd);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Wizard — getState
// ═══════════════════════════════════════════════════════════════════════════
test("wizard: getState returns full snapshot", async () => {
  const r = await signup({ businessName: "Wizard State Co", email: "wizstate@test.com", industry: "cleaning" });
  const state = container.onboardingWizardService.getState(r.tenantId);
  assert.equal(state.tenantId, r.tenantId);
  assert.equal(state.businessName, "Wizard State Co");
  assert.ok(Array.isArray(state.offerings) && state.offerings.length > 0);
  assert.ok(Array.isArray(state.faqs));
  assert.ok(state.hours);
});

test("wizard: getState throws for unknown tenant", () => {
  assert.throws(() => container.onboardingWizardService.getState("does-not-exist"), /not found/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Wizard — updateProfile
// ═══════════════════════════════════════════════════════════════════════════
test("wizard: updateProfile edits name/contact/hours and mirrors to knowledge", async () => {
  const r = await signup({ businessName: "Profile Edit Co", email: "profile@test.com", industry: "cleaning" });
  container.onboardingWizardService.updateProfile(r.tenantId, {
    name: "Profile Edit Co (Updated)",
    contact: "+1-555-9999",
    hours: "Mon-Fri 9-5",
    location: "Denver, CO",
    description: "Top-rated cleaning",
    assistantName: "Dusty",
    welcomeMessage: "Hi! Dusty here.",
  });
  const profile = readTenantFile(r.tenantId, "profile.json");
  assert.equal(profile.name, "Profile Edit Co (Updated)");
  assert.equal(profile.business.contact, "+1-555-9999");
  assert.equal(profile.business.hours, "Mon-Fri 9-5");
  assert.equal(profile.branding.assistantName, "Dusty");
  // Mirrored to knowledge
  const kb = readTenantFile(r.tenantId, "knowledge/business.json");
  assert.equal(kb.name, "Profile Edit Co (Updated)");
  assert.equal(kb.hours, "Mon-Fri 9-5");
  assert.equal(kb.location, "Denver, CO");
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Wizard — updateFaqs
// ═══════════════════════════════════════════════════════════════════════════
test("wizard: updateFaqs replaces the FAQ list and filters invalid entries", async () => {
  const r = await signup({ businessName: "Faq Co", email: "faq@test.com", industry: "salon" });
  const result = container.onboardingWizardService.updateFaqs(r.tenantId, [
    { question: "Do you take walk-ins?", answer: "Yes, subject to availability." },
    { question: "", answer: "this should be filtered out" }, // invalid
    { question: "What are your hours?", answer: "10-8 daily" },
  ]);
  assert.equal(result.count, 2);
  const faqs = readTenantFile(r.tenantId, "knowledge/faqs.json");
  assert.equal(faqs.length, 2);
  assert.equal(faqs[0].question, "Do you take walk-ins?");
});

test("wizard: updateFaqs rejects non-array", async () => {
  const r = await signup({ businessName: "Faq Bad Co", email: "faqbad@test.com", industry: "salon" });
  assert.throws(() => container.onboardingWizardService.updateFaqs(r.tenantId, { not: "an array" }), /array/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Wizard — updateHours
// ═══════════════════════════════════════════════════════════════════════════
test("wizard: updateHours reflects in both knowledge and profile", async () => {
  const r = await signup({ businessName: "Hours Co", email: "hours@test.com", industry: "restaurant" });
  container.onboardingWizardService.updateHours(r.tenantId, "Daily 11-23");
  const kb = readTenantFile(r.tenantId, "knowledge/business.json");
  assert.equal(kb.hours, "Daily 11-23");
  const profile = readTenantFile(r.tenantId, "profile.json");
  assert.equal(profile.business.hours, "Daily 11-23");
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Wizard — complete
// ═══════════════════════════════════════════════════════════════════════════
test("wizard: complete sets onboardingCompletedAt", async () => {
  const r = await signup({ businessName: "Complete Co", email: "complete@test.com", industry: "cleaning" });
  const result = container.onboardingWizardService.complete(r.tenantId);
  assert.equal(result.ok, true);
  assert.ok(result.completedAt);
  const profile = readTenantFile(r.tenantId, "profile.json");
  assert.ok(profile.onboardingCompletedAt);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Each industry template produces a usable tenant
// ═══════════════════════════════════════════════════════════════════════════
test("vertical smoke: restaurant signup → usable tenant with booking config", async () => {
  const r = await signup({ businessName: "Resty Cafe", email: "resty@test.com", industry: "restaurant" });
  assert.ok(readTenantFile(r.tenantId, "booking/config.json"), "restaurant needs booking config");
});

test("vertical smoke: salon signup → usable tenant with offerings", async () => {
  const r = await signup({ businessName: "Salon Vibe", email: "salon@test.com", industry: "salon" });
  const offerings = readTenantFile(r.tenantId, "offerings/items.json");
  assert.ok(offerings.length >= 2, "salon needs at least 2 services");
});

test("vertical smoke: retail signup → usable tenant with catalog (no booking)", async () => {
  const r = await signup({ businessName: "Shop Mart", email: "shop@test.com", industry: "retail" });
  assert.ok(readTenantFile(r.tenantId, "catalog/products.json"), "retail needs a product catalog");
  // Retail template disables calendar (calendarEnabled:false) so the onboarding
  // service correctly skips writing calendar/config.json — no booking for retail.
  const cal = readTenantFile(r.tenantId, "calendar/config.json");
  assert.equal(cal, null, "retail must not have a calendar config (booking disabled)");
});

test("vertical smoke: each new tenant processes a message without billing block", async () => {
  const industries = ["restaurant", "cleaning", "salon", "retail"];
  for (const ind of industries) {
    const r = await signup({ businessName: `Smoke ${ind} ${Math.random().toString(36).slice(2, 6)}`, email: `smoke-${ind}-${Math.random().toString(36).slice(2, 6)}@test.com`, industry: ind });
    const reply = await container.executionEngine.process({ tenantId: r.tenantId, customerId: `smoke-${ind}`, channel: "p4s2-test", text: "hello" });
    assert.notEqual(reply.capabilityId, "billing_blocked", `${ind} tenant must not be blocked`);
  }
});
