// Phase 4 Sprint 1 — Billing plan catalog.
//
// Defines the subscription tiers Nova offers to businesses, the limits each
// tier enforces, and the feature flags each tier gates. Plans are pure data so
// the catalog can be edited (pricing changes, new tiers) without touching the
// billing logic.
//
// Plan selection is enforced by PlanService (this file exports the catalog;
// PlanService in planService.js reads it).
//
// Design notes:
//   - "messagesPerCycle" is the monthly message quota. -1 = unlimited.
//   - "cycleDays" is the billing period length (mirrors Stripe's monthly).
//   - Feature flags gate engine behavior: e.g. llmFallback=true allows the
//     LLM escalation path; only growth/scale tiers get it.
//   - Trial: every new tenant starts on the starter tier with status=trialing
//     and trialDays of free usage before the first payment is required.

const PLANS = {
  // Starter — entry tier. Deterministic engine only, no LLM escalation.
  // For small businesses getting started with automated customer messaging.
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 29,           // USD
    currency: "usd",
    messagesPerCycle: 2000,
    cycleDays: 30,
    trialDays: 14,
    features: {
      llmFallback: false,
      multiChannel: false,      // WhatsApp + web only
      analytics: "basic",
      customPersona: false,
    },
  },

  // Growth — recommended tier for established small businesses.
  // LLM escalation enabled, all channels, full analytics.
  growth: {
    id: "growth",
    name: "Growth",
    priceMonthly: 79,
    currency: "usd",
    messagesPerCycle: 10000,
    cycleDays: 30,
    trialDays: 14,
    features: {
      llmFallback: true,
      multiChannel: true,
      analytics: "advanced",
      customPersona: true,
    },
  },

  // Scale — for businesses with high message volume or multiple locations.
  scale: {
    id: "scale",
    name: "Scale",
    priceMonthly: 199,
    currency: "usd",
    messagesPerCycle: -1,       // unlimited
    cycleDays: 30,
    trialDays: 14,
    features: {
      llmFallback: true,
      multiChannel: true,
      analytics: "advanced",
      customPersona: true,
      prioritySupport: true,
    },
  },
};

// Ordered list for UI display (cheapest first).
const PLAN_ORDER = ["starter", "growth", "scale"];

/** Get a plan by id, or null if unknown. */
function getPlan(planId) {
  return PLANS[planId] || null;
}

/** List all plans in display order. */
function listPlans() {
  return PLAN_ORDER.map((id) => PLANS[id]);
}

/** The default plan a new tenant is provisioned on during trial. */
const DEFAULT_PLAN_ID = "starter";

module.exports = { PLANS, PLAN_ORDER, getPlan, listPlans, DEFAULT_PLAN_ID };
