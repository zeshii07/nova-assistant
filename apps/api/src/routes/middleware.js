/**
 * v74.0 — Express middleware layer (Phase 1 of the Express migration).
 *
 * Before v74.0 the raw http server hand-rolled everything: CORS headers were
 * copy-pasted at 14 call sites, security headers did not exist at all, and
 * every async handler needed its own try/catch. These middlewares replace
 * that boilerplate for every route that has been migrated to Express, and
 * run in front of the legacy fallback too (defense in depth for unconverted
 * routes):
 *
 *   correlationId — X-Request-Id + AsyncLocalStorage correlation (was inline
 *                   in the v35.3 createServer handler).
 *   helmet        — security headers. CSP is disabled globally because the
 *                   dashboards legitimately load Chart.js from jsdelivr and
 *                   the widget pages ship their own strict CSPs; CORP is set
 *                   to cross-origin because widget.js / avatars.js are
 *                   legitimately embedded cross-origin by customer sites.
 *   cors          — reflects the caller's origin (same model as the manual
 *                   per-endpoint CORS in v73.x) and answers preflights for
 *                   every route, not just /api/chat and /api/widget/*.
 *   apiLimiter    — express-rate-limit backstop for /api/* (the widget and
 *                   auth endpoints keep their tighter per-endpoint limits).
 *   error handler — one central catch for async handler rejections (Express
 *                   5 forwards rejected promises here automatically),
 *                   replicating the legacy catch block's response shape.
 */
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Logger } = require("../../../../packages/logger/src/logger");
const { requestCorrelationId } = require("../http-helpers");

// ─── Correlation ID ─────────────────────────────────────────────────────────
function correlationId(req, res, next) {
  const reqId = requestCorrelationId(req)
    || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  res.setHeader('X-Request-Id', reqId);
  // AsyncLocalStorage: the store established for this synchronous next() call
  // chain is inherited by every await started inside it, so all logs emitted
  // during the request lifecycle include requestId (v35.3 semantics).
  return Logger.withCorrelationId(reqId, next);
}

// ─── Security headers ───────────────────────────────────────────────────────
const helmetOptions = {
  // Dashboards load Chart.js from cdn.jsdelivr.net and the widget pages ship
  // their own strict CSPs; a global CSP would break both. Everything else
  // helmet sets (nosniff, frameguard, referrer-policy, HSTS on HTTPS) applies.
  contentSecurityPolicy: false,
  // widget.js / avatars.js / widget-config.js are loaded cross-origin by
  // customer websites; helmet's default "same-origin" policy would make
  // browsers refuse those loads and break every embedded widget.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};

// ─── CORS ───────────────────────────────────────────────────────────────────
// Mirrors the manual per-endpoint CORS of v73.x: reflect the caller's origin,
// no credentials (auth is a bearer token, not cookies), and answer preflight
// OPTIONS for every route instead of only /api/chat and /api/widget/*.
const corsOptions = {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-nova-tenant-id', 'x-nova-dev-token', 'x-request-id', 'x-correlation-id'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 204,
};

// ─── Rate limiting ──────────────────────────────────────────────────────────
// Backstop for all /api/* traffic: generous enough that no legitimate client
// ever sees it (the widget chat and auth endpoints keep their own tighter
// per-endpoint limits), tight enough to bound a single-IP flood. Requires
// app.set('trust proxy', 1) (set in server.js) so req.ip is the real client
// behind Render's proxy.
function createApiLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests from this IP. Please slow down.' },
  });
}

// ─── Auth guards ────────────────────────────────────────────────────────────
// Same contract as the v73.x inline pre-check: verify the JWT, stamp
// req._businessOwner ({ sub, email, name, role, tenantId }), or 401.
function createRequireBusinessAuth(container) {
  return function requireBusinessAuth(req, res, next) {
    const payload = container.businessOwnerAuthService.requireAuth(req);
    if (!payload) return res.status(401).json({ ok: false, error: 'Authentication required. Please log in.' });
    req._businessOwner = payload;
    return next();
  };
}

// v74.1: dev-token gate — the same NOVA_DEV_TOKEN check that guarded the
// /api/admin/* and /api/public-admin/* prefixes in the v73.x if-chain.
// Zero-config in development, timing-safe compare in production.
const { authorizeDeveloperRequest } = require("../http-helpers");
function createRequireDeveloperToken(message) {
  return function requireDeveloperToken(req, res, next) {
    if (!authorizeDeveloperRequest(req)) return res.status(401).json({ ok: false, error: message });
    return next();
  };
}

// ─── Central error handler ──────────────────────────────────────────────────
// Express 5 forwards rejected async handler promises here. Replicates the
// legacy catch block's response shape ({ ok, error, code?, details? }) and
// maps body-parser failures to the statuses/messages the v73.x readJson/
// readRaw pair produced.
function createErrorHandler(container) {
  return function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    if (res.headersSent) return next(err);
    let status = err.statusCode || 500;
    let message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON body.'; }
    if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large.'; }
    container.logger.error('http.request_failed', { error: err.message, requestId: res.getHeader('X-Request-Id') || null });
    return res.status(status).json({
      ok: false,
      error: message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  };
}

module.exports = {
  correlationId, helmetOptions, corsOptions, createApiLimiter,
  createRequireBusinessAuth, createRequireDeveloperToken, createErrorHandler,
};
