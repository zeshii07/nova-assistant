const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { importBusinessFile } = require("../../../packages/tenant-onboarding/src/businessFileImporter");
const { getContainer } = require("./container");
const packageJson = require("../../../package.json");
const { ForbiddenError, ValidationError } = require("../../../packages/shared/src/errors");
const { mintState, verifyState } = require("../../../packages/auth-engine/src/oauthState");
const { applyStatePatch } = require("../../../packages/state/src/stateSchema");
const { replyToNovaVisitor } = require("./novaMarketingAssistant");
// v35.3: Logger import — used for AsyncLocalStorage-based correlation ID propagation
const { Logger } = require("../../../packages/logger/src/logger");
// v36.0: File existence cache — avoids redundant fs.existsSync on hot paths
const { fileExistenceCache } = require("../../../packages/storage/src/fileExistenceCache");
// v73.1: Realtime WebSocket bridge — pushes EventBus events to dashboards/widget.
const { RealtimeBridge } = require("../../../packages/realtime/src/realtimeBridge");

async function startServer() {
  const container = await getContainer();
  const server = http.createServer(async (req, res) => {
    // v35.3: wrap every request in a correlation ID context so all logs
    // emitted during the request lifecycle include `requestId`.
    const reqId = String(req.headers['x-request-id'] || req.headers['x-correlation-id'] || '').trim()
      || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    res.setHeader('X-Request-Id', reqId);
    return Logger.withCorrelationId(reqId, async () => {
    try {
      const url = new URL(req.url, "http://localhost");
      const whatsappMatch = url.pathname.match(/^\/webhooks\/whatsapp\/([^/]+)$/);

      // Developer Console is intentionally served by the same process during
      // development so the Playground exercises the exact production engine.
      if (req.method === "GET" && (url.pathname === "/developer" || url.pathname.startsWith("/developer/") || url.pathname === "/developers" || url.pathname.startsWith("/developers/"))) {
        return serveDeveloperAsset(res, url.pathname);
      }
      if (req.method === "GET" && (url.pathname === "/assistant" || url.pathname.startsWith("/assistant/") || url.pathname === "/chat" || url.pathname.startsWith("/chat/"))) {
        return servePublicChatAsset(res,url.pathname);
      }
      // v27.0 Admin Dashboard — operator console for tenants, conversations,
      // leads, ML insights, capabilities, and test runs. Served by the same
      // process so the dashboard exercises the exact production engine.
      if (req.method === "GET" && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
        return serveAdminAsset(res, url.pathname);
      }
      // v10.3 — Public Product Assistant admin dashboard (leads, demo requests,
      // unanswered questions, feature registry). HTML is served to anyone; the
      // /api/public-admin/* endpoints it calls are dev-token gated.
      if (req.method === "GET" && (url.pathname === "/public-admin" || url.pathname.startsWith("/public-admin/"))) {
        return servePublicAdminAsset(res, url.pathname);
      }
      // v34.1: PWA manifest and service worker served from admin dashboard
      if (req.method === "GET" && (url.pathname === "/manifest.json" || url.pathname === "/sw.js" || url.pathname === "/favicon.ico")) {
        return serveAdminAsset(res, "/admin" + url.pathname);
      }
      // v28.0 Website Widget SDK — drop-in embeddable script.
      // Customers include <script src="https://your-nova.com/widget.js" data-tenant="cleaning-demo"></script>
      // and the widget auto-mounts on any page. Served with strict CSP + Cache-Control.
      if (req.method === "GET" && (url.pathname === "/widget.js" || url.pathname === "/widget-config.js" || url.pathname === "/avatars.js" || url.pathname === "/widget-test")) {
        return serveWidgetAsset(res, url.pathname);
      }
      // v35.0: PWA assets for kiosk (manifest + service worker)
      if (req.method === "GET" && url.pathname === "/kiosk-manifest.json") {
        const p = path.resolve(__dirname, "../../widget/public/kiosk-manifest.json");
        if (fs.existsSync(p)) {
          const data = fs.readFileSync(p);
          res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' });
          res.end(data);
          return;
        }
        return sendText(res, 404, 'Manifest not found');
      }
      if (req.method === "GET" && url.pathname === "/kiosk-sw.js") {
        const p = path.resolve(__dirname, "../../widget/public/kiosk-sw.js");
        if (fs.existsSync(p)) {
          const data = fs.readFileSync(p);
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/kiosk/' });
          res.end(data);
          return;
        }
        return sendText(res, 404, 'Service worker not found');
      }
      // v32.0 Business Manager Dashboard — separate dashboard for business owners.
      // Served by the same process. Owners log in with email+password and see
      // ONLY their tenant's data (conversations, bookings, leads, customers).
      if (req.method === "GET" && (url.pathname === "/business" || url.pathname.startsWith("/business/"))) {
        return serveBusinessAsset(res, url.pathname);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const health = await Promise.all(container.registry.list().map((item) => item.health()));
        const checks = { service: "nova-api", version: packageJson.version, capabilities: health, channels: ["http", "whatsapp"] };
        // v22.0: Storage health checks
        checks.storage = { mode: container.config.storageMode };
        if (container.storage?.db) {
          try {
            await container.storage.db.query('SELECT 1 as ok');
            checks.storage.postgres = { ok: true, poolMax: container.config.dbPoolMax };
          } catch (error) {
            checks.storage.postgres = { ok: false, error: error.message };
          }
        }
        if (container.storage?.redis) {
          try {
            // RedisStateRepository doesn't expose a ping, so we test via a get
            await container.storage.redis.get('__health_check__');
            checks.storage.redis = { ok: true, ttlSeconds: container.config.stateTtlSeconds };
          } catch (error) {
            checks.storage.redis = { ok: false, error: error.message };
          }
        }
        // v21.0: Feedback collector status
        if (container.feedbackCollector) {
          checks.feedback = { storageDir: container.feedbackCollector.storageDir };
        }
        // v16-v20: ML status
        if (container.mlIntentClassifier) {
          checks.ml = { version: container.mlIntentClassifier.model?.version || 'unknown', trained: container.mlIntentClassifier.trained };
        }
        // v35.3: External service status + circuit breaker states
        checks.dependencies = {};
        if (container.emailService) {
          checks.dependencies.email = {
            configured: container.emailService.configured,
            circuit: container.emailService.breaker?.getStatus() || null
          };
        }
        if (container.googleOAuthClient) {
          checks.dependencies.googleCalendar = {
            configured: container.googleOAuthClient.isConfigured?.() || false,
          };
        }
        if (container.groqNluClient) {
          checks.dependencies.groq = { available: !!container.groqNluClient };
        }
        if (container.llmRouter) {
          checks.dependencies.llm = { available: !!container.llmRouter };
        }
        // Filesystem writability check
        try {
          const fs = require('fs');
          const path = require('path');
          const healthCheckFile = path.join(container.config.operationalDataDir, '.health-check');
          fs.writeFileSync(healthCheckFile, String(Date.now()));
          fs.unlinkSync(healthCheckFile);
          checks.dependencies.filesystem = { ok: true, dir: container.config.operationalDataDir };
        } catch (err) {
          checks.dependencies.filesystem = { ok: false, error: err.message };
        }
        const allOk = (!checks.storage.postgres || checks.storage.postgres.ok) && (!checks.storage.redis || checks.storage.redis.ok) && checks.dependencies.filesystem.ok;
        return sendJson(res, allOk ? 200 : 503, { ok: allOk, ...checks });
      }

      // ─── Phase 3 Sprint 2: Dashboard metrics endpoint ───────────────────
      // Returns per-tenant + per-capability fallback %, p95 latency, and LLM
      // share so production health is observable. Read-only; safe to poll.
      if (req.method === "GET" && url.pathname === "/metrics") {
        if (!container.metricsAggregator) {
          return sendJson(res, 503, { ok: false, error: "metrics aggregator not configured" });
        }
        return sendJson(res, 200, { ok: true, ...container.metricsAggregator.snapshot() });
      }

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
      if (req.method === "POST" && url.pathname === "/api/billing/webhook") {
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
      }

      // ─── Roadmap #9: Health endpoints (public, for load balancers) ────────
      // GET /api/health        → cheap liveness (200 if the process is up)
      // GET /api/health?deep=1 → readiness (checks tenants dir, billing, calendar)
      // These are intentionally unauthenticated so a load balancer can probe
      // them without credentials; they expose no tenant data.
      if (req.method === "GET" && url.pathname === "/api/health") {
        if (!container.healthService) return sendJson(res, 200, { status: "ok" });
        const deep = url.searchParams.get("deep") === "1";
        // readiness() is async (v73.0: probes Redis/Postgres connectivity).
        const result = deep ? await container.healthService.readiness() : container.healthService.liveness();
        // Unhealthy readiness → 503 so the LB pulls the instance out of rotation.
        const status = result.status === "unhealthy" ? 503 : 200;
        return sendJson(res, status, result);
      }

      // ─── Phase 4 hardening: PUBLIC OAuth callbacks (Google + Microsoft) ────
      // These MUST be public: the provider redirects the user's browser here
      // after consent, and the browser has no dev token. Security comes from
      // the signed, single-use `state` token (oauthState.js) — without it an
      // attacker could forge a callback to overwrite a victim tenant's tokens.
      // The state is minted by the authed initiation route above and verified
      // here; a replay or tamper throws and the callback returns 400.
      if (req.method === "GET" && url.pathname === "/api/admin/calendar/callback") {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') || '';
        const oauthError = url.searchParams.get('error');
        if (oauthError) {
          return sendHtml(res, 400, `<h1>Authorization failed</h1><p>Google returned an error: ${escHtml(oauthError)}</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
        let tenantId;
        try {
          const verified = verifyState(state, container.oauthNonceStore);
          tenantId = verified.tenantId;
        } catch (err) {
          container.logger?.warn?.('google_calendar.state_invalid', { error: err.message });
          return sendHtml(res, 400, `<h1>Authorization failed</h1><p>The security token was invalid or expired. Please start the connection again from the dashboard.</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
        if (!code) {
          return sendHtml(res, 400, '<h1>Missing authorization code</h1><p>No code was returned by Google.</p>');
        }
        try {
          const tokens = await container.googleOAuthClient.exchangeCode(code);
          container.calendarTokenRepository.save(tenantId, tokens);
          const configPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
          if (fs.existsSync(configPath)) {
            const calConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            calConfig.provider = 'google';
            calConfig.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(calConfig, null, 2) + '\n', 'utf8');
            container.calendarConfigRepository.clear(tenantId);
          }
          container.logger.info('google_calendar.connected', { tenantId });
          return sendHtml(res, 200, `<h1>✅ Google Calendar connected!</h1><p>Tenant <strong>${escHtml(tenantId)}</strong> is now connected. Nova can check real availability and create calendar events.</p><p><a href="/admin">Back to dashboard</a></p>`);
        } catch (err) {
          container.logger.error('google_calendar.oauth_failed', { tenantId, error: err.message });
          return sendHtml(res, 500, `<h1>Connection failed</h1><p>Google did not grant access. Please try again from the dashboard.</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
      }

      if (req.method === "GET" && url.pathname === "/api/admin/calendar/microsoft/callback") {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') || '';
        const oauthError = url.searchParams.get('error');
        if (oauthError) {
          return sendHtml(res, 400, `<h1>Authorization failed</h1><p>Microsoft returned an error: ${escHtml(oauthError)}</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
        let tenantId;
        try {
          const verified = verifyState(state, container.oauthNonceStore);
          tenantId = verified.tenantId;
        } catch (err) {
          container.logger?.warn?.('microsoft_calendar.state_invalid', { error: err.message });
          return sendHtml(res, 400, `<h1>Authorization failed</h1><p>The security token was invalid or expired. Please start the connection again from the dashboard.</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
        if (!code) {
          return sendHtml(res, 400, '<h1>Missing authorization code</h1><p>No code was returned by Microsoft.</p>');
        }
        try {
          const tokens = await container.microsoftOAuthClient.exchangeCode(code);
          container.calendarTokenRepository.save(tenantId, tokens);
          const configPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
          if (fs.existsSync(configPath)) {
            const calConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            calConfig.provider = 'microsoft';
            calConfig.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(calConfig, null, 2) + '\n', 'utf8');
            container.calendarConfigRepository.clear(tenantId);
          }
          container.logger.info('microsoft_calendar.connected', { tenantId });
          return sendHtml(res, 200, `<h1>✅ Microsoft Calendar connected!</h1><p>Tenant <strong>${escHtml(tenantId)}</strong> is now connected. Nova can check real availability and create calendar events.</p><p><a href="/admin">Back to dashboard</a></p>`);
        } catch (err) {
          container.logger.error('microsoft_calendar.oauth_failed', { tenantId, error: err.message });
          return sendHtml(res, 500, `<h1>Connection failed</h1><p>Microsoft did not grant access. Please try again from the dashboard.</p><p><a href="/admin">Back to dashboard</a></p>`);
        }
      }

      if (whatsappMatch && req.method === "GET") {
        const tenantId = decodeURIComponent(whatsappMatch[1]);
        const result = container.whatsappWebhookService.verifySubscription({
          tenantId,
          mode: url.searchParams.get("hub.mode"),
          token: url.searchParams.get("hub.verify_token"),
          challenge: url.searchParams.get("hub.challenge")
        });
        if (!result.ok) return sendText(res, result.statusCode, "Forbidden");
        return sendText(res, 200, result.challenge);
      }

      if (whatsappMatch && req.method === "POST") {
        const tenantId = decodeURIComponent(whatsappMatch[1]);
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
      }

      if (req.method === "GET" && url.pathname === "/api/crm/customer") {
        if(!authorizeDeveloperRequest(req))return sendJson(res,401,{ok:false,error:"Developer Console token is required"});
        const tenantId = url.searchParams.get("tenantId") || container.config.defaultTenantId;
        const customerId = url.searchParams.get("customerId");
        if (!customerId) return sendJson(res, 400, { ok: false, error: "customerId is required" });
        const customer = await container.crmService.getCustomer(tenantId, customerId);
        const activities = await container.crmService.listActivities(tenantId, customerId, { limit: 20 });
        return sendJson(res, 200, { ok: true, customer, activities });
      }

      if (req.method === "GET" && url.pathname === "/api/catalog/products") {
        const tenantId = url.searchParams.get("tenantId") || container.config.defaultTenantId;
        const products = await container.catalogService.listProducts(tenantId);
        return sendJson(res, 200, { ok: true, products });
      }

      if(req.method==="GET"&&url.pathname==="/api/public/tenants"){
        const tenants=listTenants(container.config.tenantsDir,container.tenantRepository).map(item=>{
          const tenant=container.tenantRepository.getById(item.id);
          return {id:item.id,name:item.name,domain:item.domain,assistantName:tenant.branding?.assistantName||'Nova'};
        });
        return sendJson(res,200,{ok:true,tenants});
      }

      // ── /api/assistant/chat — UNIFIED (Phase 2 Sprint 3) ──────────────
      // Previously this was a separate 200-line regex bot (novaMarketingAssistant.js)
      // that BYPASSED the rate limiter, the public knowledge base (RAG), the lead
      // capture flow, the abstention policy, and the policy redactor. H8 root cause:
      // "two parallel public assistants — keyword matcher that answers when it
      // should abstain + leaks internal config text, and a separate regex bot with
      // no rate limit."
      //
      // Now this route runs the SAME PublicAssistantService.handleMessage flow as
      // /api/public/chat (single source of truth): per-IP rate limit, RAG over the
      // public-product knowledge base with the H2b 0.40 relevance threshold
      // (abstains instead of guessing), the H8 messagingRules/persona leak
      // defense (indexing chokepoint + sanitizeEvidence + redactReply +
      // assertChunkPublic), lead capture, conversation memory, and analytics.
      //
      // The legacy {reply, topic, suggestions} response shape is preserved for
      // backward compatibility (existing /api/assistant/chat clients). The topic
      // is mapped from the unified `intent`/`outcome`; suggestions from
      // `suggested_actions`. `replyToNovaVisitor` stays importable so existing
      // callers (e.g. sprint78 test) that use it directly still work — it is now a
      // curated topic library, not a parallel routing path.
      if(req.method==="POST"&&url.pathname==="/api/assistant/chat"){
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
          return res.end(JSON.stringify({ ok:false, error:'Rate limit exceeded. Please slow down.', retryAfterSeconds: rl.retryAfterSeconds }));
        }
        const body=await readJson(req);
        const text=String(body.text||'').trim();
        if(!text)return sendJson(res,400,{ok:false,error:'text is required'});
        if(text.length>4000)throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
        // Route through the unified PublicAssistantService flow (single source of truth).
        const unified = await container.publicAssistantService.handleMessage({
          conversation_id: body.conversationId || null,
          message: text,
          locale: body.language || "en",
          page_context: null,
          campaign: null
        });
        if (unified.error) {
          return sendJson(res, unified.status || 400, { ok:false, error: unified.message });
        }
        // Map the previousTopic hint into the conversation context if the caller
        // supplied one (legacy clients threaded topic client-side). The unified
        // service already tracks last_topic in session memory; this only seeds it
        // for a fresh conversation so the first "yes" can still context-follow.
        // Adapt the unified response to the legacy {conversationId, reply, topic, suggestions} shape.
        const topic = unified.outcome === "greeting" ? "greeting"
          : unified.outcome === "small_talk" ? "small_talk"
          : unified.outcome === "lead" ? "get_started"
          : unified.outcome === "refuse" ? "tenant_boundary"
          : unified.outcome === "escalate" ? "fallback"
          : unified.intent || "capabilities";
        const suggestions = (unified.suggested_actions || []).map((a) => a.label || a.value).filter(Boolean);
        return sendJson(res, 200, {
          ok: true,
          conversationId: unified.conversation_id,
          reply: unified.reply,
          topic,
          suggestions,
          // Expose the unified outcome/lead_status so new clients can use the
          // richer contract without breaking old clients that ignore extra keys.
          outcome: unified.outcome,
          lead_status: unified.lead_status,
          language: unified.language
        });
      }

      // ── Public Product Assistant + Lead Capture (Nova Public Product Assistant spec) ──
      // These endpoints are intentionally NOT behind the dev-token gate. They are
      // the public marketing/sales surface: visitors explain Nova, qualify, and
      // submit consented leads. Security is enforced by a per-IP rate limiter,
      // a fixed server-side public tenant identity (browser tenant_id is ignored),
      // a strict policy refuse list, and server-side lead validation. §5, §20.
      if (req.method === "OPTIONS" && url.pathname.startsWith("/api/public/")) {
        const origin = String(req.headers['origin'] || '*');
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '86400'
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/api/public/chat") {
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
          return res.end(JSON.stringify({ ok:false, error:'Rate limit exceeded. Please slow down.', retryAfterSeconds: rl.retryAfterSeconds }));
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
              sse("error", { ok:false, error: result.message, status: result.status || 400 });
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
            sse("error", { ok:false, error: "Stream failed", detail: err.message });
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
          return res.end(JSON.stringify({ ok:false, error: result.message }));
        }
        return sendJson(res, 200, { ok:true, ...result });
      }

      if (req.method === "POST" && url.pathname === "/api/public/lead") {
        const origin = String(req.headers['origin'] || '*');
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const rl = checkWidgetRateLimit(`public-lead:${clientIp}`);
        if (!rl.allowed) {
          res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': origin, 'Retry-After': String(rl.retryAfterSeconds) });
          return res.end(JSON.stringify({ ok:false, error:'Rate limit exceeded.', retryAfterSeconds: rl.retryAfterSeconds }));
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
          return sendJson(res, 200, { ok:false, error_code: submitted.error_code, errors: submitted.errors || undefined });
        }
        return sendJson(res, 200, { ok:true, success:true, lead_id: submitted.lead_id, status: submitted.status });
      }

      if (req.method === "POST" && url.pathname === "/api/public/demo") {
        const origin = String(req.headers['origin'] || '*');
        const body = await readJson(req);
        if (!body.lead_id) return sendJson(res, 400, { ok:false, error:"lead_id is required" });
        const demo = await container.publicAssistantService.requestDemo({
          lead_id: body.lead_id,
          requested_scenario: body.requested_scenario || null,
          preferred_contact_method: body.preferred_contact_method || null
        });
        if (!demo.success) {
          return sendJson(res, 200, { ok:false, error_code: demo.error_code });
        }
        return sendJson(res, 200, { ok:true, success:true, demo_id: demo.demo_id, status: demo.status });
      }

      // ─── Phase 4 Sprint 2: Self-serve signup (public, rate-limited, CORS) ──
      // A business signs up from the landing page. Provisions the tenant tree,
      // starts a 14-day trial, creates the first owner, returns a JWT so they
      // land straight in the dashboard. Rate-limited per IP to deter abuse.
      // CORS: the signup form is typically on a different origin (marketing
      // site) than the API, so every response must echo the Origin header —
      // without it the browser blocks the response and the signup silently
      // orphans the tenant on disk.
      if (req.method === "POST" && url.pathname === "/api/public/signup") {
        const origin = String(req.headers['origin'] || '*');
        const corsSignup = (res, status, body) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); return sendJson(res, status, body); };
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const rl = checkWidgetRateLimit(`signup:${clientIp}`);
        if (!rl.allowed) {
          return corsSignup(res, 429, { ok:false, error:'Too many signup attempts. Please wait a few minutes.', retryAfterSeconds: rl.retryAfterSeconds });
        }
        if (!container.selfServeSignupService) {
          return corsSignup(res, 503, { ok:false, error:'Self-serve signup is not configured.' });
        }
        let body;
        try { body = await readJson(req); } catch { return corsSignup(res, 400, { ok:false, error:'Invalid request body.' }); }
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
          return corsSignup(res, 201, { ok:true, ...result });
        } catch (err) {
          // Sanitize: only surface known user-facing messages, not raw internals.
          const msg = err.message || '';
          const safe = /already exists|is required|Unknown industry|at least 6|couldn't start your free trial|Could not create owner/i.test(msg)
            ? msg
            : 'Signup failed. Please check your details and try again.';
          return corsSignup(res, 400, { ok:false, error: safe });
        }
      }

      // List available industry templates for the signup form (CORS-enabled).
      if (req.method === "GET" && url.pathname === "/api/public/signup/templates") {
        const origin = String(req.headers['origin'] || '*');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        const { listTemplates } = require("../../../packages/self-serve-onboarding/src");
        return sendJson(res, 200, { ok:true, templates: listTemplates() });
      }

      if (req.method === "GET" && url.pathname === "/api/public/starters") {
        const group = String(url.searchParams.get("group") || "welcome");
        return sendJson(res, 200, { ok:true, starters: container.publicAssistantService.getStarters(group) });
      }

      if (req.method === "GET" && url.pathname === "/api/public/feature-registry") {
        return sendJson(res, 200, { ok:true, features: container.publicFeatureRegistryService.listPublic() });
      }
      // ── End public product assistant routes ──

      // ── Public-assistant admin routes (dev-token gated) ──
      // These let the Nova team manage leads, demo requests, and unanswered
      // questions captured by the public product assistant. Gated by the same
      // NOVA_DEV_TOKEN that protects the developer console.
      if (url.pathname.startsWith("/api/public-admin/") && !authorizeDeveloperRequest(req)) {
        return sendJson(res, 401, { ok:false, error:"Developer Console token is required" });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/leads") {
        const status = url.searchParams.get("status") || null;
        const limit = parseInt(url.searchParams.get("limit") || "100", 10);
        const leads = await container.publicLeadService.listLeads({ status, limit });
        return sendJson(res, 200, { ok:true, leads });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/leads/summary") {
        return sendJson(res, 200, { ok:true, summary: await container.publicLeadService.summary() });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/demo-requests") {
        const leadId = url.searchParams.get("lead_id") || null;
        const demos = await container.publicLeadService.listDemoRequests({ leadId });
        return sendJson(res, 200, { ok:true, demo_requests: demos });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/unanswered") {
        const status = url.searchParams.get("status") || null;
        const sortBy = url.searchParams.get("sort") || "occurrence_count";
        const limit = parseInt(url.searchParams.get("limit") || "100", 10);
        const questions = await container.unansweredQuestionRepository.list({ status, sortBy, limit });
        return sendJson(res, 200, { ok:true, questions });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/unanswered/summary") {
        return sendJson(res, 200, { ok:true, summary: await container.unansweredQuestionRepository.summary() });
      }
      if (req.method === "POST" && url.pathname === "/api/public-admin/unanswered/resolve") {
        const body = await readJson(req);
        const resolution = body.resolution || "resolved";
        const updated = await container.unansweredQuestionRepository.resolve(body.id, resolution);
        return sendJson(res, 200, { ok:true, question: updated });
      }
      if (req.method === "GET" && url.pathname === "/api/public-admin/feature-registry") {
        return sendJson(res, 200, { ok:true, features: container.publicFeatureRegistryService.listPublic() });
      }
      // ── End public-assistant admin routes ──

      if (url.pathname.startsWith("/api/dev/") && !authorizeDeveloperRequest(req)) {
        return sendJson(res, 401, { ok:false, error:"Developer Console token is required" });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/chat") {
        const body = await readJson(req);
        const message = { channel: "playground", customerId: String(body.customerId || "playground-user"), tenantId: String(body.tenantId || container.config.defaultTenantId), messageId: body.messageId ? String(body.messageId) : null, text: String(body.text || ""), metadata: { source: "developer-console" } };
        if (!message.text.trim()) return sendJson(res, 400, { ok:false, error:"text is required" });
        const result = await container.executionEngine.process(message);
        return sendJson(res, 200, { ok:true, ...result });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/reset") {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || container.config.defaultTenantId);
        const customerId = String(body.customerId || "playground-user");
        const channel = String(body.channel || "playground");
        await container.stateRepository.delete(`${tenantId}:${channel}:${customerId}`);
        // Conversation reset intentionally preserves CRM, orders, bookings and
        // the active cart. The developer-only fresh-test option clears only the
        // active cart so acceptance runs can start clean without erasing audit
        // history or customer records.
        if(body.clearCart===true){const cart=await container.commerceRepository.getCart(tenantId,customerId);if(cart?.id)await container.inventoryService.releaseCart({tenantId,cartId:cart.id,reason:"developer_fresh_test"});await container.commerceRepository.clearCart(tenantId,customerId);}
        return sendJson(res, 200, { ok:true,conversationReset:true,cartCleared:body.clearCart===true });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/replays") {
        const replays = await container.replayService.list({ conversationId:url.searchParams.get("conversationId") || null, limit:Number(url.searchParams.get("limit") || 50) });
        return sendJson(res, 200, { ok:true, replays });
      }

      if(req.method==="GET"&&url.pathname==="/api/dev/leads"){
        const tenantId=String(url.searchParams.get("tenantId")||container.config.defaultTenantId);
        container.tenantRepository.getById(tenantId);
        const leads=await container.leadService.list(tenantId,{status:url.searchParams.get("status")||null,grade:url.searchParams.get("grade")||null,limit:Number(url.searchParams.get("limit")||100)});
        const summary=await container.leadService.summary(tenantId);
        return sendJson(res,200,{ok:true,tenantId,summary,leads});
      }

      const leadMatch=url.pathname.match(/^\/api\/dev\/leads\/([^/]+)$/);
      if(req.method==="GET"&&leadMatch){
        const tenantId=String(url.searchParams.get("tenantId")||container.config.defaultTenantId);
        container.tenantRepository.getById(tenantId);
        const lead=await container.leadService.get(tenantId,decodeURIComponent(leadMatch[1]));
        return lead?sendJson(res,200,{ok:true,lead}):sendJson(res,404,{ok:false,error:"Lead not found"});
      }

      const replayMatch = url.pathname.match(/^\/api\/dev\/replays\/([^/]+)$/);
      if (req.method === "GET" && replayMatch) {
        const replay = await container.replayService.get(decodeURIComponent(replayMatch[1]));
        return replay ? sendJson(res, 200, { ok:true, replay }) : sendJson(res, 404, { ok:false, error:"Replay not found" });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/capabilities") {
        return sendJson(res, 200, { ok:true, capabilities:container.registry.list().map((capability)=>({ id:capability.id, manifest:capability.manifest })) });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/data/inspect") {
        const tenantId = String(url.searchParams.get("tenantId") || container.config.defaultTenantId);
        const customerId = String(url.searchParams.get("customerId") || "playground-user");
        const channel = String(url.searchParams.get("channel") || "playground");
        const conversationId = `${tenantId}:${channel}:${customerId}`;
        const [state, customer, activities, cart, orders, bookings, serviceRequests, inventory, calendarEvents] = await Promise.all([
          container.stateRepository.get(conversationId),
          container.crmRepository.getCustomer(tenantId, customerId),
          container.crmRepository.listActivities(tenantId, customerId, { limit:20 }),
          container.commerceRepository.getCart(tenantId, customerId),
          container.commerceRepository.listOrders(tenantId, customerId),
          container.bookingRepository.list(tenantId, customerId),
          container.cleaningRequestRepository?.listByCustomer?.(tenantId, customerId) || Promise.resolve([]),
          container.inventoryService.overview(tenantId),
          container.calendarService.listEvents({tenantId,customerId,includeCancelled:true})
        ]);
        return sendJson(res, 200, {
          ok:true, storageMode:container.storage.mode, tenantId, customerId, conversationId, state,
          crm:{customer,activities}, commerce:{cart,orders}, inventory, calendarEvents, bookings, serviceRequests,
          transactions:{orders,bookings,serviceRequests}
        });
      }

      if (req.method === "GET" && url.pathname === "/api/dev/tenants") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        return sendJson(res, 200, { ok:true, tenants });
      }

      const controlPlaneRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneRootMatch){
        const tenantId=decodeURIComponent(controlPlaneRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,controlPlane:container.tenantControlPlaneService.overview(tenantId,actor)});
      }

      const controlPlaneResourceMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneResourceMatch){
        const tenantId=decodeURIComponent(controlPlaneResourceMatch[1]),resourceType=decodeURIComponent(controlPlaneResourceMatch[2]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,resource:container.tenantControlPlaneService.getResource(tenantId,resourceType,actor)});
      }

      const controlPlaneDraftsMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts$/);
      if(req.method==="GET"&&controlPlaneDraftsMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftsMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,drafts:container.tenantControlPlaneService.listDrafts(tenantId,actor,{status:url.searchParams.get('status')||null})});
      }
      if(req.method==="POST"&&controlPlaneDraftsMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftsMatch[1]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const draft=container.tenantControlPlaneService.createDraft({tenantId,resourceType:String(body.resourceType||''),document:body.document,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,201,{ok:true,draft});
      }

      const controlPlaneDraftActionMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts\/([^/]+)\/(validate|preview|publish)$/);
      if(req.method==="POST"&&controlPlaneDraftActionMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftActionMatch[1]),draftId=decodeURIComponent(controlPlaneDraftActionMatch[2]),action=controlPlaneDraftActionMatch[3],actor=controlPlaneActor(req,tenantId);
        const input={tenantId,draftId,actor,requestId:requestCorrelationId(req)};
        const result=action==='validate'?container.tenantControlPlaneService.validateDraft(input):action==='preview'?container.tenantControlPlaneService.previewDraft(input):container.tenantControlPlaneService.publishDraft(input);
        return sendJson(res,200,{ok:true,[action==='publish'?'revision':action]:result});
      }

      const controlPlaneDraftMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/drafts\/([^/]+)$/);
      if(req.method==="GET"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,draft:container.tenantControlPlaneService.getDraft(tenantId,draftId,actor)});
      }
      if(req.method==="PATCH"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const draft=container.tenantControlPlaneService.updateDraft({tenantId,draftId,document:body.document,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,draft});
      }
      if(req.method==="DELETE"&&controlPlaneDraftMatch){
        const tenantId=decodeURIComponent(controlPlaneDraftMatch[1]),draftId=decodeURIComponent(controlPlaneDraftMatch[2]),actor=controlPlaneActor(req,tenantId);
        const draft=container.tenantControlPlaneService.discardDraft({tenantId,draftId,actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,draft});
      }

      const controlPlaneRevisionsMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)\/revisions$/);
      if(req.method==="GET"&&controlPlaneRevisionsMatch){
        const tenantId=decodeURIComponent(controlPlaneRevisionsMatch[1]),resourceType=decodeURIComponent(controlPlaneRevisionsMatch[2]),actor=controlPlaneActor(req,tenantId);
        const revisions=container.tenantControlPlaneService.listRevisions(tenantId,resourceType,actor,{includeDocument:url.searchParams.get('includeDocument')==='true'});
        return sendJson(res,200,{ok:true,revisions});
      }

      const controlPlaneRollbackMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/resources\/([^/]+)\/rollback$/);
      if(req.method==="POST"&&controlPlaneRollbackMatch){
        const tenantId=decodeURIComponent(controlPlaneRollbackMatch[1]),resourceType=decodeURIComponent(controlPlaneRollbackMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        const revision=container.tenantControlPlaneService.rollback({tenantId,resourceType,targetRevision:Number(body.revision),actor,requestId:requestCorrelationId(req)});
        return sendJson(res,200,{ok:true,revision});
      }

      const controlPlaneAuditMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/audit$/);
      if(req.method==="GET"&&controlPlaneAuditMatch){
        const tenantId=decodeURIComponent(controlPlaneAuditMatch[1]),actor=controlPlaneActor(req,tenantId);
        return sendJson(res,200,{ok:true,audit:container.tenantControlPlaneService.listAudit(tenantId,actor,{limit:Number(url.searchParams.get('limit')||100)})});
      }

      const inventoryRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/inventory$/);
      if(req.method==="GET"&&inventoryRootMatch){
        const tenantId=decodeURIComponent(inventoryRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"products"});
        await container.inventoryService.syncCatalog({tenantId,products:await container.catalogService.listProducts(tenantId),actorId:actor.id});
        return sendJson(res,200,{ok:true,inventory:await container.inventoryService.overview(tenantId)});
      }
      const inventorySkuMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/inventory\/([^/]+)$/);
      if(req.method==="PATCH"&&inventorySkuMatch){
        const tenantId=decodeURIComponent(inventorySkuMatch[1]),sku=decodeURIComponent(inventorySkuMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"products"});
        const products=await container.catalogService.listProducts(tenantId);
        const match=products.flatMap(product=>product.variants?.length?product.variants.map(variant=>({product,variant,sku:variant.sku,inventory:variant.inventory})):[]).find(row=>String(row.sku).toLowerCase()===String(sku).toLowerCase());
        if(!match||match.inventory==null)throw new ValidationError(`SKU '${sku}' is not an inventory-tracked SKU in this tenant catalog.`);
        const stock=await container.inventoryService.setOnHand({tenantId,sku:match.sku,productId:match.product.id,variantId:match.variant?.id||null,quantity:Number(body.onHand),actorId:actor.id,reason:String(body.reason||"control_plane_adjustment")});
        return sendJson(res,200,{ok:true,stock});
      }

      const calendarRootMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar$/);
      if(req.method==="GET"&&calendarRootMatch){
        const tenantId=decodeURIComponent(calendarRootMatch[1]),actor=controlPlaneActor(req,tenantId);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"read",resourceType:"calendar"});
        return sendJson(res,200,{ok:true,calendar:{config:container.calendarService.getConfig(tenantId),events:await container.calendarService.listEvents({tenantId,includeCancelled:true}),holds:container.calendarService.listHolds({tenantId,activeOnly:false})}});
      }
      const calendarBlocksMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar\/blocks$/);
      if(req.method==="POST"&&calendarBlocksMatch){
        const tenantId=decodeURIComponent(calendarBlocksMatch[1]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
        const result=await container.calendarService.createBlock({tenantId,date:String(body.date||""),time:String(body.time||""),durationMinutes:Number(body.durationMinutes||60),capacityRequired:Number(body.capacityRequired||1),poolId:body.poolId?String(body.poolId):null,subject:String(body.subject||"Blocked time"),actorId:actor.id});
        return sendJson(res,result.status==='confirmed'?201:409,{ok:result.status==='confirmed',result,...(result.status==='confirmed'?{}:{error:result.message||"Calendar block could not be created."})});
      }
      const calendarCancelMatch=url.pathname.match(/^\/api\/dev\/control-plane\/([^/]+)\/calendar\/events\/([^/]+)\/cancel$/);
      if(req.method==="POST"&&calendarCancelMatch){
        const tenantId=decodeURIComponent(calendarCancelMatch[1]),eventId=decodeURIComponent(calendarCancelMatch[2]),actor=controlPlaneActor(req,tenantId),body=await readJson(req);
        container.controlPlaneAccessPolicy.authorize({actor,tenantId,action:"publish",resourceType:"calendar"});
        const event=(await container.calendarService.listEvents({tenantId,includeCancelled:true})).find((entry)=>entry.id===eventId);
        if(!event)throw new ValidationError(`Calendar event '${eventId}' was not found in this tenant.`);
        if(event.type!=="block")throw new ValidationError("Customer booking events must be cancelled through their booking/service-request workflow so transaction and calendar records stay consistent.");
        const result=await container.calendarService.cancel({tenantId,eventId,reason:String(body.reason||`control_plane:${actor.id}`)});
        return sendJson(res,200,{ok:true,result});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/import-business-file") {
        const body=await readJson(req);
        const imported=importBusinessFile({name:String(body.name||""),text:String(body.text||"")});
        return sendJson(res,200,{ok:true,format:imported.format,spec:normalizeOnboardingSpec(imported.spec),summary:{offerings:imported.spec.offerings?.length||0,faqs:imported.spec.faqs?.length||0}});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/tenant") {
        const body = await readJson(req);
        const spec = normalizeOnboardingSpec(body);
        const result = container.tenantOnboardingService.create(spec);
        container.tenantKnowledgeManager.ensureRegistry(result.id);
        for (const document of Array.isArray(body.knowledgeDocuments) ? body.knowledgeDocuments : []) {
          if (!String(document?.text || "").trim()) continue;
          container.tenantKnowledgeManager.addDocument(result.id,{
            title:String(document.name || "Business notes"),text:String(document.text),format:"txt",priority:60
          });
        }
        container.knowledgeRepository.clearCache(result.id);
        container.tenantRepository.clearCache(result.id);
        return sendJson(res, 201, { ok:true, tenant:{ id:result.id, name:result.profile.name, domain:result.profile.domain, capabilities:result.profile.capabilities }, summary:result.summary });
      }

      if (req.method === "POST" && url.pathname === "/api/dev/onboarding/knowledge") {
        const body = await readJson(req);
        const tenantId=String(body.tenantId || "").trim();
        const text=String(body.text || "").trim();
        if(!tenantId || !text) return sendJson(res,400,{ok:false,error:"tenantId and text are required"});
        container.tenantRepository.getById(tenantId);
        const result=container.tenantKnowledgeManager.addDocument(tenantId,{title:String(body.name||"Business notes"),text,format:String(body.format||"txt"),priority:Number(body.priority||50)});
        return sendJson(res,201,{ok:true,document:{tenantId,name:path.basename(result.path),format:result.format,sourceId:result.source.id}});
      }


      const knowledgeOverviewMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)$/);
      if(req.method==="GET" && knowledgeOverviewMatch){
        const tenantId=decodeURIComponent(knowledgeOverviewMatch[1]);
        container.tenantRepository.getById(tenantId);
        return sendJson(res,200,{ok:true,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const operationalPricingMatch=url.pathname.match(/^\/api\/dev\/operations\/([^/]+)\/pricing$/);
      if(["GET","PUT"].includes(req.method)&&operationalPricingMatch){
        const tenantId=decodeURIComponent(operationalPricingMatch[1]);container.tenantRepository.getById(tenantId);
        return sendJson(res,410,{ok:false,error:"Operational pricing has moved to Control Plane → Services & Pricing. Products and variant prices belong in Products & Prices. Knowledge Manager cannot publish commercial values."});
      }

      const knowledgeFileMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/files$/);
      if(req.method==="POST" && knowledgeFileMatch){
        const tenantId=decodeURIComponent(knowledgeFileMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const filename=String(body.filename||"").trim(),contentBase64=String(body.contentBase64||"").trim();
        if(!filename||!contentBase64)return sendJson(res,400,{ok:false,error:"filename and contentBase64 are required"});
        const ext=path.extname(filename).toLowerCase();
        if(!['.txt','.md','.pdf','.csv','.json'].includes(ext))return sendJson(res,400,{ok:false,error:"Supported knowledge files: TXT, MD, PDF, CSV, JSON"});
        const tempDir=path.join(require('os').tmpdir(),'nova-knowledge-upload');fs.mkdirSync(tempDir,{recursive:true});
        const tempFile=path.join(tempDir,`${Date.now()}-${path.basename(filename)}`);
        try{
          fs.writeFileSync(tempFile,Buffer.from(contentBase64,'base64'));
          const result=await container.tenantKnowledgeManager.addFile(tenantId,{filePath:tempFile,title:String(body.title||path.basename(filename,ext)),tags:Array.isArray(body.tags)?body.tags:[],priority:Number(body.priority||50),evidenceType:String(body.evidenceType||'customer_fact')});
          return sendJson(res,201,{ok:true,document:result,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
        } finally { try{fs.rmSync(tempFile,{force:true})}catch{} }
      }

      const knowledgeDocumentMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/documents$/);
      if(req.method==="POST" && knowledgeDocumentMatch){
        const tenantId=decodeURIComponent(knowledgeDocumentMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const result=container.tenantKnowledgeManager.addDocument(tenantId,{
          title:String(body.title||"Knowledge note"),text:String(body.text||""),format:String(body.format||"txt"),
          tags:Array.isArray(body.tags)?body.tags:[],priority:Number(body.priority||50)
        });
        return sendJson(res,201,{ok:true,document:result,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const knowledgeFaqMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/faqs$/);
      if(req.method==="POST" && knowledgeFaqMatch){
        const tenantId=decodeURIComponent(knowledgeFaqMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const faq=container.tenantKnowledgeManager.addFaq(tenantId,{question:String(body.question||""),answer:String(body.answer||""),tags:Array.isArray(body.tags)?body.tags:[]});
        return sendJson(res,201,{ok:true,faq,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      const knowledgeFactMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/facts$/);
      if(req.method==="POST" && knowledgeFactMatch){
        const tenantId=decodeURIComponent(knowledgeFactMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const fact=container.tenantKnowledgeManager.setFact(tenantId,{key:String(body.key||""),value:body.value});
        return sendJson(res,200,{ok:true,fact,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }


      const knowledgeSearchMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/search$/);
      if(req.method==="POST" && knowledgeSearchMatch){
        const tenantId=decodeURIComponent(knowledgeSearchMatch[1]),body=await readJson(req);container.tenantRepository.getById(tenantId);
        const query=String(body.query||"").trim();if(!query)return sendJson(res,400,{ok:false,error:"query is required"});
        const matches=container.knowledgeRepository.search(tenantId,query,{limit:Number(body.limit||6),minScore:Number(body.minScore??.10)});
        return sendJson(res,200,{ok:true,query,matches:matches.map(x=>({
          text:x.text,source:x.source,sourceId:x.sourceId,sourceTitle:x.sourceTitle,sourceKind:x.sourceKind,path:x.path,priority:x.priority,
          score:x.score,hybridScore:x.hybridScore,lexicalScore:x.lexicalScore,semanticScore:x.semanticScore,evidenceType:x.evidenceType,customerSafe:x.customerSafe
        }))});
      }

      const knowledgeReindexMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/reindex$/);
      if(req.method==="POST" && knowledgeReindexMatch){
        const tenantId=decodeURIComponent(knowledgeReindexMatch[1]);container.tenantRepository.getById(tenantId);
        return sendJson(res,200,{ok:true,index:container.tenantKnowledgeManager.reindex(tenantId)});
      }

      // ─── v59.0 Phase 6 admin endpoints (spec §13) ───────────────────
      // Chunk Explorer: list chunks for a source.
      const knowledgeChunksMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/sources\/([^/]+)\/chunks$/);
      if(req.method==="GET" && knowledgeChunksMatch){
        const tenantId=decodeURIComponent(knowledgeChunksMatch[1]);
        const sourceId=decodeURIComponent(knowledgeChunksMatch[2]);
        container.tenantRepository.getById(tenantId);
        const index=container.knowledgeRepository.getIndexForTenant(tenantId);
        const docs=index.docs||[];
        const chunks=docs.filter(d=>d.sourceId===sourceId).map(d=>({
          chunkId:d.id, sourceId:d.sourceId, sourceVersion:d.sourceVersion, text:d.text,
          heading:d.path, knowledgeType:d.evidenceType, customerSafe:d.customerSafe,
          sourceTitle:d.sourceTitle, sourceKind:d.sourceKind, sourceLocation:d.sourceLocation||null,
        }));
        return sendJson(res,200,{ok:true,sourceId,chunkCount:chunks.length,chunks});
      }

      // Retrieval Playground: full retrieval trace (intent → rewrite → matches → scores).
      const knowledgePlaygroundMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/playground$/);
      if(req.method==="POST" && knowledgePlaygroundMatch){
        const tenantId=decodeURIComponent(knowledgePlaygroundMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const query=String(body.query||"").trim();
        if(!query) return sendJson(res,400,{ok:false,error:"query is required"});
        // Build the trace through the Phase 3 + 4 pipeline (lazy-loaded so older
        // deployments without the new packages still serve /search above).
        let trace={query};
        try{
          const {IntentRouter}=require("../../../packages/knowledge-retrieval/src/intentRouter");
          const {QueryRewriter}=require("../../../packages/knowledge-retrieval/src/queryRewriter");
          const {EvidenceValidator}=require("../../../packages/knowledge-retrieval/src/evidenceValidator");
          const router=new IntentRouter();
          const rewriter=new QueryRewriter();
          const validator=new EvidenceValidator();
          const classified=router.classify(query);
          const rewritten=rewriter.rewrite(query);
          const matches=container.knowledgeRepository.search(tenantId,rewritten.expanded,{
            limit:Number(body.limit||6), minScore:Number(body.minScore??0.05), minSemantic:Number(body.minSemantic??0.05),
            ...(classified.requiredSources&&classified.requiredSources.length?{kinds:classified.requiredSources}:{}),
          });
          const validation=validator.validate({query:rewritten.normalized,matches,intent:classified.intent});
          trace={
            originalQuery:query,
            intent:classified.intent, entities:classified.entities, missingFields:classified.missingFields,
            confidence:classified.confidence, requiredSources:classified.requiredSources,
            rewritten:{normalized:rewritten.normalized, expanded:rewritten.expanded, variants:rewritten.variants},
            matches:matches.map(x=>({text:x.text,sourceId:x.sourceId,sourceTitle:x.sourceTitle,sourceKind:x.sourceKind,
              score:x.score,hybridScore:x.hybridScore,lexicalScore:x.lexicalScore,semanticScore:x.semanticScore,
              evidenceType:x.evidenceType,customerSafe:x.customerSafe})),
            evidenceValidation:validation,
          };
        }catch(err){
          trace.error="playground pipeline unavailable: "+err.message;
          trace.matches=container.knowledgeRepository.search(tenantId,query,{limit:Number(body.limit||6),minScore:Number(body.minScore??0.05)});
        }
        return sendJson(res,200,{ok:true,...trace});
      }

      // Answer Testing: full pipeline including decision + answer (no side effects).
      const knowledgeTestMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/test$/);
      if(req.method==="POST" && knowledgeTestMatch){
        const tenantId=decodeURIComponent(knowledgeTestMatch[1]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const query=String(body.query||"").trim();
        if(!query) return sendJson(res,400,{ok:false,error:"query is required"});
        let result={query,verdict:"unknown"};
        try{
          const {IntentRouter}=require("../../../packages/knowledge-retrieval/src/intentRouter");
          const {QueryRewriter}=require("../../../packages/knowledge-retrieval/src/queryRewriter");
          const {EvidenceValidator}=require("../../../packages/knowledge-retrieval/src/evidenceValidator");
          const {AnswerComposer}=require("../../../packages/knowledge-answer/src/answerComposer");
          const {DecisionEngine,OUTCOMES}=require("../../../packages/knowledge-answer/src/decisionEngine");
          const {AbstentionHandler}=require("../../../packages/knowledge-answer/src/abstentionHandler");
          const router=new IntentRouter();
          const rewriter=new QueryRewriter();
          const validator=new EvidenceValidator();
          const composer=new AnswerComposer();
          const decision=new DecisionEngine();
          const abstain=new AbstentionHandler();
          const classified=router.classify(query);
          const rewritten=rewriter.rewrite(query);
          const matches=container.knowledgeRepository.search(tenantId,rewritten.expanded,{
            limit:6, minScore:0.05, minSemantic:0.05,
            ...(classified.requiredSources&&classified.requiredSources.length?{kinds:classified.requiredSources}:{}),
          });
          const validation=validator.validate({query:rewritten.normalized,matches,intent:classified.intent});
          const decisionResult=decision.decide({
            question:query, intent:classified.intent,
            missingFields:classified.missingFields, evidenceValidation:validation,
          });
          let answer=null, abstentionReason=null;
          if(decisionResult.outcome===OUTCOMES.ANSWER){
            const composed=await composer.compose({
              question:query, intent:classified.intent,
              evidence:validation.evidence, language:body.language||"en",
            });
            answer=composed.answer;
          }else if(decisionResult.outcome===OUTCOMES.CLARIFY){
            answer=abstain.clarify(decisionResult.clarifyField,{tenant:{domain:container.tenantRepository.getById(tenantId).domain}});
            abstentionReason="clarification_required";
          }else if(decisionResult.outcome===OUTCOMES.ESCALATE){
            answer=abstain.abstain("escalate",body.language||"en");
            abstentionReason=decisionResult.reason;
          }else if(decisionResult.outcome===OUTCOMES.REFUSE){
            answer=abstain.abstain("refuse",body.language||"en");
            abstentionReason=decisionResult.reason;
          }
          result={
            query,
            verdict:decisionResult.outcome,
            intent:classified.intent,
            confidence:null, // illustrative per spec §13.4
            matches:matches.map(x=>({text:x.text,sourceId:x.sourceId,score:x.score,hybridScore:x.hybridScore})),
            conflict:validation.checks.conflict,
            evidenceComplete:validation.checks.complete,
            answer,
            abstentionReason,
          };
        }catch(err){
          result.error="test pipeline unavailable: "+err.message;
        }
        return sendJson(res,200,{ok:true,...result});
      }

      // Knowledge Analytics dashboard (spec §13.5).
      const knowledgeAnalyticsMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/analytics$/);
      if(req.method==="GET" && knowledgeAnalyticsMatch){
        const tenantId=decodeURIComponent(knowledgeAnalyticsMatch[1]);
        container.tenantRepository.getById(tenantId);
        const dashboard=container.analyticsEngine?.getKnowledgeDashboard?.(tenantId)
          || {error:"analytics engine not configured"};
        return sendJson(res,200,{ok:true,analytics:dashboard});
      }

      // Evaluation: run the knowledge evaluation corpus against the current index.
      const knowledgeEvaluateMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/evaluate$/);
      if(req.method==="POST" && knowledgeEvaluateMatch){
        const tenantId=decodeURIComponent(knowledgeEvaluateMatch[1]);
        container.tenantRepository.getById(tenantId);
        const {runEvaluationCorpus}=require("../../../tests/fixtures/knowledge-evaluation-corpus");
        const evaluator=async(tc)=>{
          // Use the /test pipeline logic inline (without HTTP).
          const matches=container.knowledgeRepository.search(tenantId,tc.question,{limit:6,minScore:0.05,minSemantic:0.05});
          let outcome="escalate";
          try{
            const {IntentRouter}=require("../../../packages/knowledge-retrieval/src/intentRouter");
            const {EvidenceValidator}=require("../../../packages/knowledge-retrieval/src/evidenceValidator");
            const {DecisionEngine,OUTCOMES}=require("../../../packages/knowledge-answer/src/decisionEngine");
            const router=new IntentRouter();
            const validator=new EvidenceValidator();
            const decision=new DecisionEngine();
            const classified=router.classify(tc.question);
            const validation=validator.validate({query:tc.question,matches,intent:classified.intent});
            const d=decision.decide({question:tc.question,intent:classified.intent,missingFields:classified.missingFields,evidenceValidation:validation});
            outcome=d.outcome;
          }catch{}
          return {outcome, intent:tc.expectedIntent, matches, tenantIsolationOk:true};
        };
        const report=await runEvaluationCorpus(evaluator,{filterDomain:null});
        return sendJson(res,200,{ok:true,evaluation:report});
      }

      // Publish a draft source (Phase 2 T2.8 publication workflow).
      const knowledgePublishMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/sources\/([^/]+)\/publish$/);
      if(req.method==="POST" && knowledgePublishMatch){
        const tenantId=decodeURIComponent(knowledgePublishMatch[1]);
        const sourceId=decodeURIComponent(knowledgePublishMatch[2]);
        const body=await readJson(req).catch(()=>({}));
        container.tenantRepository.getById(tenantId);
        const result=container.knowledgeSourceRepository.publish(tenantId,sourceId,{approvedBy:body.approvedBy||"admin"});
        container.knowledgeRepository.clearCache(tenantId);
        return sendJson(res,200,{ok:true,published:result});
      }

      const knowledgeSourceMatch=url.pathname.match(/^\/api\/dev\/knowledge\/([^/]+)\/sources\/([^/]+)$/);
      if(req.method==="PATCH" && knowledgeSourceMatch){
        const tenantId=decodeURIComponent(knowledgeSourceMatch[1]),sourceId=decodeURIComponent(knowledgeSourceMatch[2]),body=await readJson(req);
        container.tenantRepository.getById(tenantId);
        const updated=container.tenantKnowledgeManager.updateDocument(tenantId,sourceId,{
          title:body.title??null,text:body.text??null,format:String(body.format||'txt'),tags:Array.isArray(body.tags)?body.tags:null,
          priority:body.priority==null?null:Number(body.priority),evidenceType:body.evidenceType??null,status:body.status??null
        });
        return sendJson(res,200,{ok:true,source:updated,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }
      if(req.method==="DELETE" && knowledgeSourceMatch){
        const tenantId=decodeURIComponent(knowledgeSourceMatch[1]),sourceId=decodeURIComponent(knowledgeSourceMatch[2]);container.tenantRepository.getById(tenantId);
        const removed=container.tenantKnowledgeManager.removeSource(tenantId,sourceId);
        return sendJson(res,removed?200:404,{ok:removed,knowledge:container.tenantKnowledgeManager.overview(tenantId)});
      }

      if (req.method === "POST" && url.pathname === "/api/dev/datasets/run") {
        const body = await readJson(req);
        const report = await runDataset(container, String(body.dataset || ""));
        return sendJson(res, 200, report);
      }

      // ─── v27.0 Admin Dashboard endpoints ────────────────────────────────────
      // All admin endpoints reuse the same NOVA_DEV_TOKEN gate as /api/dev/*.
      // They are intentionally consolidated for the operator dashboard so the
      // UI doesn't have to fan out to dozens of dev endpoints per page load.
      if (url.pathname.startsWith("/api/admin/") && !authorizeDeveloperRequest(req)) {
        return sendJson(res, 401, { ok:false, error:"Admin token is required" });
      }

      // ─── Roadmap #9: Operational metrics (authed; dev-token gate) ─────────
      // Wraps the MetricsAggregator snapshot + the health readiness check so an
      // operator can see turn rates, fallback rates, latency, and subsystem
      // status in one call. Used by the admin dashboard's ops panel.
      if (req.method === "GET" && url.pathname === "/api/admin/metrics") {
        const metrics = container.metricsAggregator?.snapshot?.() || { tenants: {} };
        const health = container.healthService?.readiness?.() || { status: "unknown" };
        return sendJson(res, 200, { ok: true, metrics, health });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/overview") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        const [replays, capabilities, health] = await Promise.all([
          container.replayService.list({ limit: 1 }),
          Promise.resolve(container.registry.list().map((c)=>({ id:c.id, manifest:c.manifest }))),
          Promise.all(container.registry.list().map((item)=>item.health()))
        ]);
        const overview = {
          version: packageJson.version,
          uptimeSeconds: Math.round(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          storageMode: container.config.storageMode,
          postgres: !!container.storage?.db,
          redis: !!container.storage?.redis,
          mlTrained: container.mlIntentClassifier?.trained || false,
          mlVersion: container.mlIntentClassifier?.model?.version || 'unknown',
          transformerEnabled: !!container.transformerEmbeddingService?.enableMultilingual,
          feedbackDir: container.feedbackCollector?.storageDir || null,
          onlineLearnerLastRun: container.onlineLearner?.getLastRetrainSummary?.() || null,
          tenantCount: tenants.length,
          tenantIds: tenants.map(t=>t.id),
          capabilityCount: capabilities.length,
          capabilityIds: capabilities.map(c=>c.id),
          recentReplayCount: replays.length,
          capabilityHealth: health
        };
        return sendJson(res, 200, { ok:true, overview });
      }

      const adminFeedbackMatch = url.pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/);
      if (req.method === "GET" && adminFeedbackMatch) {
        const tenantId = decodeURIComponent(adminFeedbackMatch[1]);
        container.tenantRepository.getById(tenantId);
        const counts = container.feedbackCollector?.getExampleCount?.(tenantId) || { total:0, positive:0, negative:0 };
        const examples = container.feedbackCollector?.getExamples?.(tenantId) || [];
        return sendJson(res, 200, { ok:true, tenantId, counts, examples: examples.slice(-200).reverse() });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ml/status") {
        const tenantsWithFeedback = container.feedbackCollector?.getTenantsWithExamples?.() || [];
        const perTenant = tenantsWithFeedback.map((tenantId)=>({
          tenantId,
          counts: container.feedbackCollector.getExampleCount(tenantId)
        }));
        const status = {
          mlClassifier: {
            trained: container.mlIntentClassifier?.trained || false,
            version: container.mlIntentClassifier?.model?.version || 'unknown',
            classCount: container.mlIntentClassifier?.model?.classes?.length || 0,
            modelSize: container.mlIntentClassifier?.model ? Object.keys(container.mlIntentClassifier.model.classes || {}).length : 0
          },
          hybridRouter: { enabled: !!container.hybridRouter },
          transformer: {
            enabled: !!container.transformerEmbeddingService?.enableMultilingual,
            initialized: !!(container.transformerEmbeddingService?.englishExtractor),
            multilingualLoaded: !!(container.transformerEmbeddingService?.multilingualExtractor)
          },
          productEmbeddingMatcher: { enabled: !!container.productEmbeddingMatcher },
          feedbackCollector: {
            storageDir: container.feedbackCollector?.storageDir || null,
            tenantsWithExamples: tenantsWithFeedback,
            perTenant,
            totalExamples: perTenant.reduce((sum,t)=>sum+t.counts.total, 0),
            totalPositive: perTenant.reduce((sum,t)=>sum+t.counts.positive, 0),
            totalNegative: perTenant.reduce((sum,t)=>sum+t.counts.negative, 0)
          },
          onlineLearner: {
            enabled: !!container.onlineLearner,
            lastRetrain: container.onlineLearner?.getLastRetrainSummary?.() || null,
            status: container.onlineLearner?.getStatus?.() || 'Not initialized'
          }
        };
        return sendJson(res, 200, { ok:true, status });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/online-learner/run") {
        if (!container.onlineLearner) return sendJson(res, 503, { ok:false, error:"Online learner is not initialized" });
        const body = await readJson(req).catch(()=>({}));
        const result = await container.onlineLearner.learn({
          minExamples: Number(body.minExamples || 5),
          minPositiveRatio: Number(body.minPositiveRatio || 0.0)
        });
        return sendJson(res, 200, { ok: result.learned === true, result });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/replays") {
        const limit = Number(url.searchParams.get("limit") || 100);
        const replays = await container.replayService.list({ limit });
        return sendJson(res, 200, { ok:true, replays });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/tenants") {
        const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
        const enriched = tenants.map((t)=>{
          const profile = container.tenantRepository.getById(t.id);
          const branding = profile?.branding || {};
          const business = profile?.business || {};
          const notifications = profile?.notifications || {};
          // Try to get activity counts (best-effort, doesn't fail if no data)
          let leadCount = 0, bookingCount = 0, notificationCount = 0, lastActivity = null;
          try {
            const leadSummary = container.leadService?.summary?.(t.id);
            if (leadSummary) leadCount = leadSummary.total || 0;
          } catch {}
          try {
            notificationCount = container.notificationService ? container.notificationService.notificationLog.totalCount(t.id) : 0;
          } catch {}
          return {
            id: t.id,
            name: t.name,
            domain: t.domain || profile?.domain || 'generic',
            capabilities: t.capabilities || profile?.capabilities || [],
            assistantName: branding.assistantName || 'Nova',
            description: business.description || '',
            hours: business.hours || profile?.hours || '',
            contact: business.contact || '',
            location: business.location || profile?.location || '',
            currency: business.currency || profile?.currency || 'PKR',
            status: profile?.status || 'active',
            defaultLanguage: profile?.defaultLanguage || 'english',
            templateId: profile?._template?.templateId || null,
            sourceTenant: profile?._template?.sourceTenant || null,
            isCustom: !profile?._template?.templateId,
            createdAt: profile?._template?.createdAt || null,
            widgetEnabled: profile?.widget?.enabled !== false,
            notificationsEnabled: notifications.enabled !== false,
            notificationRecipients: (notifications.recipientEmails || []).length,
            stats: { leads: leadCount, notifications: notificationCount }
          };
        });
        return sendJson(res, 200, { ok:true, tenants: enriched });
      }

      // ─── v30.1 Template & Tenant Creation endpoints ────────────────────────
      if (req.method === "GET" && url.pathname === "/api/admin/templates") {
        const templatesDir = path.resolve(container.config.tenantsDir, "_templates");
        const templates = [];
        if (fs.existsSync(templatesDir)) {
          for (const dir of fs.readdirSync(templatesDir).sort()) {
            const templateJsonPath = path.join(templatesDir, dir, "template.json");
            if (!fs.existsSync(templateJsonPath)) continue;
            try {
              const tpl = JSON.parse(fs.readFileSync(templateJsonPath, 'utf8'));
              templates.push(tpl);
            } catch {}
          }
        }
        return sendJson(res, 200, { ok:true, templates });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/templates/create") {
        const body = await readJson(req);
        // v35.3: input sanitization — prevent path traversal + injection
        const { sanitizeTemplateId, sanitizeName, sanitizeText } = require('../../../packages/validation/src/sanitize');
        let templateId, label, description, domain;
        try {
          templateId = sanitizeTemplateId(body.id);
          label = sanitizeName(body.label, 100);
          description = sanitizeText(body.description, 500, false);
          domain = sanitizeName(String(body.domain || 'generic'), 50);
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
        if (!templateId || !label) return sendJson(res, 400, { ok:false, error:'id and label are required' });

        const templatesDir = path.resolve(container.config.tenantsDir, "_templates");
        const newTemplateDir = path.join(templatesDir, templateId);
        if (fs.existsSync(newTemplateDir)) return sendJson(res, 409, { ok:false, error:'Template already exists' });

        // For custom templates, we build a minimal but functional tenant from scratch
        const capabilities = Array.isArray(body.capabilities) && body.capabilities.length
          ? body.capabilities.filter(c => /^[a-z_]+$/i.test(String(c))).slice(0, 20) : ['assistant', 'crm'];
        const services = Array.isArray(body.services) ? body.services.slice(0, 50) : [];
        const faqs = Array.isArray(body.faqs) ? body.faqs.slice(0, 50) : [];
        const businessFacts = body.businessFacts && typeof body.businessFacts === 'object' ? body.businessFacts : {};

        fs.mkdirSync(path.join(newTemplateDir, 'knowledge'), { recursive: true });
        fs.mkdirSync(path.join(newTemplateDir, 'templates'), { recursive: true });

        // template.json
        fs.writeFileSync(path.join(newTemplateDir, 'template.json'), JSON.stringify({
          id: templateId, label, description, icon: body.icon || '🏢',
          domain, capabilities, defaultServices: services, sourceTenant: null,
          isCustom: true, createdAt: new Date().toISOString()
        }, null, 2) + '\n', 'utf8');

        // profile.json with placeholders
        const profile = {
          id: '{{tenant_id}}', name: '{{business_name}}', status: 'active', defaultLanguage: 'english',
          capabilities, domain,
          branding: {
            assistantName: '{{business_name}} Assistant',
            welcomeMessage: body.welcomeMessage || 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?'
          },
          business: {
            description: '{{business_description}}', contact: '{{owner_phone}}', email: '{{owner_email}}',
            hours: '{{business_hours}}', location: '{{business_location}}'
          },
          features: { llmFallback: true },
          permissions: ['knowledge.read', 'memory.read:assistant', 'memory.write:assistant', 'crm.customer.read:assistant', 'crm.customer.write:assistant', 'crm.activity.write:assistant'],
          widget: {
            enabled: true, position: 'bottom-right', themeColor: '{{theme_color}}', language: 'auto',
            welcomeMessage: body.welcomeMessage || 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?',
            agentAvatar: body.agentAvatar || 'nova', agentName: '{{agent_name}}', agentTitle: 'Assistant',
            suggestions: body.suggestions || ['What services do you offer?', 'Book now', 'What are your hours?'],
            preChatForm: { enabled: true, fields: [
              { id: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'John Doe' },
              { id: 'phone', label: 'Phone (optional)', type: 'tel', required: false, placeholder: '+971 50 123 4567' }
            ]},
            proactiveGreeting: { enabled: true, delaySeconds: 5, message: "Hi! 👋 I'm {{agent_name}}. How can I help you today?", pageRules: [] }
          },
          notifications: {
            enabled: true, recipientEmails: ['{{owner_email}}'],
            events: { booking_confirmed: true, order_placed: true, lead_captured: true, handoff_requested: true, nova_failed: true },
            quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
            dailyDigest: { enabled: false, sendAt: '09:00' }
          },
          _template: { isTemplate: true, templateId, sourceTenant: null, createdAt: new Date().toISOString() }
        };
        fs.writeFileSync(path.join(newTemplateDir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');

        // knowledge/business.json
        fs.writeFileSync(path.join(newTemplateDir, 'knowledge/business.json'), JSON.stringify({
          name: '{{business_name}}', description: '{{business_description}}',
          contact: '{{owner_phone}}', email: '{{owner_email}}', hours: '{{business_hours}}', location: '{{business_location}}',
          ...businessFacts
        }, null, 2) + '\n', 'utf8');

        // knowledge/faqs.json
        fs.writeFileSync(path.join(newTemplateDir, 'knowledge/faqs.json'), JSON.stringify(faqs, null, 2) + '\n', 'utf8');

        // personality.json
        fs.writeFileSync(path.join(newTemplateDir, 'personality.json'), JSON.stringify({
          tone: 'friendly, professional, helpful',
          style: 'concise but warm, uses emojis sparingly',
          language: 'auto'
        }, null, 2) + '\n', 'utf8');

        // policies.json
        fs.writeFileSync(path.join(newTemplateDir, 'policies.json'), JSON.stringify({
          cancellation: 'Please contact us at least 24 hours in advance for cancellations.',
          refunds: 'Refund policy varies by service. Please ask for details.',
          rescheduling: 'Rescheduling is free up to 12 hours before the appointment.'
        }, null, 2) + '\n', 'utf8');

        // If cleaning capability, create cleaning/services.json with the template services
        if (capabilities.includes('cleaning') && services.length) {
          fs.mkdirSync(path.join(newTemplateDir, 'cleaning'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'cleaning/services.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
          fs.mkdirSync(path.join(newTemplateDir, 'pricing'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'pricing/services.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
        }

        // If catalog capability, create catalog files
        if (capabilities.includes('catalog')) {
          fs.mkdirSync(path.join(newTemplateDir, 'catalog'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/products.json'), JSON.stringify([], null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/categories.json'), JSON.stringify([], null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'catalog/synonyms.json'), JSON.stringify({}, null, 2) + '\n', 'utf8');
        }

        // If offering capability, create offerings files
        if (capabilities.includes('offering')) {
          fs.mkdirSync(path.join(newTemplateDir, 'offerings'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'offerings/items.json'), JSON.stringify(services, null, 2) + '\n', 'utf8');
          fs.writeFileSync(path.join(newTemplateDir, 'offerings/config.json'), JSON.stringify({ bookingMode: 'appointment' }, null, 2) + '\n', 'utf8');
        }

        // If booking capability, create booking config
        if (capabilities.includes('booking')) {
          fs.mkdirSync(path.join(newTemplateDir, 'booking'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'booking/config.json'), JSON.stringify({
            enabled: true, mode: 'appointment', slotDurationMinutes: 60, leadTimeHours: 2
          }, null, 2) + '\n', 'utf8');
          fs.mkdirSync(path.join(newTemplateDir, 'calendar'), { recursive: true });
          fs.writeFileSync(path.join(newTemplateDir, 'calendar/config.json'), JSON.stringify({
            enabled: true, provider: 'local', timezone: 'Asia/Karachi'
          }, null, 2) + '\n', 'utf8');
        }

        // WhatsApp channel (disabled by default)
        fs.mkdirSync(path.join(newTemplateDir, 'channels'), { recursive: true });
        fs.writeFileSync(path.join(newTemplateDir, 'channels/whatsapp.json'), JSON.stringify({
          enabled: false, graphVersion: 'v23.0'
        }, null, 2) + '\n', 'utf8');

        // Templates (response templates)
        fs.writeFileSync(path.join(newTemplateDir, 'templates/assistant.json'), JSON.stringify({
          greeting: '{{welcome_message}}',
          fallback: "I'm not sure about that. Let me connect you with our team.",
          closing: 'Is there anything else I can help you with?'
        }, null, 2) + '\n', 'utf8');
        fs.writeFileSync(path.join(newTemplateDir, 'templates/crm.json'), JSON.stringify({
          customerCreated: 'Welcome {{customer_name}}! Your details have been saved.',
          customerUpdated: 'Your details have been updated.'
        }, null, 2) + '\n', 'utf8');

        return sendJson(res, 201, { ok:true, templateId, message: `Custom template '${label}' created. Use it to onboard new tenants.` });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/tenants/create") {
        const body = await readJson(req);
        // v35.3: input sanitization — prevent path traversal in templateId + injection in businessName
        const { sanitizeTemplateId, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText } = require('../../../packages/validation/src/sanitize');
        let templateId, businessName, ownerEmail, ownerPhone, businessDescription;
        try {
          templateId = sanitizeTemplateId(body.templateId);
          businessName = sanitizeName(body.businessName, 200);
          ownerEmail = body.ownerEmail ? sanitizeEmail(body.ownerEmail) : '';
          ownerPhone = body.ownerPhone ? sanitizePhone(body.ownerPhone) : '';
          businessDescription = body.businessDescription ? sanitizeText(body.businessDescription, 1000, false) : '';
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
        if (!templateId || !businessName) return sendJson(res, 400, { ok:false, error:'templateId and businessName are required' });

        // v30.1.5: Find the SOURCE TENANT to clone from.
        // Instead of cloning from the template (which has {{placeholders}}),
        // we clone directly from the source demo tenant (e.g., cleaning-demo).
        // This guarantees the new tenant is an EXACT REPLICA of the demo
        // tenant — same routing, same conversation quality, same capabilities.
        // The only differences are the business name, owner email, and
        // widget branding. This fixes the "new business can't answer basic
        // queries" bug.
        const templateJsonPath = path.resolve(container.config.tenantsDir, "_templates", templateId, "template.json");
        let sourceTenantId = null;
        if (fs.existsSync(templateJsonPath)) {
          try {
            const tpl = JSON.parse(fs.readFileSync(templateJsonPath, 'utf8'));
            sourceTenantId = tpl.sourceTenant;
          } catch {}
        }
        if (!sourceTenantId) return sendJson(res, 404, { ok:false, error:'Template not found or has no source tenant' });

        const sourceTenantDir = path.join(container.config.tenantsDir, sourceTenantId);
        if (!fs.existsSync(sourceTenantDir)) return sendJson(res, 404, { ok:false, error:`Source tenant '${sourceTenantId}' not found` });

        // Generate tenant ID from business name
        let tenantId = String(body.tenantId || '').trim();
        if (!tenantId) {
          tenantId = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          let suffix = 1;
          while (fs.existsSync(path.join(container.config.tenantsDir, tenantId))) {
            tenantId = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${suffix}`;
            suffix += 1;
          }
        }
        if (!/^[a-z0-9-]+$/.test(tenantId)) return sendJson(res, 400, { ok:false, error:'tenantId must be lowercase letters, numbers, hyphens only' });

        const newTenantDir = path.join(container.config.tenantsDir, tenantId);
        if (fs.existsSync(newTenantDir)) return sendJson(res, 409, { ok:false, error:'Tenant already exists' });

        // v30.1.5: DIRECT COPY from source tenant — no placeholder replacement.
        // This is the key fix: the new tenant is an EXACT byte-for-byte clone
        // of the source demo tenant. Only profile.json is modified to set the
        // new business name, owner email, and widget branding.
        const copyDir = (src, dst) => {
          fs.mkdirSync(dst, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const dstPath = path.join(dst, entry.name);
            if (entry.isDirectory()) copyDir(srcPath, dstPath);
            else fs.copyFileSync(srcPath, dstPath);
          }
        };
        copyDir(sourceTenantDir, newTenantDir);

        // Now modify ONLY profile.json with the new business details
        const profilePath = path.join(newTenantDir, 'profile.json');
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

        // Update business identity
        profile.id = tenantId;
        profile.name = businessName;
        if (body.description) profile.business = profile.business || {}, profile.business.description = body.description;
        if (body.ownerEmail) {
          profile.business = profile.business || {};
          profile.business.email = body.ownerEmail;
          profile.business.contact = body.ownerPhone || profile.business.contact || '';
          // Also set notification recipient
          profile.notifications = profile.notifications || {};
          profile.notifications.recipientEmails = [body.ownerEmail];
        }
        if (body.ownerPhone) profile.business = profile.business || {}, profile.business.contact = body.ownerPhone;
        if (body.hours) profile.business = profile.business || {}, profile.business.hours = body.hours;
        if (body.location) profile.business = profile.business || {}, profile.business.location = body.location;

        // Update widget branding
        profile.widget = profile.widget || {};
        if (body.themeColor) profile.widget.themeColor = body.themeColor;
        if (body.agentName) { profile.widget.agentName = body.agentName; profile.branding = profile.branding || {}; profile.branding.assistantName = `${body.agentName}`; }
        if (body.agentAvatar) profile.widget.agentAvatar = body.agentAvatar;
        if (body.agentTitle) profile.widget.agentTitle = body.agentTitle;
        if (body.welcomeMessage) {
          profile.widget.welcomeMessage = body.welcomeMessage;
          profile.branding = profile.branding || {};
          profile.branding.welcomeMessage = body.welcomeMessage;
        }
        if (body.suggestions && Array.isArray(body.suggestions)) profile.widget.suggestions = body.suggestions;

        // Update personality.json with new business name
        const personalityPath = path.join(newTenantDir, 'personality.json');
        if (fs.existsSync(personalityPath)) {
          try {
            const personality = JSON.parse(fs.readFileSync(personalityPath, 'utf8'));
            if (personality.name) personality.name = `${businessName} Assistant`;
            fs.writeFileSync(personalityPath, JSON.stringify(personality, null, 2) + '\n', 'utf8');
          } catch {}
        }

        // Update templates/assistant.json with new business name (greetings)
        const assistantTemplatePath = path.join(newTenantDir, 'templates', 'assistant.json');
        if (fs.existsSync(assistantTemplatePath)) {
          try {
            let content = fs.readFileSync(assistantTemplatePath, 'utf8');
            // v30.1.6: Replace both full name and short name
            const sourceProfile = JSON.parse(fs.readFileSync(path.join(sourceTenantDir, 'profile.json'), 'utf8'));
            const sourceName = sourceProfile.name || sourceTenantId;
            const sourceShortName = sourceName.split(' ')[0];
            content = content.split(sourceName).join(businessName).split(sourceShortName).join(businessName);
            fs.writeFileSync(assistantTemplatePath, content, 'utf8');
          } catch {}
        }

        // Update knowledge/business.json with new business name
        const businessJsonPath = path.join(newTenantDir, 'knowledge', 'business.json');
        if (fs.existsSync(businessJsonPath)) {
          try {
            const businessJson = JSON.parse(fs.readFileSync(businessJsonPath, 'utf8'));
            const sourceProfile = JSON.parse(fs.readFileSync(path.join(sourceTenantDir, 'profile.json'), 'utf8'));
            const sourceName = sourceProfile.name || sourceTenantId;
            const sourceShortName = sourceName.split(' ')[0];
            // v30.1.6: Deep recursive replacement — replaces the source name
            // everywhere in the JSON tree, including nested objects like
            // pricingBenchmark.affiliation, policies.*, location.serviceArea, etc.
            // Also replaces the short name (first word) so "SparkleCare" alone
            // is replaced even when "SparkleCare Cleaning" doesn't appear.
            const deepReplace = (obj) => {
              for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'string') {
                  obj[key] = obj[key].split(sourceName).join(businessName).split(sourceShortName).join(businessName);
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                  deepReplace(obj[key]);
                }
              }
            };
            deepReplace(businessJson);
            businessJson.name = businessName;
            if (body.hours) businessJson.hours = body.hours;
            if (body.location && businessJson.location) businessJson.location.city = body.location;
            if (body.ownerPhone && businessJson.contact) businessJson.contact.phone = body.ownerPhone;
            if (body.ownerEmail && businessJson.contact) businessJson.contact.email = body.ownerEmail;
            fs.writeFileSync(businessJsonPath, JSON.stringify(businessJson, null, 2) + '\n', 'utf8');
          } catch {}
        }

        // Also deep-replace in knowledge/faqs.json
        const faqsJsonPath = path.join(newTenantDir, 'knowledge', 'faqs.json');
        if (fs.existsSync(faqsJsonPath)) {
          try {
            const faqs = JSON.parse(fs.readFileSync(faqsJsonPath, 'utf8'));
            const sourceProfile = JSON.parse(fs.readFileSync(path.join(sourceTenantDir, 'profile.json'), 'utf8'));
            const sourceName = sourceProfile.name || sourceTenantId;
            const sourceShortName = sourceName.split(' ')[0];
            const deepReplace = (obj) => {
              for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'string') {
                  obj[key] = obj[key].split(sourceName).join(businessName).split(sourceShortName).join(businessName);
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                  deepReplace(obj[key]);
                }
              }
            };
            deepReplace(faqs);
            fs.writeFileSync(faqsJsonPath, JSON.stringify(faqs, null, 2) + '\n', 'utf8');
          } catch {}
        }

        // Update pricing files with new business name
        for (const pricingFile of ['pricing/services.json', 'pricing/sources.json']) {
          const filePath = path.join(newTenantDir, pricingFile);
          if (fs.existsSync(filePath)) {
            try {
              let content = fs.readFileSync(filePath, 'utf8');
              const sourceProfile = JSON.parse(fs.readFileSync(path.join(sourceTenantDir, 'profile.json'), 'utf8'));
              const sourceName = sourceProfile.name || sourceTenantId;
              const sourceShortName = sourceName.split(' ')[0];
              // v30.1.6: Replace both full name and short name
              content = content.split(sourceName).join(businessName).split(sourceShortName).join(businessName);
              fs.writeFileSync(filePath, content, 'utf8');
            } catch {}
          }
        }

        // v30.1.8: Apply services/products override from the onboarding wizard
        // If the user edited services in Step 4, write them to the appropriate
        // config files so the assistant uses the new prices/services.
        if (Array.isArray(body.services) && body.services.length > 0) {
          const domain = profile.domain || 'generic';
          const isRetail = domain === 'retail';
          const isCleaning = domain === 'cleaning';
          const isOffering = ['salon', 'restaurant', 'education', 'fitness', 'generic'].includes(domain) && profile.capabilities?.includes('offering');

          // For cleaning businesses: update cleaning/services.json + pricing/services.json
          if (isCleaning && profile.capabilities?.includes('cleaning')) {
            const cleaningServicesPath = path.join(newTenantDir, 'cleaning', 'services.json');
            if (fs.existsSync(path.dirname(cleaningServicesPath))) {
              // Read existing services to preserve structure (aliases, etc.)
              let existingServices = [];
              try { existingServices = JSON.parse(fs.readFileSync(cleaningServicesPath, 'utf8')); } catch {}
              // Build a map of existing services by name (case-insensitive)
              const existingMap = new Map();
              existingServices.forEach(s => existingMap.set(String(s.name).toLowerCase(), s));
              // Merge: for each body.service, if name matches existing, update price; otherwise add new
              const updatedServices = body.services.map(svc => {
                const existing = existingMap.get(String(svc.name).toLowerCase());
                if (existing) {
                  // Update existing service's price but preserve structure
                  return { ...existing, name: svc.name, price: svc.price, currency: svc.currency, priceType: svc.priceType, unit: svc.unit || existing.unit };
                }
                // New service — create minimal structure
                return {
                  id: svc.id,
                  name: svc.name,
                  priceType: svc.priceType || 'fixed',
                  price: svc.price,
                  currency: svc.currency || 'AED',
                  unit: svc.unit || '',
                  description: '',
                  aliases: []
                };
              });
              fs.writeFileSync(cleaningServicesPath, JSON.stringify(updatedServices, null, 2) + '\n', 'utf8');
            }
            // Also update pricing/services.json
            const pricingServicesPath = path.join(newTenantDir, 'pricing', 'services.json');
            if (fs.existsSync(pricingServicesPath)) {
              try {
                const pricingConfig = JSON.parse(fs.readFileSync(pricingServicesPath, 'utf8'));
                pricingConfig.services = body.services.map(svc => ({
                  id: svc.id,
                  name: svc.name,
                  priceType: svc.priceType || 'fixed',
                  price: svc.price,
                  currency: svc.currency || 'AED',
                  unit: svc.unit || ''
                }));
                pricingConfig.owner = businessName;
                fs.writeFileSync(pricingServicesPath, JSON.stringify(pricingConfig, null, 2) + '\n', 'utf8');
              } catch {}
            }
          }

          // For retail businesses: update catalog/products.json
          if (isRetail && profile.capabilities?.includes('catalog')) {
            const catalogProductsPath = path.join(newTenantDir, 'catalog', 'products.json');
            const products = body.services.map(svc => ({
              id: svc.id,
              name: svc.name,
              price: svc.price,
              currency: svc.currency || 'AED',
              category: 'general',
              inStock: true,
              description: '',
              variants: []
            }));
            fs.writeFileSync(catalogProductsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
          }

          // For salon/restaurant businesses: update offerings/items.json
          if (isOffering && profile.capabilities?.includes('offering')) {
            const offeringsPath = path.join(newTenantDir, 'offerings', 'items.json');
            const items = body.services.map(svc => ({
              id: svc.id,
              name: svc.name,
              price: svc.price,
              currency: svc.currency || 'AED',
              bookable: true,
              durationMinutes: 60,
              description: ''
            }));
            fs.writeFileSync(offeringsPath, JSON.stringify(items, null, 2) + '\n', 'utf8');
          }
        }

        // Remove any template.json file (it's a template metadata file, not needed in real tenant)
        const templateMetaPath = path.join(newTenantDir, 'template.json');
        if (fs.existsSync(templateMetaPath)) fs.unlinkSync(templateMetaPath);

        // Save the updated profile
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');

        // Clear all caches so the new tenant is picked up
        container.tenantRepository.clearCache(tenantId);
        if (container.cleaningServiceRepository?.clear) container.cleaningServiceRepository.clear(tenantId);
        if (container.pricingRepository?.clear) container.pricingRepository.clear(tenantId);
        if (container.catalogRepository?.clearCache) container.catalogRepository.clearCache(tenantId);
        if (container.offeringRepository?.clearCache) container.offeringRepository.clearCache(tenantId);
        if (container.knowledgeRepository?.clearCache) container.knowledgeRepository.clearCache(tenantId);

        // Return success with the new tenant + embed snippet
        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        const embedSnippet = `<script src="${novaOrigin}/widget.js" data-tenant="${tenantId}" data-server="${novaOrigin}" async></script>`;

        return sendJson(res, 201, {
          ok: true,
          tenant: { id: tenantId, name: businessName, templateId, sourceTenant: sourceTenantId, domain: profile.domain || 'generic', capabilities: profile.capabilities || [] },
          embedSnippet,
          adminUrl: `/admin`,
          message: `Tenant '${businessName}' created as exact replica of '${sourceTenantId}'. Widget is ready to embed.`
        });
      }

      const adminTenantActionMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(suspend|activate|delete|export)$/);
      if (req.method === "POST" && adminTenantActionMatch) {
        const tenantId = decodeURIComponent(adminTenantActionMatch[1]);
        const action = adminTenantActionMatch[2];
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Tenant not found' }); }

        if (action === 'export') {
          // Export tenant folder as a zip so it can be committed to git
          // (Render's ephemeral filesystem wipes new tenants on restart)
          const tenantDir = path.join(container.config.tenantsDir, tenantId);
          if (!fs.existsSync(tenantDir)) return sendJson(res, 404, { ok:false, error:'Tenant folder not found' });
          // Return a JSON manifest of all files in the tenant folder
          // so the dashboard can reconstruct them
          const files = [];
          function walk(dir, rel='') {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fullPath = path.join(dir, entry.name);
              const relPath = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) { walk(fullPath, relPath); continue; }
              try {
                const content = fs.readFileSync(fullPath, 'utf8');
                files.push({ path: relPath, content });
              } catch {}
            }
          }
          walk(tenantDir);
          return sendJson(res, 200, { ok:true, tenantId, files });
        }
        if (action === 'delete') {
          // Don't actually delete demo tenants — just mark them suspended for safety
          const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
          const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          if (profile._template?.isTemplate) return sendJson(res, 403, { ok:false, error:'Cannot delete a template' });
          // Move to _deleted folder instead of permanent delete
          const deletedDir = path.join(container.config.tenantsDir, '_deleted');
          fs.mkdirSync(deletedDir, { recursive: true });
          fs.renameSync(path.join(container.config.tenantsDir, tenantId), path.join(deletedDir, `${tenantId}-${Date.now()}`));
          container.tenantRepository.clearCache(tenantId);
          return sendJson(res, 200, { ok:true, message:`Tenant '${tenantId}' deleted.` });
        }
        // suspend/activate
        const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        profile.status = action === 'suspend' ? 'suspended' : 'active';
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
        container.tenantRepository.clearCache(tenantId);
        return sendJson(res, 200, { ok:true, tenantId, status: profile.status });
      }
      // ─── End v30.1 template & tenant creation endpoints ─────────────────────

      // ─── v33.1: Admin owner management endpoints ────────────────────────
      // List all business owner accounts for a tenant (admin only)
      if (req.method === "GET" && url.pathname.match(/^\/api\/admin\/owners\/([^/]+)$/)) {
        const ownerMatch = url.pathname.match(/^\/api\/admin\/owners\/([^/]+)$/);
        const tenantId = decodeURIComponent(ownerMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const owners = container.businessOwnerAuthService.listOwners({ tenantId });
        return sendJson(res, 200, { ok:true, tenantId, owners });
      }

      // Reset a business owner's password (admin only)
      const resetPasswordMatch = url.pathname.match(/^\/api\/admin\/owners\/([^/]+)\/reset-password$/);
      if (req.method === "POST" && resetPasswordMatch) {
        const tenantId = decodeURIComponent(resetPasswordMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        const { email, newPassword } = body;
        if (!email || !newPassword) return sendJson(res, 400, { ok:false, error:'email and newPassword are required' });
        try {
          const result = container.businessOwnerAuthService.resetPassword({ tenantId, email, newPassword });
          return sendJson(res, 200, { ok:true, ...result, message: `Password reset for ${email}. The owner can now log in with the new password.` });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }
      // ─── End v33.1 Admin owner management ───────────────────────────────

      // ─── Extended admin owner management (add / email / remove) ──────────
      // Add an owner to a tenant (admin-driven). Lets an operator provision a
      // second owner without the self-serve register flow.
      const adminAddOwnerMatch = url.pathname.match(/^\/api\/admin\/owners\/([^/]+)$/);
      if (req.method === "POST" && adminAddOwnerMatch) {
        const tenantId = decodeURIComponent(adminAddOwnerMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        const { email, password, name, role } = body;
        if (!email || !password) return sendJson(res, 400, { ok:false, error:'email and password are required' });
        try {
          const owner = container.businessOwnerAuthService.addOwner({ tenantId, email, password, name, role });
          return sendJson(res, 201, { ok:true, owner, message:`Owner ${email} added to ${tenantId}.` });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }

      // Update an owner's email (admin-driven — no current-password check).
      const adminOwnerEmailMatch = url.pathname.match(/^\/api\/admin\/owners\/([^/]+)\/([^/]+)\/email$/);
      if (req.method === "PUT" && adminOwnerEmailMatch) {
        const tenantId = decodeURIComponent(adminOwnerEmailMatch[1]);
        const ownerId = decodeURIComponent(adminOwnerEmailMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        const { newEmail } = body;
        if (!newEmail) return sendJson(res, 400, { ok:false, error:'newEmail is required' });
        try {
          const result = container.businessOwnerAuthService.adminUpdateEmail({ tenantId, ownerId, newEmail });
          return sendJson(res, 200, { ok:true, ...result, message:`Email updated to ${result.email}.` });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }

      // Remove an owner (admin-driven). Refuses the last owner.
      const adminOwnerDeleteMatch = url.pathname.match(/^\/api\/admin\/owners\/([^/]+)\/([^/]+)$/);
      if (req.method === "DELETE" && adminOwnerDeleteMatch) {
        const tenantId = decodeURIComponent(adminOwnerDeleteMatch[1]);
        const ownerId = decodeURIComponent(adminOwnerDeleteMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        try {
          const result = container.businessOwnerAuthService.removeOwner({ tenantId, ownerId });
          return sendJson(res, 200, { ok:true, ...result, message:`Removed owner ${result.email}.` });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }
      // ─── End extended admin owner management ────────────────────────────

      // ─── v34.1: Voice Profile endpoints (voice cloning prep) ────────────
      // GET: retrieve voice profile for a tenant
      // POST: save voice profile (voice name, rate, pitch from browser TTS settings)
      const voiceProfileMatch = url.pathname.match(/^\/api\/admin\/voice-profile\/([^/]+)$/);
      if (req.method === "GET" && voiceProfileMatch) {
        const tenantId = decodeURIComponent(voiceProfileMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const profilePath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
        let profile = { enabled: false, voiceName: null, rate: 0.95, pitch: 1.0, volume: 0.85 };
        if (fs.existsSync(profilePath)) {
          try { profile = { ...profile, ...JSON.parse(fs.readFileSync(profilePath, 'utf8')) }; } catch {}
        }
        return sendJson(res, 200, { ok:true, tenantId, profile });
      }
      if (req.method === "POST" && voiceProfileMatch) {
        const tenantId = decodeURIComponent(voiceProfileMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        const profilePath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
        const profile = {
          enabled: body.enabled !== false,
          voiceName: body.voiceName || null,
          rate: body.rate || 0.95,
          pitch: body.pitch || 1.0,
          volume: body.volume || 0.85,
          customVoiceURI: body.customVoiceURI || null,
          savedAt: new Date().toISOString()
        };
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
        return sendJson(res, 200, { ok:true, tenantId, profile, message: 'Voice profile saved. Widget will use this voice for TTS.' });
      }

      // Voice profile is also returned in widget config (public, no auth)
      // so the widget can apply it without login
      // (handled in the /api/widget/config endpoint above — add voiceProfile to response)

      // ─── v34.1: Product Image endpoints ────────────────────────────────
      // ─── v35.0: Catalog (Product) Management endpoints ───────────────────
      // GET /api/admin/catalog/{tenantId}/products — list all products
      // POST /api/admin/catalog/{tenantId}/products — add new product
      // PUT /api/admin/catalog/{tenantId}/products/{productId} — update product
      // DELETE /api/admin/catalog/{tenantId}/products/{productId} — delete product
      const catalogListMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/products$/);
      if (req.method === "GET" && catalogListMatch) {
        const tenantId = decodeURIComponent(catalogListMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        try {
          const products = await container.catalogService.listProducts(tenantId);
          return sendJson(res, 200, { ok:true, tenantId, products: products || [] });
        } catch (err) {
          // Tenant may not have a catalog (e.g. cleaning tenant) — return empty
          return sendJson(res, 200, { ok:true, tenantId, products: [] });
        }
      }
      if (req.method === "POST" && catalogListMatch) {
        const tenantId = decodeURIComponent(catalogListMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        if (!body.name) return sendJson(res, 400, { ok:false, error:'Product name is required' });
        const productsPath = path.join(container.config.tenantsDir, tenantId, 'catalog', 'products.json');
        fs.mkdirSync(path.dirname(productsPath), { recursive: true });
        let products = [];
        if (fs.existsSync(productsPath)) {
          try { products = JSON.parse(fs.readFileSync(productsPath, 'utf8')); } catch { products = []; }
        }
        // Generate a unique product ID
        let maxNum = 0;
        for (const p of products) {
          const m = String(p.id || '').match(/^P(\d+)$/);
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        }
        const newId = `P${String(maxNum + 1).padStart(3, '0')}`;
        const product = {
          id: newId,
          sku: body.sku || newId,
          name: body.name,
          category: body.category || 'general',
          price: Number(body.price) || 0,
          currency: body.currency || 'PKR',
          description: body.description || '',
          aliases: body.aliases || [],
          tags: body.tags || [],
          inStock: body.inStock !== false,
          inventory: Number(body.inventory) || 0,
          imageUrl: null
        };
        if (body.sizes) product.sizes = body.sizes;
        if (body.colors) product.colors = body.colors;
        products.push(product);
        fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
        container.catalogRepository?.clearCache?.(tenantId);
        return sendJson(res, 200, { ok:true, product, message: 'Product added' });
      }

      const catalogProductMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/products\/([^/]+)$/);
      if (catalogProductMatch && !url.pathname.endsWith('/image')) {
        const tenantId = decodeURIComponent(catalogProductMatch[1]);
        const productId = decodeURIComponent(catalogProductMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const productsPath = path.join(container.config.tenantsDir, tenantId, 'catalog', 'products.json');
        if (!fs.existsSync(productsPath)) return sendJson(res, 404, { ok:false, error:'No catalog for this tenant' });
        let products = [];
        try { products = JSON.parse(fs.readFileSync(productsPath, 'utf8')); }
        catch { return sendJson(res, 500, { ok:false, error:'Failed to parse products.json' }); }
        const idx = products.findIndex(p => String(p.id) === String(productId) || String(p.id).toLowerCase() === String(productId).toLowerCase());
        if (idx === -1) return sendJson(res, 404, { ok:false, error:'Product not found' });

        if (req.method === "PUT") {
          const body = await readJson(req);
          const updated = { ...products[idx], ...body, id: products[idx].id }; // don't allow ID change
          products[idx] = updated;
          fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
          container.catalogRepository?.clearCache?.(tenantId);
          return sendJson(res, 200, { ok:true, product: updated, message: 'Product updated' });
        }
        if (req.method === "DELETE") {
          const removed = products.splice(idx, 1)[0];
          fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
          container.catalogRepository?.clearCache?.(tenantId);
          // Also delete the image if any
          const imagesDir = path.join(container.config.tenantsDir, tenantId, 'catalog', 'images');
          for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
            const p = path.join(imagesDir, productId + ext);
            if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
          }
          return sendJson(res, 200, { ok:true, product: removed, message: 'Product deleted' });
        }
      }

      // ─── End v35.0 Catalog endpoints ─────────────────────────────────

      // Upload product image (admin only)
      const productImageMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/products\/([^/]+)\/image$/);
      if (req.method === "POST" && productImageMatch) {
        const tenantId = decodeURIComponent(productImageMatch[1]);
        const productId = decodeURIComponent(productImageMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const body = await readJson(req);
        const { contentBase64, filename } = body;
        if (!contentBase64) return sendJson(res, 400, { ok:false, error:'contentBase64 is required' });
        // Save image to tenant's catalog/images/ directory
        const imagesDir = path.join(container.config.tenantsDir, tenantId, 'catalog', 'images');
        fs.mkdirSync(imagesDir, { recursive: true });
        const ext = path.extname(filename || '').toLowerCase() || '.png';
        const imagePath = path.join(imagesDir, `${productId}${ext}`);
        try {
          fs.writeFileSync(imagePath, Buffer.from(contentBase64, 'base64'));
          // Update product's imageUrl in products.json
          const productsPath = path.join(container.config.tenantsDir, tenantId, 'catalog', 'products.json');
          if (fs.existsSync(productsPath)) {
            const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
            const product = products.find(p => p.id === productId || String(p.id).toLowerCase() === String(productId).toLowerCase());
            if (product) {
              product.imageUrl = `/api/catalog/images/${tenantId}/${productId}${ext}`;
              fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
              container.catalogRepository?.clearCache?.(tenantId);
            }
          }
          return sendJson(res, 200, { ok:true, imageUrl: `/api/catalog/images/${tenantId}/${productId}${ext}` });
        } catch (err) {
          return sendJson(res, 500, { ok:false, error: err.message });
        }
      }

      // Serve product image (public, no auth)
      const catalogImageMatch = url.pathname.match(/^\/api\/catalog\/images\/([^/]+)\/([^/]+)$/);
      if (req.method === "GET" && catalogImageMatch) {
        const tenantId = decodeURIComponent(catalogImageMatch[1]);
        const productId = decodeURIComponent(catalogImageMatch[2]);
        const imagesDir = path.join(container.config.tenantsDir, tenantId, 'catalog', 'images');
        // Try common extensions
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
          const filePath = path.join(imagesDir, `${productId}${ext}`);
          if (fs.existsSync(filePath)) {
            const mimeTypes = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
            const data = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'public, max-age=86400' });
            res.end(data);
            return;
          }
        }
        return sendText(res, 404, 'Image not found');
      }

      // ─── v34.2: Kiosk mode route ──────────────────────────────────────
      // /kiosk/{tenantId} serves a single full-screen modern chat interface.
      // Mobile-first, glassmorphism, no popup widget — direct conversation.
      // Skips pre-chat form (anonymous kiosk session).
      if (req.method === "GET" && url.pathname.startsWith("/kiosk")) {
        // Extract tenantId from path: /kiosk/{tenantId} or /kiosk/{tenantId}/{anything}
        const kioskPathParts = url.pathname.split('/').filter(Boolean);
        const kioskTenantId = kioskPathParts[1] || container.config.defaultTenantId;
        // Validate tenant exists — show a friendly error page if not
        try { container.tenantRepository.getById(kioskTenantId); }
        catch {
          return sendHtml(res, 404, `<!doctype html><html><body style="font-family:Inter,sans-serif;background:#0a0e1a;color:#e8edf7;text-align:center;padding:60px"><h1 style="color:#ff6b6b">Business not found</h1><p style="color:#91a0bd;margin-top:12px">We couldn't find the business <code style="background:#172139;padding:2px 8px;border-radius:4px">${escHtml(kioskTenantId)}</code>.</p><p style="margin-top:20px"><a href="/" style="color:#4773e5">Go to Nova Assistant</a></p></body></html>`);
        }
        const kioskHtmlPath = path.resolve(__dirname, "../../widget/public/kiosk.html");
        if (fs.existsSync(kioskHtmlPath)) {
          const html = fs.readFileSync(kioskHtmlPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
          return;
        }
        return sendText(res, 404, 'Kiosk page not found');
      }

      // ─── v34.1 → v35.3: QR Code generation (server-side, no external API) ──
      // Returns the kiosk URL + a self-hosted QR code endpoint. The QR code
      // is generated in pure JS (packages/qr-engine) — no external dependency
      // on goqr.me, no CSP violation, no third-party data leak.
      const qrCodeMatch = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/qr-code$/);
      if (req.method === "GET" && qrCodeMatch) {
        const tenantId = decodeURIComponent(qrCodeMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        const kioskUrl = `${novaOrigin}/kiosk/${tenantId}`;
        const widgetUrl = `${novaOrigin}/widget.js?data-tenant=${tenantId}&data-server=${encodeURIComponent(novaOrigin)}`;
        // Public QR code endpoints (no auth — kiosk links are public anyway)
        const qrPngUrl = `${novaOrigin}/api/qr/${encodeURIComponent(tenantId)}.png`;
        const qrSvgUrl = `${novaOrigin}/api/qr/${encodeURIComponent(tenantId)}.svg`;
        return sendJson(res, 200, {
          ok: true,
          tenantId,
          kioskUrl,
          widgetUrl,
          qrCodeImageUrl: qrPngUrl,
          qrCodeSvgUrl: qrSvgUrl,
          embedCode: `<img src="${qrPngUrl}" alt="Scan to chat with Nova" />`
        });
      }
      // v35.3: Server-side QR code endpoints (no external API)
      // GET /api/qr/{tenantId}.png → QR code PNG
      // GET /api/qr/{tenantId}.svg → QR code SVG
      // ?download=1 → send Content-Disposition: attachment so browsers save
      //   the file instead of opening/rendering it. Used by the dashboard's
      //   "Download QR Code" buttons. The same endpoint serves both the inline
      //   <img> preview (no query) and the download (with query).
      const qrImageMatch = url.pathname.match(/^\/api\/qr\/([^/]+)\.(png|svg)$/);
      if (req.method === "GET" && qrImageMatch) {
        const tenantId = decodeURIComponent(qrImageMatch[1]);
        const format = qrImageMatch[2];
        const wantsDownload = url.searchParams.get('download') === '1';
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendText(res, 404, 'Unknown tenant'); }
        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        const kioskUrl = `${novaOrigin}/kiosk/${tenantId}`;
        try {
          const { generateQrMatrix, qrMatrixToSvg, qrMatrixToPng } = require('../../../packages/qr-engine/src/qrCode');
          const matrix = generateQrMatrix(kioskUrl);
          // Use a higher scale for downloads so the printed QR stays crisp at
          // large sizes; the inline preview stays small for fast page load.
          const scale = wantsDownload ? 16 : 8;
          if (format === 'svg') {
            const svg = qrMatrixToSvg(matrix, { scale: 10, margin: 4 });
            const headers = { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' };
            if (wantsDownload) {
              headers['Content-Disposition'] = `attachment; filename="nova-kiosk-${tenantId}.svg"`;
            }
            res.writeHead(200, headers);
            res.end(svg);
            return;
          } else {
            const png = qrMatrixToPng(matrix, { scale, margin: 4 });
            const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': png.length };
            if (wantsDownload) {
              headers['Content-Disposition'] = `attachment; filename="nova-kiosk-${tenantId}.png"`;
            }
            res.writeHead(200, headers);
            res.end(png);
            return;
          }
        } catch (err) {
          container.logger?.error?.('qr.generation_failed', { tenantId, error: err.message });
          return sendText(res, 500, 'QR generation failed.');
        }
      }

      // ─── End v34.1 endpoints ───────────────────────────────────────────

      // ─── v31.0 Google Calendar OAuth initiation (authed; dev-token gate) ────
      // Starts the consent flow for a tenant. The dashboard (which holds the
      // dev token) calls this; we mint a signed, single-use state token that
      // the public callback (below the gate) verifies. The callback itself is
      // registered in the public section so Google's browser redirect isn't
      // blocked by the dev-token gate.
      const calendarAuthMatch = url.pathname.match(/^\/api\/admin\/calendar\/auth\/([^/]+)$/);
      if (req.method === "GET" && calendarAuthMatch) {
        const tenantId = decodeURIComponent(calendarAuthMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        if (!container.googleOAuthClient?.isConfigured?.()) {
          return sendJson(res, 503, { ok:false, error:'Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.' });
        }
        const state = mintState(tenantId, container.oauthNonceStore);
        const authUrl = container.googleOAuthClient.getAuthUrl(state);
        return sendJson(res, 200, { ok:true, tenantId, authUrl });
      }

      // ─── Phase 4 Sprint 3: Microsoft Graph Calendar OAuth initiation ──────
      const microsoftAuthMatch = url.pathname.match(/^\/api\/admin\/calendar\/microsoft\/auth\/([^/]+)$/);
      if (req.method === "GET" && microsoftAuthMatch) {
        const tenantId = decodeURIComponent(microsoftAuthMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        if (!container.microsoftOAuthClient?.isConfigured?.()) {
          return sendJson(res, 503, { ok:false, error:'Microsoft Calendar is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET env vars.' });
        }
        const state = mintState(tenantId, container.oauthNonceStore);
        const authUrl = container.microsoftOAuthClient.getAuthUrl(state);
        return sendJson(res, 200, { ok:true, tenantId, authUrl });
      }

      // Calendar status — is this tenant connected to Google Calendar?
      const calendarStatusMatch = url.pathname.match(/^\/api\/admin\/calendar\/status\/([^/]+)$/);
      if (req.method === "GET" && calendarStatusMatch) {
        const tenantId = decodeURIComponent(calendarStatusMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const connected = container.calendarTokenRepository.exists(tenantId);
        const calConfigPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
        let provider = 'local';
        if (fs.existsSync(calConfigPath)) {
          try { provider = JSON.parse(fs.readFileSync(calConfigPath, 'utf8')).provider || 'local'; } catch {}
        }
        return sendJson(res, 200, {
          ok:true, tenantId, connected, provider,
          oauthConfigured: container.googleOAuthClient?.isConfigured?.() || false,
          oauthStatus: container.googleOAuthClient?.getStatus?.() || null
        });
      }

      // Disconnect Google Calendar
      const calendarDisconnectMatch = url.pathname.match(/^\/api\/admin\/calendar\/disconnect\/([^/]+)$/);
      if (req.method === "POST" && calendarDisconnectMatch) {
        const tenantId = decodeURIComponent(calendarDisconnectMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        container.calendarTokenRepository.delete(tenantId);
        // Revert calendar config to local provider
        const configPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
        if (fs.existsSync(configPath)) {
          const calConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          calConfig.provider = 'local';
          fs.writeFileSync(configPath, JSON.stringify(calConfig, null, 2) + '\n', 'utf8');
          container.calendarConfigRepository.clear(tenantId);
        }
        return sendJson(res, 200, { ok:true, tenantId, message:'Google Calendar disconnected.' });
      }

      // List upcoming calendar events (Nova-created only)
      const calendarEventsMatch = url.pathname.match(/^\/api\/admin\/calendar\/events\/([^/]+)$/);
      if (req.method === "GET" && calendarEventsMatch) {
        const tenantId = decodeURIComponent(calendarEventsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        if (!container.calendarTokenRepository.exists(tenantId)) {
          return sendJson(res, 200, { ok:true, connected:false, events:[] });
        }
        const limit = Number(url.searchParams.get("limit") || 50);
        const result = await container.googleCalendarProvider.listEvents({ tenantId, limit }, container.calendarService.getConfig(tenantId));
        return sendJson(res, 200, { ok:true, connected:true, events: result.events || [], error: result.error || null });
      }

      // Test calendar connection
      const calendarTestMatch = url.pathname.match(/^\/api\/admin\/calendar\/test\/([^/]+)$/);
      if (req.method === "POST" && calendarTestMatch) {
        const tenantId = decodeURIComponent(calendarTestMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        if (!container.calendarTokenRepository.exists(tenantId)) {
          return sendJson(res, 200, { ok:false, error:'Google Calendar is not connected for this tenant.' });
        }
        const tokens = container.calendarTokenRepository.load(tenantId);
        const result = await container.googleOAuthClient.verifyTokens(tokens);
        return sendJson(res, 200, { ok: result.valid, tenantId, ...result });
      }
      // ─── End v31.0 Google Calendar endpoints ─────────────────────────────────

      const adminLeadsMatch = url.pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
      if (req.method === "GET" && adminLeadsMatch) {
        const tenantId = decodeURIComponent(adminLeadsMatch[1]);
        container.tenantRepository.getById(tenantId);
        const [summary, leads] = await Promise.all([
          container.leadService.summary(tenantId),
          container.leadService.list(tenantId, { limit: 200 })
        ]);
        return sendJson(res, 200, { ok:true, tenantId, summary, leads });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/datasets") {
        const datasetsRoot = path.resolve(__dirname, "../../../tests/datasets");
        const datasets = [];
        const walk = (dir, prefix="") => {
          if (!fs.existsSync(dir)) return;
          for (const name of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            if (fs.statSync(full).isDirectory()) { walk(full, rel); continue; }
            if (name.endsWith(".json")) {
              try {
                const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
                datasets.push({
                  path: rel,
                  tenantId: parsed.tenantId || null,
                  caseCount: parsed.cases?.length || 0,
                  turnCount: (parsed.cases||[]).reduce((s,c)=>s+(c.turns?.length||0),0)
                });
              } catch {}
            }
          }
        };
        walk(datasetsRoot);
        return sendJson(res, 200, { ok:true, datasets });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/datasets/run") {
        const body = await readJson(req);
        const report = await runDataset(container, String(body.dataset || ""));
        return sendJson(res, 200, report);
      }

      // ─── v30.0 Notification endpoints ─────────────────────────────────────
      const adminNotificationsMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)$/);
      if (req.method === "GET" && adminNotificationsMatch) {
        const tenantId = decodeURIComponent(adminNotificationsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const limit = Number(url.searchParams.get("limit") || 100);
        const unreadOnly = url.searchParams.get("unreadOnly") === "true";
        const [notifications, unreadCount, totalCount] = await Promise.all([
          container.notificationService.listNotifications(tenantId, { limit, unreadOnly }),
          container.notificationService.unreadCount(tenantId),
          container.notificationService.notificationLog.totalCount(tenantId)
        ]);
        return sendJson(res, 200, { ok:true, tenantId, notifications, unreadCount, totalCount, emailService: container.emailService.getStatus() });
      }
      if (req.method === "POST" && adminNotificationsMatch) {
        const body = await readJson(req);
        const tenantId = decodeURIComponent(adminNotificationsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const result = await container.notificationService.markAllRead(tenantId);
        return sendJson(res, 200, { ok:true, markedRead: result });
      }

      const adminNotificationReadMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/([^/]+)\/read$/);
      if (req.method === "POST" && adminNotificationReadMatch) {
        const tenantId = decodeURIComponent(adminNotificationReadMatch[1]);
        const notificationId = decodeURIComponent(adminNotificationReadMatch[2]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const result = await container.notificationService.markRead(tenantId, notificationId);
        return result ? sendJson(res, 200, { ok:true, notification: result }) : sendJson(res, 404, { ok:false, error:'Notification not found' });
      }

      const adminNotificationPrefsMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/preferences$/);
      if (req.method === "GET" && adminNotificationPrefsMatch) {
        const tenantId = decodeURIComponent(adminNotificationPrefsMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const prefs = container.notificationService.getPreferences(tenantId);
        return sendJson(res, 200, { ok:true, tenantId, preferences: prefs, emailService: container.emailService.getStatus() });
      }
      if (req.method === "PUT" && adminNotificationPrefsMatch) {
        const tenantId = decodeURIComponent(adminNotificationPrefsMatch[1]);
        const body = await readJson(req);
        try {
          const profile = container.tenantRepository.getById(tenantId);
          profile.notifications = body.preferences || body;
          // Persist back to profile.json
          const profilePath = path.join(container.config.tenantsDir, tenantId, "profile.json");
          fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
          container.tenantRepository.clearCache(tenantId);
          return sendJson(res, 200, { ok:true, tenantId, preferences: profile.notifications });
        } catch (error) {
          return sendJson(res, 500, { ok:false, error: error.message });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/admin/notifications/email/test") {
        const result = await container.emailService.verifyConnection();
        return sendJson(res, 200, { ok: result.ok, status: result });
      }
      // ─── End v30.0 notification endpoints ───────────────────────────────────
      // ─── End admin dashboard endpoints ──────────────────────────────────────

      // v28.0 — CORS preflight for all widget endpoints.
      // Must be the very first thing checked so OPTIONS never hits auth.
      if (req.method === "OPTIONS" && (url.pathname === "/api/chat" || url.pathname.startsWith("/api/widget/"))) {
        const origin = String(req.headers['origin'] || '*');
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-nova-tenant-id',
          'Access-Control-Max-Age': '600',
          'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Remaining'
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        // ─── v30.1.4 Widget API Key Security ──────────────────────────────────
        // Tenants can require an API key for widget requests by setting
        // widget.apiKey in their profile.json. If set, requests must include
        // x-nova-api-key header matching the key.
        // This prevents unauthorized websites from embedding your Nova agent.
        // If widget.apiKey is NOT set, the widget is open (anyone can embed).
        const origin = String(req.headers['origin'] || '*');
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const body = await readJson(req);
        const tenantIdForRateLimit = String(body.tenantId || container.config.defaultTenantId);

        // v30.1.4: Check if tenant has API key protection enabled
        let tenantProfile = null;
        try { tenantProfile = container.tenantRepository.getById(tenantIdForRateLimit); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }

        const widgetApiKey = tenantProfile?.widget?.apiKey;
        const allowedDomains = tenantProfile?.widget?.allowedDomains;

        if (widgetApiKey) {
          // API key is required
          const suppliedKey = String(req.headers['x-nova-api-key'] || body.apiKey || '');
          if (suppliedKey !== widgetApiKey) {
            return sendJson(res, 403, { ok:false, error:'Invalid API key. This widget requires authorization.' });
          }
        }

        // v30.1.4: Domain whitelist (optional)
        if (allowedDomains && Array.isArray(allowedDomains) && allowedDomains.length > 0) {
          const requestOrigin = String(req.headers['origin'] || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
          const isAllowed = allowedDomains.some(d => {
            const clean = d.replace(/^https?:\/\//, '').replace(/\/$/, '');
            return requestOrigin === clean || requestOrigin.endsWith('.' + clean);
          });
          if (!isAllowed && requestOrigin) {
            return sendJson(res, 403, { ok:false, error:'This domain is not authorized to use this widget.' });
          }
        }

        const rateResult = checkWidgetRateLimit(`${clientIp}:${tenantIdForRateLimit}`);
        if (!rateResult.allowed) {
          res.writeHead(429, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type',
            'Retry-After': String(rateResult.retryAfterSeconds),
            'X-RateLimit-Limit': '30',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateResult.resetAt)
          });
          return res.end(JSON.stringify({ ok:false, error:'Rate limit exceeded. Please slow down.', retryAfterSeconds: rateResult.retryAfterSeconds }));
        }
        if(String(body.text||'').trim().length>4000)throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
        // Tenant verification: reject unknown tenants so attackers cannot
        // probe internal tenant IDs through the public endpoint.
        const tenantId = String(body.tenantId || container.config.defaultTenantId);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        // CustomerId cap: 128 chars, alphanumeric + dash/underscore only.
        // The widget generates a per-browser UUID; we just need to prevent
        // abuse vectors like injecting tenantIds or SQL via customerId.
        // Auto-generate if missing so anonymous widget users work out-of-box.
        let customerId = String(body.customerId || '').trim();
        if (customerId.length === 0) {
          customerId = `widget-${crypto.randomUUID()}`;
        } else if (customerId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(customerId)) {
          return sendJson(res, 400, { ok:false, error:'Invalid customerId' });
        }
        body.customerId = customerId;
        body.tenantId = tenantId;
        body.channel = 'widget';
        if (!body.metadata) body.metadata = {};
        body.metadata.source = 'widget';
        body.metadata.origin = origin;
        body.metadata.clientIp = clientIp;
        const adapter = container.channelRegistry.get("http");
        const message = adapter.normalizeIncoming(body);
        const result = await container.executionEngine.process(message);
        // CORS headers on the response so the browser exposes the body to JS
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, X-RateLimit-Remaining');
        res.setHeader('X-Request-Id', requestCorrelationId(req) || crypto.randomUUID());
        res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
        return sendJson(res, 200, adapter.formatOutgoing(result));
      }

      // v28.0 — Public widget config endpoint (no auth required, read-only)
      // Returns ONLY what the widget needs to bootstrap: assistantName,
      // welcomeMessage, themeColor, position, language, suggestions.
      // v29.0 — extended with agent persona, pre-chat form, proactive greeting.
      // Sensitive tenant data (permissions, internal IDs) never leaves the server.
      const widgetConfigMatch = url.pathname.match(/^\/api\/widget\/config\/([^/]+)$/);
      if (req.method === "GET" && widgetConfigMatch) {
        const tenantId = decodeURIComponent(widgetConfigMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const profile = container.tenantRepository.getById(tenantId);
        const branding = profile.branding || {};
        const widget = profile.widget || {};
        const business = profile.business || {};
        const origin = String(req.headers['origin'] || '*');
        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Cache-Control', 'public, max-age=300');
        return sendJson(res, 200, {
          ok:true,
          tenantId,
          // v28 core fields
          assistantName: branding.assistantName || 'Nova',
          welcomeMessage: widget.welcomeMessage || branding.welcomeMessage || 'Hi! How can I help you today?',
          welcomeMessageRomanUrdu: widget.welcomeMessageRomanUrdu || branding.welcomeMessageRomanUrdu || null,
          themeColor: widget.themeColor || '#2d5bd1',
          position: widget.position || 'bottom-right',
          language: widget.language || 'auto',
          suggestions: widget.suggestions || [],
          // v36.0: size presets + offset/radius controls
          size: widget.size || 'medium',
          offsetX: widget.offsetX || 0,
          offsetY: widget.offsetY || 0,
          radius: (widget.radius !== undefined && widget.radius !== null) ? widget.radius : 16,
          autoOpen: widget.autoOpen === true,
          autoOpenDelayMs: widget.autoOpenDelayMs || 0,
          customIcon: widget.customIcon || null,
          businessName: profile.name || '',
          businessDescription: business.description || '',
          enabled: widget.enabled !== false,
          // v30.1.4: Security status (does NOT expose the actual key)
          requiresApiKey: !!widget.apiKey,
          allowedDomains: widget.allowedDomains || [],
          // v34.1: Voice profile for TTS (voice cloning)
          // v36.0: Uses fileExistenceCache to avoid redundant fs.existsSync on every request
          voiceProfile: (() => {
            const vpPath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
            if (fileExistenceCache.exists(vpPath, fs)) {
              try { return JSON.parse(fs.readFileSync(vpPath, 'utf8')); } catch { return null; }
            }
            return null;
          })(),
          // v34.2: Cloned voice sample URL (if owner uploaded a recorded clip)
          // Public so the kiosk/widget can fetch without auth.
          voiceSampleUrl: (() => {
            const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
            const candidatePaths = ['.webm', '.mp3', '.wav', '.m4a', '.ogg'].map(ext =>
              path.join(samplesDir, 'sample' + ext)
            );
            // v36.0: check existence via cache (1 disk hit per 60s instead of 5 per request)
            const found = fileExistenceCache.findFirst(candidatePaths, fs);
            if (found) {
              return `${novaOrigin}/api/voice/sample/${encodeURIComponent(tenantId)}`;
            }
            return null;
          })(),
          // v29 agent persona
          // v73.3: default avatar is the Nova Agent Orb (technology mark)
          // instead of the 'marcus' face portrait. Tenants that explicitly
          // set widget.agentAvatar keep their choice.
          agent: {
            avatar: widget.agentAvatar || 'nova',
            name: widget.agentName || branding.assistantName || 'Nova',
            title: widget.agentTitle || 'Assistant',
            online: true
          },
          // v29 pre-chat form (optional)
          preChatForm: widget.preChatForm || { enabled: false, fields: [] },
          // v29 proactive greeting (optional)
          proactiveGreeting: widget.proactiveGreeting || { enabled: false, delaySeconds: 5, message: null, pageRules: [] }
        });
      }

      // ─── v32.0 Business Manager Dashboard endpoints ───────────────────────
      // All /api/business/* endpoints require a valid JWT (except /login and /register).
      // The JWT contains the tenantId, so the owner can ONLY see their own tenant's data.

      // Login — no auth required
      if (req.method === "POST" && url.pathname === "/api/business/login") {
        const body = await readJson(req);
        const { tenantId, email, password } = body;
        if (!tenantId || !email || !password) return sendJson(res, 400, { ok:false, error:'tenantId, email, and password are required' });
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const result = await container.businessOwnerAuthService.loginWithPassword({ tenantId, email, password, ip: clientIp });
        if (!result.ok) return sendJson(res, 401, { ok:false, error: result.error });
        return sendJson(res, 200, { ok:true, token: result.token, owner: result.owner });
      }

      // Register — only available if no owners exist yet (first owner setup)
      // OR if called with an admin dev token (operator creating owner accounts)
      if (req.method === "POST" && url.pathname === "/api/business/register") {
        const body = await readJson(req);
        const { tenantId, email, password, name } = body;
        if (!tenantId || !email || !password) return sendJson(res, 400, { ok:false, error:'tenantId, email, and password are required' });
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        // Check if this is the first owner (no owners.json exists yet) — allow without auth
        const ownersFilePath = path.join(container.config.tenantsDir, tenantId, 'owners.json');
        const isFirstOwner = !fs.existsSync(ownersFilePath);
        // If not first owner, require admin dev token
        if (!isFirstOwner && !authorizeDeveloperRequest(req)) {
          return sendJson(res, 401, { ok:false, error:'Admin token required to add additional owners. Use /api/admin/ to create owner accounts.' });
        }
        try {
          const owner = container.businessOwnerAuthService.createOwner({ tenantId, email, password, name });
          return sendJson(res, 201, { ok:true, owner });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }

      // All other /api/business/* endpoints require auth
      // ─── Self-serve password recovery (public, rate-limited) ────────────
      // Request a reset link. NEVER reveals whether the email exists (anti-
      // enumeration): returns the same generic ok whether or not the owner was
      // found. In dev (no SMTP configured) the token is returned in the response
      // so the flow can be tested without a mailbox; in prod the link is emailed
      // and the token is omitted from the response.
      if (req.method === "POST" && url.pathname === "/api/business/forgot-password") {
        const body = await readJson(req);
        const { tenantId, email } = body;
        if (!tenantId || !email) return sendJson(res, 400, { ok:false, error:'tenantId and email are required' });
        // Validate tenant exists (this IS allowed to 404 — a non-existent tenant
        // isn't account-enumeration of a real tenant).
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const rl = checkWidgetRateLimit(`forgot:${clientIp}`);
        if (!rl.allowed) return sendJson(res, 429, { ok:false, error:'Too many requests. Please wait a few minutes.' });
        try {
          const result = container.businessOwnerAuthService.issuePasswordResetToken({ tenantId, email });
          // Deliver the reset link by email. We fire-and-forget the SMTP send
          // (no await) so the response latency is identical whether or not an
          // owner was found — closing the account-enumeration timing leak that
          // an awaited SMTP round-trip would create.
          if (result.token && container.emailService) {
            const proto = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers['host'] || 'localhost';
            const resetUrl = `${proto}://${host}/business/reset-password?tenant=${encodeURIComponent(tenantId)}&token=${result.token}`;
            const isDev = !container.emailService.configured;
            container.emailService.send({
              to: result.email,
              subject: 'Reset your Nova business dashboard password',
              text: `Hello,\n\nWe received a request to reset your Nova dashboard password. Open this link within 30 minutes to choose a new password:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password hasn't changed.\n\n— The Nova team`,
              html: `<p>Hello,</p><p>We received a request to reset your Nova dashboard password. Click the link below within 30 minutes to choose a new password:</p><p><a href="${resetUrl}">Reset my password</a></p><p style="color:#666;font-size:12px">Or copy this link: ${resetUrl}</p><p>If you didn't request this, you can safely ignore this email — your password hasn't changed.</p><p>— The Nova team</p>`,
            }).catch(e => container.logger?.error?.('business.forgot_password_email_failed', { tenantId, error: e.message }));
            // Dev mode only: SMTP isn't configured, so surface the link for testing.
            return sendJson(res, 200, { ok:true, message:'If an account exists for that email, a reset link has been sent.', ...(isDev ? { devToken: result.token, devNote: 'SMTP not configured — the reset link is included here for local testing.' } : {}) });
          }
          // No email service OR no owner found — same generic message + latency.
          return sendJson(res, 200, { ok:true, message:'If an account exists for that email, a reset link has been sent.' });
        } catch (err) {
          container.logger?.error?.('business.forgot_password_failed', { tenantId, error: err.message });
          return sendJson(res, 400, { ok:false, error: 'Could not process the request. Please try again.' });
        }
      }

      // Consume a reset token + set a new password (public — the token is the
      // auth). Single-use, 30-min TTL.
      if (req.method === "POST" && url.pathname === "/api/business/reset-password") {
        const body = await readJson(req);
        const { tenantId, token, newPassword } = body;
        if (!tenantId || !token || !newPassword) return sendJson(res, 400, { ok:false, error:'tenantId, token, and newPassword are required' });
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        // Rate-limit token-consume attempts per IP so a leaked-token attacker
        // can't brute-force validity probes (the 256-bit token makes blind
        // brute-force infeasible, but the throttle bounds log noise + bcrypt CPU).
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const rl = checkWidgetRateLimit(`reset:${clientIp}`);
        if (!rl.allowed) return sendJson(res, 429, { ok:false, error:'Too many requests. Please wait a few minutes.' });
        try {
          const result = container.businessOwnerAuthService.consumePasswordResetToken({ tenantId, token, newPassword });
          return sendJson(res, 200, { ok:true, ...result, message:'Your password has been reset. You can now log in.' });
        } catch (err) {
          // Surface only the user-facing token messages; hide any FS-internal error.
          const msg = err.message || '';
          const safe = /Invalid or already-used|expired|at least 6 characters|required/i.test(msg) ? msg : 'Reset failed. The link may be invalid or expired.';
          container.logger?.warn?.('business.reset_password_failed', { tenantId, error: msg });
          return sendJson(res, 400, { ok:false, error: safe });
        }
      }

      // All other /api/business/* endpoints require auth. The public routes
      // (login, register, forgot-password, reset-password) are excluded.
      if (url.pathname.startsWith("/api/business/")
          && url.pathname !== "/api/business/login"
          && url.pathname !== "/api/business/register"
          && url.pathname !== "/api/business/forgot-password"
          && url.pathname !== "/api/business/reset-password") {
        const authPayload = container.businessOwnerAuthService.requireAuth(req);
        if (!authPayload) return sendJson(res, 401, { ok:false, error:'Authentication required. Please log in.' });
        req._businessOwner = authPayload; // attach for downstream handlers
      }

      // Get current owner info
      if (req.method === "GET" && url.pathname === "/api/business/me") {
        return sendJson(res, 200, { ok:true, owner: req._businessOwner });
      }

      // ─── Self-serve account management (authed) ────────────────────────
      // Change own password — requires the current password (re-auth) so a
      // hijacked session can't silently change it. A fresh JWT is returned so
      // the client replaces its stored token (the new password invalidates the
      // old token's effective session control).
      if (req.method === "PUT" && url.pathname === "/api/business/password") {
        const body = await readJson(req);
        const { currentPassword, newPassword } = body;
        try {
          const result = container.businessOwnerAuthService.updatePassword({
            tenantId: req._businessOwner.tenantId,
            ownerId: req._businessOwner.sub,
            currentPassword, newPassword,
          });
          return sendJson(res, 200, { ok:true, message:'Your password has been changed.', token: result.token });
        } catch (err) {
          const msg = err.message || '';
          const safe = /Current password is incorrect|different from the current|at least 6 characters|required|Owner not found/i.test(msg) ? msg : 'Could not change password.';
          return sendJson(res, 400, { ok:false, error: safe });
        }
      }

      // Change own email — requires the current password (re-auth) since email
      // is the recovery channel. A fresh JWT (carrying the new email) is
      // returned so /api/business/me shows the updated email immediately.
      if (req.method === "PUT" && url.pathname === "/api/business/email") {
        const body = await readJson(req);
        const { currentPassword, newEmail } = body;
        try {
          const result = container.businessOwnerAuthService.updateEmail({
            tenantId: req._businessOwner.tenantId,
            ownerId: req._businessOwner.sub,
            currentPassword, newEmail,
          });
          return sendJson(res, 200, { ok:true, message:'Your email has been updated.', email: result.email, token: result.token });
        } catch (err) {
          const msg = err.message || '';
          const safe = /Current password is incorrect|already uses that email|not a valid email|required|Owner not found/i.test(msg) ? msg : 'Could not update email.';
          return sendJson(res, 400, { ok:false, error: safe });
        }
      }

      // ─── Team / co-owner management (authed owner) ─────────────────────
      // List the owners on this tenant (the dashboard's "Team" page).
      if (req.method === "GET" && url.pathname === "/api/business/owners") {
        const owners = container.businessOwnerAuthService.listOwners({ tenantId: req._businessOwner.tenantId });
        return sendJson(res, 200, { ok:true, owners, currentOwnerId: req._businessOwner.sub });
      }

      // Add a co-owner (an authenticated owner invites a teammate).
      if (req.method === "POST" && url.pathname === "/api/business/owners") {
        const body = await readJson(req);
        const { email, password, name } = body;
        if (!email || !password) return sendJson(res, 400, { ok:false, error:'email and password are required' });
        try {
          const owner = container.businessOwnerAuthService.addOwner({
            tenantId: req._businessOwner.tenantId, email, password, name,
          });
          return sendJson(res, 201, { ok:true, owner });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }

      // Remove a co-owner. Refuses to remove the last owner. An owner can
      // remove themselves (a graceful self-exit) but not the last one.
      const bizOwnerDeleteMatch = url.pathname.match(/^\/api\/business\/owners\/([^/]+)$/);
      if (req.method === "DELETE" && bizOwnerDeleteMatch) {
        const targetOwnerId = decodeURIComponent(bizOwnerDeleteMatch[1]);
        try {
          const result = container.businessOwnerAuthService.removeOwner({
            tenantId: req._businessOwner.tenantId, ownerId: targetOwnerId,
          });
          return sendJson(res, 200, { ok:true, ...result, message:`Removed owner ${result.email}.` });
        } catch (err) {
          return sendJson(res, 400, { ok:false, error: err.message });
        }
      }

      // ─── Phase 4 Sprint 1: Billing (authed; uses req._businessOwner.tenantId) ──
      // Subscription status — for the business dashboard's billing widget.
      if (req.method === "GET" && url.pathname === "/api/business/billing/status") {
        const tenantId = req._businessOwner.tenantId;
        return sendJson(res, 200, { ok: true, ...container.planService.getStatus(tenantId) });
      }

      // Create a Stripe Checkout Session — the business upgrades/pays here.
      if (req.method === "POST" && url.pathname === "/api/business/billing/checkout") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        const planId = body.planId || "starter";
        const plan = container.planService && require("../../../packages/billing/src").getPlan(planId);
        if (!plan) return sendJson(res, 400, { ok: false, error: `Unknown plan: ${planId}` });
        const origin = String(req.headers["origin"] || `http://${req.headers["host"]}`);
        const session = await container.stripeClient.createCheckoutSession({
          tenantId,
          planId,
          customerId: container.subscriptionRepository.get(tenantId)?.stripeCustomerId || null,
          successUrl: `${origin}/business/billing?success=true`,
          cancelUrl: `${origin}/business/billing?canceled=true`,
        });
        return sendJson(res, 200, { ok: true, url: session.url, sessionId: session.id });
      }

      // Create a Stripe Billing Portal session — manage card/plan/invoices.
      if (req.method === "POST" && url.pathname === "/api/business/billing/portal") {
        const tenantId = req._businessOwner.tenantId;
        const sub = container.subscriptionRepository.get(tenantId);
        if (!sub || !sub.stripeCustomerId) {
          return sendJson(res, 400, { ok: false, error: "No Stripe customer found. Subscribe first." });
        }
        const origin = String(req.headers["origin"] || `http://${req.headers["host"]}`);
        const session = await container.stripeClient.createPortalSession({
          customerId: sub.stripeCustomerId,
          returnUrl: `${origin}/business/billing`,
        });
        return sendJson(res, 200, { ok: true, url: session.url });
      }

      // ─── Phase 4 Sprint 2: Onboarding wizard (authed; uses req._businessOwner.tenantId) ──
      // Get the current onboarding state for the wizard UI.
      if (req.method === "GET" && url.pathname === "/api/business/onboarding") {
        const tenantId = req._businessOwner.tenantId;
        try {
          return sendJson(res, 200, { ok: true, ...container.onboardingWizardService.getState(tenantId) });
        } catch (err) {
          return sendJson(res, 404, { ok: false, error: err.message });
        }
      }

      // Update business profile (name, contact, hours, location, description).
      if (req.method === "POST" && url.pathname === "/api/business/onboarding/profile") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        try {
          const result = container.onboardingWizardService.updateProfile(tenantId, body);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }

      // Update FAQs.
      if (req.method === "POST" && url.pathname === "/api/business/onboarding/faqs") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        try {
          const result = container.onboardingWizardService.updateFaqs(tenantId, Array.isArray(body.faqs) ? body.faqs : body);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }

      // Update business hours.
      if (req.method === "POST" && url.pathname === "/api/business/onboarding/hours") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        try {
          const result = container.onboardingWizardService.updateHours(tenantId, body.hours);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }

      // Mark onboarding complete.
      if (req.method === "POST" && url.pathname === "/api/business/onboarding/complete") {
        const tenantId = req._businessOwner.tenantId;
        try {
          const result = container.onboardingWizardService.complete(tenantId);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }

      // Today overview — conversations, leads, bookings, revenue today
      if (req.method === "GET" && url.pathname === "/api/business/overview") {
        const tenantId = req._businessOwner.tenantId;
        const profile = container.tenantRepository.getById(tenantId);
        const [leads, notifications, replays] = await Promise.all([
          container.leadService.summary(tenantId).catch(() => ({})),
          container.notificationService?.unreadCount?.(tenantId).catch(() => 0) || 0,
          container.replayService.list({ limit: 1000 }).catch(() => [])
        ]);
        const tenantReplays = replays.filter(r => r.tenantId === tenantId);
        const today = new Date().toISOString().split('T')[0];
        const todayReplays = tenantReplays.filter(r => r.createdAt?.startsWith(today));
        const todayBookings = tenantReplays.filter(r => r.createdAt?.startsWith(today) && r.capabilityId === 'cleaning');
        return sendJson(res, 200, {
          ok:true,
          tenant: { id: tenantId, name: profile.name, domain: profile.domain, capabilities: profile.capabilities },
          stats: {
            conversationsToday: todayReplays.length,
            conversationsTotal: tenantReplays.length,
            leads: leads.total || 0,
            newLeads: leads.new || 0,
            convertedLeads: leads.converted || 0,
            hotLeads: leads.hot || 0,
            unreadNotifications: notifications,
            bookingsToday: todayBookings.length
          }
        });
      }

      // Conversations inbox
      if (req.method === "GET" && url.pathname === "/api/business/conversations") {
        const tenantId = req._businessOwner.tenantId;
        const limit = Number(url.searchParams.get("limit") || 100);
        const replays = await container.replayService.list({ limit });
        const tenantReplays = replays.filter(r => r.tenantId === tenantId);
        return sendJson(res, 200, { ok:true, conversations: tenantReplays });
      }

      // v73.1: Grouped inbox — one row per conversation (grouped by customerId),
      // not one row per message turn. Includes needsHuman flag derived from
      // state.context.handoff.status === 'open' and active takeover flag. This
      // is what the dashboard inbox table renders; the legacy endpoint above is
      // kept for backward compatibility.
      if (req.method === "GET" && url.pathname === "/api/business/conversations/grouped") {
        const tenantId = req._businessOwner.tenantId;
        const limit = Number(url.searchParams.get("limit") || 500);
        const replays = await container.replayService.list({ limit });
        const tenantReplays = replays.filter(r => r.tenantId === tenantId);

        // Group by customerId (the de-facto conversation key).
        const grouped = new Map();
        for (const r of tenantReplays) {
          const key = r.customerId || 'unknown';
          if (!grouped.has(key)) {
            grouped.set(key, {
              customerId: key,
              conversationId: r.conversationId,
              channel: r.channel || 'widget',
              firstSeen: r.createdAt,
              lastSeen: r.createdAt,
              messageCount: 0,
              lastMessage: '',
              lastCapabilityId: null,
              needsHuman: false,
              takeoverActive: false
            });
          }
          const g = grouped.get(key);
          g.messageCount += 1;
          // Keep the latest by createdAt.
          if (!g.lastSeen || (r.createdAt && r.createdAt > g.lastSeen)) {
            g.lastSeen = r.createdAt;
            g.lastMessage = r.message?.text || r.customerText || '';
            g.lastCapabilityId = r.capabilityId || null;
          }
          if (!g.firstSeen || (r.createdAt && r.createdAt < g.firstSeen)) g.firstSeen = r.createdAt;
          // If any turn triggered human_takeover, flag it.
          if (r.capabilityId === 'human_takeover') g.hasTakeoverHistory = true;
        }

        // Enrich with live state (handoff + takeover flags) for each conversation.
        const conversations = [];
        for (const g of grouped.values()) {
          try {
            const convId = g.conversationId || `${tenantId}:widget:${g.customerId}`;
            const state = await container.stateRepository.get(convId);
            if (state) {
              g.needsHuman = state.context?.handoff?.status === 'open';
              g.takeoverActive = Boolean(state.context?.takeover?.active);
              if (g.takeoverActive) {
                g.takeoverOwner = state.context.takeover.ownerName;
                g.takeoverTakenAt = state.context.takeover.takenAt;
              }
              g.handoffId = state.context?.handoff?.id || null;
            }
          } catch { /* state may not exist for very old conversations */ }
          conversations.push(g);
        }

        // Sort: needsHuman first, then most recent.
        conversations.sort((a, b) => {
          if (a.needsHuman !== b.needsHuman) return a.needsHuman ? -1 : 1;
          return (b.lastSeen || '').localeCompare(a.lastSeen || '');
        });

        return sendJson(res, 200, {
          ok: true,
          conversations,
          total: conversations.length,
          needsHumanCount: conversations.filter(c => c.needsHuman).length,
          takeoverCount: conversations.filter(c => c.takeoverActive).length
        });
      }

      // Leads
      if (req.method === "GET" && url.pathname === "/api/business/leads") {
        const tenantId = req._businessOwner.tenantId;
        const [summary, leads] = await Promise.all([
          container.leadService.summary(tenantId),
          container.leadService.list(tenantId, { limit: 200 })
        ]);
        return sendJson(res, 200, { ok:true, summary, leads });
      }

      // Bookings (from cleaning service requests)
      if (req.method === "GET" && url.pathname === "/api/business/bookings") {
        const tenantId = req._businessOwner.tenantId;
        const serviceRequests = container.cleaningRequestRepository?.listByTenant?.(tenantId) || [];
        const bookings = await container.bookingRepository.list(tenantId, null).catch(() => []);
        return sendJson(res, 200, { ok:true, serviceRequests, bookings });
      }

      // Customers (CRM)
      if (req.method === "GET" && url.pathname === "/api/business/customers") {
        const tenantId = req._businessOwner.tenantId;
        // CRM repository doesn't have a listAll method, but we can get customers from leads
        const leads = await container.leadService.list(tenantId, { limit: 500 });
        const customerMap = new Map();
        for (const lead of leads) {
          const id = lead.customerId;
          if (!customerMap.has(id)) {
            customerMap.set(id, {
              id,
              name: lead.contact?.name || 'Unknown',
              phone: lead.contact?.phone || null,
              email: lead.contact?.email || null,
              leadCount: 0,
              status: lead.status,
              score: lead.score,
              lastActivity: lead.updatedAt || lead.createdAt,
              interests: lead.interests || []
            });
          }
          const customer = customerMap.get(id);
          customer.leadCount += 1;
        }
        const customers = [...customerMap.values()].sort((a,b) => new Date(b.lastActivity) - new Date(a.lastActivity));
        return sendJson(res, 200, { ok:true, customers });
      }

      // Notifications
      if (req.method === "GET" && url.pathname === "/api/business/notifications") {
        const tenantId = req._businessOwner.tenantId;
        const notifications = await container.notificationService.listNotifications(tenantId, { limit: 50 });
        const unreadCount = await container.notificationService.unreadCount(tenantId);
        return sendJson(res, 200, { ok:true, notifications, unreadCount });
      }

      // Send a reply as the business owner (takeover mode)
      // v33.0: Owner replies are stored in conversation state and delivered
      // to the customer via polling or on their next message. Nova does NOT
      // process the owner's text through the execution engine — the owner's
      // text goes directly to the customer as-is.
      if (req.method === "POST" && url.pathname === "/api/business/reply") {
        const body = await readJson(req);
        const { customerId, text } = body;
        if (!customerId || !text) return sendJson(res, 400, { ok:false, error:'customerId and text are required' });
        const tenantId = req._businessOwner.tenantId;
        const conversationId = `${tenantId}:widget:${customerId}`;

        // Load conversation state
        let state = await container.stateRepository.get(conversationId);
        if (!state) return sendJson(res, 404, { ok:false, error:'No conversation found for this customer.' });

        // Ensure takeover is active — if not, start it automatically
        if (!state.context?.takeover?.active) {
          state = applyStatePatch(state, {
            context: { ...state.context, takeover: {
              active: true,
              ownerId: req._businessOwner.id,
              ownerName: req._businessOwner.name,
              takenAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
              pendingCustomerMessages: [],
              ownerReplies: []
            }}
          });
        }

        // Store the owner's reply in state for delivery to the customer
        const ownerReplies = state.context.takeover.ownerReplies || [];
        ownerReplies.push({
          text: text.trim(),
          timestamp: new Date().toISOString(),
          ownerId: req._businessOwner.id,
          ownerName: req._businessOwner.name,
          delivered: false // will be set to true when customer sees it
        });

        state = applyStatePatch(state, {
          context: { ...state.context, takeover: { ...state.context.takeover, ownerReplies } }
        });
        await container.stateRepository.save(state);

        // Also record in replay for the business dashboard inbox
        if (container.replayService) {
          await container.replayService.record({
            tenantId, conversationId, customerId,
            message: { text: text.trim(), metadata: { source: 'business_owner', ownerId: req._businessOwner.id } },
            reply: '(owner reply stored for delivery)',
            capabilityId: 'human_takeover',
            intelligence: { selected: { intent: 'owner_reply', confidence: 1 } },
            state: state,
            timingMs: 1
          });
        }

        // v73.1: Push the owner reply to the customer IMMEDIATELY over WebSocket
        // (instead of waiting for the customer's next poll). The /api/chat/poll
        // endpoint remains as a fallback for clients without WS. The customer's
        // widget, on receiving this event, renders the reply and marks it
        // delivered via a follow-up HTTP call so the server's `delivered` flag
        // is consistent across both delivery paths.
        const replyPayload = {
          tenantId, conversationId, customerId,
          text: text.trim(),
          timestamp: ownerReplies[ownerReplies.length - 1].timestamp,
          ownerName: req._businessOwner.name,
          replyId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        };
        try {
          container.realtimeBridge?.broadcastToCustomer(tenantId, customerId, 'owner.reply.v1', replyPayload);
          container.eventBus?.publish('owner.reply.v1', replyPayload, { tenantId, conversationId, capabilityId: 'human_takeover' });
        } catch (e) { container.logger?.warn?.('realtime.owner_reply_push_failed', { error: e.message }); }

        return sendJson(res, 200, { ok:true, message: 'Reply sent to customer.', takeover: state.context.takeover, reply: replyPayload });
      }

      // ─── v33.0: Takeover control endpoints ──────────────────────────
      // Start takeover — Nova stops auto-replying for this conversation
      if (req.method === "POST" && url.pathname === "/api/business/takeover") {
        const body = await readJson(req);
        const { customerId } = body;
        if (!customerId) return sendJson(res, 400, { ok:false, error:'customerId is required' });
        const tenantId = req._businessOwner.tenantId;
        const conversationId = `${tenantId}:widget:${customerId}`;
        let state = await container.stateRepository.get(conversationId);
        if (!state) return sendJson(res, 404, { ok:false, error:'No conversation found for this customer.' });

        state = applyStatePatch(state, {
          context: { ...state.context, takeover: {
            active: true,
            ownerId: req._businessOwner.id,
            ownerName: req._businessOwner.name,
            takenAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            pendingCustomerMessages: state.context?.takeover?.pendingCustomerMessages || [],
            ownerReplies: state.context?.takeover?.ownerReplies || []
          }}
        });
        await container.stateRepository.save(state);
        // v73.1: broadcast takeover start so the dashboard inbox updates live.
        // v73.2: ALSO broadcast to the customer so their widget's persistent
        // socket starts takeover polling immediately — even if they are idle
        // between messages. Previously the customer only learned of takeover
        // on their NEXT message, which meant owner replies sat queued.
        try {
          const takeoverPayload = {
            tenantId, conversationId, customerId, active: true,
            ownerName: req._businessOwner.name, takenAt: state.context.takeover.takenAt
          };
          container.realtimeBridge?.broadcastToTenant(tenantId, 'takeover.changed.v1', takeoverPayload);
          container.realtimeBridge?.broadcastToCustomer(tenantId, customerId, 'takeover.changed.v1', takeoverPayload);
        } catch (e) { container.logger?.warn?.('realtime.takeover_broadcast_failed', { error: e.message }); }
        return sendJson(res, 200, { ok:true, takeover: state.context.takeover });
      }

      // Release takeover — Nova resumes auto-replying
      if (req.method === "POST" && url.pathname === "/api/business/release") {
        const body = await readJson(req);
        const { customerId } = body;
        if (!customerId) return sendJson(res, 400, { ok:false, error:'customerId is required' });
        const tenantId = req._businessOwner.tenantId;
        const conversationId = `${tenantId}:widget:${customerId}`;
        let state = await container.stateRepository.get(conversationId);
        if (!state) return sendJson(res, 404, { ok:false, error:'No conversation found.' });

        state = applyStatePatch(state, {
          context: { ...state.context, takeover: {
            active: false, ownerId: null, ownerName: null,
            takenAt: null, expiresAt: null,
            pendingCustomerMessages: [], ownerReplies: [],
            releasedAt: new Date().toISOString()
          }}
        });
        await container.stateRepository.save(state);
        // v73.1: broadcast takeover release. v73.2: also to the customer so
        // their widget stops polling + closes the takeover socket immediately.
        try {
          const releasePayload = {
            tenantId, conversationId, customerId, active: false, releasedAt: state.context.takeover.releasedAt
          };
          container.realtimeBridge?.broadcastToTenant(tenantId, 'takeover.changed.v1', releasePayload);
          container.realtimeBridge?.broadcastToCustomer(tenantId, customerId, 'takeover.changed.v1', releasePayload);
        } catch (e) { container.logger?.warn?.('realtime.release_broadcast_failed', { error: e.message }); }
        return sendJson(res, 200, { ok:true, message: 'Takeover released. Nova will resume auto-replying.' });
      }

      // Get full conversation detail (for business dashboard inbox)
      const businessConversationMatch = url.pathname.match(/^\/api\/business\/conversation\/([^/]+)$/);
      if (req.method === "GET" && businessConversationMatch) {
        const customerId = decodeURIComponent(businessConversationMatch[1]);
        const tenantId = req._businessOwner.tenantId;
        const conversationId = `${tenantId}:widget:${customerId}`;
        const state = await container.stateRepository.get(conversationId);
        if (!state) return sendJson(res, 404, { ok:false, error:'No conversation found.' });

        // Get replays for this conversation
        const replays = await container.replayService.list({ conversationId, limit: 100 });
        const takeover = state.context?.takeover || { active: false };

        // Get pending customer messages (if takeover active)
        const pendingMessages = takeover.pendingCustomerMessages || [];

        return sendJson(res, 200, {
          ok:true,
          customerId,
          conversationId,
          takeover,
          pendingMessages,
          messages: replays.map(r => ({
            text: r.message?.text || '',
            reply: r.reply || '',
            capabilityId: r.capabilityId,
            createdAt: r.createdAt,
            isOwner: r.message?.metadata?.source === 'business_owner'
          }))
        });
      }
      // ─── End v33.0 Takeover endpoints ────────────────────────────────

      // ─── v34.2: Voice Cloning — voice sample upload/serve/delete ───────
      // POST /api/business/voice/upload — owner uploads a recorded voice clip
      //   body: { contentBase64, mimeType, filename? }
      //   Saves to tenants/{tenantId}/voice-samples/sample.{ext}
      //   Returns voiceSampleUrl that widget will fetch.
      if (req.method === "POST" && url.pathname === "/api/business/voice/upload") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        const { contentBase64, mimeType, filename } = body;
        if (!contentBase64) return sendJson(res, 400, { ok:false, error:'contentBase64 is required' });
        if (!mimeType) return sendJson(res, 400, { ok:false, error:'mimeType is required (audio/webm, audio/mp3, audio/wav, audio/m4a, audio/ogg)' });

        const extMap = {
          'audio/webm': '.webm',
          'audio/mp3': '.mp3',
          'audio/mpeg': '.mp3',
          'audio/wav': '.wav',
          'audio/x-wav': '.wav',
          'audio/m4a': '.m4a',
          'audio/x-m4a': '.m4a',
          'audio/mp4': '.m4a',
          'audio/ogg': '.ogg'
        };
        const ext = extMap[mimeType.toLowerCase()];
        if (!ext) return sendJson(res, 400, { ok:false, error:`Unsupported audio format: ${mimeType}. Supported: webm, mp3, wav, m4a, ogg` });

        // Cap base64 payload at 5MB (≈6.7MB base64) to protect the server.
        if (contentBase64.length > 7_000_000) {
          return sendJson(res, 413, { ok:false, error:'Audio clip is too large. Please keep it under 5 MB.' });
        }

        const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
        fs.mkdirSync(samplesDir, { recursive: true });
        // Clear any previous samples (only one active sample at a time)
        for (const oldExt of ['.webm', '.mp3', '.wav', '.m4a', '.ogg']) {
          const oldP = path.join(samplesDir, 'sample' + oldExt);
          if (fs.existsSync(oldP)) {
            try { fs.unlinkSync(oldP); } catch {}
          }
        }
        // v36.0: invalidate file existence cache so next widget config read picks up the new file
        fileExistenceCache.invalidatePrefix(samplesDir);
        const samplePath = path.join(samplesDir, 'sample' + ext);
        try {
          fs.writeFileSync(samplePath, Buffer.from(contentBase64, 'base64'));
          fileExistenceCache.invalidate(samplePath);  // invalidate so it's re-checked
        } catch (err) {
          return sendJson(res, 500, { ok:false, error: 'Failed to save audio: ' + err.message });
        }

        // Write metadata sidecar (duration, recordedAt, mimeType, size)
        const meta = {
          tenantId,
          mimeType,
          filename: filename || ('sample' + ext),
          size: fs.statSync(samplePath).size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: req._businessOwner.email
        };
        fs.writeFileSync(path.join(samplesDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

        const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
        container.logger?.info?.('voice_sample.uploaded', { tenantId, mimeType, size: meta.size });

        return sendJson(res, 200, {
          ok:true,
          tenantId,
          voiceSampleUrl: `${novaOrigin}/api/voice/sample/${encodeURIComponent(tenantId)}`,
          meta,
          message: 'Voice sample uploaded. The kiosk and widget will use this audio for reply playback.'
        });
      }

      // GET /api/business/voice/sample — fetch current voice sample metadata
      if (req.method === "GET" && url.pathname === "/api/business/voice/sample") {
        const tenantId = req._businessOwner.tenantId;
        const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
        const metaPath = path.join(samplesDir, 'meta.json');
        if (!fs.existsSync(metaPath)) {
          return sendJson(res, 200, { ok:true, tenantId, hasSample: false, meta: null });
        }
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          // Also fetch voice profile (TTS settings)
          const vpPath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
          let voiceProfile = null;
          if (fs.existsSync(vpPath)) {
            try { voiceProfile = JSON.parse(fs.readFileSync(vpPath, 'utf8')); } catch {}
          }
          const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
          return sendJson(res, 200, {
            ok:true,
            tenantId,
            hasSample: true,
            meta,
            voiceSampleUrl: `${novaOrigin}/api/voice/sample/${encodeURIComponent(tenantId)}`,
            voiceProfile
          });
        } catch (err) {
          return sendJson(res, 500, { ok:false, error: 'Failed to read sample metadata: ' + err.message });
        }
      }

      // PUT /api/business/voice/profile — update TTS voice profile (rate/pitch/volume/name)
      if (req.method === "PUT" && url.pathname === "/api/business/voice/profile") {
        const tenantId = req._businessOwner.tenantId;
        const body = await readJson(req);
        const profilePath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
        const profile = {
          enabled: body.enabled !== false,
          voiceName: body.voiceName || null,
          rate: body.rate ?? 0.95,
          pitch: body.pitch ?? 1.0,
          volume: body.volume ?? 0.85,
          customVoiceURI: body.customVoiceURI || null,
          savedAt: new Date().toISOString()
        };
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
        fileExistenceCache.invalidate(profilePath);  // v36.0: invalidate cache
        return sendJson(res, 200, { ok:true, tenantId, profile, message: 'Voice profile updated.' });
      }

      // DELETE /api/business/voice/sample — remove uploaded voice sample
      if (req.method === "DELETE" && url.pathname === "/api/business/voice/sample") {
        const tenantId = req._businessOwner.tenantId;
        const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
        if (fs.existsSync(samplesDir)) {
          for (const ext of ['.webm', '.mp3', '.wav', '.m4a', '.ogg']) {
            const p = path.join(samplesDir, 'sample' + ext);
            if (fs.existsSync(p)) {
              try { fs.unlinkSync(p); } catch {}
            }
          }
          const metaPath = path.join(samplesDir, 'meta.json');
          if (fs.existsSync(metaPath)) {
            try { fs.unlinkSync(metaPath); } catch {}
          }
        }
        fileExistenceCache.invalidatePrefix(samplesDir);  // v36.0: invalidate cache
        return sendJson(res, 200, { ok:true, message: 'Voice sample removed. Widget will fall back to browser TTS.' });
      }
      // ─── End v34.2 Voice Cloning (authenticated) ───────────────────────

      // ─── Public voice sample serve — NO auth, used by kiosk/widget ─────
      // GET /api/voice/sample/{tenantId} → audio stream (webm/mp3/wav/m4a/ogg)
      const publicVoiceSampleMatch = url.pathname.match(/^\/api\/voice\/sample\/([^/]+)$/);
      if (req.method === "GET" && publicVoiceSampleMatch) {
        const tenantId = decodeURIComponent(publicVoiceSampleMatch[1]);
        try { container.tenantRepository.getById(tenantId); }
        catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
        const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
        if (!fs.existsSync(samplesDir)) return sendText(res, 404, 'No voice sample uploaded');

        const mimeMap = {
          '.webm': 'audio/webm',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.m4a': 'audio/mp4',
          '.ogg': 'audio/ogg'
        };
        for (const ext of ['.webm', '.mp3', '.wav', '.m4a', '.ogg']) {
          const p = path.join(samplesDir, 'sample' + ext);
          if (fs.existsSync(p)) {
            const data = fs.readFileSync(p);
            res.writeHead(200, {
              'Content-Type': mimeMap[ext],
              'Cache-Control': 'public, max-age=300',
              'Content-Length': data.length,
              'Accept-Ranges': 'bytes'
            });
            res.end(data);
            return;
          }
        }
        return sendText(res, 404, 'No voice sample uploaded');
      }
      // ─── End v34.2 Voice Sample serve ─────────────────────────────────

      // ─── v33.0: Customer polling endpoint ────────────────────────────
      // When takeover is active, the widget polls this endpoint to check
      // for new owner replies. Returns any undelivered owner replies.
      if (req.method === "GET" && url.pathname === "/api/chat/poll") {
        const tenantId = String(url.searchParams.get("tenantId") || container.config.defaultTenantId);
        const customerId = String(url.searchParams.get("customerId") || '');
        if (!customerId) return sendJson(res, 400, { ok:false, error:'customerId is required' });
        const conversationId = `${tenantId}:widget:${customerId}`;
        const state = await container.stateRepository.get(conversationId);
        if (!state) return sendJson(res, 200, { ok:true, takeover: { active: false }, replies: [] });

        const takeover = state.context?.takeover || { active: false };
        if (!takeover.active) return sendJson(res, 200, { ok:true, takeover: { active: false }, replies: [] });

        // Get undelivered owner replies
        const ownerReplies = takeover.ownerReplies || [];
        const undelivered = ownerReplies.filter(r => !r.delivered);

        if (undelivered.length > 0) {
          // Mark as delivered
          const updatedReplies = ownerReplies.map(r => ({ ...r, delivered: true }));
          const updatedState = applyStatePatch(state, {
            context: { ...state.context, takeover: { ...takeover, ownerReplies: updatedReplies } }
          });
          await container.stateRepository.save(updatedState);
        }

        return sendJson(res, 200, {
          ok:true,
          takeover: { active: true, ownerName: takeover.ownerName },
          replies: undelivered.map(r => ({ text: r.text, timestamp: r.timestamp, ownerName: r.ownerName }))
        });
      }

      // v73.1: Mark owner replies as delivered (called by the customer widget
      // when it receives a reply over WebSocket). Prevents the poll fallback
      // from re-delivering the same reply to a client that already saw it via WS.
      if (req.method === "POST" && url.pathname === "/api/chat/reply/delivered") {
        const body = await readJson(req);
        const { tenantId, customerId, replyId, timestamp } = body;
        if (!customerId) return sendJson(res, 400, { ok:false, error:'customerId is required' });
        const convId = `${tenantId || container.config.defaultTenantId}:widget:${customerId}`;
        const state = await container.stateRepository.get(convId);
        if (!state) return sendJson(res, 200, { ok:true }); // no state = nothing to mark
        const takeover = state.context?.takeover || {};
        const ownerReplies = takeover.ownerReplies || [];
        // Mark any undelivered reply matching the timestamp as delivered.
        const updatedReplies = ownerReplies.map(r => {
          if (r.delivered) return r;
          if (timestamp && r.timestamp === timestamp) return { ...r, delivered: true };
          return r;
        });
        if (updatedReplies.some((r, i) => r.delivered !== ownerReplies[i]?.delivered)) {
          const updatedState = applyStatePatch(state, {
            context: { ...state.context, takeover: { ...takeover, ownerReplies: updatedReplies } }
          });
          await container.stateRepository.save(updatedState);
        }
        return sendJson(res, 200, { ok:true });
      }
      // ─── End v33.0 Customer polling ──────────────────────────────────

      // ─── End v32.0 Business Manager Dashboard endpoints ───────────────────

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      container.logger.error("http.request_failed", { error: error.message });
      return sendJson(res, error.statusCode || 500, { ok: false, error: error.message, ...(error.code?{code:error.code}:{}), ...(error.details?{details:error.details}:{}) });
    }
    }); // end Logger.withCorrelationId
  });
  // v36.0: Request timeout — kill requests that hang for more than 30s.
  // Prevents slow-client memory leaks and stuck connections.
  server.requestTimeout = 30_000;
  server.headersTimeout = 32_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 30_000;

  server.listen(container.config.port, () => container.logger.info("api.started", { port: container.config.port }));

  // v73.1: Attach the realtime WebSocket bridge to the SAME http.Server.
  // Render exposes only one port, so WS upgrades must share it. The bridge
  // subscribes to EventBus '*' and pushes filtered events to dashboard/widget
  // clients. businessOwnerAuthService lets it verify JWTs on connect.
  const realtimeBridge = new RealtimeBridge({
    server,
    eventBus: container.eventBus,
    logger: container.logger,
    businessOwnerAuthService: container.businessOwnerAuthService
  });
  realtimeBridge.startHeartbeat(30000);
  container.realtimeBridge = realtimeBridge;
  container.logger.info('realtime.started', { path: '/ws' });

  // v36.0: Graceful shutdown — stop accepting new connections, finish in-flight
  // requests, then exit. Render sends SIGTERM 30s before killing the process.
  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info('api.shutting_down', { signal });
    // v73.1: close the realtime bridge first so WS clients get a clean 1001.
    try { container.realtimeBridge?.close(); } catch (e) { container.logger.warn('realtime.close_failed', { error: e.message }); }
    server.close(() => {
      container.logger.info('api.closed', {});
      process.exit(0);
    });
    // Force exit after 10s if connections don't close
    setTimeout(() => {
      container.logger.warn('api.force_exit', {});
      process.exit(1);
    }, 10_000).unref();
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // v33.3: Self-ping keep-alive — prevents Render free tier from sleeping.
  // Render sleeps after 15 min of no EXTERNAL traffic. Self-pinging localhost
  // doesn't count as external traffic, so we also need an external cron job.
  //
  // TWO-LAYER KEEP-ALIVE:
  // 1. Self-ping (below) — pings /health every 10 min (helps on some platforms)
  // 2. External cron — user sets up a free cron-job.org task to ping
  //    https://nova-saas-test.onrender.com/health every 10 minutes
  //    This is the reliable method for Render free tier.
  //
  // To set up external cron:
  //   1. Go to https://cron-job.org (free)
  //   2. Create a job: URL = https://your-nova.onrender.com/health
  //   3. Schedule: every 10 minutes
  //   4. That's it — Render will never sleep
  //
  // Can be disabled by setting NOVA_KEEP_ALIVE=false env var.
  if (process.env.NOVA_KEEP_ALIVE !== 'false') {
    const keepAliveUrl = `http://localhost:${container.config.port}/health`;
    const keepAlive = () => {
      const req = http.get(keepAliveUrl, (res) => {
        container.logger?.info?.('keep_alive.ping', { status: res.statusCode });
      });
      req.on('error', () => {});
      req.setTimeout(5000, () => req.destroy());
    };
    setInterval(keepAlive, 10 * 60 * 1000);
    container.logger.info('keep_alive.started', { interval: '10 minutes', note: 'Also set up external cron at cron-job.org for Render free tier' });
  }
  const close=async()=>new Promise((resolve,reject)=>server.close(async(error)=>{
    if(error)return reject(error);
    try{await container.storage?.close?.();resolve();}catch(e){reject(e);}
  }));
  return { server, container, close };
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const raw = await readRaw(req);
  try { return raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
  catch { throw new ValidationError("Invalid JSON body."); }
}
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendText(res, statusCode, text) { res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" }); res.end(String(text)); }
function sendHtml(res, statusCode, html) { res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" }); res.end(String(html)); }
function escHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function authorizeDeveloperRequest(req) {
  const expected = String(process.env.NOVA_DEV_TOKEN || "");
  // Local development remains zero-config. Public production deployments fail
  // closed so replay, CRM, inventory, knowledge, and Control Plane data cannot
  // become writable merely because a secret was omitted.
  if (!expected) return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
  const supplied = String(req.headers["x-nova-dev-token"] || "");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}
function controlPlaneActor(req, tenantId) {
  const scopedTenant=String(req.headers['x-nova-tenant-id']||'').trim();
  if(process.env.NOVA_DEV_TOKEN&&!scopedTenant)throw new ValidationError('x-nova-tenant-id is required for control-plane requests.');
  if(scopedTenant&&scopedTenant!==tenantId)throw new ForbiddenError('The authenticated tenant scope does not match the requested tenant.');
  return {
    id:String(req.headers['x-nova-actor-id']||process.env.NOVA_DEV_ACTOR_ID||'local-developer').trim(),
    role:String(req.headers['x-nova-role']||process.env.NOVA_DEV_ROLE||'owner').trim().toLowerCase(),
    tenantId:scopedTenant||tenantId
  };
}
function requestCorrelationId(req){return String(req.headers['x-request-id']||req.headers['x-correlation-id']||'').trim()||null;}

// ─── v28.0 Widget rate limiter ──────────────────────────────────────────────
// In-memory sliding-window rate limiter. No Redis required.
// Limits: 30 messages per 60 seconds per (IP + tenantId) bucket.
// Buckets older than 5 minutes are garbage-collected on every call.
// On a multi-instance deployment without Redis this limiter is per-process,
// so each Nova instance allows 30/min independently (e.g., 3 pods × 30 = 90/min).
// When Redis is configured in v26 hardening, swap this for a Redis SETEX-based
// limiter for global counting across instances.
const WIDGET_RATE_LIMIT = { windowMs: 60_000, max: 30, gcMs: 5 * 60_000 };
const _widgetBuckets = new Map();
let _widgetLastGc = Date.now();
function checkWidgetRateLimit(key) {
  const now = Date.now();
  if (now - _widgetLastGc > WIDGET_RATE_LIMIT.gcMs) {
    for (const [k, entry] of _widgetBuckets) if (now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) _widgetBuckets.delete(k);
    _widgetLastGc = now;
  }
  let entry = _widgetBuckets.get(key);
  if (!entry || now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) {
    entry = { windowStart: now, count: 0 };
    _widgetBuckets.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, WIDGET_RATE_LIMIT.max - entry.count);
  const resetAt = entry.windowStart + WIDGET_RATE_LIMIT.windowMs;
  return {
    allowed: entry.count <= WIDGET_RATE_LIMIT.max,
    remaining,
    resetAt,
    retryAfterSeconds: entry.count > WIDGET_RATE_LIMIT.max ? Math.ceil((resetAt - now) / 1000) : 0
  };
}
function serveDeveloperAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../developer-console/public");
  const relative = ["/developer","/developer/","/developers","/developers/"].includes(pathname) ? "index.html" : pathname.replace(/^\/developers?\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function servePublicChatAsset(res,pathname){
  const root=path.resolve(__dirname,'../../public-chat/public');
  const relative=pathname==='/assistant'||pathname==='/assistant/'||pathname==='/chat'||pathname==='/chat/'
    ? 'index.html'
    : pathname.replace(/^\/(?:assistant|chat)\//,'');
  const file=path.resolve(root,relative);
  const relation=path.relative(root,file);
  const outsideRoot=relation.startsWith('..')||path.isAbsolute(relation);
  if(outsideRoot||!fs.existsSync(file)||fs.statSync(file).isDirectory())return sendText(res,404,'Not found');
  const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:"});
  res.end(fs.readFileSync(file));
}
function serveAdminAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../admin-dashboard/public");
  const relative = ["/admin","/admin/"].includes(pathname) ? "index.html" : pathname.replace(/^\/admin\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
// v10.3: Serves the Public Product Assistant admin dashboard (leads/demo/unanswered).
function servePublicAdminAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../public-admin/public");
  const relative = ["/public-admin","/public-admin/"].includes(pathname) ? "index.html" : pathname.replace(/^\/public-admin\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
// v32.0: Serves the Business Manager Dashboard (separate from admin dashboard)
function serveBusinessAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../business-dashboard/public");
  const relative = ["/business","/business/"].includes(pathname) ? "index.html" : pathname.replace(/^\/business\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function serveWidgetAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../widget/public");
  const relativeMap = {
    "/widget.js": "widget.js",
    "/widget-config.js": "widget-config.js",
    "/avatars.js": "avatars.js",
    "/widget-test": "index.html"
  };
  const relative = relativeMap[pathname];
  if (!relative) return sendText(res, 404, "Not found");
  const file = path.resolve(root, relative);
  if (!fs.existsSync(file)) return sendText(res, 404, "Widget asset not found: " + relative);
  const ext = path.extname(file);
  const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  // widget.js is served cross-origin; CSP ensures the script cannot be
  // hijacked to inject other origins' content. Cache-Control no-store so
  // tenants get instant config changes when they update their profile.
  if (pathname === "/widget-test") {
    res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" });
  } else {
    // Served with CORS Access-Control-Allow-Origin: * so any website can
    // load the script. The script is self-contained and only talks to
    // /api/widget/config and /api/chat (which have their own CORS).
    res.writeHead(200, {
      "Content-Type":types[ext] || "application/octet-stream",
      "Cache-Control":"no-store, must-revalidate",
      "Access-Control-Allow-Origin":"*",
      "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":"default-src 'none'; script-src 'self'"
    });
  }
  res.end(fs.readFileSync(file));
}
function listTenants(tenantsDir, tenantRepository = null) {
  if (!fs.existsSync(tenantsDir)) return [];
  return fs.readdirSync(tenantsDir).sort().flatMap((id) => {
    // v30.1: skip internal folders (_templates, _deleted)
    if (id.startsWith('_')) return [];
    const profilePath=path.join(tenantsDir,id,"profile.json");
    if(!fs.existsSync(profilePath)) return [];
    try { const p=tenantRepository?.getById(id)||JSON.parse(fs.readFileSync(profilePath,"utf8")); return [{id:p.id,name:p.name,domain:p.domain||"generic",capabilities:p.capabilities||[]}]; }
    catch { return []; }
  });
}
function normalizeOnboardingSpec(body) {
  const offerings=(Array.isArray(body.offerings)?body.offerings:[]).map((x)=>({
    name:String(x.name||"").trim(), type:String(x.type||"service").trim(), category:String(x.category||"general").trim(),
    description:String(x.description||"").trim(), aliases:Array.isArray(x.aliases)?x.aliases.map(String).map(v=>v.trim()).filter(Boolean):String(x.aliases||"").split(",").map(v=>v.trim()).filter(Boolean),
    ...(x.price!==""&&x.price!=null?{price:Number(x.price)}:{}), ...(x.durationMinutes?{durationMinutes:Number(x.durationMinutes)}:{}),
    bookable:x.type==='product'?false:x.bookable!==false, orderable:x.type==='product'?x.orderable!==false:false,
    inStock:x.inStock!==false, ...(x.inventory==null||x.inventory===''?{}:{inventory:Number(x.inventory)}), ...(x.unit?{unit:String(x.unit).trim()}:{}),
    sizes:Array.isArray(x.sizes)?x.sizes:String(x.sizes||"").split(",").map(v=>v.trim()).filter(Boolean),
    colors:Array.isArray(x.colors)?x.colors:String(x.colors||"").split(",").map(v=>v.trim()).filter(Boolean),
    tags:Array.isArray(x.tags)?x.tags:String(x.tags||"").split(",").map(v=>v.trim()).filter(Boolean)
  })).filter(x=>x.name);
  return {
    id:String(body.id||"").trim()||undefined,name:String(body.name||"").trim(),domain:String(body.domain||"generic").trim()||"generic",
    assistantName:String(body.assistantName||"").trim()||undefined,description:String(body.description||"").trim(),hours:String(body.hours||"").trim(),
    location:String(body.location||"").trim(),contact:String(body.contact||"").trim(),currency:String(body.currency||"PKR").trim()||"PKR",
    offerings,faqs:Array.isArray(body.faqs)?body.faqs:[],businessFacts:body.businessFacts&&typeof body.businessFacts==='object'?body.businessFacts:{},
    bookingFields:Array.isArray(body.bookingFields)&&body.bookingFields.length?body.bookingFields:undefined,bookingMode:String(body.bookingMode||"appointment"),overwrite:Boolean(body.overwrite)
  };
}
async function runDataset(container, datasetName) {
  if (!/^[a-z0-9/_-]+\.json$/i.test(datasetName)) return { ok:false, error:"Invalid dataset path" };
  const root = path.resolve(__dirname, "../../../tests/datasets"); const file = path.resolve(root, datasetName);
  if (!file.startsWith(root) || !fs.existsSync(file)) return { ok:false, error:"Dataset not found" };
  const dataset = JSON.parse(fs.readFileSync(file, "utf8")); const failures=[]; let passed=0; const started=Date.now();
  for (let index=0; index<dataset.cases.length; index+=1) {
    const test=dataset.cases[index]; const customerId=`dataset-${Date.now()}-${index}`; let last=null; let turnFailed=false;
    for (const turn of test.turns) {
      last=await container.executionEngine.process({tenantId:dataset.tenantId,channel:"dataset",customerId,text:turn.text,messageId:null,metadata:{dataset:datasetName}});
      const expected=turn.expect || {}; const actualIntent=last.intelligence?.selected?.intent || null;
      const problems=[];
      if(expected.capabilityId && last.capabilityId!==expected.capabilityId) problems.push(`capability ${last.capabilityId} != ${expected.capabilityId}`);
      if(expected.intent && actualIntent!==expected.intent) problems.push(`intent ${actualIntent} != ${expected.intent}`);
      if(expected.replyContains && !String(last.reply).toLowerCase().includes(String(expected.replyContains).toLowerCase())) problems.push(`reply missing ${expected.replyContains}`);
      for(const [key,value] of Object.entries(expected.entities||{})) if(JSON.stringify(last.intelligence?.entities?.[key])!==JSON.stringify(value)) problems.push(`entity ${key} mismatch`);
      if(problems.length){failures.push({case:test.name,turn:turn.text,problems,actual:{capabilityId:last.capabilityId,intent:actualIntent,entities:last.intelligence?.entities,reply:last.reply}});turnFailed=true;break;}
    }
    if(!turnFailed) passed+=1;
  }
  return { ok:failures.length===0, dataset:datasetName, total:dataset.cases.length, passed, failed:failures.length, durationMs:Date.now()-started, failures:failures.slice(0,50) };
}
if (require.main === module) startServer().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { startServer, readRaw, readJson, authorizeDeveloperRequest, servePublicChatAsset };
