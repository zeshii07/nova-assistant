/**
 * v74.2 — Customer chat + widget router (Phase 4, final, of the Express
 * migration), mounted at /api.
 *
 * The customer-facing conversation surface from the v73.x→v74.1 if-chain,
 * converted 1:1:
 *   POST /api/assistant/chat — unified public assistant (rate-limited)
 *   POST /api/chat           — widget chat (API key + domain whitelist +
 *                              rate limit + anonymous customerId)
 *   GET  /api/chat/poll      — takeover reply polling
 *   POST /api/chat/reply/delivered — WS dedup ack
 *   GET  /api/widget/config/:tenantId — public widget bootstrap config
 *   GET  /api/voice/sample/:tenantId  — public voice sample stream
 *
 * The v73.x OPTIONS preflight branch for /api/chat + /api/widget/* was
 * already dead code in v74.0 (the global cors() middleware answers
 * preflights first), so it is not carried over.
 *
 * Handler bodies are verbatim transcriptions (same status codes, headers,
 * rate-limit responses, CORS reflections). Handlers keep readJson() from
 * http-helpers — no express.json — so the raw stream stays available and
 * readJson rejections flow to the central error handler with the same 400.
 */
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { applyStatePatch } = require("../../../../packages/state/src/stateSchema");
const { fileExistenceCache } = require("../../../../packages/storage/src/fileExistenceCache");
const {
  sendJson, sendText, readJson, checkWidgetRateLimit, requestCorrelationId,
} = require("../http-helpers");
const { ValidationError } = require("../../../../packages/shared/src/errors");

function createWidgetRouter({ container }) {
  const router = express.Router();

  // ── /api/assistant/chat — UNIFIED (Phase 2 Sprint 3) ─────────────────
  // Previously this was a separate 200-line regex bot (novaMarketingAssistant.js)
  // that BYPASSED the rate limiter, the public knowledge base (RAG), the lead
  // capture flow, the abstention policy, and the policy redactor. H8 root cause:
  // "two parallel public assistants — keyword matcher that answers when it
  // should abstain + leaks internal config text, and a separate regex bot with
  // no rate limit."
  //
  // This route runs the SAME PublicAssistantService.handleMessage flow as
  // /api/public/chat (single source of truth): per-IP rate limit, RAG over the
  // public-product knowledge base with the H2b 0.40 relevance threshold
  // (abstains instead of guessing), the H8 messagingRules/persona leak
  // defense, lead capture, conversation memory, and analytics.
  //
  // The legacy {reply, topic, suggestions} response shape is preserved for
  // backward compatibility (existing /api/assistant/chat clients).
  router.post('/assistant/chat', async (req, res) => {
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
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, { ok:false, error:'text is required' });
    if (text.length > 4000) throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
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
  });

  // ── /api/chat — widget chat ──────────────────────────────────────────
  // ─── v30.1.4 Widget API Key Security ──────────────────────────────────
  // Tenants can require an API key for widget requests by setting
  // widget.apiKey in their profile.json. If set, requests must include
  // x-nova-api-key header matching the key. This prevents unauthorized
  // websites from embedding your Nova agent. If widget.apiKey is NOT set,
  // the widget is open (anyone can embed).
  router.post('/chat', async (req, res) => {
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
    if (String(body.text||'').trim().length > 4000) throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
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
  });

  // v33.0: Customer polling endpoint. When takeover is active, the widget
  // polls this endpoint to check for new owner replies. Returns any
  // undelivered owner replies.
  router.get('/chat/poll', async (req, res) => {
    const tenantId = String(req.query.tenantId || container.config.defaultTenantId);
    const customerId = String(req.query.customerId || '');
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
  });

  // v73.1: Mark owner replies as delivered (called by the customer widget
  // when it receives a reply over WebSocket). Prevents the poll fallback
  // from re-delivering the same reply to a client that already saw it via WS.
  router.post('/chat/reply/delivered', async (req, res) => {
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
  });

  // v28.0 — Public widget config endpoint (no auth required, read-only)
  // Returns ONLY what the widget needs to bootstrap: assistantName,
  // welcomeMessage, themeColor, position, language, suggestions.
  // v29.0 — extended with agent persona, pre-chat form, proactive greeting.
  // Sensitive tenant data (permissions, internal IDs) never leaves the server.
  router.get('/widget/config/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
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
  });

  // ─── Public voice sample serve — NO auth, used by kiosk/widget ─────
  // GET /api/voice/sample/{tenantId} → audio stream (webm/mp3/wav/m4a/ogg)
  router.get('/voice/sample/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
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
  });

  return router;
}

module.exports = { createWidgetRouter };
