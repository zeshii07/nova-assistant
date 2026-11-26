// Phase 4 Sprint 1 — Stripe client wrapper with a mock mode.
//
// Real mode: when STRIPE_SECRET_KEY is set, uses the `stripe` npm package to
// create Checkout Sessions, Billing Portal sessions, and to verify webhook
// signatures. This is the production path.
//
// Mock mode: when no key is set (tests, local dev), every method returns a
// deterministic fake object so the full billing flow can be exercised without
// network access or credentials. The mock also emits webhook events through a
// captured handler so tests can simulate Stripe lifecycle events
// (checkout.session.completed, invoice.paid, customer.subscription.updated,
// customer.subscription.deleted) end-to-end.
//
// The contract (method names + return shapes) is identical in both modes, so
// the API routes + webhook handler do not branch on mode.
const crypto = require("crypto");

// Deterministic-but-unique ID generator for mock mode. Derives the id from the
// inputs (so a given tenant+plan is recognizable in test output) plus a random
// suffix so two concurrent checkouts for the same tenant never collide (the
// old `session_id=mock` URL collided and broke checkout resumption).
function mockId(prefix, seed = "") {
  const hash = crypto.createHash("sha1").update(prefix + seed).digest("hex").slice(0, 12);
  const rand = crypto.randomBytes(4).toString("hex");
  return `${prefix}_mock_${hash}${rand}`;
}

class StripeClient {
  constructor({ secretKey = null, webhookSecret = null, logger = null, mock = null } = {}) {
    // Auto-detect mode: explicit `mock` flag wins; else mock when no key.
    this.mockMode = mock !== null ? mock : !secretKey;
    this.webhookSecret = webhookSecret || null;
    this.logger = logger || null;
    if (!this.mockMode) {
      // Lazy-require so tests without the stripe package don't crash.
      this._stripe = require("stripe")(secretKey);
    } else if (process.env.NODE_ENV === "production") {
      // Loud warning: mock mode in production means webhooks are unauthenticated.
      // The webhook route hard-fails in this state, but flag it at startup too.
      this.logger?.error?.("stripe.mock_mode_in_production", { hint: "Set STRIPE_SECRET_KEY; webhooks are disabled until then." });
    }
    // Mock-mode hook: tests inject a handler to observe "webhook" events.
    this._mockWebhookHandler = null;
  }

  /** Real Stripe requires the raw body for signature verification. Mock ignores it. */
  isMock() { return this.mockMode; }
  /** Alias used by the webhook route to gate on mode. */
  isMockMode() { return this.mockMode; }

  /** Create a Checkout Session for a plan subscription. */
  async createCheckoutSession({ tenantId, planId, customerId = null, successUrl, cancelUrl }) {
    if (this.mockMode) {
      const sessionId = mockId("cs", `${tenantId}:${planId}`);
      return {
        id: sessionId,
        // Put the real (unique) session id in the URL so two concurrent
        // checkouts don't collide on session_id=mock.
        url: `${successUrl}?mock_checkout=true&session_id=${sessionId}`,
        mode: "subscription",
        customer: customerId || mockId("cus", tenantId),
        metadata: { tenantId, planId },
        client_reference_id: tenantId,
      };
    }
    const plan = require("./plans").getPlan(planId);
    const priceData = {
      currency: plan.currency,
      product_data: { name: `Nova ${plan.name} plan` },
      unit_amount: plan.priceMonthly * 100, // Stripe uses cents
      recurring: { interval: "month" },
    };
    return this._stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId || undefined,
      client_reference_id: tenantId,
      line_items: [{ price_data: priceData, quantity: 1 }],
      metadata: { tenantId, planId },
      subscription_data: { metadata: { tenantId, planId }, trial_period_days: plan.trialDays },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  /** Create a Billing Portal session (lets the business manage their card/plan). */
  async createPortalSession({ customerId, returnUrl }) {
    if (this.mockMode) {
      return { id: mockId("bps"), url: `${returnUrl}?mock_portal=true`, customer: customerId };
    }
    return this._stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  }

  /**
   * Verify a Stripe webhook signature + parse the event.
   * @param {Buffer|string} rawBody  The raw request body (Stripe needs bytes).
   * @param {string} signature       The Stripe-Signature header value.
   * @returns {{ type:string, data:{ object:any } }}  The parsed event.
   */
  constructWebhookEvent(rawBody, signature) {
    if (this.mockMode) {
      // Mock mode: the test injects a pre-built event object via emitMockEvent,
      // and the route calls this with the raw JSON body. We parse it as-is
      // (test-side) — signature verification is skipped.
      const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"));
      return parsed;
    }
    return this._stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /** TEST-ONLY (mock mode): emit a webhook event to the captured handler. */
  emitMockEvent(event) {
    if (!this.mockMode) throw new Error("emitMockEvent is only available in mock mode");
    if (this._mockWebhookHandler) this._mockWebhookHandler(event);
  }

  /** TEST-ONLY (mock mode): capture the webhook handler the route registers. */
  captureMockWebhookHandler(handler) {
    if (!this.mockMode) throw new Error("captureMockWebhookHandler is only available in mock mode");
    this._mockWebhookHandler = handler;
  }
}

module.exports = { StripeClient };
