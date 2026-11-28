/**
 * v74.0 — Business dashboard API router (Phase 2 of the Express migration).
 *
 * Every /api/business/* endpoint from the v73.x server.js if-chain, converted
 * 1:1 to Express 5 routes. Handler bodies are faithful transcriptions — same
 * status codes, same response shapes, same error messages — with three
 * mechanical substitutions:
 *
 *   readJson(req)            → req.body        (express.json at the mount)
 *   sendJson(res, code, obj) → res.status(code).json(obj)
 *   url.searchParams.get(x)  → req.query.x
 *
 * The v73.x inline auth pre-check becomes a declarative middleware: the four
 * public auth routes (login, register, forgot-password, reset-password) are
 * declared BEFORE router.use(requireBusinessAuth); every route after it is
 * authenticated by the router itself instead of by an if-condition that every
 * new endpoint had to remember to exclude. Unknown /api/business/* paths
 * still behave exactly as before: 401 without a token, 404 with one.
 *
 * One deliberate fix: express.json is mounted with a 10mb limit, so voice
 * sample uploads up to the handler's own 5 MB cap finally work — the old
 * readRaw() 1 MB cap made the "keep it under 5 MB" check unreachable.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { applyStatePatch } = require("../../../../packages/state/src/stateSchema");
const { fileExistenceCache } = require("../../../../packages/storage/src/fileExistenceCache");
const { checkWidgetRateLimit, authorizeDeveloperRequest } = require("../http-helpers");

function createBusinessRouter({ container, requireBusinessAuth }) {
  const router = express.Router();

  // ═══ Public auth routes (no JWT) ═════════════════════════════════════════

  // Login — no auth required
  router.post('/login', async (req, res) => {
    const { tenantId, email, password } = req.body || {};
    if (!tenantId || !email || !password) return res.status(400).json({ ok:false, error:'tenantId, email, and password are required' });
    try { container.tenantRepository.getById(tenantId); }
    catch { return res.status(404).json({ ok:false, error:'Unknown tenant' }); }
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const result = await container.businessOwnerAuthService.loginWithPassword({ tenantId, email, password, ip: clientIp });
    if (!result.ok) return res.status(401).json({ ok:false, error: result.error });
    return res.status(200).json({ ok:true, token: result.token, owner: result.owner });
  });

  // Register — only available if no owners exist yet (first owner setup)
  // OR if called with an admin dev token (operator creating owner accounts)
  router.post('/register', async (req, res) => {
    const { tenantId, email, password, name } = req.body || {};
    if (!tenantId || !email || !password) return res.status(400).json({ ok:false, error:'tenantId, email, and password are required' });
    try { container.tenantRepository.getById(tenantId); }
    catch { return res.status(404).json({ ok:false, error:'Unknown tenant' }); }
    // Check if this is the first owner (no owners.json exists yet) — allow without auth
    const ownersFilePath = path.join(container.config.tenantsDir, tenantId, 'owners.json');
    const isFirstOwner = !fs.existsSync(ownersFilePath);
    // If not first owner, require admin dev token
    if (!isFirstOwner && !authorizeDeveloperRequest(req)) {
      return res.status(401).json({ ok:false, error:'Admin token required to add additional owners. Use /api/admin/ to create owner accounts.' });
    }
    try {
      const owner = container.businessOwnerAuthService.createOwner({ tenantId, email, password, name });
      return res.status(201).json({ ok:true, owner });
    } catch (err) {
      return res.status(400).json({ ok:false, error: err.message });
    }
  });

  // ─── Self-serve password recovery (public, rate-limited) ────────────
  // Request a reset link. NEVER reveals whether the email exists (anti-
  // enumeration): returns the same generic ok whether or not the owner was
  // found. In dev (no SMTP configured) the token is returned in the response
  // so the flow can be tested without a mailbox; in prod the link is emailed
  // and the token is omitted from the response.
  router.post('/forgot-password', async (req, res) => {
    const { tenantId, email } = req.body || {};
    if (!tenantId || !email) return res.status(400).json({ ok:false, error:'tenantId and email are required' });
    // Validate tenant exists (this IS allowed to 404 — a non-existent tenant
    // isn't account-enumeration of a real tenant).
    try { container.tenantRepository.getById(tenantId); }
    catch { return res.status(404).json({ ok:false, error:'Unknown tenant' }); }
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const rl = checkWidgetRateLimit(`forgot:${clientIp}`);
    if (!rl.allowed) return res.status(429).json({ ok:false, error:'Too many requests. Please wait a few minutes.' });
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
        return res.status(200).json({ ok:true, message:'If an account exists for that email, a reset link has been sent.', ...(isDev ? { devToken: result.token, devNote: 'SMTP not configured — the reset link is included here for local testing.' } : {}) });
      }
      // No email service OR no owner found — same generic message + latency.
      return res.status(200).json({ ok:true, message:'If an account exists for that email, a reset link has been sent.' });
    } catch (err) {
      container.logger?.error?.('business.forgot_password_failed', { tenantId, error: err.message });
      return res.status(400).json({ ok:false, error: 'Could not process the request. Please try again.' });
    }
  });

  // Consume a reset token + set a new password (public — the token is the
  // auth). Single-use, 30-min TTL.
  router.post('/reset-password', async (req, res) => {
    const { tenantId, token, newPassword } = req.body || {};
    if (!tenantId || !token || !newPassword) return res.status(400).json({ ok:false, error:'tenantId, token, and newPassword are required' });
    try { container.tenantRepository.getById(tenantId); }
    catch { return res.status(404).json({ ok:false, error:'Unknown tenant' }); }
    // Rate-limit token-consume attempts per IP so a leaked-token attacker
    // can't brute-force validity probes (the 256-bit token makes blind
    // brute-force infeasible, but the throttle bounds log noise + bcrypt CPU).
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const rl = checkWidgetRateLimit(`reset:${clientIp}`);
    if (!rl.allowed) return res.status(429).json({ ok:false, error:'Too many requests. Please wait a few minutes.' });
    try {
      const result = container.businessOwnerAuthService.consumePasswordResetToken({ tenantId, token, newPassword });
      return res.status(200).json({ ok:true, ...result, message:'Your password has been reset. You can now log in.' });
    } catch (err) {
      // Surface only the user-facing token messages; hide any FS-internal error.
      const msg = err.message || '';
      const safe = /Invalid or already-used|expired|at least 6 characters|required/i.test(msg) ? msg : 'Reset failed. The link may be invalid or expired.';
      container.logger?.warn?.('business.reset_password_failed', { tenantId, error: msg });
      return res.status(400).json({ ok:false, error: safe });
    }
  });

  // ═══ Authenticated routes ═════════════════════════════════════════════════
  // Everything below this line requires a valid business-owner JWT. The
  // v73.x code enforced this with one if-condition guarding the whole block;
  // here the guard IS the routing.
  router.use(requireBusinessAuth);

  // Get current owner info
  router.get('/me', (req, res) => {
    return res.status(200).json({ ok:true, owner: req._businessOwner });
  });

  // ─── Self-serve account management (authed) ────────────────────────
  // Change own password — requires the current password (re-auth) so a
  // hijacked session can't silently change it. A fresh JWT is returned so
  // the client replaces its stored token (the new password invalidates the
  // old token's effective session control).
  router.put('/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    try {
      const result = container.businessOwnerAuthService.updatePassword({
        tenantId: req._businessOwner.tenantId,
        ownerId: req._businessOwner.sub,
        currentPassword, newPassword,
      });
      return res.status(200).json({ ok:true, message:'Your password has been changed.', token: result.token });
    } catch (err) {
      const msg = err.message || '';
      const safe = /Current password is incorrect|different from the current|at least 6 characters|required|Owner not found/i.test(msg) ? msg : 'Could not change password.';
      return res.status(400).json({ ok:false, error: safe });
    }
  });

  // Change own email — requires the current password (re-auth) since email
  // is the recovery channel. A fresh JWT (carrying the new email) is
  // returned so /api/business/me shows the updated email immediately.
  router.put('/email', async (req, res) => {
    const { currentPassword, newEmail } = req.body || {};
    try {
      const result = container.businessOwnerAuthService.updateEmail({
        tenantId: req._businessOwner.tenantId,
        ownerId: req._businessOwner.sub,
        currentPassword, newEmail,
      });
      return res.status(200).json({ ok:true, message:'Your email has been updated.', email: result.email, token: result.token });
    } catch (err) {
      const msg = err.message || '';
      const safe = /Current password is incorrect|already uses that email|not a valid email|required|Owner not found/i.test(msg) ? msg : 'Could not update email.';
      return res.status(400).json({ ok:false, error: safe });
    }
  });

  // ─── Team / co-owner management (authed owner) ─────────────────────
  // List the owners on this tenant (the dashboard's "Team" page).
  router.get('/owners', (req, res) => {
    const owners = container.businessOwnerAuthService.listOwners({ tenantId: req._businessOwner.tenantId });
    return res.status(200).json({ ok:true, owners, currentOwnerId: req._businessOwner.sub });
  });

  // Add a co-owner (an authenticated owner invites a teammate).
  router.post('/owners', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:'email and password are required' });
    try {
      const owner = container.businessOwnerAuthService.addOwner({
        tenantId: req._businessOwner.tenantId, email, password, name,
      });
      return res.status(201).json({ ok:true, owner });
    } catch (err) {
      return res.status(400).json({ ok:false, error: err.message });
    }
  });

  // Remove a co-owner. Refuses to remove the last owner. An owner can
  // remove themselves (a graceful self-exit) but not the last one.
  router.delete('/owners/:ownerId', (req, res) => {
    const targetOwnerId = req.params.ownerId;
    try {
      const result = container.businessOwnerAuthService.removeOwner({
        tenantId: req._businessOwner.tenantId, ownerId: targetOwnerId,
      });
      return res.status(200).json({ ok:true, ...result, message:`Removed owner ${result.email}.` });
    } catch (err) {
      return res.status(400).json({ ok:false, error: err.message });
    }
  });

  // ─── Phase 4 Sprint 1: Billing (authed; uses req._businessOwner.tenantId) ──
  // Subscription status — for the business dashboard's billing widget.
  router.get('/billing/status', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    return res.status(200).json({ ok: true, ...container.planService.getStatus(tenantId) });
  });

  // Create a Stripe Checkout Session — the business upgrades/pays here.
  router.post('/billing/checkout', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const planId = (req.body || {}).planId || "starter";
    const plan = container.planService && require("../../../../packages/billing/src").getPlan(planId);
    if (!plan) return res.status(400).json({ ok: false, error: `Unknown plan: ${planId}` });
    const origin = String(req.headers["origin"] || `http://${req.headers["host"]}`);
    const session = await container.stripeClient.createCheckoutSession({
      tenantId,
      planId,
      customerId: container.subscriptionRepository.get(tenantId)?.stripeCustomerId || null,
      successUrl: `${origin}/business/billing?success=true`,
      cancelUrl: `${origin}/business/billing?canceled=true`,
    });
    return res.status(200).json({ ok: true, url: session.url, sessionId: session.id });
  });

  // Create a Stripe Billing Portal session — manage card/plan/invoices.
  router.post('/billing/portal', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const sub = container.subscriptionRepository.get(tenantId);
    if (!sub || !sub.stripeCustomerId) {
      return res.status(400).json({ ok: false, error: "No Stripe customer found. Subscribe first." });
    }
    const origin = String(req.headers["origin"] || `http://${req.headers["host"]}`);
    const session = await container.stripeClient.createPortalSession({
      customerId: sub.stripeCustomerId,
      returnUrl: `${origin}/business/billing`,
    });
    return res.status(200).json({ ok: true, url: session.url });
  });

  // ─── Phase 4 Sprint 2: Onboarding wizard (authed) ──────────────────
  // Get the current onboarding state for the wizard UI.
  router.get('/onboarding', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    try {
      return res.status(200).json({ ok: true, ...container.onboardingWizardService.getState(tenantId) });
    } catch (err) {
      return res.status(404).json({ ok: false, error: err.message });
    }
  });

  // Update business profile (name, contact, hours, location, description).
  router.post('/onboarding/profile', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    try {
      const result = container.onboardingWizardService.updateProfile(tenantId, req.body || {});
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Update FAQs.
  router.post('/onboarding/faqs', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const body = req.body || {};
    try {
      const result = container.onboardingWizardService.updateFaqs(tenantId, Array.isArray(body.faqs) ? body.faqs : body);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Update business hours.
  router.post('/onboarding/hours', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const body = req.body || {};
    try {
      const result = container.onboardingWizardService.updateHours(tenantId, body.hours);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Mark onboarding complete.
  router.post('/onboarding/complete', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    try {
      const result = container.onboardingWizardService.complete(tenantId);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Today overview — conversations, leads, bookings, revenue today
  router.get('/overview', async (req, res) => {
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
    return res.status(200).json({
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
  });

  // Conversations inbox
  router.get('/conversations', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const limit = Number(req.query.limit || 100);
    const replays = await container.replayService.list({ limit });
    const tenantReplays = replays.filter(r => r.tenantId === tenantId);
    return res.status(200).json({ ok:true, conversations: tenantReplays });
  });

  // v73.1: Grouped inbox — one row per conversation (grouped by customerId),
  // not one row per message turn. Includes needsHuman flag derived from
  // state.context.handoff.status === 'open' and active takeover flag. This
  // is what the dashboard inbox table renders; the legacy endpoint above is
  // kept for backward compatibility.
  router.get('/conversations/grouped', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const limit = Number(req.query.limit || 500);
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

    return res.status(200).json({
      ok: true,
      conversations,
      total: conversations.length,
      needsHumanCount: conversations.filter(c => c.needsHuman).length,
      takeoverCount: conversations.filter(c => c.takeoverActive).length
    });
  });

  // Leads
  router.get('/leads', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const [summary, leads] = await Promise.all([
      container.leadService.summary(tenantId),
      container.leadService.list(tenantId, { limit: 200 })
    ]);
    return res.status(200).json({ ok:true, summary, leads });
  });

  // Bookings (from cleaning service requests)
  router.get('/bookings', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const serviceRequests = container.cleaningRequestRepository?.listByTenant?.(tenantId) || [];
    const bookings = await container.bookingRepository.list(tenantId, null).catch(() => []);
    return res.status(200).json({ ok:true, serviceRequests, bookings });
  });

  // Customers (CRM)
  router.get('/customers', async (req, res) => {
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
    return res.status(200).json({ ok:true, customers });
  });

  // Notifications
  router.get('/notifications', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const notifications = await container.notificationService.listNotifications(tenantId, { limit: 50 });
    const unreadCount = await container.notificationService.unreadCount(tenantId);
    return res.status(200).json({ ok:true, notifications, unreadCount });
  });

  // Send a reply as the business owner (takeover mode)
  // v33.0: Owner replies are stored in conversation state and delivered
  // to the customer via polling or on their next message. Nova does NOT
  // process the owner's text through the execution engine — the owner's
  // text goes directly to the customer as-is.
  router.post('/reply', async (req, res) => {
    const { customerId, text } = req.body || {};
    if (!customerId || !text) return res.status(400).json({ ok:false, error:'customerId and text are required' });
    const tenantId = req._businessOwner.tenantId;
    const conversationId = `${tenantId}:widget:${customerId}`;

    // Load conversation state
    let state = await container.stateRepository.get(conversationId);
    if (!state) return res.status(404).json({ ok:false, error:'No conversation found for this customer.' });

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

    return res.status(200).json({ ok:true, message: 'Reply sent to customer.', takeover: state.context.takeover, reply: replyPayload });
  });

  // ─── v33.0: Takeover control endpoints ──────────────────────────
  // Start takeover — Nova stops auto-replying for this conversation
  router.post('/takeover', async (req, res) => {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ ok:false, error:'customerId is required' });
    const tenantId = req._businessOwner.tenantId;
    const conversationId = `${tenantId}:widget:${customerId}`;
    let state = await container.stateRepository.get(conversationId);
    if (!state) return res.status(404).json({ ok:false, error:'No conversation found for this customer.' });

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
    return res.status(200).json({ ok:true, takeover: state.context.takeover });
  });

  // Release takeover — Nova resumes auto-replying
  router.post('/release', async (req, res) => {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ ok:false, error:'customerId is required' });
    const tenantId = req._businessOwner.tenantId;
    const conversationId = `${tenantId}:widget:${customerId}`;
    let state = await container.stateRepository.get(conversationId);
    if (!state) return res.status(404).json({ ok:false, error:'No conversation found.' });

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
    return res.status(200).json({ ok:true, message: 'Takeover released. Nova will resume auto-replying.' });
  });

  // Get full conversation detail (for business dashboard inbox)
  router.get('/conversation/:customerId', async (req, res) => {
    const customerId = req.params.customerId;
    const tenantId = req._businessOwner.tenantId;
    const conversationId = `${tenantId}:widget:${customerId}`;
    const state = await container.stateRepository.get(conversationId);
    if (!state) return res.status(404).json({ ok:false, error:'No conversation found.' });

    // Get replays for this conversation
    const replays = await container.replayService.list({ conversationId, limit: 100 });
    const takeover = state.context?.takeover || { active: false };

    // Get pending customer messages (if takeover active)
    const pendingMessages = takeover.pendingCustomerMessages || [];

    return res.status(200).json({
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
  });
  // ─── End v33.0 Takeover endpoints ────────────────────────────────

  // ─── v34.2: Voice Cloning — voice sample upload/serve/delete ───────
  // POST /api/business/voice/upload — owner uploads a recorded voice clip
  //   body: { contentBase64, mimeType, filename? }
  //   Saves to tenants/{tenantId}/voice-samples/sample.{ext}
  //   Returns voiceSampleUrl that widget will fetch.
  router.post('/voice/upload', async (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const { contentBase64, mimeType, filename } = req.body || {};
    if (!contentBase64) return res.status(400).json({ ok:false, error:'contentBase64 is required' });
    if (!mimeType) return res.status(400).json({ ok:false, error:'mimeType is required (audio/webm, audio/mp3, audio/wav, audio/m4a, audio/ogg)' });

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
    if (!ext) return res.status(400).json({ ok:false, error:`Unsupported audio format: ${mimeType}. Supported: webm, mp3, wav, m4a, ogg` });

    // Cap base64 payload at 5MB (≈6.7MB base64) to protect the server.
    if (contentBase64.length > 7_000_000) {
      return res.status(413).json({ ok:false, error:'Audio clip is too large. Please keep it under 5 MB.' });
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
      return res.status(500).json({ ok:false, error: 'Failed to save audio: ' + err.message });
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

    return res.status(200).json({
      ok:true,
      tenantId,
      voiceSampleUrl: `${novaOrigin}/api/voice/sample/${encodeURIComponent(tenantId)}`,
      meta,
      message: 'Voice sample uploaded. The kiosk and widget will use this audio for reply playback.'
    });
  });

  // GET /api/business/voice/sample — fetch current voice sample metadata
  router.get('/voice/sample', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const samplesDir = path.join(container.config.tenantsDir, tenantId, 'voice-samples');
    const metaPath = path.join(samplesDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return res.status(200).json({ ok:true, tenantId, hasSample: false, meta: null });
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
      return res.status(200).json({
        ok:true,
        tenantId,
        hasSample: true,
        meta,
        voiceSampleUrl: `${novaOrigin}/api/voice/sample/${encodeURIComponent(tenantId)}`,
        voiceProfile
      });
    } catch (err) {
      return res.status(500).json({ ok:false, error: 'Failed to read sample metadata: ' + err.message });
    }
  });

  // PUT /api/business/voice/profile — update TTS voice profile (rate/pitch/volume/name)
  router.put('/voice/profile', (req, res) => {
    const tenantId = req._businessOwner.tenantId;
    const body = req.body || {};
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
    return res.status(200).json({ ok:true, tenantId, profile, message: 'Voice profile updated.' });
  });

  // DELETE /api/business/voice/sample — remove uploaded voice sample
  router.delete('/voice/sample', (req, res) => {
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
    return res.status(200).json({ ok:true, message: 'Voice sample removed. Widget will fall back to browser TTS.' });
  });
  // ─── End v34.2 Voice Cloning (authenticated) ───────────────────────

  return router;
}

module.exports = { createBusinessRouter };
