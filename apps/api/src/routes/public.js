/**
 * v74.1 — Public product assistant router (Phase 3 of the Express migration).
 *
 * Every /api/public/* and /api/public-admin/* endpoint from the v73.x
 * server.js if-chain, converted 1:1. Handler bodies are verbatim
 * transcriptions — same status codes, response shapes, rate limits and
 * error messages — with these mechanical substitutions only:
 *
 *   url.searchParams.get(x) → req.query.x
 *   path params             → req.params.x (Express decodes once, matching
 *                              the old decodeURIComponent(match[1]))
 *
 * Handlers deliberately keep readJson()/sendJson() from http-helpers
 * instead of mounting express.json on these prefixes: the per-endpoint
 * readJson keeps behavior byte-identical (including its 1 MB cap) and a
 * readJson rejection is forwarded by Express 5 to the central error
 * handler, producing the same 400 "Invalid JSON body." as v73.x.
 *
 * The v73.x OPTIONS preflight branch for /api/public/* was already dead
 * code in v74.0 (the global cors() middleware answers preflights first),
 * so it is not carried over.
 *
 * /api/public-admin/* is the same product surface behind the dev-token
 * gate; both routers are exported from this module.
 */
const express = require("express");
const {
  sendJson, readJson, checkWidgetRateLimit, listTenants,
} = require("../http-helpers");
const { createRequireDeveloperToken } = require("./middleware");

// ─── Public marketing/sales surface (no auth) ───────────────────────────────
function createPublicRouter({ container }) {
  const router = express.Router();

  router.get('/tenants', (req, res) => {
    const tenants = listTenants(container.config.tenantsDir, container.tenantRepository).map(item => {
      const tenant = container.tenantRepository.getById(item.id);
      return { id: item.id, name: item.name, domain: item.domain, assistantName: tenant.branding?.assistantName || 'Nova' };
    });
    return sendJson(res, 200, { ok: true, tenants });
  });

  // POST /chat — the public product assistant. §5.10 supports SSE streaming
  // (stream === true) for a typing effect. Per-IP rate limited (30/min).
  router.post('/chat', async (req, res) => {
    const origin = String(req.headers['origin'] || '*');
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const rl = checkWidgetRateLimit(`public:${clientIp}`);
    if (!rl.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': origin,
        'Retry-After': String(rl.retryAfterSeconds),
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(rl.resetAt)
      });
      return res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded. Please slow down.', retryAfterSeconds: rl.retryAfterSeconds }));
    }
    const body = await readJson(req);
    // §5.10 — streaming mode: return Server-Sent Events for a typing effect.
    if (body.stream === true) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': origin,
        'X-Accel-Buffering': 'no'
      });
      const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const result = await container.publicAssistantService.handleMessage({
          conversation_id: body.conversation_id || null,
          message: body.message,
          locale: body.locale || "en",
          page_context: body.page_context || null,
          campaign: body.campaign || null
        });
        if (result.error) {
          sse("error", { ok: false, error: result.message, status: result.status || 400 });
          return res.end();
        }
        // meta event first (intent, outcome, conversation_id, lead_status).
        sse("meta", {
          ok: true,
          conversation_id: result.conversation_id,
          intent: result.intent,
          outcome: result.outcome,
          lead_status: result.lead_status,
          language: result.language
        });
        // stream the reply text in word-group deltas for a typing effect.
        const words = String(result.reply || "").split(/(\s+)/);
        const chunkSize = 4; // words per delta
        for (let i = 0; i < words.length; i += chunkSize) {
          const delta = words.slice(i, i + chunkSize).join("");
          if (delta) sse("delta", { text: delta });
        }
        // done event with suggested_actions + lead info.
        sse("done", { suggested_actions: result.suggested_actions, lead: result.lead || null, latency_ms: result.latency_ms });
        return res.end();
      } catch (err) {
        sse("error", { ok: false, error: "Stream failed", detail: err.message });
        return res.end();
      }
    }
    const result = await container.publicAssistantService.handleMessage({
      conversation_id: body.conversation_id || null,
      message: body.message,
      locale: body.locale || "en",
      page_context: body.page_context || null,
      campaign: body.campaign || null
    });
    if (result.error) {
      res.writeHead(result.status || 400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': origin });
      return res.end(JSON.stringify({ ok: false, error: result.message }));
    }
    return sendJson(res, 200, { ok: true, ...result });
  });

  // POST /lead — consented lead capture, per-IP rate limited.
  router.post('/lead', async (req, res) => {
    const origin = String(req.headers['origin'] || '*');
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const rl = checkWidgetRateLimit(`public-lead:${clientIp}`);
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': origin, 'Retry-After': String(rl.retryAfterSeconds) });
      return res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded.', retryAfterSeconds: rl.retryAfterSeconds }));
    }
    const body = await readJson(req);
    const consent = body.consent || {};
    const fields = {
      session_id: body.conversation_id || null,
      name: body.name, business_name: body.business_name, industry: body.industry,
      email: body.email, phone: body.phone,
      preferred_contact_method: body.preferred_contact_method,
      business_problem: body.business_problem,
      requested_workflows: body.requested_workflows,
      current_software: body.current_software,
      purchase_timeline: body.purchase_timeline,
      demo_requested: body.demo_requested,
      source: body.source || "public_nova_assistant",
      page_context: body.page_context || null,
      campaign: body.campaign || null
    };
    const submitted = await container.publicAssistantService.submitLead(fields, consent);
    if (!submitted.success) {
      return sendJson(res, 200, { ok: false, error_code: submitted.error_code, errors: submitted.errors || undefined });
    }
    return sendJson(res, 200, { ok: true, success: true, lead_id: submitted.lead_id, status: submitted.status });
  });

  // POST /demo — request a demo for an existing lead.
  router.post('/demo', async (req, res) => {
    const origin = String(req.headers['origin'] || '*');
    const body = await readJson(req);
    if (!body.lead_id) return sendJson(res, 400, { ok: false, error: "lead_id is required" });
    const demo = await container.publicAssistantService.requestDemo({
      lead_id: body.lead_id,
      requested_scenario: body.requested_scenario || null,
      preferred_contact_method: body.preferred_contact_method || null
    });
    if (!demo.success) {
      return sendJson(res, 200, { ok: false, error_code: demo.error_code });
    }
    return sendJson(res, 200, { ok: true, success: true, demo_id: demo.demo_id, status: demo.status });
  });

  // ─── Self-serve signup (public, rate-limited, CORS) ──────────────────
  // A business signs up from the landing page. Provisions the tenant tree,
  // starts a 14-day trial, creates the first owner, returns a JWT so they
  // land straight in the dashboard. Rate-limited per IP to deter abuse.
  // CORS: the signup form is typically on a different origin (marketing
  // site) than the API, so every response must echo the Origin header —
  // without it the browser blocks the response and the signup silently
  // orphans the tenant on disk.
  router.post('/signup', async (req, res) => {
    const origin = String(req.headers['origin'] || '*');
    const corsSignup = (res, status, body) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); return sendJson(res, status, body); };
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const rl = checkWidgetRateLimit(`signup:${clientIp}`);
    if (!rl.allowed) {
      return corsSignup(res, 429, { ok: false, error: 'Too many signup attempts. Please wait a few minutes.', retryAfterSeconds: rl.retryAfterSeconds });
    }
    if (!container.selfServeSignupService) {
      return corsSignup(res, 503, { ok: false, error: 'Self-serve signup is not configured.' });
    }
    let body;
    try { body = await readJson(req); } catch { return corsSignup(res, 400, { ok: false, error: 'Invalid request body.' }); }
    try {
      const result = await container.selfServeSignupService.signup({
        businessName: body.businessName,
        email: body.email,
        password: body.password,
        ownerName: body.ownerName,
        industry: body.industry,
        planId: body.planId,
        overrides: body.overrides,
        ip: clientIp,
      });
      return corsSignup(res, 201, { ok: true, ...result });
    } catch (err) {
      // Sanitize: only surface known user-facing messages, not raw internals.
      const msg = err.message || '';
      const safe = /already exists|is required|Unknown industry|at least 6|couldn't start your free trial|Could not create owner/i.test(msg)
        ? msg
        : 'Signup failed. Please check your details and try again.';
      return corsSignup(res, 400, { ok: false, error: safe });
    }
  });

  // List available industry templates for the signup form (CORS-enabled).
  router.get('/signup/templates', (req, res) => {
    const origin = String(req.headers['origin'] || '*');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    const { listTemplates } = require("../../../../packages/self-serve-onboarding/src");
    return sendJson(res, 200, { ok: true, templates: listTemplates() });
  });

  router.get('/starters', (req, res) => {
    const group = String(req.query.group || "welcome");
    return sendJson(res, 200, { ok: true, starters: container.publicAssistantService.getStarters(group) });
  });

  router.get('/feature-registry', (req, res) => {
    return sendJson(res, 200, { ok: true, features: container.publicFeatureRegistryService.listPublic() });
  });

  return router;
}

// ─── Public-assistant admin routes (dev-token gated) ────────────────────────
// These let the Nova team manage leads, demo requests, and unanswered
// questions captured by the public product assistant. Gated by the same
// NOVA_DEV_TOKEN that protects the developer console.
function createPublicAdminRouter({ container }) {
  const router = express.Router();
  router.use(createRequireDeveloperToken("Developer Console token is required"));

  router.get('/leads', async (req, res) => {
    const status = req.query.status || null;
    const limit = parseInt(req.query.limit || "100", 10);
    const leads = await container.publicLeadService.listLeads({ status, limit });
    return sendJson(res, 200, { ok: true, leads });
  });

  router.get('/leads/summary', async (req, res) => {
    return sendJson(res, 200, { ok: true, summary: await container.publicLeadService.summary() });
  });

  router.get('/demo-requests', async (req, res) => {
    const leadId = req.query.lead_id || null;
    const demos = await container.publicLeadService.listDemoRequests({ leadId });
    return sendJson(res, 200, { ok: true, demo_requests: demos });
  });

  router.get('/unanswered', async (req, res) => {
    const status = req.query.status || null;
    const sortBy = req.query.sort || "occurrence_count";
    const limit = parseInt(req.query.limit || "100", 10);
    const questions = await container.unansweredQuestionRepository.list({ status, sortBy, limit });
    return sendJson(res, 200, { ok: true, questions });
  });

  router.get('/unanswered/summary', async (req, res) => {
    return sendJson(res, 200, { ok: true, summary: await container.unansweredQuestionRepository.summary() });
  });

  router.post('/unanswered/resolve', async (req, res) => {
    const body = await readJson(req);
    const resolution = body.resolution || "resolved";
    const updated = await container.unansweredQuestionRepository.resolve(body.id, resolution);
    return sendJson(res, 200, { ok: true, question: updated });
  });

  router.get('/feature-registry', (req, res) => {
    return sendJson(res, 200, { ok: true, features: container.publicFeatureRegistryService.listPublic() });
  });

  return router;
}

module.exports = { createPublicRouter, createPublicAdminRouter };
