/**
 * v74.2 — Webhook router (Phase 4, final, of the Express migration),
 * mounted at the root so both /webhooks/* and /api/billing/webhook live
 * here. (The /api rate limiter still runs first for the billing path —
 * app.use('/api', limiter) matches the path prefix regardless of which
 * router eventually serves it, exactly as in v74.1.)
 *
 * Both handlers read the RAW request body via readRaw() — the WhatsApp
 * X-Hub-Signature-256 and the Stripe signature are computed over the exact
 * bytes, so no body parser may ever touch these streams. Verbatim
 * transcription from the v73.x if-chain.
 */
const express = require("express");
const { sendJson, sendText, readRaw } = require("../http-helpers");

function createWebhooksRouter({ container }) {
  const router = express.Router();

  // ─── WhatsApp Cloud API webhook (verify + receive) ─────────────────────
  // GET  — Meta subscription verification (hub.mode/hub.verify_token/challenge)
  // POST — signed event delivery; acknowledged immediately, processed async
  //        outside the response lifecycle so Meta never retries on our
  //        processing latency.
  router.get('/webhooks/whatsapp/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    const result = container.whatsappWebhookService.verifySubscription({
      tenantId,
      mode: req.query['hub.mode'],
      token: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge']
    });
    if (!result.ok) return sendText(res, result.statusCode, "Forbidden");
    return sendText(res, 200, result.challenge);
  });

  router.post('/webhooks/whatsapp/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    const rawBody = await readRaw(req);
    const signatureHeader = req.headers["x-hub-signature-256"];
    if (!container.whatsappWebhookService.authenticate({ tenantId, rawBody, signatureHeader })) {
      return sendJson(res, 401, { ok: false, error: "Invalid webhook signature" });
    }
    let payload;
    try { payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {}; }
    catch { return sendJson(res, 400, { ok: false, error: "Invalid JSON body" }); }

    // Acknowledge Meta immediately, then process outside the response lifecycle.
    sendJson(res, 200, { ok: true });
    setImmediate(() => container.whatsappWebhookService.processPayload({ tenantId, payload }).catch((error) => {
      container.logger.error("whatsapp.webhook_processing_failed", { tenantId, error: error.message });
    }));
    return;
  });

  // ─── Phase 4 Sprint 1: Stripe webhook (signature-verified) ──────────
  // Stripe calls this endpoint to report subscription lifecycle events
  // (checkout completed, invoice paid, subscription updated/deleted). The
  // raw body is required for signature verification in real mode; in mock
  // mode the body is parsed as-is (tests inject events directly).
  //
  // Security: mock mode skips signature verification, so it is FORBIDDEN in
  // production — an attacker could forge a checkout.session.completed and
  // activate any tenant for free. The container auto-enables mock when no
  // STRIPE_SECRET_KEY is set; we hard-fail the webhook here if mock mode
  // is on AND NODE_ENV is production, so a misconfigured prod deploy fails
  // closed instead of processing unauthenticated events.
  router.post('/api/billing/webhook', async (req, res) => {
    if (!container.planService || !container.stripeClient) {
      return sendJson(res, 503, { ok: false, error: "billing not configured" });
    }
    if (container.stripeClient.isMockMode && container.stripeClient.isMockMode() && process.env.NODE_ENV === "production") {
      container.logger?.error?.("billing.webhook_rejected_mock_in_prod", {});
      return sendJson(res, 503, { ok: false, error: "Stripe is in mock mode; webhooks are disabled in production. Set STRIPE_SECRET_KEY." });
    }
    const rawBody = await readRaw(req);
    const signature = req.headers["stripe-signature"] || "";
    let event;
    try {
      event = container.stripeClient.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: "Invalid signature" });
    }
    const applied = container.planService.applyWebhookEvent(event);
    // 200 even for irrelevant events — Stripe expects ACK on all valid events.
    return sendJson(res, 200, { received: true, applied });
  });

  return router;
}

module.exports = { createWebhooksRouter };
