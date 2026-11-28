/**
 * v74.2 — Site router (Phase 4, final, of the Express migration), mounted
 * at the root: the static dashboards (developer console, public chat page,
 * admin, public-admin, business manager), the widget SDK assets, kiosk
 * PWA files, /kiosk/{tenantId}, /health, /metrics and /api/health.
 *
 * The serve*Asset helpers moved here from server.js (paths one directory
 * deeper). servePublicChatAsset is re-exported by server.js for backward
 * compatibility with older callers.
 *
 * Prefix routes use anchored regexes that reproduce the exact v73.x
 * matching semantics — e.g. /admin and /admin/* but NOT /adminfoo —
 * including the historical quirk that /kiosk<anything> serves the default
 * tenant's kiosk page (startsWith("/kiosk") + missing segment → default).
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const packageJson = require("../../../../package.json");
const { sendJson, sendText, sendHtml, escHtml } = require("../http-helpers");

// ─── Static asset helpers (moved from server.js in v74.2) ──────────────────
function serveDeveloperAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../../developer-console/public");
  const relative = ["/developer","/developer/","/developers","/developers/"].includes(pathname) ? "index.html" : pathname.replace(/^\/developers?\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function servePublicChatAsset(res,pathname){
  const root=path.resolve(__dirname,'../../../public-chat/public');
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
  const root = path.resolve(__dirname, "../../../admin-dashboard/public");
  const relative = ["/admin","/admin/"].includes(pathname) ? "index.html" : pathname.replace(/^\/admin\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
// v10.3: Serves the Public Product Assistant admin dashboard (leads/demo/unanswered).
function servePublicAdminAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../../public-admin/public");
  const relative = ["/public-admin","/public-admin/"].includes(pathname) ? "index.html" : pathname.replace(/^\/public-admin\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
// v32.0: Serves the Business Manager Dashboard (separate from admin dashboard)
function serveBusinessAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../../business-dashboard/public");
  const relative = ["/business","/business/"].includes(pathname) ? "index.html" : pathname.replace(/^\/business\//, "");
  const file = path.resolve(root, relative);
  const outsideRoot = path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file));
  if (outsideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, "Not found");
  const ext = path.extname(file); const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type":types[ext] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(fs.readFileSync(file));
}
function serveWidgetAsset(res, pathname) {
  const root = path.resolve(__dirname, "../../../widget/public");
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

function createSiteRouter({ container }) {
  const router = express.Router();

  // Developer Console is intentionally served by the same process during
  // development so the Playground exercises the exact production engine.
  router.get(/^\/developers?(\/|$)/, (req, res) => serveDeveloperAsset(res, req.path));
  router.get(/^\/(assistant|chat)(\/|$)/, (req, res) => servePublicChatAsset(res, req.path));
  // v27.0 Admin Dashboard — operator console for tenants, conversations,
  // leads, ML insights, capabilities, and test runs.
  router.get(/^\/admin(\/|$)/, (req, res) => serveAdminAsset(res, req.path));
  // v10.3 — Public Product Assistant admin dashboard. HTML is served to
  // anyone; the /api/public-admin/* endpoints it calls are dev-token gated.
  router.get(/^\/public-admin(\/|$)/, (req, res) => servePublicAdminAsset(res, req.path));
  // v34.1: PWA manifest and service worker served from admin dashboard
  router.get(['/manifest.json', '/sw.js', '/favicon.ico'], (req, res) => serveAdminAsset(res, "/admin" + req.path));
  // v28.0 Website Widget SDK — drop-in embeddable script.
  // Customers include <script src="https://your-nova.com/widget.js" data-tenant="cleaning-demo"></script>
  // and the widget auto-mounts on any page. Served with strict CSP + Cache-Control.
  router.get(['/widget.js', '/widget-config.js', '/avatars.js', '/widget-test'], (req, res) => serveWidgetAsset(res, req.path));
  // v35.0: PWA assets for kiosk (manifest + service worker)
  router.get('/kiosk-manifest.json', (req, res) => {
    const p = path.resolve(__dirname, "../../../widget/public/kiosk-manifest.json");
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p);
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' });
      res.end(data);
      return;
    }
    return sendText(res, 404, 'Manifest not found');
  });
  router.get('/kiosk-sw.js', (req, res) => {
    const p = path.resolve(__dirname, "../../../widget/public/kiosk-sw.js");
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/kiosk/' });
      res.end(data);
      return;
    }
    return sendText(res, 404, 'Service worker not found');
  });
  // v32.0 Business Manager Dashboard — separate dashboard for business owners.
  // Owners log in with email+password and see ONLY their tenant's data.
  router.get(/^\/business(\/|$)/, (req, res) => serveBusinessAsset(res, req.path));

  // ─── /health — full capability + dependency readiness (LB probe) ────────
  router.get('/health', async (req, res) => {
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
      const healthCheckFile = path.join(container.config.operationalDataDir, '.health-check');
      fs.writeFileSync(healthCheckFile, String(Date.now()));
      fs.unlinkSync(healthCheckFile);
      checks.dependencies.filesystem = { ok: true, dir: container.config.operationalDataDir };
    } catch (err) {
      checks.dependencies.filesystem = { ok: false, error: err.message };
    }
    const allOk = (!checks.storage.postgres || checks.storage.postgres.ok) && (!checks.storage.redis || checks.storage.redis.ok) && checks.dependencies.filesystem.ok;
    return sendJson(res, allOk ? 200 : 503, { ok: allOk, ...checks });
  });

  // ─── Phase 3 Sprint 2: Dashboard metrics endpoint ───────────────────
  // Returns per-tenant + per-capability fallback %, p95 latency, and LLM
  // share so production health is observable. Read-only; safe to poll.
  router.get('/metrics', (req, res) => {
    if (!container.metricsAggregator) {
      return sendJson(res, 503, { ok: false, error: "metrics aggregator not configured" });
    }
    return sendJson(res, 200, { ok: true, ...container.metricsAggregator.snapshot() });
  });

  // ─── Roadmap #9: Health endpoints (public, for load balancers) ────────
  // GET /api/health        → cheap liveness (200 if the process is up)
  // GET /api/health?deep=1 → readiness (checks tenants dir, billing, calendar)
  // These are intentionally unauthenticated so a load balancer can probe
  // them without credentials; they expose no tenant data.
  router.get('/api/health', async (req, res) => {
    if (!container.healthService) return sendJson(res, 200, { status: "ok" });
    const deep = req.query.deep === "1";
    // readiness() is async (v73.0: probes Redis/Postgres connectivity).
    const result = deep ? await container.healthService.readiness() : container.healthService.liveness();
    // Unhealthy readiness → 503 so the LB pulls the instance out of rotation.
    const status = result.status === "unhealthy" ? 503 : 200;
    return sendJson(res, status, result);
  });

  // ─── v34.2: Kiosk mode route ──────────────────────────────────────────
  // /kiosk/{tenantId} serves a single full-screen modern chat interface.
  // Mobile-first, glassmorphism, no popup widget — direct conversation.
  // Skips pre-chat form (anonymous kiosk session).
  // (StartsWith match preserved: /kiosk or /kiosk/<tenant> — a missing
  // segment falls back to the default tenant, as in v73.x.)
  router.get(/^\/kiosk/, (req, res) => {
    const pathname = req.path;
    // Extract tenantId from path: /kiosk/{tenantId} or /kiosk/{tenantId}/{anything}
    const kioskPathParts = pathname.split('/').filter(Boolean);
    const kioskTenantId = kioskPathParts[1] || container.config.defaultTenantId;
    // Validate tenant exists — show a friendly error page if not
    try { container.tenantRepository.getById(kioskTenantId); }
    catch {
      return sendHtml(res, 404, `<!doctype html><html><body style="font-family:Inter,sans-serif;background:#0a0e1a;color:#e8edf7;text-align:center;padding:60px"><h1 style="color:#ff6b6b">Business not found</h1><p style="color:#91a0bd;margin-top:12px">We couldn't find the business <code style="background:#172139;padding:2px 8px;border-radius:4px">${escHtml(kioskTenantId)}</code>.</p><p style="margin-top:20px"><a href="/" style="color:#4773e5">Go to Nova Assistant</a></p></body></html>`);
    }
    const kioskHtmlPath = path.resolve(__dirname, "../../../widget/public/kiosk.html");
    if (fs.existsSync(kioskHtmlPath)) {
      const html = fs.readFileSync(kioskHtmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    return sendText(res, 404, 'Kiosk page not found');
  });

  return router;
}

module.exports = {
  createSiteRouter,
  serveDeveloperAsset, servePublicChatAsset, serveAdminAsset,
  servePublicAdminAsset, serveBusinessAsset, serveWidgetAsset,
};
