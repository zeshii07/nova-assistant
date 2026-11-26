// Phase 4 Sprint 1 (+ hardening) — Plan service: the enforcement brain.
//
// Bridges the subscription repository + plan catalog into the decisions the
// engine + API need:
//   - evaluate(tenantId):     should the engine process this tenant's messages?
//   - recordMessage(tenantId): increment the cycle counter atomically (per turn).
//   - getStatus(tenantId):    a snapshot for dashboards + /api/billing/status.
//   - applyWebhookEvent(event): map a Stripe event → subscription state change
//                              (idempotent — duplicate event ids are deduped).
//
// Grace policy:
//   - trialing + before trialEnd:           allowed
//   - trialing + after trialEnd:            NOT allowed (trial expired → must pay)
//   - active + before currentPeriodEnd:     allowed
//   - past_due + within grace (7d):         allowed (give them time to fix the card)
//   - past_due + beyond grace:              NOT allowed
//   - canceled:                             NOT allowed
//   - no subscription at all + not self-serve:  allowed (legacy tenants like byt, demos)
//   - no subscription at all + self-serve:      NOT allowed (new signups must have a trial)
//
// Quota: messagesThisCycle is compared to the plan's messagesPerCycle (-1 = unlimited).
// Over-quota → NOT allowed, with reason "quota_exceeded".
//
// Hardening notes (post-audit):
//   - recordMessage is an atomic compare-and-increment (repo.mutate under a file
//     lock), so concurrent messages can't lose increments or double-count.
//   - applyWebhookEvent dedupes by event.id — Stripe redelivers routinely, and
//     a duplicate checkout.session.completed used to reset the quota to 0.
//   - evaluate uses the injected clock (testable) and lazily persists the
//     trialing→past_due transition when a trial expires, so getStatus is consistent.
const fs = require("fs");
const path = require("path");
const { getPlan, DEFAULT_PLAN_ID } = require("./plans");

const PAST_DUE_GRACE_DAYS = 7;
const PROCESSED_EVENTS_FILE = "processedWebhooks.json";
const PROCESSED_EVENTS_MAX = 1000; // rolling window — bound the file size

const ALLOWED_REASONS = {
  ALLOWED: "allowed",
  NO_SUBSCRIPTION: "no_subscription",          // legacy tenant — allowed by default
  TRIAL_ACTIVE: "trial_active",
  ACTIVE: "active",
  PAST_DUE_GRACE: "past_due_grace",
};

const BLOCKED_REASONS = {
  TRIAL_EXPIRED: "trial_expired",
  SUBSCRIPTION_CANCELED: "subscription_canceled",
  PAST_DUE_EXPIRED: "past_due_expired",
  QUOTA_EXCEEDED: "quota_exceeded",
  UNKNOWN_PLAN: "unknown_plan",
  NO_SUBSCRIPTION_REQUIRED: "no_subscription_required",
};

class PlanService {
  constructor({ subscriptionRepository, logger = null, clock = null, graceDays = PAST_DUE_GRACE_DAYS, tenantsDir = null }) {
    this.repo = subscriptionRepository;
    this.logger = logger;
    this.clock = clock || (() => new Date().toISOString());
    this.graceDays = graceDays;
    this.tenantsDir = tenantsDir; // for the per-tenant processed-events file
    this._processedEvents = new Map(); // tenantId → Set(eventId), in-memory cache of the file
  }

  _nowMs() { return new Date(this.clock()).getTime(); }

  /**
   * Decide whether a tenant's message should be processed.
   * @returns {{ allowed: boolean, reason: string, subscription?: object }}
   */
  evaluate(tenantId) {
    const sub = this.repo.get(tenantId);
    // Backward compatibility: no subscription record. Legacy tenants (byt, demos)
    // are allowed. Self-serve signups MUST have a trial — if they don't, the
    // signup failed to provision one and we block (forcing checkout) rather than
    // giving them free unlimited use. We detect self-serve by the billingRequired
    // flag the onboarding service sets on the profile.
    if (!sub) {
      if (this._isBillingRequired(tenantId)) {
        return { allowed: false, reason: BLOCKED_REASONS.NO_SUBSCRIPTION_REQUIRED };
      }
      return { allowed: true, reason: ALLOWED_REASONS.NO_SUBSCRIPTION };
    }

    const now = this._nowMs();
    const plan = getPlan(sub.planId);
    if (!plan) return { allowed: false, reason: BLOCKED_REASONS.UNKNOWN_PLAN, subscription: sub };

    // Quota check applies to all billable states (trial + active + past_due grace).
    const cap = plan.messagesPerCycle;
    if (cap !== -1 && sub.messagesThisCycle >= cap) {
      return { allowed: false, reason: BLOCKED_REASONS.QUOTA_EXCEEDED, subscription: sub };
    }

    switch (sub.status) {
      case "trialing": {
        if (sub.trialEnd && new Date(sub.trialEnd).getTime() < now) {
          // Lazy transition: persist the expired-trial state so getStatus is
          // consistent. A webhook will eventually flip it to active (on payment)
          // or canceled. Until then treat as past_due (within grace) so the
          // owner gets a short window to add a card after the trial ends.
          this._persistTrialExpiry(tenantId, sub);
          return { allowed: false, reason: BLOCKED_REASONS.TRIAL_EXPIRED, subscription: sub };
        }
        return { allowed: true, reason: ALLOWED_REASONS.TRIAL_ACTIVE, subscription: sub };
      }
      case "active": {
        return { allowed: true, reason: ALLOWED_REASONS.ACTIVE, subscription: sub };
      }
      case "past_due": {
        // Grace: allow for graceDays after currentPeriodEnd, then block.
        const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0;
        const graceEnd = periodEnd + this.graceDays * 86400000;
        if (now < graceEnd) return { allowed: true, reason: ALLOWED_REASONS.PAST_DUE_GRACE, subscription: sub };
        return { allowed: false, reason: BLOCKED_REASONS.PAST_DUE_EXPIRED, subscription: sub };
      }
      case "canceled": {
        return { allowed: false, reason: BLOCKED_REASONS.SUBSCRIPTION_CANCELED, subscription: sub };
      }
      case "incomplete": {
        // Incomplete = checkout started but not finished. Treat like trial-expired.
        return { allowed: false, reason: BLOCKED_REASONS.TRIAL_EXPIRED, subscription: sub };
      }
      default:
        return { allowed: false, reason: BLOCKED_REASONS.SUBSCRIPTION_CANCELED, subscription: sub };
    }
  }

  /** Shortcut for the engine: just the boolean. */
  isAllowed(tenantId) {
    return this.evaluate(tenantId).allowed;
  }

  /**
   * Increment the message counter atomically (locked read-modify-write).
   * No-op for legacy tenants (no subscription). The cap check inside the lock
   * means a burst of concurrent messages can't all pass the cap and then all
   * increment past it — the Nth to acquire the lock sees the updated count.
   */
  async recordMessage(tenantId) {
    const sub = this.repo.get(tenantId);
    if (!sub) return null;
    const plan = getPlan(sub.planId);
    const cap = plan?.messagesPerCycle ?? -1;
    return this.repo.mutate(tenantId, (current) => {
      if (!current) return null; // tenant lost their sub mid-flight — abort
      // Re-check the cap inside the lock; if already at/over cap, don't increment
      // (the message was already allowed by evaluate, but a concurrent burst may
      // have pushed the count over — we don't want to inflate it further).
      if (cap !== -1 && current.messagesThisCycle >= cap) return current;
      return { ...current, messagesThisCycle: current.messagesThisCycle + 1 };
    });
  }

  /** A status snapshot for dashboards + /api/billing/status. */
  getStatus(tenantId) {
    const sub = this.repo.get(tenantId);
    if (!sub) return { tenantId, provisioned: false, allowed: !this._isBillingRequired(tenantId), reason: this._isBillingRequired(tenantId) ? BLOCKED_REASONS.NO_SUBSCRIPTION_REQUIRED : ALLOWED_REASONS.NO_SUBSCRIPTION };
    const decision = this.evaluate(tenantId);
    const plan = getPlan(sub.planId);
    return {
      tenantId,
      provisioned: true,
      status: sub.status,
      planId: sub.planId,
      planName: plan?.name || null,
      allowed: decision.allowed,
      reason: decision.reason,
      messagesThisCycle: sub.messagesThisCycle,
      messagesPerCycle: plan?.messagesPerCycle ?? null,
      trialEnd: sub.trialEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
      hasPaymentMethod: !!sub.stripeCustomerId,
    };
  }

  /**
   * Apply a Stripe webhook event to the subscription state. IDEMPOTENT: a
   * duplicate event.id (Stripe redelivers routinely) is short-circuited so it
   * can't reset the quota counter or double-activate.
   * @param {{ type:string, id?:string, data:{ object:any } }} event
   * @returns {{ tenantId:string, action:string, deduped?:boolean }|null}
   */
  applyWebhookEvent(event) {
    const type = event?.type;
    const obj = event?.data?.object;
    if (!type || !obj) return null;
    const eventId = event?.id;
    const tenantId = obj.metadata?.tenantId || obj.client_reference_id;
    if (!tenantId) return null;

    // Idempotency: if we've seen this event id before, skip. This prevents a
    // redelivered checkout.session.completed from resetting messagesThisCycle.
    if (eventId && this._isEventProcessed(tenantId, eventId)) {
      this.logger?.info?.("billing.webhook_deduped", { tenantId, eventId, type });
      return { tenantId, action: "deduped", deduped: true };
    }

    let result = null;
    switch (type) {
      case "checkout.session.completed": {
        // Checkout finished → activate the subscription.
        const sub = this.repo.get(tenantId) || { tenantId, planId: obj.metadata?.planId || DEFAULT_PLAN_ID, messagesThisCycle: 0, cycleStart: this.clock() };
        const periodEnd = new Date(this._nowMs() + 30 * 86400000).toISOString();
        this.repo.save({
          ...sub,
          tenantId,
          status: "active",
          planId: obj.metadata?.planId || sub.planId || DEFAULT_PLAN_ID,
          stripeCustomerId: obj.customer || sub.stripeCustomerId,
          stripeSubscriptionId: obj.subscription || sub.stripeSubscriptionId,
          currentPeriodEnd: periodEnd,
          trialEnd: null,
          canceledAt: null,
          messagesThisCycle: 0,
          cycleStart: this.clock(),
        });
        result = { tenantId, action: "activated" };
        break;
      }
      case "invoice.paid": {
        // Recurring payment succeeded → renew the cycle. Only reset the counter
        // when the billing period actually advanced (avoid a redeliver resetting
        // a partially-used cycle). We compare currentPeriodEnd.
        const sub = this.repo.get(tenantId);
        if (!sub) { result = null; break; }
        const newPeriodEnd = new Date(this._nowMs() + 30 * 86400000).toISOString();
        const periodAdvanced = !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() < this._nowMs();
        this.repo.save({
          ...sub,
          status: "active",
          currentPeriodEnd: newPeriodEnd,
          ...(periodAdvanced ? { messagesThisCycle: 0, cycleStart: this.clock() } : {}),
          canceledAt: null,
        });
        result = { tenantId, action: "renewed" };
        break;
      }
      case "customer.subscription.updated": {
        const sub = this.repo.get(tenantId);
        if (!sub) { result = null; break; }
        const newStatus = obj.status === "past_due" ? "past_due"
          : obj.status === "active" ? "active"
          : obj.status === "trialing" ? "trialing"
          : sub.status;
        // Plan upgrade: read the new plan from the subscription object's
        // metadata (we set it at checkout) or its price lookup_key. Without this
        // a mid-cycle upgrade starter→growth left planId stuck at "starter" and
        // the tenant was capped at the old (lower) quota.
        const newPlanId = obj.metadata?.planId
          || (obj.items?.data?.[0]?.price?.lookup_key && this._planFromLookupKey(obj.items.data[0].price.lookup_key))
          || sub.planId;
        const planChanged = newPlanId !== sub.planId;
        this.repo.save({
          ...sub,
          status: newStatus,
          planId: newPlanId,
          currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : sub.currentPeriodEnd,
          stripeSubscriptionId: obj.id || sub.stripeSubscriptionId,
          // Reset the counter on plan upgrade so the new (higher) cap takes
          // effect immediately — the tenant just paid for a bigger plan.
          ...(planChanged ? { messagesThisCycle: 0, cycleStart: this.clock() } : {}),
        });
        result = { tenantId, action: planChanged ? "upgraded" : "updated" };
        break;
      }
      case "customer.subscription.deleted": {
        const sub = this.repo.get(tenantId);
        if (!sub) { result = null; break; }
        this.repo.save({ ...sub, status: "canceled", canceledAt: this.clock(), stripeSubscriptionId: obj.id || sub.stripeSubscriptionId });
        result = { tenantId, action: "canceled" };
        break;
      }
      default:
        result = null;
    }

    if (eventId && result) this._markEventProcessed(tenantId, eventId);
    return result;
  }

  /** Provision a trial for a new tenant (called by onboarding). */
  provisionTrial(tenantId, planId = DEFAULT_PLAN_ID) {
    return this.repo.provisionTrial(tenantId, planId);
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** True if the tenant's profile marks billing as required (self-serve signup). */
  _isBillingRequired(tenantId) {
    try {
      if (!this.tenantsDir) return false;
      const profilePath = path.join(this.tenantsDir, tenantId, "profile.json");
      if (!fs.existsSync(profilePath)) return false;
      const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
      return profile.billingRequired === true;
    } catch { return false; }
  }

  /** Persist the expired-trial transition so getStatus stays consistent. */
  _persistTrialExpiry(tenantId, sub) {
    try {
      this.repo.save({ ...sub, status: "past_due", canceledAt: null });
    } catch (e) {
      this.logger?.warn?.("billing.trial_expiry_persist_failed", { tenantId, error: e.message });
    }
  }

  _planFromLookupKey(key) {
    const plans = require("./plans").PLANS;
    for (const p of Object.values(plans)) {
      if (key === p.planId || key === p.name.toLowerCase()) return p.planId;
    }
    return null;
  }

  // ── webhook idempotency: per-tenant processed-event log ────────────────

  _processedEventsPath(tenantId) {
    return this.tenantsDir ? path.join(this.tenantsDir, tenantId, PROCESSED_EVENTS_FILE) : null;
  }

  _loadProcessedEvents(tenantId) {
    if (this._processedEvents.has(tenantId)) return this._processedEvents.get(tenantId);
    const set = new Set();
    const p = this._processedEventsPath(tenantId);
    if (p && fs.existsSync(p)) {
      try {
        const arr = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(arr)) for (const id of arr) set.add(id);
      } catch {}
    }
    this._processedEvents.set(tenantId, set);
    return set;
  }

  _isEventProcessed(tenantId, eventId) {
    return this._loadProcessedEvents(tenantId).has(eventId);
  }

  _markEventProcessed(tenantId, eventId) {
    const set = this._loadProcessedEvents(tenantId);
    set.add(eventId);
    const p = this._processedEventsPath(tenantId);
    if (!p) return;
    try {
      // Rolling window: keep only the most recent N event ids to bound file size.
      let arr = [...set];
      if (arr.length > PROCESSED_EVENTS_MAX) arr = arr.slice(arr.length - PROCESSED_EVENTS_MAX);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(arr, null, 2), "utf8");
      this._processedEvents.set(tenantId, new Set(arr));
    } catch (e) {
      this.logger?.warn?.("billing.processed_events_persist_failed", { tenantId, error: e.message });
    }
  }
}

module.exports = { PlanService, ALLOWED_REASONS, BLOCKED_REASONS, PAST_DUE_GRACE_DAYS };