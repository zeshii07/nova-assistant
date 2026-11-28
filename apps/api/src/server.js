/**
 * Nova API — composition root (v74.2, Express migration complete).
 *
 * History: through v73.x this file was a 3,813-line raw http.createServer
 * with 170 routes in one if-chain. v74.0–v74.2 migrated them, phase by
 * phase, into Express routers under routes/:
 *
 *   v74.0 phase 1 — Express front door: helmet, cors, api rate limit,
 *                   correlation ID, central error handler + /api/business
 *   v74.1 phase 2 — /api/admin, /api/public, /api/public-admin
 *   v74.2 phase 3 — /api/dev, /api/crm, /api/chat (+widget/poll), the
 *                   webhooks (raw-body), and the static site/kiosk/QR
 *                   assets; the legacy if-chain was retired entirely
 *
 * What is LEFT here is composition only: build the container, assemble
 * middleware + routers, start the http server with the WebSocket realtime
 * bridge on the same port, and own the process lifecycle (graceful
 * shutdown, self-ping keep-alive). Every route lives in routes/.
 */
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { getContainer } = require("./container");
// v73.1: Realtime WebSocket bridge — pushes EventBus events to dashboards/widget.
const { RealtimeBridge } = require("../../../packages/realtime/src/realtimeBridge");
// v74.0: security middleware (helmet / CORS / rate limit / correlation ID).
const {
  correlationId, helmetOptions, corsOptions, createApiLimiter,
  createRequireBusinessAuth, createErrorHandler,
} = require("./routes/middleware");
// Routers (one per API surface, all converted from the v73.x if-chain).
const { createBusinessRouter } = require("./routes/business");
const { createAdminRouter } = require("./routes/admin");
const { createPublicRouter, createPublicAdminRouter } = require("./routes/public");
const { createDevRouter, createCrmRouter } = require("./routes/dev");
const { createWidgetRouter } = require("./routes/widget");
const { createAssetsRouter } = require("./routes/assets");
const { createWebhooksRouter } = require("./routes/webhooks");
const { createSiteRouter, servePublicChatAsset } = require("./routes/site");
// Shared HTTP helpers — re-exported below for backward compatibility with
// callers that used to import them from server.js.
const { readRaw, readJson, sendJson, authorizeDeveloperRequest } = require("./http-helpers");

async function startServer() {
  const container = await getContainer();

  // ─── Express app assembly ─────────────────────────────────────────────
  const app = express();
  app.disable('x-powered-by');
  // Render terminates TLS and forwards exactly one proxy hop; trusting that
  // hop makes req.ip the real client IP for the rate limiter (handlers that
  // need the client IP read x-forwarded-for directly, as in v73.x).
  app.set('trust proxy', 1);
  app.use(correlationId);
  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));
  app.use('/api', createApiLimiter());

  // ─── API routers (converted from the v73.x if-chain, in mount order) ──
  // No express.json on these prefixes — their handlers keep readJson()/
  // readRaw() from http-helpers so raw request streams stay available and
  // rejections flow to the central error handler with the same 400s as
  // v73.x. The Stripe and WhatsApp webhooks REQUIRE raw bodies for
  // signature verification; the business router alone mounts express.json.
  app.use('/api/public', createPublicRouter({ container }));
  app.use('/api/public-admin', createPublicAdminRouter({ container }));
  app.use('/api/admin', createAdminRouter({ container }));
  app.use('/api/dev', createDevRouter({ container }));
  app.use('/api/crm', createCrmRouter({ container }));
  const requireBusinessAuth = createRequireBusinessAuth(container);
  app.use('/api/business', express.json({ limit: '10mb' }), createBusinessRouter({ container, requireBusinessAuth }));
  app.use('/api', createWidgetRouter({ container }));
  app.use('/api', createAssetsRouter({ container }));
  app.use(createWebhooksRouter({ container }));
  app.use(createSiteRouter({ container }));

  // Final fall-through for everything no router claimed — the v73.x
  // if-chain's 404. Non-GET/POST methods (e.g. PUT on an unconverted path)
  // also land here, exactly as before.
  app.use((req, res) => sendJson(res, 404, { ok: false, error: "Not found" }));
  // Central error handler: Express 5 forwards rejected async handler
  // promises here, replicating the legacy catch block's response shape.
  app.use(createErrorHandler(container));

  // ─── HTTP server + timeouts ───────────────────────────────────────────
  const server = http.createServer(app);
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

  // ─── Graceful shutdown ────────────────────────────────────────────────
  // v36.0: stop accepting new connections, finish in-flight requests, then
  // exit. Render sends SIGTERM 30s before killing the process.
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
  const close = async () => new Promise((resolve, reject) => server.close(async (error) => {
    if (error) return reject(error);
    try { await container.storage?.close?.(); resolve(); }
    catch (e) { reject(e); }
  }));
  return { server, container, close };
}

if (require.main === module) startServer().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { startServer, readRaw, readJson, authorizeDeveloperRequest, servePublicChatAsset };
