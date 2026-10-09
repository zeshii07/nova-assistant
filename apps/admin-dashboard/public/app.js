/* ============================================================
   Nova Admin Dashboard — v27.0
   Vanilla JS dashboard wiring all /api/admin/* endpoints.
   ============================================================ */

const $ = id => document.getElementById(id);
const view = $('view');

// ─── State ────────────────────────────────────────────────────────
const state = {
  route: 'overview',
  tenant: '',
  devToken: localStorage.getItem('novaDevToken') || '',
  tenants: [],
  overview: null,
  mlStatus: null,
  datasets: [],
  replays: [],
  leads: {},
  selectedReplay: null,
  busy: {}
};

// Persist & bind token field
$('devToken').value = state.devToken;
$('devToken').addEventListener('change', () => {
  state.devToken = $('devToken').value;
  localStorage.setItem('novaDevToken', state.devToken);
  refresh();
});

// ─── Helpers ──────────────────────────────────────────────────────
function headers(extra = {}) {
  const h = { 'content-type': 'application/json', ...extra };
  if (state.devToken) h['x-nova-dev-token'] = state.devToken;
  if (state.tenant) h['x-nova-tenant-id'] = state.tenant;
  return h;
}
async function api(path, options = {}) {
  const r = await fetch(path, { headers: headers(options.headers || {}), ...options });
  const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok && data && !data.error) data.error = `HTTP ${r.status}`;
  return data;
}
function json(v, indent = 2) {
  if (v == null) return '—';
  try { return JSON.stringify(v, null, indent); }
  catch { return String(v); }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtUptime(sec) {
  if (!sec || sec < 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}
function badge(text, kind = 'neutral') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}
function healthBadge(h) {
  if (!h) return badge('—', 'neutral');
  return h.ok === true ? badge('OK', 'ok') : h.ok === false ? badge('DOWN', 'bad') : badge('—', 'neutral');
}
function loading(msg = 'Loading…') {
  view.innerHTML = `<div class="loading-card">${esc(msg)}</div>`;
}
function showError(err) {
  view.innerHTML = `<div class="error-card"><strong>Error</strong>${esc(err?.error || err?.message || 'Unknown error')}</div>`;
}

// ─── Tenant picker ─────────────────────────────────────────────────
async function loadTenants() {
  const d = await api('/api/admin/tenants');
  if (!d.ok) return;
  state.tenants = d.tenants || [];
  const sel = $('tenantSelect');
  const current = state.tenant || sel.value;
  sel.innerHTML = '<option value="">All tenants</option>' +
    state.tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)}</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  state.tenant = sel.value;
}
$('tenantSelect').addEventListener('change', () => {
  state.tenant = $('tenantSelect').value;
  refresh();
});

// ─── Status pill ──────────────────────────────────────────────────
async function updateStatusPill() {
  const pill = $('statusPill'), text = $('statusText');
  try {
    const d = await api('/api/admin/overview');
    if (!d.ok) throw new Error(d.error);
    const o = d.overview;
    const postgresOk = o.postgres === false ? true : true; // optional
    const redisOk = o.redis === false ? true : true; // optional
    const mlOk = o.mlTrained;
    pill.classList.remove('ok', 'bad');
    if (mlOk) { pill.classList.add('ok'); text.textContent = `v${o.version} · up ${fmtUptime(o.uptimeSeconds)}`; }
    else { text.textContent = `v${o.version} · ML not trained`; }
  } catch (e) {
    pill.classList.add('bad');
    text.textContent = 'Admin token required';
  }
}

// ─── Routes ────────────────────────────────────────────────────────
const ROUTES = {
  overview: { title: 'Overview', subtitle: 'Live system status and key metrics.', render: renderOverview },
  tenants: { title: 'Tenants', subtitle: 'All configured tenant businesses.', render: renderTenants },
  onboard: { title: 'Onboard Business', subtitle: 'Create a new business from a template in under 2 minutes.', render: renderOnboard },
  conversations: { title: 'Conversations', subtitle: 'Recent conversation replays across all tenants.', render: renderConversations },
  leads: { title: 'Leads', subtitle: 'Customer leads captured by the conversation engine.', render: renderLeads },
  ml: { title: 'ML Insights', subtitle: 'Intent classifier, feedback loop, and online learner.', render: renderML },
  capabilities: { title: 'Capabilities', subtitle: 'Registered capability adapters and their manifests.', render: renderCapabilities },
  datasets: { title: 'Test Runner', subtitle: 'Run conversation datasets and view pass/fail.', render: renderDatasets },
  notifications: { title: 'Notifications', subtitle: 'Business owner email alerts and notification log.', render: renderNotifications },
  inspector: { title: 'Data Inspector', subtitle: 'Inspect live state, CRM, cart, and bookings for any tenant/customer.', render: renderInspector },
  settings: { title: 'Settings', subtitle: 'Admin dashboard configuration and runtime info.', render: renderSettings }
};

// ─── Nav ───────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.route));
});
function navigate(route) {
  if (!ROUTES[route]) route = 'overview';
  state.route = route;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  const r = ROUTES[route];
  $('pageTitle').textContent = r.title;
  $('pageSubtitle').textContent = r.subtitle;
  refresh();
}
async function refresh() {
  const r = ROUTES[state.route];
  if (!r) return;
  loading();
  try {
    await r.render();
  } catch (e) {
    showError(e);
  }
}
$('refreshBtn').addEventListener('click', refresh);

// ─── 1. Overview ───────────────────────────────────────────────────
async function renderOverview() {
  const [overviewRes, healthRes] = await Promise.all([
    api('/api/admin/overview'),
    fetch('/health').then(r => r.json()).catch(() => null)
  ]);
  if (!overviewRes.ok) return showError(overviewRes);
  state.overview = overviewRes.overview;

  const o = state.overview;
  const storage = healthRes?.storage || {};
  const kpis = [
    { label: 'Version', value: `v${o.version}`, kind: 'accent', delta: `Uptime ${fmtUptime(o.uptimeSeconds)}` },
    { label: 'Tenants', value: o.tenantCount, kind: '', delta: `${o.tenantIds.join(', ').slice(0, 60) || '—'}` },
    { label: 'Capabilities', value: o.capabilityCount, kind: '', delta: o.capabilityIds.join(', ') },
    { label: 'ML Classifier', value: o.mlTrained ? 'Trained' : 'Idle', kind: o.mlTrained ? 'ok' : 'warn', delta: o.mlVersion },
    { label: 'Storage Mode', value: o.storageMode || 'file', kind: '', delta: `${o.postgres ? 'PG ' : ''}${o.redis ? 'Redis' : ''}`.trim() || 'local files' },
    { label: 'Memory (RSS)', value: `${o.memoryMb} MB`, kind: '', delta: 'Process resident set' }
  ];

  // Capability health table
  const capHealthRows = (o.capabilityHealth || []).map(h => `
    <tr>
      <td class="mono">${esc(h.id || h.capabilityId || '—')}</td>
      <td>${healthBadge(h)}</td>
      <td class="muted">${esc(h.error || h.message || '—')}</td>
    </tr>`).join('');

  // Storage status
  const storageRows = [
    `<tr><td>Mode</td><td>${badge(esc(storage.mode || 'file'), 'info')}</td></tr>`,
    storage.postgres ? `<tr><td>PostgreSQL</td><td>${healthBadge(storage.postgres)} ${storage.postgres?.ok ? `· poolMax ${storage.postgres.poolMax}` : ''}</td></tr>` : '',
    storage.redis ? `<tr><td>Redis</td><td>${healthBadge(storage.redis)} ${storage.redis?.ok ? `· TTL ${storage.redis.ttlSeconds}s` : ''}</td></tr>` : '',
    storage.feedback ? `<tr><td>Feedback dir</td><td class="mono">${esc(storage.feedback.storageDir || '—')}</td></tr>` : '',
    storage.ml ? `<tr><td>ML model</td><td>${badge(esc(storage.ml.version || '—'), 'info')} · ${storage.ml.trained ? badge('trained', 'ok') : badge('idle', 'warn')}</td></tr>` : ''
  ].join('');

  view.innerHTML = `
    <div class="kpi-grid">
      ${kpis.map(k => `
        <div class="kpi ${k.kind}">
          <div class="label">${esc(k.label)}</div>
          <div class="value">${esc(k.value)}</div>
          <div class="delta">${esc(k.delta)}</div>
        </div>`).join('')}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Capability Health</h3>
        ${capHealthRows ? `<div class="table-wrap"><table><thead><tr><th>Capability</th><th>Status</th><th>Notes</th></tr></thead><tbody>${capHealthRows}</tbody></table></div>` : '<div class="empty">No capabilities registered.</div>'}
      </div>
      <div class="card">
        <h3>Storage & ML</h3>
        ${storageRows ? `<div class="table-wrap"><table><tbody>${storageRows}</tbody></table></div>` : '<div class="empty">No storage info.</div>'}
        ${o.feedbackDir ? `<p class="hint" style="margin-top:10px">Feedback collected to: <code>${esc(o.feedbackDir)}</code></p>` : ''}
      </div>
    </div>

    ${o.onlineLearnerLastRun ? `
      <div class="card">
        <h3>Last Online Learner Run</h3>
        <pre class="tight">${json(o.onlineLearnerLastRun)}</pre>
      </div>` : ''}
  `;
}

// ─── 2. Tenants ────────────────────────────────────────────────────
// ─── Onboard Business wizard (v30.1) ─────────────────────────────────
async function renderOnboard() {
  // Load templates
  const tplRes = await api('/api/admin/templates');
  const templates = tplRes.ok ? tplRes.templates : [];

  view.innerHTML = `
    <div class="card">
      <h3>Onboard a new business</h3>
      <p class="hint" style="margin-bottom:14px">Pick a template (or build a custom one), enter business details, customize branding, and get an embed snippet in under 2 minutes.</p>

      <div id="wizard">
        <h4 style="margin:14px 0 8px;font-size:13px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Step 1 · Pick a template</h4>
        <div class="template-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px"></div>

        <div id="wizard-step2" style="display:none">
          <h4 style="margin:14px 0 8px;font-size:13px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Step 2 · Business details</h4>
          <div class="grid-2" style="margin-bottom:16px">
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Business name *</label>
              <input id="ob-name" placeholder="CleanPro Dubai" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Tenant ID (auto-generated from name)</label>
              <input id="ob-tenant-id" placeholder="auto (cleanpro-dubai)" style="width:100%;background:var(--surface-2);color:var(--text-faint);border:1px solid var(--border);border-radius:8px;padding:9px;font-size:13px" disabled>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Owner email *</label>
              <input id="ob-email" type="email" placeholder="owner@business.com" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Owner phone</label>
              <input id="ob-phone" placeholder="+971 50 123 4567" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Business hours</label>
              <input id="ob-hours" placeholder="Mon-Sat, 8 AM - 8 PM" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Location</label>
              <input id="ob-location" placeholder="Dubai, UAE" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div style="grid-column:1/-1">
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Business description</label>
              <input id="ob-description" placeholder="Premium cleaning services in Dubai" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
          </div>

          <h4 style="margin:14px 0 8px;font-size:13px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Step 3 · Widget branding</h4>
          <div class="grid-3" style="margin-bottom:16px">
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Theme color</label>
              <input id="ob-color" type="color" value="#2d5bd1" style="width:100%;height:38px;background:var(--surface-3);border:1px solid var(--border-strong);border-radius:8px;cursor:pointer">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Agent name</label>
              <input id="ob-agent-name" placeholder="Sarah" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Agent avatar</label>
              <select id="ob-agent-avatar" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
                <option value="marcus">Marcus (Support)</option>
                <option value="aria">Aria (Customer Success)</option>
                <option value="sophie">Sophie (Booking Agent)</option>
                <option value="david">David (Concierge)</option>
                <option value="emma">Emma (Consultant)</option>
                <option value="liam">Liam (Assistant)</option>
                <option value="natalie">Natalie (Coordinator)</option>
                <option value="james">James (Representative)</option>
                <option value="olivia">Olivia (Support)</option>
                <option value="noah">Noah (Guide)</option>
              </select>
            </div>
          </div>

          <button class="primary" id="ob-create" style="margin-top:8px">🚀 Create business & get embed snippet</button>
        </div>

        <div id="wizard-custom" style="display:none">
          <h4 style="margin:14px 0 8px;font-size:13px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Step 2 · Define custom business type</h4>
          <div class="grid-2" style="margin-bottom:16px">
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Template ID (lowercase, hyphens)</label>
              <input id="ct-id" placeholder="gym-template" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Label</label>
              <input id="ct-label" placeholder="Gym / Fitness" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Icon (emoji)</label>
              <input id="ct-icon" placeholder="💪" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Domain</label>
              <input id="ct-domain" placeholder="fitness" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
            </div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Description</label>
            <input id="ct-description" placeholder="Gym memberships, class bookings, personal training" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
          </div>
          <div style="margin-bottom:16px">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Capabilities (comma-separated from: assistant, crm, cleaning, pricing, availability, catalog, commerce, offering, booking)</label>
            <input id="ct-capabilities" value="assistant, crm, offering, booking" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
          </div>
          <div style="margin-bottom:16px">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Services (one per line: name | price | currency | unit)</label>
            <textarea id="ct-services" rows="4" placeholder="Monthly Membership | 200 | AED | per month&#10;Personal Training | 150 | AED | per session" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px;font-family:inherit"></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Welcome message</label>
            <input id="ct-welcome" placeholder="Hi! 👋 Welcome to {{business_name}}. How can I help?" style="width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px">
          </div>
          <button class="primary" id="ct-create" style="margin-top:8px">✨ Create custom template</button>
          <span style="margin-left:10px;color:var(--text-faint);font-size:12px">After creating, you can onboard businesses from it.</span>
        </div>

        <div id="wizard-result" style="display:none;margin-top:16px"></div>
      </div>
    </div>
  `;

  // Build template cards HTML separately to avoid nested template literal issues
  const templateCardsHtml = templates.length === 0
    ? '<div class="empty">No templates found. Run the extract-templates.js script first.</div>'
    : templates.map(t => `<div class="template-card" data-template="${esc(t.id)}" style="background:var(--surface-2);border:2px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .12s"><div style="font-size:28px;margin-bottom:6px">${esc(t.icon || '🏢')}</div><div style="font-weight:600;font-size:14px">${esc(t.label)}</div><div style="font-size:11px;color:var(--text-faint);margin-top:4px">${esc(t.description || '')}</div><div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${(t.capabilities||[]).map(c => badge(c, 'info')).join('')}${t.isCustom ? badge('custom', 'warn') : ''}</div></div>`).join('') + '<div class="template-card" data-template="custom" style="background:var(--surface-2);border:2px dashed var(--border-strong);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .12s"><div style="font-size:28px;margin-bottom:6px">✨</div><div style="font-weight:600;font-size:14px">Build from scratch</div><div style="font-size:11px;color:var(--text-faint);margin-top:4px">Create a custom template for a totally new business type (gym, vet clinic, real estate, etc.)</div></div>';

  // Inject template cards into the wizard
  const grid = document.querySelector('.template-grid');
  if (grid) grid.innerHTML = templateCardsHtml;

  // Wire template card clicks
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      const templateId = card.dataset.template;
      // Highlight selected card
      document.querySelectorAll('.template-card').forEach(c => c.style.borderColor = 'var(--border)');
      card.style.borderColor = 'var(--accent)';

      if (templateId === 'custom') {
        $('wizard-step2').style.display = 'none';
        $('wizard-custom').style.display = 'block';
        $('wizard-result').style.display = 'none';
      } else {
        $('wizard-custom').style.display = 'none';
        $('wizard-step2').style.display = 'block';
        $('wizard-result').style.display = 'none';
        // Auto-fill welcome message based on template
        const tpl = templates.find(t => t.id === templateId);
        if (tpl) {
          $('ob-agent-name').value = tpl.label.split(' ')[0] + ' Assistant';
        }
      }
    });
  });

  // Wire create tenant button
  if ($('ob-create')) {
    $('ob-create').addEventListener('click', async () => {
      const name = $('ob-name').value.trim();
      const email = $('ob-email').value.trim();
      if (!name || !email) { alert('Business name and owner email are required'); return; }

      $('ob-create').disabled = true;
      $('ob-create').textContent = 'Creating…';

      const body = {
        templateId: document.querySelector('.template-card[style*="border-color: var(--accent)"], .template-card[style*="border-color:var(--accent)"]')?.dataset.template,
        businessName: name,
        ownerEmail: email,
        ownerPhone: $('ob-phone').value.trim(),
        hours: $('ob-hours').value.trim(),
        location: $('ob-location').value.trim(),
        description: $('ob-description').value.trim(),
        themeColor: $('ob-color').value,
        agentName: $('ob-agent-name').value.trim(),
        agentAvatar: $('ob-agent-avatar').value
      };

      const r = await api('/api/admin/tenants/create', { method: 'POST', body: JSON.stringify(body) });
      $('ob-create').disabled = false;
      $('ob-create').textContent = '🚀 Create business & get embed snippet';

      const result = $('wizard-result');
      result.style.display = 'block';
      if (r.ok) {
        result.innerHTML = `
          <div class="card" style="border-color:var(--ok)">
            <h3 style="color:var(--ok)">✅ Business created!</h3>
            <p><strong>${esc(r.tenant.name)}</strong> (${esc(r.tenant.id)}) is now live.</p>
            <h4 style="margin-top:14px">Embed snippet</h4>
            <pre>${esc(r.embedSnippet)}</pre>
            <div class="toolbar" style="margin-top:12px">
              <button onclick="navigator.clipboard.writeText(\`${r.embedSnippet.replace(/`/g,'\\`')}\`);alert('Copied!')">📋 Copy snippet</button>
              <button onclick="window.open('/widget-test','_blank')">🧪 Test widget</button>
              <button onclick="window.open('/admin','_blank')">📊 Open dashboard</button>
            </div>
          </div>
        `;
      } else {
        result.innerHTML = `<div class="error-card"><strong>Failed</strong>${esc(r.error || 'Unknown error')}</div>`;
      }
    });
  }

  // Wire create custom template button
  if ($('ct-create')) {
    $('ct-create').addEventListener('click', async () => {
      const id = $('ct-id').value.trim();
      const label = $('ct-label').value.trim();
      if (!id || !label) { alert('Template ID and label are required'); return; }

      $('ct-create').disabled = true;
      $('ct-create').textContent = 'Creating…';

      const services = $('ct-services').value.trim().split('\n').filter(Boolean).map(line => {
        const [name, price, currency, unit] = line.split('|').map(s => s.trim());
        return { name, priceType: 'fixed', price: Number(price) || 0, currency: currency || 'AED', unit: unit || 'per service' };
      });

      const body = {
        id, label,
        description: $('ct-description').value.trim(),
        icon: $('ct-icon').value.trim() || '🏢',
        domain: $('ct-domain').value.trim() || 'generic',
        capabilities: $('ct-capabilities').value.split(',').map(s => s.trim()).filter(Boolean),
        services,
        welcomeMessage: $('ct-welcome').value.trim() || 'Hi! 👋 Welcome to {{business_name}}. How can I help?'
      };

      const r = await api('/api/admin/templates/create', { method: 'POST', body: JSON.stringify(body) });
      $('ct-create').disabled = false;
      $('ct-create').textContent = '✨ Create custom template';

      const result = $('wizard-result');
      result.style.display = 'block';
      if (r.ok) {
        result.innerHTML = `<div class="card" style="border-color:var(--ok)"><h3 style="color:var(--ok)">✅ Custom template created!</h3><p>Template <strong>${esc(r.templateId)}</strong> is now available. Click it above to onboard a business from it.</p></div>`;
        // Reload wizard to show new template
        setTimeout(() => renderOnboard(), 2000);
      } else {
        result.innerHTML = `<div class="error-card"><strong>Failed</strong>${esc(r.error || 'Unknown error')}</div>`;
      }
    });
  }
}

async function renderTenants() {
  if (!state.tenants.length) await loadTenants();
  const tenants = state.tenants;
  if (!tenants.length) return view.innerHTML = `
    <div class="empty">
      <strong>No tenants yet</strong>
      <p>Create your first business from a template.</p>
      <button class="primary" onclick="document.querySelector('[data-route=onboard]').click()">🚀 Onboard a business</button>
    </div>`;

  view.innerHTML = `
    <div class="toolbar" style="margin-bottom:14px">
      <button class="primary" onclick="document.querySelector('[data-route=onboard]').click()">+ Onboard new business</button>
      <input id="tenantSearch" placeholder="Search tenants…" style="flex:1;min-width:200px">
      <select id="templateFilter">
        <option value="">All templates</option>
        <option value="custom">Custom only</option>
        <option value="cleaning-template">Cleaning</option>
        <option value="retail-template">Retail</option>
        <option value="salon-template">Salon</option>
        <option value="restaurant-template">Restaurant</option>
      </select>
    </div>
    <div class="tenant-grid" id="tenantGrid">
      ${tenants.map(t => `
        <div class="tenant-card" data-tenant="${esc(t.id)}" data-template="${esc(t.templateId || 'custom')}" data-name="${esc(t.name.toLowerCase())}">
          <div class="name">${esc(t.name)} ${t.templateId ? badge(t.templateId.replace('-template',''), 'neutral') : badge('custom', 'warn')}</div>
          <div class="id">${esc(t.id)} · ${esc(t.domain || 'generic')}</div>
          <div class="desc">${esc(t.description || 'No description.')}</div>
          <div class="muted" style="font-size:11px">
            ${t.assistantName ? `Assistant: ${esc(t.assistantName)}` : ''}<br>
            ${t.contact ? `Contact: ${esc(t.contact)}` : ''}<br>
            ${t.currency ? `Currency: ${esc(t.currency)}` : ''}
          </div>
          <div class="caps">
            ${(t.capabilities || []).map(c => badge(c, 'info')).join('')}
            ${t.widgetEnabled ? badge('widget', 'ok') : badge('widget off', 'warn')}
            ${t.notificationsEnabled ? badge('notifications', 'ok') : badge('notifications off', 'warn')}
          </div>
          ${t.stats ? `<div class="muted" style="font-size:11px;margin-top:6px">Leads: ${t.stats.leads || 0} · Notifications: ${t.stats.notifications || 0}</div>` : ''}
        </div>`).join('')}
    </div>
  `;
  document.querySelectorAll('.tenant-card').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.tenant;
      $('tenantSelect').value = id;
      state.tenant = id;
      navigate('conversations');
    });
  });
  // Wire search + filter
  const search = $('tenantSearch');
  const filter = $('templateFilter');
  const applyFilter = () => {
    const q = search.value.toLowerCase();
    const tpl = filter.value;
    document.querySelectorAll('.tenant-card').forEach(card => {
      const nameMatch = !q || card.dataset.name.includes(q);
      const tplMatch = !tpl || (tpl === 'custom' ? card.dataset.template === 'custom' : card.dataset.template === tpl);
      card.style.display = (nameMatch && tplMatch) ? '' : 'none';
    });
  };
  search.addEventListener('input', applyFilter);
  filter.addEventListener('change', applyFilter);
}

// ─── 3. Conversations / Replays ────────────────────────────────────
async function renderConversations() {
  loading('Loading recent conversations…');
  const d = await api('/api/admin/replays?limit=100');
  if (!d.ok) return showError(d);
  state.replays = d.replays || [];

  const tenant = state.tenant;
  const filtered = tenant ? state.replays.filter(r => r.tenantId === tenant) : state.replays;

  view.innerHTML = `
    <div class="card">
      <h3>Recent Conversations ${tenant ? `· ${esc(tenant)}` : '· all tenants'} (${filtered.length})</h3>
      ${filtered.length === 0 ? '<div class="empty"><strong>No replays yet</strong>Send messages via the Developer Console or public chat to populate replays.</div>' : `
        <div class="replay-list">
          ${filtered.slice(0, 100).map(r => `
            <div class="replay-row" data-replay="${esc(r.id)}">
              <div class="meta">
                ${esc(fmtDate(r.createdAt))}<br>
                <span class="muted">${esc(r.tenantId || '—')} · ${esc(r.customerId || '—')}</span>
              </div>
              <div class="text">${esc(r.message?.text || r.customerText || '(no text)')}</div>
              <div class="tag">${r.capabilityId ? badge(r.capabilityId, 'info') : badge('—', 'neutral')}</div>
            </div>`).join('')}
        </div>`}
    </div>
    <div class="card">
      <h3>Selected Replay Detail</h3>
      <pre id="replayDetail">Select a replay above to inspect.</pre>
    </div>
  `;
  document.querySelectorAll('.replay-row').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.replay;
      const detail = $('replayDetail');
      detail.textContent = 'Loading…';
      // Try the /api/dev/replays/{id} endpoint (same auth)
      const r = await fetch(`/api/dev/replays/${encodeURIComponent(id)}`, { headers: headers() });
      const data = await r.json();
      detail.textContent = json(data.replay || data);
    });
  });
}

// ─── 4. Leads ──────────────────────────────────────────────────────
async function renderLeads() {
  const tenant = state.tenant;
  if (!tenant) {
    return view.innerHTML = `
      <div class="empty">
        <strong>Select a tenant</strong>
        Choose a tenant from the top-right dropdown to view its leads.
      </div>`;
  }
  loading(`Loading leads for ${tenant}…`);
  const d = await api(`/api/admin/leads/${encodeURIComponent(tenant)}`);
  if (!d.ok) return showError(d);

  const { summary, leads } = d;
  const summaryCards = [
    { label: 'Total leads', value: summary?.total || leads.length || 0, kind: 'accent' },
    { label: 'Open', value: summary?.open || leads.filter(l => (l.status || 'open') === 'open').length, kind: 'ok' },
    { label: 'Converted', value: summary?.converted || leads.filter(l => l.status === 'converted').length, kind: 'ok' },
    { label: 'Lost', value: summary?.lost || leads.filter(l => l.status === 'lost').length, kind: 'bad' }
  ];

  const leadRows = (leads || []).map(l => {
    const score = l.score || 0;
    const scoreClass = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
    return `
      <tr>
        <td class="mono">${esc(l.id || '—')}</td>
        <td>${esc(l.contact?.name || l.customerId || '—')}</td>
        <td class="muted">${esc(l.contact?.phone || l.contact?.email || '—')}</td>
        <td>${badge(esc(l.status || 'open'), l.status === 'converted' ? 'ok' : l.status === 'lost' ? 'bad' : 'info')}</td>
        <td><span class="score ${scoreClass}">${score}</span></td>
        <td class="muted">${esc(fmtDate(l.createdAt || l.updatedAt))}</td>
        <td class="muted">${esc((l.interests || []).map(i => i.value).join(', ') || '—')}</td>
      </tr>`;
  }).join('');

  view.innerHTML = `
    <div class="kpi-grid">${summaryCards.map(k => `
      <div class="kpi ${k.kind}">
        <div class="label">${esc(k.label)}</div>
        <div class="value">${esc(k.value)}</div>
      </div>`).join('')}</div>
    <div class="card">
      <h3>Leads · ${esc(tenant)}</h3>
      ${leads.length === 0 ? '<div class="empty"><strong>No leads yet</strong>Leads appear here when the conversation engine captures contact info, service intent, or transaction signals.</div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Contact</th><th>Status</th><th>Score</th><th>Created</th><th>Interests</th></tr></thead>
            <tbody>${leadRows}</tbody>
          </table>
        </div>`}
    </div>
    <div class="card">
      <h3>Lead summary</h3>
      <pre class="tight">${json(summary)}</pre>
    </div>
  `;
}

// ─── 5. ML Insights ────────────────────────────────────────────────
async function renderML() {
  loading('Loading ML status…');
  const d = await api('/api/admin/ml/status');
  if (!d.ok) return showError(d);
  state.mlStatus = d.status;
  const s = state.mlStatus;

  const ml = s.mlClassifier || {};
  const fb = s.feedbackCollector || {};
  const ol = s.onlineLearner || {};
  const tr = s.transformer || {};
  const pm = s.productEmbeddingMatcher || {};

  // Per-tenant table
  const perTenantRows = (fb.perTenant || []).map(t => `
    <tr>
      <td class="mono">${esc(t.tenantId)}</td>
      <td>${t.counts.total}</td>
      <td>${badge(`+${t.counts.positive}`, 'ok')}</td>
      <td>${badge(`-${t.counts.negative}`, 'bad')}</td>
      <td>
        <button class="small" data-feedback-tenant="${esc(t.tenantId)}">View examples</button>
      </td>
    </tr>`).join('');

  view.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi ${ml.trained ? 'ok' : 'warn'}">
        <div class="label">ML Classifier</div>
        <div class="value">${ml.trained ? 'Trained' : 'Idle'}</div>
        <div class="delta">${esc(ml.version || '—')} · ${ml.classCount || 0} classes</div>
      </div>
      <div class="kpi ${tr.initialized ? 'ok' : 'warn'}">
        <div class="label">Transformer</div>
        <div class="value">${tr.initialized ? 'Loaded' : 'Idle'}</div>
        <div class="delta">${tr.multilingualLoaded ? 'multilingual' : 'english-only'}</div>
      </div>
      <div class="kpi accent">
        <div class="label">Feedback examples</div>
        <div class="value">${fb.totalExamples || 0}</div>
        <div class="delta ok">+${fb.totalPositive || 0} positive</div>
        <div class="delta bad">-${fb.totalNegative || 0} negative</div>
      </div>
      <div class="kpi ${ol.lastRetrain?.learned ? 'ok' : 'warn'}">
        <div class="label">Online learner</div>
        <div class="value">${ol.lastRetrain?.learned ? 'Updated' : 'Pending'}</div>
        <div class="delta">${ol.lastRetrain ? fmtDate(ol.lastRetrain.retrainedAt || ol.lastRetrain.timestamp) : 'never run'}</div>
      </div>
    </div>

    <div class="card">
      <h3>Components</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><td>ML Intent Classifier</td><td>${ml.trained ? badge('trained', 'ok') : badge('idle', 'warn')} ${badge(esc(ml.version || '—'), 'info')}</td></tr>
            <tr><td>Hybrid Router</td><td>${s.hybridRouter?.enabled ? badge('enabled', 'ok') : badge('off', 'neutral')}</td></tr>
            <tr><td>Transformer Embeddings</td><td>${tr.enabled ? badge('enabled', 'ok') : badge('disabled', 'neutral')} ${tr.initialized ? badge('initialized', 'ok') : badge('lazy', 'warn')}</td></tr>
            <tr><td>Product Embedding Matcher</td><td>${pm.enabled ? badge('enabled', 'ok') : badge('disabled', 'neutral')}</td></tr>
            <tr><td>Feedback Collector</td><td>${badge('active', 'ok')} <span class="muted">${esc(fb.storageDir || '—')}</span></td></tr>
            <tr><td>Online Learner</td><td>${ol.enabled ? badge('enabled', 'ok') : badge('disabled', 'neutral')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Feedback per tenant</h3>
      ${perTenantRows ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tenant</th><th>Total</th><th>Positive</th><th>Negative</th><th></th></tr></thead>
            <tbody>${perTenantRows}</tbody>
          </table>
        </div>` : '<div class="empty"><strong>No feedback yet</strong>Positive and negative conversation outcomes will be auto-collected here as users interact with the system.</div>'}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Online learner status</h3>
        <p class="hint">The online learner retrains the ML intent classifier using positive examples collected by the feedback loop. It only runs on demand to avoid surprising model drift.</p>
        <div class="toolbar" style="margin-top:12px">
          <button class="primary" id="retrainBtn">⟳ Retrain now</button>
          <label>min examples <input type="number" id="minExamples" value="5" min="1" style="width:80px"></label>
          <label>min positive ratio <input type="number" id="minPositiveRatio" value="0" min="0" max="1" step="0.05" style="width:80px"></label>
        </div>
        <pre class="tight" id="retrainResult">${ol.lastRetrain ? json(ol.lastRetrain) : 'No retrain has been run yet.'}</pre>
      </div>
      <div class="card">
        <h3>Last retrain detail</h3>
        <pre class="tight">${ol.lastRetrain ? json(ol.lastRetrain) : '—'}</pre>
        <p class="hint" style="margin-top:10px">${esc(ol.status || '')}</p>
      </div>
    </div>

    <div class="card">
      <h3>Feedback examples</h3>
      <pre id="feedbackExamples" class="tight">Click "View examples" on a tenant row above.</pre>
    </div>
  `;

  // Wire retrain button
  $('retrainBtn').addEventListener('click', async () => {
    const btn = $('retrainBtn');
    btn.disabled = true; btn.textContent = 'Retraining…';
    const result = $('retrainResult');
    result.textContent = 'Running…';
    const minEx = Number($('minExamples').value || 5);
    const minRatio = Number($('minPositiveRatio').value || 0);
    const d = await api('/api/admin/online-learner/run', {
      method: 'POST',
      body: JSON.stringify({ minExamples: minEx, minPositiveRatio: minRatio })
    });
    btn.disabled = false; btn.textContent = '⟳ Retrain now';
    result.textContent = json(d);
  });

  // Wire feedback example viewer
  document.querySelectorAll('[data-feedback-tenant]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tenantId = btn.dataset.feedbackTenant;
      const target = $('feedbackExamples');
      target.textContent = `Loading feedback for ${tenantId}…`;
      const d = await api(`/api/admin/feedback/${encodeURIComponent(tenantId)}`);
      target.textContent = json(d);
    });
  });
}

// ─── 6. Capabilities ──────────────────────────────────────────────
async function renderCapabilities() {
  loading('Loading capabilities…');
  const d = await api('/api/dev/capabilities');
  if (!d.ok) return showError(d);
  const caps = d.capabilities || [];

  view.innerHTML = `
    <div class="cap-grid">
      ${caps.map(c => {
        const m = c.manifest || {};
        return `
          <div class="cap-card">
            <div class="id">${esc(c.id)}</div>
            <div class="desc">${esc(m.description || 'No description.')}</div>
            <div class="meta">
              ${m.version ? badge(`v${m.version}`, 'info') : ''}
              ${m.conversational ? badge('conversational', 'ok') : ''}
              ${m.readOnly ? badge('read-only', 'neutral') : ''}
            </div>
            ${m.intents?.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--text-dim)">${m.intents.length} intents</summary><pre class="tight" style="margin-top:8px">${json(m.intents)}</pre></details>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;
}

// ─── 7. Test Runner (Datasets) ─────────────────────────────────────
async function renderDatasets() {
  loading('Loading datasets…');
  const d = await api('/api/admin/datasets');
  if (!d.ok) return showError(d);
  state.datasets = d.datasets || [];

  const rows = state.datasets.map(ds => `
    <tr>
      <td class="mono">${esc(ds.path)}</td>
      <td>${ds.tenantId ? badge(esc(ds.tenantId), 'info') : badge('—', 'neutral')}</td>
      <td>${ds.caseCount}</td>
      <td>${ds.turnCount}</td>
      <td><button class="small primary" data-run="${esc(ds.path)}">Run</button></td>
    </tr>`).join('');

  view.innerHTML = `
    <div class="card">
      <h3>Conversation datasets</h3>
      <p class="hint">Each dataset is a JSON file under <code>tests/datasets/</code>. Running a dataset replays every conversation turn through the live engine and reports per-case pass/fail.</p>
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr><th>Dataset</th><th>Tenant</th><th>Cases</th><th>Turns</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Run result</h3>
      <pre id="datasetResult" class="tight">Click "Run" on a dataset to execute it.</pre>
    </div>
  `;

  document.querySelectorAll('[data-run]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const path = btn.dataset.run;
      btn.disabled = true; btn.textContent = 'Running…';
      const target = $('datasetResult');
      target.textContent = `Running ${path}…`;
      const d = await api('/api/admin/datasets/run', { method: 'POST', body: JSON.stringify({ dataset: path }) });
      btn.disabled = false; btn.textContent = 'Run';
      target.textContent = json(d);
    });
  });
}

// ─── 8. Data Inspector ─────────────────────────────────────────────
// ─── 9. Notifications (v30.0) ────────────────────────────────────────
async function renderNotifications() {
  const tenant = state.tenant;
  if (!tenant) {
    return view.innerHTML = `
      <div class="empty">
        <strong>Select a tenant</strong>
        Choose a tenant from the top-right dropdown to view notifications.
      </div>`;
  }
  loading(`Loading notifications for ${tenant}…`);
  const d = await api(`/api/admin/notifications/${encodeURIComponent(tenant)}?limit=100`);
  if (!d.ok) return showError(d);

  const { notifications, unreadCount, totalCount, emailService } = d;
  const kpis = [
    { label: 'Unread', value: unreadCount, kind: unreadCount > 0 ? 'bad' : 'ok' },
    { label: 'Total', value: totalCount, kind: '' },
    { label: 'Email status', value: emailService?.configured ? 'Configured' : 'Dev mode', kind: emailService?.configured ? 'ok' : 'warn' },
    { label: 'Recipients', value: (state.notifPrefs?.recipientEmails || []).length, kind: '' }
  ];

  const notifRows = (notifications || []).map(n => {
    const typeIcons = { booking_confirmed: '📅', order_placed: '🛒', lead_captured: '🎯', handoff_requested: '🤝', nova_failed: '⚠️' };
    const icon = typeIcons[n.eventType] || '•';
    const typeBadge = n.eventType.replace(/_/g, ' ');
    const emailBadge = n.email?.sent ? badge('sent', 'ok') : n.email?.devMode ? badge('dev', 'warn') : n.email?.queued ? badge('queued', 'info') : badge('logged', 'neutral');
    return `
      <tr data-notif-id="${esc(n.id)}" style="cursor:pointer">
        <td>${icon}</td>
        <td>${badge(esc(typeBadge), 'info')}</td>
        <td>${esc(n.subject || '—')}</td>
        <td class="muted">${esc(fmtDate(n.createdAt))}</td>
        <td>${n.readAt ? badge('read', 'neutral') : badge('unread', 'warn')}</td>
        <td>${emailBadge}</td>
      </tr>`;
  }).join('');

  view.innerHTML = `
    <div class="kpi-grid">
      ${kpis.map(k => `
        <div class="kpi ${k.kind}">
          <div class="label">${esc(k.label)}</div>
          <div class="value">${esc(k.value)}</div>
        </div>`).join('')}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Recent notifications ${tenant ? `· ${esc(tenant)}` : ''}</h3>
        ${notifications.length === 0 ? '<div class="empty"><strong>No notifications yet</strong>Trigger a booking, order, or lead to see notifications appear here.<br><br><button class="primary" id="refreshNotif">⟳ Refresh</button></div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th></th><th>Type</th><th>Subject</th><th>Created</th><th>Status</th><th>Email</th></tr></thead>
              <tbody>${notifRows}</tbody>
            </table>
          </div>
          <div class="toolbar" style="margin-top:12px">
            <button class="primary" id="markAllRead">Mark all as read</button>
            <button id="refreshNotif">⟳ Refresh</button>
          </div>`}
      </div>

      <div class="card">
        <h3>Email configuration</h3>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td>SMTP host</td><td class="mono">${esc(emailService?.host || '—')}</td></tr>
              <tr><td>Port</td><td>${esc(emailService?.port || '—')}</td></tr>
              <tr><td>User</td><td class="mono">${esc(emailService?.user || '—')}</td></tr>
              <tr><td>From</td><td class="mono">${esc(emailService?.from || '—')}</td></tr>
              <tr><td>Status</td><td>${emailService?.configured ? badge('configured', 'ok') : badge('dev mode (log only)', 'warn')}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="hint" style="margin-top:10px">Set <code>NOVA_SMTP_HOST</code>, <code>NOVA_SMTP_USER</code>, <code>NOVA_SMTP_PASS</code>, <code>NOVA_SMTP_FROM</code> env vars to enable real email sending. In dev mode, emails are logged but not sent.</p>
        <button id="testSmtp" style="margin-top:8px">Test SMTP connection</button>
        <pre id="smtpTestResult" class="tight" style="margin-top:8px"></pre>
      </div>
    </div>

    <div class="card">
      <h3>Notification preferences</h3>
      <div id="prefsEditor">Loading preferences…</div>
    </div>

    <div class="card">
      <h3>Selected notification detail</h3>
      <pre id="notifDetail" class="tight">Click a notification row above to inspect.</pre>
    </div>
  `;

  // Wire row clicks
  document.querySelectorAll('[data-notif-id]').forEach(row => {
    row.addEventListener('click', async () => {
      const id = row.dataset.notifId;
      const target = $('notifDetail');
      target.textContent = 'Loading…';
      const notif = (notifications || []).find(n => n.id === id);
      if (notif) {
        target.textContent = json(notif);
        // Mark as read
        if (!notif.readAt) {
          await api(`/api/admin/notifications/${encodeURIComponent(tenant)}/${encodeURIComponent(id)}/read`, { method: 'POST' });
        }
      }
    });
  });

  // Wire buttons only if they exist (empty state doesn't render them)
  const markAllReadBtn = $('markAllRead');
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async () => {
      const r = await api(`/api/admin/notifications/${encodeURIComponent(tenant)}`, { method: 'POST', body: JSON.stringify({}) });
      if (r.ok) { renderNotifications(); }
    });
  }
  const refreshNotifBtn = $('refreshNotif');
  if (refreshNotifBtn) refreshNotifBtn.addEventListener('click', renderNotifications);
  const testSmtpBtn = $('testSmtp');
  if (testSmtpBtn) {
    testSmtpBtn.addEventListener('click', async () => {
      const r = await api('/api/admin/notifications/email/test');
      $('smtpTestResult').textContent = json(r);
    });
  }

  // Load preferences
  loadNotificationPrefs(tenant);
}

async function loadNotificationPrefs(tenant) {
  const r = await api(`/api/admin/notifications/${encodeURIComponent(tenant)}/preferences`);
  const editor = document.querySelector('#prefsEditor');
  if (!r.ok) { editor.textContent = 'Failed to load: ' + r.error; return; }
  state.notifPrefs = r.preferences;
  const prefs = r.preferences;
  editor.innerHTML = `
    <div class="row">
      <div class="label">Notifications enabled</div>
      <div class="value">
        <label><input type="checkbox" id="prefEnabled" ${prefs.enabled ? 'checked' : ''}> Send email notifications</label>
      </div>
    </div>
    <div class="row">
      <div class="label">Recipient emails</div>
      <div class="value">
        <input id="prefEmails" value="${esc((prefs.recipientEmails || []).join(', '))}" placeholder="owner@business.com, staff@business.com" style="width:100%;font-family:inherit;background:#172139;color:#e8edf7;border:1px solid #34415f;border-radius:8px;padding:9px;font-size:13px">
        <p class="hint" style="margin-top:4px">Comma-separated list. All recipients receive every notification.</p>
      </div>
    </div>
    <div class="row">
      <div class="label">Events to notify on</div>
      <div class="value">
        ${Object.entries(prefs.events || {}).map(([k,v]) => `
          <label style="display:block;margin:4px 0">
            <input type="checkbox" data-event="${esc(k)}" ${v ? 'checked' : ''}> ${esc(k.replace(/_/g,' '))}
          </label>`).join('')}
      </div>
    </div>
    <div class="row">
      <div class="label">Quiet hours</div>
      <div class="value">
        <label><input type="checkbox" id="prefQuietEnabled" ${prefs.quietHours?.enabled ? 'checked' : ''}> Enable quiet hours (queue emails for next morning)</label>
        <div style="margin-top:6px">
          Start: <input type="time" id="prefQuietStart" value="${esc(prefs.quietHours?.start || '22:00')}" style="background:#172139;color:#e8edf7;border:1px solid #34415f;border-radius:6px;padding:5px">
          End: <input type="time" id="prefQuietEnd" value="${esc(prefs.quietHours?.end || '07:00')}" style="background:#172139;color:#e8edf7;border:1px solid #34415f;border-radius:6px;padding:5px">
        </div>
      </div>
    </div>
    <div class="row">
      <div class="label">Daily digest</div>
      <div class="value">
        <label><input type="checkbox" id="prefDigestEnabled" ${prefs.dailyDigest?.enabled ? 'checked' : ''}> Send one summary email at</label>
        <input type="time" id="prefDigestTime" value="${esc(prefs.dailyDigest?.sendAt || '09:00')}" style="background:#172139;color:#e8edf7;border:1px solid #34415f;border-radius:6px;padding:5px;margin-left:8px">
      </div>
    </div>
    <div class="toolbar" style="margin-top:14px">
      <button class="primary" id="savePrefs">Save preferences</button>
    </div>
    <pre id="prefSaveResult" class="tight" style="margin-top:10px"></pre>
  `;

  $('savePrefs').addEventListener('click', async () => {
    const newPrefs = {
      enabled: $('prefEnabled').checked,
      recipientEmails: $('prefEmails').value.split(',').map(s => s.trim()).filter(Boolean),
      events: {},
      quietHours: {
        enabled: $('prefQuietEnabled').checked,
        start: $('prefQuietStart').value,
        end: $('prefQuietEnd').value,
        timezone: prefs.quietHours?.timezone || 'UTC'
      },
      dailyDigest: {
        enabled: $('prefDigestEnabled').checked,
        sendAt: $('prefDigestTime').value
      }
    };
    document.querySelectorAll('[data-event]').forEach(cb => {
      newPrefs.events[cb.dataset.event] = cb.checked;
    });
    const r = await api(`/api/admin/notifications/${encodeURIComponent(tenant)}/preferences`, {
      method: 'PUT',
      body: JSON.stringify({ preferences: newPrefs })
    });
    $('prefSaveResult').textContent = json(r);
    if (r.ok) state.notifPrefs = r.preferences;
  });
}

async function renderInspector() {
  const tenant = state.tenant || (state.tenants[0]?.id || '');
  const customerId = state.inspectorCustomerId || 'playground-user';

  view.innerHTML = `
    <div class="card">
      <h3>Inspect customer state</h3>
      <p class="hint">Pulls live state, CRM record, cart, orders, bookings, calendar, and inventory for the selected tenant + customer.</p>
      <div class="toolbar" style="margin-top:12px">
        <label>Tenant
          <select id="inspTenant">
            ${(state.tenants.length ? state.tenants : []).map(t => `<option value="${esc(t.id)}" ${t.id === tenant ? 'selected' : ''}>${esc(t.name)} · ${esc(t.id)}</option>`).join('')}
          </select>
        </label>
        <label>Customer ID
          <input id="inspCustomer" value="${esc(customerId)}" placeholder="playground-user">
        </label>
        <button class="primary" id="inspRun">Inspect</button>
      </div>
    </div>
    <div class="card">
      <h3>Result</h3>
      <pre id="inspResult" class="tight">Click "Inspect" to load data.</pre>
    </div>
  `;

  $('inspRun').addEventListener('click', async () => {
    const t = $('inspTenant').value;
    const c = $('inspCustomer').value || 'playground-user';
    state.inspectorCustomerId = c;
    const r = $('inspResult');
    r.textContent = 'Loading…';
    const d = await api(`/api/dev/data/inspect?tenantId=${encodeURIComponent(t)}&customerId=${encodeURIComponent(c)}&channel=playground`);
    r.textContent = json(d);
  });
}

// ─── 9. Settings ───────────────────────────────────────────────────
async function renderSettings() {
  const o = state.overview || (await api('/api/admin/overview')).overview || {};
  view.innerHTML = `
    <div class="card">
      <h3>Runtime</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><td>Version</td><td class="mono">v${esc(o.version || '—')}</td></tr>
            <tr><td>Uptime</td><td>${esc(fmtUptime(o.uptimeSeconds))}</td></tr>
            <tr><td>Memory (RSS)</td><td>${esc(o.memoryMb || '—')} MB</td></tr>
            <tr><td>Storage mode</td><td>${badge(esc(o.storageMode || 'file'), 'info')}</td></tr>
            <tr><td>PostgreSQL</td><td>${o.postgres ? badge('connected', 'ok') : badge('off', 'neutral')}</td></tr>
            <tr><td>Redis</td><td>${o.redis ? badge('connected', 'ok') : badge('off', 'neutral')}</td></tr>
            <tr><td>ML trained</td><td>${o.mlTrained ? badge('yes', 'ok') : badge('no', 'warn')}</td></tr>
            <tr><td>Feedback dir</td><td class="mono">${esc(o.feedbackDir || '—')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Admin token</h3>
      <p class="hint">The dashboard uses the same <code>NOVA_DEV_TOKEN</code> as the Developer Console. In local development, no token is required. In production (<code>NODE_ENV=production</code>), requests without a valid token are rejected with 401.</p>
      <div class="toolbar" style="margin-top:12px">
        <input id="tokenInput" type="password" placeholder="Set admin token" value="${esc(state.devToken)}" style="flex:1;min-width:200px">
        <button class="primary" id="saveToken">Save</button>
        <button class="danger" id="clearToken">Clear</button>
      </div>
    </div>

    <div class="card">
      <h3>Useful links</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><td>Developer Console</td><td><a href="/developer" target="_blank" rel="noopener" style="color:var(--accent-strong)">/developer ↗</a></td></tr>
            <tr><td>Public chat widget</td><td><a href="/assistant" target="_blank" rel="noopener" style="color:var(--accent-strong)">/assistant ↗</a></td></tr>
            <tr><td>Health endpoint</td><td><a href="/health" target="_blank" rel="noopener" style="color:var(--accent-strong)">/health ↗</a></td></tr>
            <tr><td>Repo root</td><td class="mono">/home/z/my-project/nova-assistant</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>About Nova Admin Dashboard</h3>
      <p class="hint" style="line-height:1.6">v27.0 operator console for the Nova Assistant multi-tenant engagement engine. Surfaces system health, tenant inventory, recent conversations, captured leads, ML classifier and feedback-loop status, capability manifests, and a one-click dataset runner. All actions reuse the existing <code>/api/dev/*</code> authorization so no new secrets are introduced.</p>
    </div>
  `;

  $('saveToken').addEventListener('click', () => {
    state.devToken = $('tokenInput').value;
    localStorage.setItem('novaDevToken', state.devToken);
    $('devToken').value = state.devToken;
    refresh();
  });
  $('clearToken').addEventListener('click', () => {
    state.devToken = '';
    localStorage.removeItem('novaDevToken');
    $('tokenInput').value = '';
    $('devToken').value = '';
    refresh();
  });
}

// ─── Boot ──────────────────────────────────────────────────────────
async function boot() {
  // Initial parallel loads
  await loadTenants().catch(() => {});
  await updateStatusPill().catch(() => {});
  await refresh();
  // Refresh status pill every 30s
  setInterval(updateStatusPill, 30000);
}
boot();
