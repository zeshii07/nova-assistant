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
  conversations: { title: 'Conversations', subtitle: 'Recent conversation replays across all tenants.', render: renderConversations },
  leads: { title: 'Leads', subtitle: 'Customer leads captured by the conversation engine.', render: renderLeads },
  ml: { title: 'ML Insights', subtitle: 'Intent classifier, feedback loop, and online learner.', render: renderML },
  capabilities: { title: 'Capabilities', subtitle: 'Registered capability adapters and their manifests.', render: renderCapabilities },
  datasets: { title: 'Test Runner', subtitle: 'Run conversation datasets and view pass/fail.', render: renderDatasets },
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
async function renderTenants() {
  if (!state.tenants.length) await loadTenants();
  const tenants = state.tenants;
  if (!tenants.length) return view.innerHTML = '<div class="empty"><strong>No tenants</strong>Create one via the Developer Console Onboarding Studio.</div>';

  view.innerHTML = `
    <div class="tenant-grid">
      ${tenants.map(t => `
        <div class="tenant-card" data-tenant="${esc(t.id)}">
          <div class="name">${esc(t.name)}</div>
          <div class="id">${esc(t.id)} · ${esc(t.domain || 'generic')}</div>
          <div class="desc">${esc(t.description || 'No description.')}</div>
          <div class="muted" style="font-size:11px">
            ${t.assistantName ? `Assistant: ${esc(t.assistantName)}` : ''}<br>
            ${t.contact ? `Contact: ${esc(t.contact)}` : ''}<br>
            ${t.currency ? `Currency: ${esc(t.currency)}` : ''}
          </div>
          <div class="caps">
            ${(t.capabilities || []).map(c => badge(c, 'info')).join('')}
          </div>
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
