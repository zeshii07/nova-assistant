// Phase 4 Sprint 1 — Billing: subscription state + Stripe webhook + plan enforcement.
//
// Covers every state in the subscription lifecycle and the enforcement point
// in the execution engine. Uses the StripeClient in mock mode (no real keys
// required) so the full flow — checkout → webhook → state transition →
// enforcement — is exercised end-to-end without network access.
//
// Test matrix:
//   1. Plan catalog: plans exist, are well-formed, ordered.
//   2. Subscription repository: provision, get, save, validation.
//   3. Stripe client (mock): createCheckoutSession, createPortalSession, webhook.
//   4. Plan service — enforcement decisions:
//        • no subscription (legacy tenant) → allowed
//        • trialing + before trialEnd → allowed
//        • trialing + after trialEnd → blocked (trial_expired)
//        • active → allowed
//        • past_due + within grace → allowed
//        • past_due + beyond grace → blocked (past_due_expired)
//        • canceled → blocked (subscription_canceled)
//        • over-quota → blocked (quota_exceeded)
//   5. Webhook event mapping: checkout.completed, invoice.paid, sub.updated, sub.deleted.
//   6. Engine enforcement: blocked tenant gets brand-safe reply + capabilityId=billing_blocked.
//   7. Message counter: increments per successful turn; legacy tenants unaffected.
//   8. Status snapshot: getStatus returns all fields for the dashboard.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");
const { getPlan, listPlans, DEFAULT_PLAN_ID, FileSubscriptionRepository, PlanService, StripeClient, ALLOWED_REASONS, BLOCKED_REASONS } = require("../packages/billing/src");

let container;
let tenantsRoot;
const ORIG_NOW = Date.now;

test.before(async () => {
  // Isolated tenants dir so we can provision/cancel trial tenants freely.
  tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s1-billing-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s1-data-"));
  process.env.NOVA_LOCAL_DATA_DIR = root;
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(root, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(root, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  process.env.TENANTS_DIR = tenantsRoot;
  // Copy a real tenant so getById works for the engine.
  fs.cpSync(path.resolve(__dirname, "../tenants/restaurant-demo"), path.join(tenantsRoot, "restaurant-demo"), { recursive: true });
  container = await buildContainer();
});
test.after(async () => {
  Date.now = ORIG_NOW;
  if (container) await container.registry.shutdownAll().catch(() => {});
});

// ── Helpers ──────────────────────────────────────────────────────────────
function freezeNow(iso) {
  const ms = new Date(iso).getTime();
  Date.now = () => ms;
}
function resetClock() { Date.now = ORIG_NOW; }

async function ask(customerId, text, tenantId = "restaurant-demo") {
  return container.executionEngine.process({ tenantId, customerId, channel: "p4s1-test", text });
}

function setSubscription(tenantId, patch) {
  const sub = container.subscriptionRepository.get(tenantId);
  container.subscriptionRepository.save({ ...sub, ...patch });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Plan catalog
// ═══════════════════════════════════════════════════════════════════════════
test("plans: three tiers exist (starter, growth, scale)", () => {
  const ids = listPlans().map((p) => p.id);
  assert.deepEqual(ids, ["starter", "growth", "scale"]);
});

test("plans: each has price, quota, cycle, trial, features", () => {
  for (const plan of listPlans()) {
    assert.ok(plan.priceMonthly > 0, `${plan.id} needs a price`);
    assert.ok(typeof plan.messagesPerCycle === "number", `${plan.id} needs a quota`);
    assert.ok(plan.cycleDays > 0, `${plan.id} needs a cycle`);
    assert.ok(plan.trialDays > 0, `${plan.id} needs a trial`);
    assert.ok(plan.features && typeof plan.features === "object", `${plan.id} needs features`);
  }
});

test("plans: scale tier is unlimited (-1)", () => {
  assert.equal(getPlan("scale").messagesPerCycle, -1);
  assert.equal(getPlan("growth").messagesPerCycle, 10000);
  assert.equal(getPlan("starter").messagesPerCycle, 2000);
});

test("plans: llmFallback only on growth/scale (starter is deterministic-only)", () => {
  assert.equal(getPlan("starter").features.llmFallback, false);
  assert.equal(getPlan("growth").features.llmFallback, true);
  assert.equal(getPlan("scale").features.llmFallback, true);
});

test("plans: unknown plan id returns null", () => {
  assert.equal(getPlan("nonexistent"), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Subscription repository
// ═══════════════════════════════════════════════════════════════════════════
test("subscription repo: get returns null for unprovisioned tenant", () => {
  const repo = new FileSubscriptionRepository({ tenantsDir: tenantsRoot });
  assert.equal(repo.get("never-provisioned"), null);
});

test("subscription repo: provisionTrial creates a trialing subscription", () => {
  const repo = new FileSubscriptionRepository({ tenantsDir: tenantsRoot });
  const sub = repo.provisionTrial("restaurant-demo", "growth", { trialDays: 14 });
  assert.equal(sub.status, "trialing");
  assert.equal(sub.planId, "growth");
  assert.ok(sub.trialEnd, "trialEnd must be set");
  assert.equal(sub.messagesThisCycle, 0);
  // Persisted to disk
  const filePath = path.join(tenantsRoot, "restaurant-demo", "subscription.json");
  assert.ok(fs.existsSync(filePath), "subscription.json must be written");
  repo.clearCache();
  const reloaded = repo.get("restaurant-demo");
  assert.equal(reloaded.status, "trialing");
});

test("subscription repo: rejects invalid status", () => {
  const repo = new FileSubscriptionRepository({ tenantsDir: tenantsRoot });
  assert.throws(() => repo.save({ tenantId: "restaurant-demo", status: "bogus", planId: "starter", messagesThisCycle: 0 }), /invalid/i);
});

test("subscription repo: rejects mismatched tenantId on read", () => {
  // Write a subscription file whose tenantId field doesn't match its folder.
  const dir = path.join(tenantsRoot, "mismatch-tenant");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "subscription.json"), JSON.stringify({
    tenantId: "different-id", status: "active", planId: "starter", messagesThisCycle: 0,
  }));
  const repo = new FileSubscriptionRepository({ tenantsDir: tenantsRoot });
  assert.throws(() => repo.get("mismatch-tenant"), /match/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Stripe client (mock mode)
// ═══════════════════════════════════════════════════════════════════════════
test("stripe client: auto-detects mock mode when no key", () => {
  const client = new StripeClient({});
  assert.equal(client.isMock(), true);
});

test("stripe client: mock createCheckoutSession returns a session with a url", async () => {
  const client = new StripeClient({});
  const session = await client.createCheckoutSession({
    tenantId: "restaurant-demo", planId: "growth", successUrl: "https://app/success", cancelUrl: "https://app/cancel",
  });
  assert.ok(session.url, "session must have a url");
  assert.equal(session.metadata.tenantId, "restaurant-demo");
  assert.equal(session.metadata.planId, "growth");
});

test("stripe client: mock createPortalSession returns a url", async () => {
  const client = new StripeClient({});
  const session = await client.createPortalSession({ customerId: "cus_mock_123", returnUrl: "https://app/portal" });
  assert.ok(session.url);
  assert.equal(session.customer, "cus_mock_123");
});

test("stripe client: mock constructWebhookEvent parses the raw body", () => {
  const client = new StripeClient({});
  const event = { type: "checkout.session.completed", data: { object: { metadata: { tenantId: "restaurant-demo" } } } };
  const parsed = client.constructWebhookEvent(JSON.stringify(event), "fake-sig");
  assert.equal(parsed.type, "checkout.session.completed");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Plan service — enforcement decisions
// ═══════════════════════════════════════════════════════════════════════════
test("enforcement: legacy tenant (no subscription) is allowed", () => {
  container.subscriptionRepository.clearCache("no-sub-tenant");
  // Wipe any existing subscription file for this fresh tenant id
  const subFile = path.join(tenantsRoot, "no-sub-tenant", "subscription.json");
  if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
  container.subscriptionRepository.clearCache("no-sub-tenant");
  const decision = container.planService.evaluate("no-sub-tenant");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, ALLOWED_REASONS.NO_SUBSCRIPTION);
});

test("enforcement: trialing + before trialEnd is allowed", () => {
  container.planService.provisionTrial("restaurant-demo", "growth", );
  setSubscription("restaurant-demo", { trialEnd: new Date(Date.now() + 7 * 86400000).toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, ALLOWED_REASONS.TRIAL_ACTIVE);
});

test("enforcement: trialing + after trialEnd is blocked (trial_expired)", () => {
  setSubscription("restaurant-demo", { status: "trialing", trialEnd: new Date(Date.now() - 86400000).toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, BLOCKED_REASONS.TRIAL_EXPIRED);
});

test("enforcement: active subscription is allowed", () => {
  setSubscription("restaurant-demo", { status: "active", trialEnd: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, ALLOWED_REASONS.ACTIVE);
});

test("enforcement: past_due + within grace is allowed", () => {
  setSubscription("restaurant-demo", { status: "past_due", currentPeriodEnd: new Date(Date.now() - 1 * 86400000).toISOString() }); // 1 day ago, within 7d grace
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, ALLOWED_REASONS.PAST_DUE_GRACE);
});

test("enforcement: past_due + beyond grace is blocked (past_due_expired)", () => {
  setSubscription("restaurant-demo", { status: "past_due", currentPeriodEnd: new Date(Date.now() - 10 * 86400000).toISOString() }); // 10 days ago, beyond 7d grace
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, BLOCKED_REASONS.PAST_DUE_EXPIRED);
});

test("enforcement: canceled is blocked (subscription_canceled)", () => {
  setSubscription("restaurant-demo", { status: "canceled", canceledAt: new Date().toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, BLOCKED_REASONS.SUBSCRIPTION_CANCELED);
});

test("enforcement: over-quota is blocked (quota_exceeded)", () => {
  setSubscription("restaurant-demo", { status: "active", messagesThisCycle: 2000, planId: "starter", currentPeriodEnd: new Date(Date.now() + 5 * 86400000).toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, BLOCKED_REASONS.QUOTA_EXCEEDED);
});

test("enforcement: scale plan never hits quota (unlimited)", () => {
  setSubscription("restaurant-demo", { status: "active", messagesThisCycle: 999999, planId: "scale", currentPeriodEnd: new Date(Date.now() + 5 * 86400000).toISOString() });
  const decision = container.planService.evaluate("restaurant-demo");
  assert.equal(decision.allowed, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Webhook event mapping
// ═══════════════════════════════════════════════════════════════════════════
test("webhook: checkout.session.completed activates the subscription", () => {
  setSubscription("restaurant-demo", { status: "trialing", messagesThisCycle: 50 });
  const event = { type: "checkout.session.completed", data: { object: { metadata: { tenantId: "restaurant-demo", planId: "growth" }, customer: "cus_real_1", subscription: "sub_real_1" } } };
  const applied = container.planService.applyWebhookEvent(event);
  assert.equal(applied.action, "activated");
  const sub = container.subscriptionRepository.get("restaurant-demo");
  assert.equal(sub.status, "active");
  assert.equal(sub.stripeCustomerId, "cus_real_1");
  assert.equal(sub.stripeSubscriptionId, "sub_real_1");
  assert.equal(sub.messagesThisCycle, 0, "counter resets on activation");
});

test("webhook: invoice.paid renews the cycle (counter resets)", () => {
  setSubscription("restaurant-demo", { status: "active", messagesThisCycle: 9999, currentPeriodEnd: new Date(Date.now() - 1 * 86400000).toISOString() });
  const event = { type: "invoice.paid", data: { object: { metadata: { tenantId: "restaurant-demo" } } } };
  const applied = container.planService.applyWebhookEvent(event);
  assert.equal(applied.action, "renewed");
  const sub = container.subscriptionRepository.get("restaurant-demo");
  assert.equal(sub.messagesThisCycle, 0, "counter resets on renewal");
  assert.ok(new Date(sub.currentPeriodEnd).getTime() > Date.now(), "period end extended");
});

test("webhook: customer.subscription.deleted cancels", () => {
  setSubscription("restaurant-demo", { status: "active" });
  const event = { type: "customer.subscription.deleted", data: { object: { metadata: { tenantId: "restaurant-demo" }, id: "sub_x" } } };
  const applied = container.planService.applyWebhookEvent(event);
  assert.equal(applied.action, "canceled");
  const sub = container.subscriptionRepository.get("restaurant-demo");
  assert.equal(sub.status, "canceled");
  assert.ok(sub.canceledAt);
});

test("webhook: customer.subscription.updated transitions to past_due", () => {
  setSubscription("restaurant-demo", { status: "active" });
  const event = { type: "customer.subscription.updated", data: { object: { metadata: { tenantId: "restaurant-demo" }, status: "past_due", current_period_end: Math.floor(Date.now() / 1000), id: "sub_y" } } };
  const applied = container.planService.applyWebhookEvent(event);
  assert.equal(applied.action, "updated");
  const sub = container.subscriptionRepository.get("restaurant-demo");
  assert.equal(sub.status, "past_due");
});

test("webhook: irrelevant event type returns null", () => {
  const event = { type: "some.other.event", data: { object: { metadata: { tenantId: "restaurant-demo" } } } };
  assert.equal(container.planService.applyWebhookEvent(event), null);
});

test("webhook: event without tenantId metadata returns null", () => {
  const event = { type: "checkout.session.completed", data: { object: {} } };
  assert.equal(container.planService.applyWebhookEvent(event), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Engine enforcement — blocked tenant gets brand-safe reply
// ═══════════════════════════════════════════════════════════════════════════
test("engine: canceled tenant's message is blocked with brand-safe reply", async () => {
  setSubscription("restaurant-demo", { status: "canceled", canceledAt: new Date().toISOString() });
  const r = await ask("engine-canceled", "i want 1 chicken biryani");
  assert.equal(r.billingBlocked, true);
  assert.equal(r.capabilityId, "billing_blocked");
  assert.equal(r.billingReason, BLOCKED_REASONS.SUBSCRIPTION_CANCELED);
  // Brand-safe: no internal codes, no billing jargon, customer-friendly
  assert.ok(r.reply.length > 0);
  assert.doesNotMatch(r.reply, /subscription_canceled|quota_exceeded|billing_blocked/i);
});

test("engine: trial-expired tenant's message is blocked", async () => {
  setSubscription("restaurant-demo", { status: "trialing", trialEnd: new Date(Date.now() - 86400000).toISOString() });
  const r = await ask("engine-trial-expired", "hello");
  assert.equal(r.billingBlocked, true);
  assert.equal(r.billingReason, BLOCKED_REASONS.TRIAL_EXPIRED);
});

test("engine: active tenant's message is processed normally", async () => {
  setSubscription("restaurant-demo", { status: "active", messagesThisCycle: 0, planId: "growth", trialEnd: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  const r = await ask("engine-active", "i want 1 chicken biryani");
  assert.equal(r.billingBlocked, undefined);
  assert.notEqual(r.capabilityId, "billing_blocked");
  assert.match(r.reply || "", /biryani/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Message counter
// ═══════════════════════════════════════════════════════════════════════════
test("counter: increments per successful turn on an active tenant", async () => {
  setSubscription("restaurant-demo", { status: "active", messagesThisCycle: 0, planId: "growth", trialEnd: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await ask("count-1", "hello");
  await ask("count-2", "i want 1 chicken biryani");
  await ask("count-3", "thanks");
  const sub = container.subscriptionRepository.get("restaurant-demo");
  assert.equal(sub.messagesThisCycle, 3);
});

test("counter: does NOT increment for a blocked tenant", async () => {
  setSubscription("restaurant-demo", { status: "canceled", canceledAt: new Date().toISOString() });
  const before = container.subscriptionRepository.get("restaurant-demo").messagesThisCycle;
  await ask("count-blocked", "hello");
  const after = container.subscriptionRepository.get("restaurant-demo").messagesThisCycle;
  assert.equal(after, before, "blocked turns must not count against quota");
});

test("counter: legacy tenant (no subscription) is unaffected", async () => {
  // Use a fresh tenant id with no subscription.json — engine should process
  // normally and recordMessage should be a no-op (returns null, no throw).
  const legacyTenant = "legacy-no-sub-tenant";
  const legacyDir = path.join(tenantsRoot, legacyTenant);
  fs.cpSync(path.resolve(__dirname, "../tenants/restaurant-demo"), legacyDir, { recursive: true });
  const subFile = path.join(legacyDir, "subscription.json");
  if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
  // Patch the copied profile's id to match the folder name.
  const profilePath = path.join(legacyDir, "profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  profile.id = legacyTenant;
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  container.subscriptionRepository.clearCache(legacyTenant);
  container.tenantRepository.clearCache(legacyTenant);
  const r = await ask("legacy-1", "hello", legacyTenant);
  assert.equal(r.billingBlocked, undefined, "legacy tenant must not be blocked");
  assert.notEqual(r.capabilityId, "billing_blocked");
  // No subscription.json should have been created by the engine.
  assert.ok(!fs.existsSync(subFile), "engine must not create a subscription for a legacy tenant");
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Status snapshot (for the dashboard)
// ═══════════════════════════════════════════════════════════════════════════
test("status: returns full snapshot for an active tenant", () => {
  setSubscription("restaurant-demo", { status: "active", planId: "growth", messagesThisCycle: 42, stripeCustomerId: "cus_x", currentPeriodEnd: new Date(Date.now() + 5 * 86400000).toISOString() });
  const status = container.planService.getStatus("restaurant-demo");
  assert.equal(status.provisioned, true);
  assert.equal(status.status, "active");
  assert.equal(status.planId, "growth");
  assert.equal(status.planName, "Growth");
  assert.equal(status.allowed, true);
  assert.equal(status.messagesThisCycle, 42);
  assert.equal(status.messagesPerCycle, 10000);
  assert.equal(status.hasPaymentMethod, true);
});

test("status: returns unprovisioned snapshot for a legacy tenant", () => {
  const subFile = path.join(tenantsRoot, "legacy-status", "subscription.json");
  if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
  container.subscriptionRepository.clearCache("legacy-status");
  const status = container.planService.getStatus("legacy-status");
  assert.equal(status.provisioned, false);
  assert.equal(status.allowed, true);
  assert.equal(status.reason, ALLOWED_REASONS.NO_SUBSCRIPTION);
});
