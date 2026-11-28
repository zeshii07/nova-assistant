/**
 * v74.1 — Admin dashboard API router (Phase 3 of the Express migration).
 *
 * Every /api/admin/* endpoint from the v73.x server.js if-chain, converted
 * 1:1: the two PUBLIC OAuth callbacks (Google + Microsoft — they must stay
 * before the gate because the provider's browser redirect carries no dev
 * token; security comes from the signed single-use `state` token), then
 * router.use(requireDeveloperToken) — everything below it is dev-token
 * gated exactly like the v73.x `startsWith("/api/admin/")` pre-check.
 *
 * Handler bodies are verbatim transcriptions (same status codes, response
 * shapes, messages) with these mechanical substitutions only:
 *
 *   url.searchParams.get(x) → req.query.x
 *   decodeURIComponent(match[n]) → req.params.x (Express decodes once)
 *   relative package requires   → one directory deeper (routes/ vs src/)
 *
 * Handlers keep readJson()/sendJson() from http-helpers — NO express.json
 * is mounted on /api/admin, so the raw request stream stays available to
 * any not-yet-migrated legacy route and readJson rejections flow to the
 * central error handler with the same 400 "Invalid JSON body." as v73.x.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const packageJson = require("../../../../package.json");
const { mintState, verifyState } = require("../../../../packages/auth-engine/src/oauthState");
const {
  sendJson, sendText, sendHtml, escHtml, readJson, listTenants, runDataset,
} = require("../http-helpers");
const { createRequireDeveloperToken } = require("./middleware");

function createAdminRouter({ container }) {
  const router = express.Router();

  // ═══ PUBLIC OAuth callbacks (browser redirect; no dev token) ═════════════
  // These MUST be public: the provider redirects the user's browser here
  // after consent, and the browser has no dev token. Security comes from
  // the signed, single-use `state` token (oauthState.js) — without it an
  // attacker could forge a callback to overwrite a victim tenant's tokens.
  // The state is minted by the authed initiation routes below the gate and
  // verified here; a replay or tamper throws and the callback returns 400.

  router.get('/calendar/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state || '';
    const oauthError = req.query.error;
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
  });

  router.get('/calendar/microsoft/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state || '';
    const oauthError = req.query.error;
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
  });

  // ═══ Dev-token gate — everything below requires NOVA_DEV_TOKEN ═══════════
  // All admin endpoints reuse the same NOVA_DEV_TOKEN gate as /api/dev/*.
  // They are intentionally consolidated for the operator dashboard so the
  // UI doesn't have to fan out to dozens of dev endpoints per page load.
  router.use(createRequireDeveloperToken("Admin token is required"));

  // ─── Roadmap #9: Operational metrics ───────────────────────────────────
  // Wraps the MetricsAggregator snapshot + the health readiness check so an
  // operator can see turn rates, fallback rates, latency, and subsystem
  // status in one call. Used by the admin dashboard's ops panel.
  router.get('/metrics', (req, res) => {
    const metrics = container.metricsAggregator?.snapshot?.() || { tenants: {} };
    const health = container.healthService?.readiness?.() || { status: "unknown" };
    return sendJson(res, 200, { ok: true, metrics, health });
  });

  router.get('/overview', async (req, res) => {
    const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
    const [replays, capabilities, health] = await Promise.all([
      container.replayService.list({ limit: 1 }),
      Promise.resolve(container.registry.list().map((c) => ({ id: c.id, manifest: c.manifest }))),
      Promise.all(container.registry.list().map((item) => item.health()))
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
      tenantIds: tenants.map(t => t.id),
      capabilityCount: capabilities.length,
      capabilityIds: capabilities.map(c => c.id),
      recentReplayCount: replays.length,
      capabilityHealth: health
    };
    return sendJson(res, 200, { ok: true, overview });
  });

  router.get('/feedback/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    container.tenantRepository.getById(tenantId);
    const counts = container.feedbackCollector?.getExampleCount?.(tenantId) || { total: 0, positive: 0, negative: 0 };
    const examples = container.feedbackCollector?.getExamples?.(tenantId) || [];
    return sendJson(res, 200, { ok: true, tenantId, counts, examples: examples.slice(-200).reverse() });
  });

  router.get('/ml/status', (req, res) => {
    const tenantsWithFeedback = container.feedbackCollector?.getTenantsWithExamples?.() || [];
    const perTenant = tenantsWithFeedback.map((tenantId) => ({
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
        totalExamples: perTenant.reduce((sum, t) => sum + t.counts.total, 0),
        totalPositive: perTenant.reduce((sum, t) => sum + t.counts.positive, 0),
        totalNegative: perTenant.reduce((sum, t) => sum + t.counts.negative, 0)
      },
      onlineLearner: {
        enabled: !!container.onlineLearner,
        lastRetrain: container.onlineLearner?.getLastRetrainSummary?.() || null,
        status: container.onlineLearner?.getStatus?.() || 'Not initialized'
      }
    };
    return sendJson(res, 200, { ok: true, status });
  });

  router.post('/online-learner/run', async (req, res) => {
    if (!container.onlineLearner) return sendJson(res, 503, { ok: false, error: "Online learner is not initialized" });
    const body = await readJson(req).catch(() => ({}));
    const result = await container.onlineLearner.learn({
      minExamples: Number(body.minExamples || 5),
      minPositiveRatio: Number(body.minPositiveRatio || 0.0)
    });
    return sendJson(res, 200, { ok: result.learned === true, result });
  });

  router.get('/replays', async (req, res) => {
    const limit = Number(req.query.limit || 100);
    const replays = await container.replayService.list({ limit });
    return sendJson(res, 200, { ok: true, replays });
  });

  router.get('/tenants', (req, res) => {
    const tenants = listTenants(container.config.tenantsDir, container.tenantRepository);
    const enriched = tenants.map((t) => {
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
    return sendJson(res, 200, { ok: true, tenants: enriched });
  });

  // ─── v30.1 Template & Tenant Creation endpoints ────────────────────────
  router.get('/templates', (req, res) => {
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
    return sendJson(res, 200, { ok: true, templates });
  });

  router.post('/templates/create', async (req, res) => {
    const body = await readJson(req);
    // v35.3: input sanitization — prevent path traversal + injection
    const { sanitizeTemplateId, sanitizeName, sanitizeText } = require('../../../../packages/validation/src/sanitize');
    let templateId, label, description, domain;
    try {
      templateId = sanitizeTemplateId(body.id);
      label = sanitizeName(body.label, 100);
      description = sanitizeText(body.description, 500, false);
      domain = sanitizeName(String(body.domain || 'generic'), 50);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    if (!templateId || !label) return sendJson(res, 400, { ok: false, error: 'id and label are required' });

    const templatesDir = path.resolve(container.config.tenantsDir, "_templates");
    const newTemplateDir = path.join(templatesDir, templateId);
    if (fs.existsSync(newTemplateDir)) return sendJson(res, 409, { ok: false, error: 'Template already exists' });

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

    return sendJson(res, 201, { ok: true, templateId, message: `Custom template '${label}' created. Use it to onboard new tenants.` });
  });

  router.post('/tenants/create', async (req, res) => {
    const body = await readJson(req);
    // v35.3: input sanitization — prevent path traversal in templateId + injection in businessName
    const { sanitizeTemplateId, sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText } = require('../../../../packages/validation/src/sanitize');
    let templateId, businessName, ownerEmail, ownerPhone, businessDescription;
    try {
      templateId = sanitizeTemplateId(body.templateId);
      businessName = sanitizeName(body.businessName, 200);
      ownerEmail = body.ownerEmail ? sanitizeEmail(body.ownerEmail) : '';
      ownerPhone = body.ownerPhone ? sanitizePhone(body.ownerPhone) : '';
      businessDescription = body.businessDescription ? sanitizeText(body.businessDescription, 1000, false) : '';
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    if (!templateId || !businessName) return sendJson(res, 400, { ok: false, error: 'templateId and businessName are required' });

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
    if (!sourceTenantId) return sendJson(res, 404, { ok: false, error: 'Template not found or has no source tenant' });

    const sourceTenantDir = path.join(container.config.tenantsDir, sourceTenantId);
    if (!fs.existsSync(sourceTenantDir)) return sendJson(res, 404, { ok: false, error: `Source tenant '${sourceTenantId}' not found` });

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
    if (!/^[a-z0-9-]+$/.test(tenantId)) return sendJson(res, 400, { ok: false, error: 'tenantId must be lowercase letters, numbers, hyphens only' });

    const newTenantDir = path.join(container.config.tenantsDir, tenantId);
    if (fs.existsSync(newTenantDir)) return sendJson(res, 409, { ok: false, error: 'Tenant already exists' });

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
  });

  // Tenant lifecycle actions: suspend / activate / delete / export.
  // (The v73.x regex restricted the action inline; here the param is
  // validated and anything else 404s, matching the old fall-through.)
  router.post('/tenants/:tenantId/:action', async (req, res) => {
    const tenantId = req.params.tenantId;
    const action = req.params.action;
    if (!['suspend', 'activate', 'delete', 'export'].includes(action)) {
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    }
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Tenant not found' }); }

    if (action === 'export') {
      // Export tenant folder as a zip so it can be committed to git
      // (Render's ephemeral filesystem wipes new tenants on restart)
      const tenantDir = path.join(container.config.tenantsDir, tenantId);
      if (!fs.existsSync(tenantDir)) return sendJson(res, 404, { ok: false, error: 'Tenant folder not found' });
      // Return a JSON manifest of all files in the tenant folder
      // so the dashboard can reconstruct them
      const files = [];
      function walk(dir, rel = '') {
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
      return sendJson(res, 200, { ok: true, tenantId, files });
    }
    if (action === 'delete') {
      // Don't actually delete demo tenants — just mark them suspended for safety
      const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (profile._template?.isTemplate) return sendJson(res, 403, { ok: false, error: 'Cannot delete a template' });
      // Move to _deleted folder instead of permanent delete
      const deletedDir = path.join(container.config.tenantsDir, '_deleted');
      fs.mkdirSync(deletedDir, { recursive: true });
      fs.renameSync(path.join(container.config.tenantsDir, tenantId), path.join(deletedDir, `${tenantId}-${Date.now()}`));
      container.tenantRepository.clearCache(tenantId);
      return sendJson(res, 200, { ok: true, message: `Tenant '${tenantId}' deleted.` });
    }
    // suspend/activate
    const profilePath = path.join(container.config.tenantsDir, tenantId, 'profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    profile.status = action === 'suspend' ? 'suspended' : 'active';
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    container.tenantRepository.clearCache(tenantId);
    return sendJson(res, 200, { ok: true, tenantId, status: profile.status });
  });

  // ─── v34.1 → v35.3: QR Code links for a tenant (server-side, no external API)
  router.get('/tenants/:tenantId/qr-code', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
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
  });

  // ─── v33.1: Admin owner management endpoints ────────────────────────
  // List all business owner accounts for a tenant (admin only)
  router.get('/owners/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const owners = container.businessOwnerAuthService.listOwners({ tenantId });
    return sendJson(res, 200, { ok: true, tenantId, owners });
  });

  // Reset a business owner's password (admin only)
  router.post('/owners/:tenantId/reset-password', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const body = await readJson(req);
    const { email, newPassword } = body;
    if (!email || !newPassword) return sendJson(res, 400, { ok: false, error: 'email and newPassword are required' });
    try {
      const result = container.businessOwnerAuthService.resetPassword({ tenantId, email, newPassword });
      return sendJson(res, 200, { ok: true, ...result, message: `Password reset for ${email}. The owner can now log in with the new password.` });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  });

  // Add an owner to a tenant (admin-driven). Lets an operator provision a
  // second owner without the self-serve register flow.
  router.post('/owners/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const body = await readJson(req);
    const { email, password, name, role } = body;
    if (!email || !password) return sendJson(res, 400, { ok: false, error: 'email and password are required' });
    try {
      const owner = container.businessOwnerAuthService.addOwner({ tenantId, email, password, name, role });
      return sendJson(res, 201, { ok: true, owner, message: `Owner ${email} added to ${tenantId}.` });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  });

  // Update an owner's email (admin-driven — no current-password check).
  router.put('/owners/:tenantId/:ownerId/email', async (req, res) => {
    const tenantId = req.params.tenantId;
    const ownerId = req.params.ownerId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const body = await readJson(req);
    const { newEmail } = body;
    if (!newEmail) return sendJson(res, 400, { ok: false, error: 'newEmail is required' });
    try {
      const result = container.businessOwnerAuthService.adminUpdateEmail({ tenantId, ownerId, newEmail });
      return sendJson(res, 200, { ok: true, ...result, message: `Email updated to ${result.email}.` });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  });

  // Remove an owner (admin-driven). Refuses the last owner.
  router.delete('/owners/:tenantId/:ownerId', (req, res) => {
    const tenantId = req.params.tenantId;
    const ownerId = req.params.ownerId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    try {
      const result = container.businessOwnerAuthService.removeOwner({ tenantId, ownerId });
      return sendJson(res, 200, { ok: true, ...result, message: `Removed owner ${result.email}.` });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  });

  // ─── v34.1: Voice Profile endpoints (voice cloning prep) ────────────
  // GET: retrieve voice profile for a tenant
  // POST: save voice profile (voice name, rate, pitch from browser TTS settings)
  router.get('/voice-profile/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const profilePath = path.join(container.config.tenantsDir, tenantId, 'voice-profile.json');
    let profile = { enabled: false, voiceName: null, rate: 0.95, pitch: 1.0, volume: 0.85 };
    if (fs.existsSync(profilePath)) {
      try { profile = { ...profile, ...JSON.parse(fs.readFileSync(profilePath, 'utf8')) }; } catch {}
    }
    return sendJson(res, 200, { ok: true, tenantId, profile });
  });

  router.post('/voice-profile/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
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
    return sendJson(res, 200, { ok: true, tenantId, profile, message: 'Voice profile saved. Widget will use this voice for TTS.' });
  });

  // ─── v35.0: Catalog (Product) Management endpoints ───────────────────
  // GET    /catalog/{tenantId}/products — list all products
  // POST   /catalog/{tenantId}/products — add new product
  // PUT    /catalog/{tenantId}/products/{productId} — update product
  // DELETE /catalog/{tenantId}/products/{productId} — delete product
  // POST   /catalog/{tenantId}/products/{productId}/image — upload image
  router.get('/catalog/:tenantId/products', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    try {
      const products = await container.catalogService.listProducts(tenantId);
      return sendJson(res, 200, { ok: true, tenantId, products: products || [] });
    } catch (err) {
      // Tenant may not have a catalog (e.g. cleaning tenant) — return empty
      return sendJson(res, 200, { ok: true, tenantId, products: [] });
    }
  });

  router.post('/catalog/:tenantId/products', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const body = await readJson(req);
    if (!body.name) return sendJson(res, 400, { ok: false, error: 'Product name is required' });
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
    return sendJson(res, 200, { ok: true, product, message: 'Product added' });
  });

  router.put('/catalog/:tenantId/products/:productId', async (req, res) => {
    const tenantId = req.params.tenantId;
    const productId = req.params.productId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const productsPath = path.join(container.config.tenantsDir, tenantId, 'catalog', 'products.json');
    if (!fs.existsSync(productsPath)) return sendJson(res, 404, { ok: false, error: 'No catalog for this tenant' });
    let products = [];
    try { products = JSON.parse(fs.readFileSync(productsPath, 'utf8')); }
    catch { return sendJson(res, 500, { ok: false, error: 'Failed to parse products.json' }); }
    const idx = products.findIndex(p => String(p.id) === String(productId) || String(p.id).toLowerCase() === String(productId).toLowerCase());
    if (idx === -1) return sendJson(res, 404, { ok: false, error: 'Product not found' });
    const body = await readJson(req);
    const updated = { ...products[idx], ...body, id: products[idx].id }; // don't allow ID change
    products[idx] = updated;
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
    container.catalogRepository?.clearCache?.(tenantId);
    return sendJson(res, 200, { ok: true, product: updated, message: 'Product updated' });
  });

  router.delete('/catalog/:tenantId/products/:productId', (req, res) => {
    const tenantId = req.params.tenantId;
    const productId = req.params.productId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const productsPath = path.join(container.config.tenantsDir, tenantId, 'catalog', 'products.json');
    if (!fs.existsSync(productsPath)) return sendJson(res, 404, { ok: false, error: 'No catalog for this tenant' });
    let products = [];
    try { products = JSON.parse(fs.readFileSync(productsPath, 'utf8')); }
    catch { return sendJson(res, 500, { ok: false, error: 'Failed to parse products.json' }); }
    const idx = products.findIndex(p => String(p.id) === String(productId) || String(p.id).toLowerCase() === String(productId).toLowerCase());
    if (idx === -1) return sendJson(res, 404, { ok: false, error: 'Product not found' });
    const removed = products.splice(idx, 1)[0];
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n', 'utf8');
    container.catalogRepository?.clearCache?.(tenantId);
    // Also delete the image if any
    const imagesDir = path.join(container.config.tenantsDir, tenantId, 'catalog', 'images');
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
      const p = path.join(imagesDir, productId + ext);
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
    }
    return sendJson(res, 200, { ok: true, product: removed, message: 'Product deleted' });
  });

  // Upload product image (admin only)
  router.post('/catalog/:tenantId/products/:productId/image', async (req, res) => {
    const tenantId = req.params.tenantId;
    const productId = req.params.productId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const body = await readJson(req);
    const { contentBase64, filename } = body;
    if (!contentBase64) return sendJson(res, 400, { ok: false, error: 'contentBase64 is required' });
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
      return sendJson(res, 200, { ok: true, imageUrl: `/api/catalog/images/${tenantId}/${productId}${ext}` });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  // ─── v31.0 Google Calendar OAuth initiation (authed; dev-token gate) ────
  // Starts the consent flow for a tenant. The dashboard (which holds the
  // dev token) calls this; we mint a signed, single-use state token that
  // the public callback (above the gate) verifies.
  router.get('/calendar/auth/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    if (!container.googleOAuthClient?.isConfigured?.()) {
      return sendJson(res, 503, { ok: false, error: 'Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.' });
    }
    const state = mintState(tenantId, container.oauthNonceStore);
    const authUrl = container.googleOAuthClient.getAuthUrl(state);
    return sendJson(res, 200, { ok: true, tenantId, authUrl });
  });

  // ─── Phase 4 Sprint 3: Microsoft Graph Calendar OAuth initiation ──────
  router.get('/calendar/microsoft/auth/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    if (!container.microsoftOAuthClient?.isConfigured?.()) {
      return sendJson(res, 503, { ok: false, error: 'Microsoft Calendar is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET env vars.' });
    }
    const state = mintState(tenantId, container.oauthNonceStore);
    const authUrl = container.microsoftOAuthClient.getAuthUrl(state);
    return sendJson(res, 200, { ok: true, tenantId, authUrl });
  });

  // Calendar status — is this tenant connected to Google Calendar?
  router.get('/calendar/status/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const connected = container.calendarTokenRepository.exists(tenantId);
    const calConfigPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
    let provider = 'local';
    if (fs.existsSync(calConfigPath)) {
      try { provider = JSON.parse(fs.readFileSync(calConfigPath, 'utf8')).provider || 'local'; } catch {}
    }
    return sendJson(res, 200, {
      ok: true, tenantId, connected, provider,
      oauthConfigured: container.googleOAuthClient?.isConfigured?.() || false,
      oauthStatus: container.googleOAuthClient?.getStatus?.() || null
    });
  });

  // Disconnect Google Calendar
  router.post('/calendar/disconnect/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    container.calendarTokenRepository.delete(tenantId);
    // Revert calendar config to local provider
    const configPath = path.join(container.config.tenantsDir, tenantId, "calendar", "config.json");
    if (fs.existsSync(configPath)) {
      const calConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      calConfig.provider = 'local';
      fs.writeFileSync(configPath, JSON.stringify(calConfig, null, 2) + '\n', 'utf8');
      container.calendarConfigRepository.clear(tenantId);
    }
    return sendJson(res, 200, { ok: true, tenantId, message: 'Google Calendar disconnected.' });
  });

  // List upcoming calendar events (Nova-created only)
  router.get('/calendar/events/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    if (!container.calendarTokenRepository.exists(tenantId)) {
      return sendJson(res, 200, { ok: true, connected: false, events: [] });
    }
    const limit = Number(req.query.limit || 50);
    const result = await container.googleCalendarProvider.listEvents({ tenantId, limit }, container.calendarService.getConfig(tenantId));
    return sendJson(res, 200, { ok: true, connected: true, events: result.events || [], error: result.error || null });
  });

  // Test calendar connection
  router.post('/calendar/test/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    if (!container.calendarTokenRepository.exists(tenantId)) {
      return sendJson(res, 200, { ok: false, error: 'Google Calendar is not connected for this tenant.' });
    }
    const tokens = container.calendarTokenRepository.load(tenantId);
    const result = await container.googleOAuthClient.verifyTokens(tokens);
    return sendJson(res, 200, { ok: result.valid, tenantId, ...result });
  });

  // ─── Leads per tenant ──────────────────────────────────────────────────
  router.get('/leads/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    container.tenantRepository.getById(tenantId);
    const [summary, leads] = await Promise.all([
      container.leadService.summary(tenantId),
      container.leadService.list(tenantId, { limit: 200 })
    ]);
    return sendJson(res, 200, { ok: true, tenantId, summary, leads });
  });

  // ─── Conversation datasets (tests/datasets/*.json) ─────────────────────
  router.get('/datasets', (req, res) => {
    const datasetsRoot = path.resolve(__dirname, "../../../../tests/datasets");
    const datasets = [];
    const walk = (dir, prefix = "") => {
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
              turnCount: (parsed.cases || []).reduce((s, c) => s + (c.turns?.length || 0), 0)
            });
          } catch {}
        }
      }
    };
    walk(datasetsRoot);
    return sendJson(res, 200, { ok: true, datasets });
  });

  router.post('/datasets/run', async (req, res) => {
    const body = await readJson(req);
    const report = await runDataset(container, String(body.dataset || ""));
    return sendJson(res, 200, report);
  });

  // ─── v30.0 Notification endpoints ─────────────────────────────────────
  // Declared before the parameterized /notifications/:tenantId routes so
  // the literal path always wins (segment counts differ, but this keeps
  // the routing intent explicit).
  router.get('/notifications/email/test', async (req, res) => {
    const result = await container.emailService.verifyConnection();
    return sendJson(res, 200, { ok: result.ok, status: result });
  });

  router.get('/notifications/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const limit = Number(req.query.limit || 100);
    const unreadOnly = req.query.unreadOnly === "true";
    const [notifications, unreadCount, totalCount] = await Promise.all([
      container.notificationService.listNotifications(tenantId, { limit, unreadOnly }),
      container.notificationService.unreadCount(tenantId),
      container.notificationService.notificationLog.totalCount(tenantId)
    ]);
    return sendJson(res, 200, { ok: true, tenantId, notifications, unreadCount, totalCount, emailService: container.emailService.getStatus() });
  });

  router.post('/notifications/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const result = await container.notificationService.markAllRead(tenantId);
    return sendJson(res, 200, { ok: true, markedRead: result });
  });

  router.post('/notifications/:tenantId/:notificationId/read', async (req, res) => {
    const tenantId = req.params.tenantId;
    const notificationId = req.params.notificationId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const result = await container.notificationService.markRead(tenantId, notificationId);
    return result ? sendJson(res, 200, { ok: true, notification: result }) : sendJson(res, 404, { ok: false, error: 'Notification not found' });
  });

  router.get('/notifications/:tenantId/preferences', (req, res) => {
    const tenantId = req.params.tenantId;
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendJson(res, 404, { ok: false, error: 'Unknown tenant' }); }
    const prefs = container.notificationService.getPreferences(tenantId);
    return sendJson(res, 200, { ok: true, tenantId, preferences: prefs, emailService: container.emailService.getStatus() });
  });

  router.put('/notifications/:tenantId/preferences', async (req, res) => {
    const tenantId = req.params.tenantId;
    const body = await readJson(req);
    try {
      const profile = container.tenantRepository.getById(tenantId);
      profile.notifications = body.preferences || body;
      // Persist back to profile.json
      const profilePath = path.join(container.config.tenantsDir, tenantId, "profile.json");
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
      container.tenantRepository.clearCache(tenantId);
      return sendJson(res, 200, { ok: true, tenantId, preferences: profile.notifications });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
