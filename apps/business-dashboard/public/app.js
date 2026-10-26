/* ============================================================
   Nova Business Manager Dashboard — v32.0
   Separate dashboard for business owners.
   Owners log in with email+password and see ONLY their tenant's data.
   ============================================================ */

const $ = id => document.getElementById(id);
const app = $('app');

// ─── State ────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('novaBusinessToken') || null,
  owner: null,
  route: 'overview'
};

// ─── Helpers ──────────────────────────────────────────────
function json(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function fmtDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return iso; } }
function badge(text, kind = 'neutral') { return `<span class="badge ${kind}">${esc(text)}</span>`; }

function headers() {
  const h = { 'content-type': 'application/json' };
  if (state.token) h['authorization'] = `Bearer ${state.token}`;
  return h;
}

async function api(path, options = {}) {
  const r = await fetch(path, { headers: { ...headers(), ...(options.headers || {}) }, ...options });
  const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  return data;
}

// ─── Login / Logout ───────────────────────────────────────
function renderLogin() {
  app.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Business Dashboard</h1>
        <p>Log in to manage your conversations, bookings, and leads.</p>
        <form id="loginForm">
          <label>Tenant ID</label>
          <input id="loginTenant" placeholder="byt-cleaners-dubai" value="${esc(localStorage.getItem('novaBusinessTenant') || '')}">
          <label>Email</label>
          <input id="loginEmail" type="email" placeholder="owner@business.com" value="${esc(localStorage.getItem('novaBusinessEmail') || '')}">
          <label>Password</label>
          <input id="loginPassword" type="password" placeholder="Your password">
          <button type="submit" class="primary">Log in</button>
        </form>
        <p style="margin-top:16px;font-size:11px;color:var(--text-faint)">
          Don't have an account? Ask your Nova operator to create one for you,
          or register below if this is the first owner for this tenant.
        </p>
        <button id="showRegister" style="width:100%;margin-top:8px">Register (first owner only)</button>
        <div id="registerForm" style="display:none;margin-top:16px">
          <label>Name</label>
          <input id="regName" placeholder="John Doe">
          <label>Email</label>
          <input id="regEmail" type="email" placeholder="owner@business.com">
          <label>Password (min 6 chars)</label>
          <input id="regPassword" type="password">
          <button type="button" id="regBtn" class="primary" style="margin-top:12px">Create account</button>
        </div>
        <div id="loginError" style="margin-top:12px;color:var(--bad);font-size:12px"></div>
      </div>
    </div>
  `;

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tenantId = $('loginTenant').value.trim();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!tenantId || !email || !password) return;
    const r = await api('/api/business/login', { method: 'POST', body: JSON.stringify({ tenantId, email, password }) });
    if (r.ok) {
      state.token = r.token;
      state.owner = r.owner;
      localStorage.setItem('novaBusinessToken', r.token);
      localStorage.setItem('novaBusinessTenant', tenantId);
      localStorage.setItem('novaBusinessEmail', email);
      boot();
    } else {
      $('loginError').textContent = r.error || 'Login failed';
    }
  });

  $('showRegister').addEventListener('click', () => {
    const form = $('registerForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  $('regBtn')?.addEventListener('click', async () => {
    const tenantId = $('loginTenant').value.trim();
    const email = $('regEmail').value.trim();
    const password = $('regPassword').value;
    const name = $('regName').value.trim();
    if (!tenantId || !email || !password) return;
    const r = await api('/api/business/register', { method: 'POST', body: JSON.stringify({ tenantId, email, password, name }) });
    if (r.ok) {
      $('loginError').style.color = 'var(--ok)';
      $('loginError').textContent = 'Account created! You can now log in.';
      $('loginEmail').value = email;
    } else {
      $('loginError').textContent = r.error || 'Registration failed';
    }
  });
}

function logout() {
  state.token = null;
  state.owner = null;
  localStorage.removeItem('novaBusinessToken');
  renderLogin();
}

// ─── Dashboard Layout ─────────────────────────────────────
const ROUTES = {
  overview: { title: 'Overview', render: renderOverview },
  inbox: { title: 'Inbox', render: renderInbox },
  bookings: { title: 'Bookings', render: renderBookings },
  leads: { title: 'Leads', render: renderLeads },
  customers: { title: 'Customers', render: renderCustomers },
  voice: { title: 'Voice Studio', render: renderVoiceStudio },
  kiosk: { title: 'Kiosk & QR', render: renderKiosk },
  notifications: { title: 'Notifications', render: renderNotifications },
  settings: { title: 'Settings', render: renderSettings }
};

function renderDashboard() {
  const navItems = Object.entries(ROUTES).map(([key, r]) =>
    `<button class="nav-item ${state.route === key ? 'active' : ''}" data-route="${key}">${r.title}</button>`
  ).join('');

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <strong>${esc(state.owner?.name || 'Business')}</strong>
          <span>${esc(state.owner?.tenantId || '')}</span>
        </div>
        <nav class="nav">${navItems}</nav>
        <div class="sidebar-footer">
          <button onclick="logout()" style="width:100%">Log out</button>
        </div>
      </aside>
      <main class="content">
        <header class="content-header">
          <div>
            <h1 id="pageTitle">${ROUTES[state.route].title}</h1>
            <p class="muted" id="pageSubtitle"></p>
          </div>
        </header>
        <section id="view" class="view">Loading…</section>
      </main>
    </div>
  `;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.route = btn.dataset.route;
      renderDashboard();
    });
  });

  ROUTES[state.route].render();
}

// ─── Overview ─────────────────────────────────────────────
async function renderOverview() {
  const view = $('view');
  view.textContent = 'Loading…';
  const d = await api('/api/business/overview');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const s = d.stats;
  const kpis = [
    { label: 'Conversations Today', value: s.conversationsToday, kind: 'accent' },
    { label: 'Total Conversations', value: s.conversationsTotal, kind: '' },
    { label: 'Total Leads', value: s.leads, kind: '' },
    { label: 'New Leads', value: s.newLeads, kind: 'ok' },
    { label: 'Hot Leads', value: s.hotLeads, kind: 'bad' },
    { label: 'Converted', value: s.convertedLeads, kind: 'ok' },
    { label: 'Unread Notifications', value: s.unreadNotifications, kind: s.unreadNotifications > 0 ? 'warn' : '' },
    { label: 'Bookings Today', value: s.bookingsToday, kind: 'accent' }
  ];

  view.innerHTML = `
    <div class="kpi-grid">
      ${kpis.map(k => `<div class="kpi ${k.kind}"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div></div>`).join('')}
    </div>
    <div class="card">
      <h3>Business Info</h3>
      <p><strong>${esc(d.tenant.name)}</strong> (${esc(d.tenant.id)})</p>
      <p style="margin-top:4px;color:var(--text-dim);font-size:12px">Domain: ${esc(d.tenant.domain)} · Capabilities: ${d.tenant.capabilities.join(', ')}</p>
    </div>
  `;
}

// ─── Inbox (v33.0: with conversation detail + takeover/reply) ────
async function renderInbox() {
  const view = $('view');
  view.textContent = 'Loading conversations…';
  const d = await api('/api/business/conversations');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const convos = d.conversations || [];
  if (convos.length === 0) {
    view.innerHTML = `<div class="card"><div class="empty"><strong>No conversations yet</strong>Conversations will appear here when customers chat with your widget.</div></div>`;
    return;
  }

  view.innerHTML = `
    <div class="card">
      <h3>Recent Conversations (${convos.length})</h3>
      <p class="hint" style="margin-bottom:10px;font-size:12px;color:var(--text-dim)">Click a conversation to view details, reply, or take over from Nova.</p>
      <table>
        <thead><tr><th>Date</th><th>Customer</th><th>Message</th><th>Channel</th><th>Capability</th><th></th></tr></thead>
        <tbody>
          ${convos.slice(0, 50).map(c => `
            <tr style="cursor:pointer" data-customer="${esc(c.customerId || '')}">
              <td class="muted" style="font-size:11px">${esc(fmtDate(c.createdAt))}</td>
              <td>${esc(c.customerId || '—')}</td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.message?.text || c.customerText || '—')}</td>
              <td>${badge(esc(c.channel || 'widget'), 'info')}</td>
              <td>${c.capabilityId ? badge(esc(c.capabilityId), c.capabilityId === 'human_takeover' ? 'warn' : 'neutral') : '—'}</td>
              <td><button class="small" style="padding:4px 8px;font-size:11px">View →</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Wire row clicks to show conversation detail
  document.querySelectorAll('[data-customer]').forEach(row => {
    row.addEventListener('click', () => {
      const customerId = row.dataset.customer;
      if (customerId) showConversationDetail(customerId);
    });
  });
}

// v33.0: Conversation detail view with takeover/reply/release
async function showConversationDetail(customerId) {
  const view = $('view');
  view.textContent = 'Loading conversation…';
  const d = await api(`/api/business/conversation/${encodeURIComponent(customerId)}`);
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const { takeover, pendingMessages, messages } = d;
  const isActive = takeover.active;

  // Build conversation timeline
  const timeline = messages.map(m => {
    const isOwner = m.isOwner;
    const role = isOwner ? 'owner' : (m.capabilityId === 'human_takeover' ? 'nova-hold' : 'nova');
    const roleLabel = isOwner ? '👤 You' : (m.capabilityId === 'human_takeover' ? '🤖 Nova (on hold)' : '🤖 Nova');
    return `
      <div style="margin-bottom:12px;padding:10px 14px;background:${isOwner ? 'var(--accent)' : 'var(--surface-2)'};border-radius:10px;${isOwner ? 'margin-left:40px' : 'margin-right:40px'}">
        <div style="font-size:11px;color:${isOwner ? '#fff' : 'var(--text-dim)'};margin-bottom:4px">${roleLabel} · ${esc(fmtDate(m.createdAt))}</div>
        ${m.text ? `<div style="font-size:13px;color:${isOwner ? '#fff' : 'var(--text)'}">${esc(m.text)}</div>` : ''}
        ${m.reply ? `<div style="font-size:13px;color:${isOwner ? '#fff' : 'var(--text)'};margin-top:6px;padding-top:6px;border-top:1px solid ${isOwner ? 'rgba(255,255,255,.2)' : 'var(--border)'}">${esc(m.reply)}</div>` : ''}
      </div>`;
  }).join('');

  // Build pending messages (from customer while takeover active)
  const pendingHtml = pendingMessages.length > 0 ? `
    <div style="margin:12px 0;padding:10px;background:rgba(245,181,74,.1);border-radius:8px;border:1px solid rgba(245,181,74,.3)">
      <strong style="font-size:12px;color:var(--warn)">📋 Pending customer messages (${pendingMessages.length}):</strong>
      ${pendingMessages.map(m => `<div style="margin-top:6px;font-size:12px;color:var(--text-dim)">${esc(m.text)} <span style="font-size:10px">(${esc(fmtDate(m.timestamp))})</span></div>`).join('')}
    </div>` : '';

  view.innerHTML = `
    <div style="margin-bottom:16px">
      <button id="backToInbox" style="margin-bottom:12px">← Back to Inbox</button>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <h3 style="margin:0">Conversation: ${esc(customerId)}</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-dim)">
            ${isActive
              ? `🟡 Takeover active by ${esc(takeover.ownerName || 'owner')} since ${esc(fmtDate(takeover.takenAt))}`
              : '🤖 Nova is handling this conversation'
            }
          </p>
        </div>
        <div>
          ${isActive
            ? `<button class="danger" id="releaseBtn">Release to Nova</button>`
            : `<button class="primary" id="takeoverBtn">Take Over</button>`
          }
        </div>
      </div>

      ${pendingHtml}

      <div style="max-height:400px;overflow-y:auto;margin-bottom:16px">
        ${timeline || '<div class="empty">No messages in this conversation yet.</div>'}
      </div>

      <div style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1">
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Reply to customer</label>
          <textarea id="replyText" placeholder="Type your reply…" rows="2" style="resize:none;width:100%;background:var(--surface-3);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;padding:9px;font-size:13px;font-family:inherit"></textarea>
        </div>
        <button class="primary" id="sendReplyBtn" style="margin-bottom:0">Send Reply</button>
      </div>
      <p class="hint" style="margin-top:6px;font-size:11px;color:var(--text-dim)">
        When you reply, Nova stops auto-responding for this conversation. The customer sees your message on their next interaction or via live polling.
      </p>
    </div>
  `;

  // Wire buttons
  $('backToInbox').addEventListener('click', renderInbox);

  const takeoverBtn = $('takeoverBtn');
  if (takeoverBtn) {
    takeoverBtn.addEventListener('click', async () => {
      const r = await api('/api/business/takeover', { method: 'POST', body: JSON.stringify({ customerId }) });
      if (r.ok) showConversationDetail(customerId);
    });
  }

  const releaseBtn = $('releaseBtn');
  if (releaseBtn) {
    releaseBtn.addEventListener('click', async () => {
      if (!confirm('Release this conversation back to Nova? Nova will resume auto-replying.')) return;
      const r = await api('/api/business/release', { method: 'POST', body: JSON.stringify({ customerId }) });
      if (r.ok) showConversationDetail(customerId);
    });
  }

  $('sendReplyBtn').addEventListener('click', async () => {
    const text = $('replyText').value.trim();
    if (!text) return;
    $('sendReplyBtn').disabled = true;
    $('sendReplyBtn').textContent = 'Sending…';
    const r = await api('/api/business/reply', { method: 'POST', body: JSON.stringify({ customerId, text }) });
    $('sendReplyBtn').disabled = false;
    $('sendReplyBtn').textContent = 'Send Reply';
    if (r.ok) {
      $('replyText').value = '';
      showConversationDetail(customerId); // refresh to show new reply
    }
  });
}

// ─── Bookings ─────────────────────────────────────────────
async function renderBookings() {
  const view = $('view');
  view.textContent = 'Loading bookings…';
  const d = await api('/api/business/bookings');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const requests = d.serviceRequests || [];
  const bookings = d.bookings || [];
  view.innerHTML = `
    <div class="card">
      <h3>Service Requests (${requests.length})</h3>
      ${requests.length === 0 ? '<div class="empty">No service requests yet.</div>' : `
        <table>
          <thead><tr><th>ID</th><th>Service</th><th>Date</th><th>Time</th><th>Customer</th><th>Status</th></tr></thead>
          <tbody>
            ${requests.slice(0, 50).map(r => `
              <tr>
                <td class="muted" style="font-size:11px">${esc(r.id || '—')}</td>
                <td>${esc(r.serviceName || '—')}</td>
                <td>${esc(r.preferredDate || '—')}</td>
                <td>${esc(r.preferredTime || '—')}</td>
                <td>${esc(r.customerName || r.customerId || '—')}</td>
                <td>${badge(esc(r.status || 'pending'), r.status === 'confirmed' ? 'ok' : 'warn')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>
    <div class="card">
      <h3>Calendar Bookings (${bookings.length})</h3>
      ${bookings.length === 0 ? '<div class="empty">No calendar bookings yet.</div>' : `<pre>${json(bookings.slice(0, 10))}</pre>`}
    </div>
  `;
}

// ─── Leads ────────────────────────────────────────────────
async function renderLeads() {
  const view = $('view');
  view.textContent = 'Loading leads…';
  const d = await api('/api/business/leads');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const { summary, leads } = d;
  view.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi accent"><div class="label">Total Leads</div><div class="value">${summary.total || 0}</div></div>
      <div class="kpi ok"><div class="label">New</div><div class="value">${summary.new || 0}</div></div>
      <div class="kpi warn"><div class="label">Engaged</div><div class="value">${summary.engaged || 0}</div></div>
      <div class="kpi bad"><div class="label">Hot</div><div class="value">${summary.hot || 0}</div></div>
      <div class="kpi ok"><div class="label">Converted</div><div class="value">${summary.converted || 0}</div></div>
    </div>
    <div class="card">
      <h3>Recent Leads (${leads.length})</h3>
      ${leads.length === 0 ? '<div class="empty">No leads yet.</div>' : `
        <table>
          <thead><tr><th>Name</th><th>Contact</th><th>Score</th><th>Grade</th><th>Status</th><th>Interests</th><th>Created</th></tr></thead>
          <tbody>
            ${leads.slice(0, 50).map(l => `
              <tr>
                <td>${esc(l.contact?.name || l.customerId || 'Anonymous')}</td>
                <td class="muted" style="font-size:11px">${esc(l.contact?.phone || l.contact?.email || '—')}</td>
                <td>${badge(esc(l.score || 0), l.score >= 70 ? 'ok' : l.score >= 40 ? 'warn' : 'bad')}</td>
                <td>${badge(esc(l.grade || '—'), l.grade === 'hot' ? 'bad' : l.grade === 'warm' ? 'warn' : 'neutral')}</td>
                <td>${badge(esc(l.status || 'new'), l.status === 'converted' ? 'ok' : l.status === 'lost' ? 'bad' : 'info')}</td>
                <td class="muted" style="font-size:11px">${esc((l.interests || []).map(i => i.value).join(', ') || '—')}</td>
                <td class="muted" style="font-size:11px">${esc(fmtDate(l.createdAt))}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>
  `;
}

// ─── Customers ─────────────────────────────────────────────
async function renderCustomers() {
  const view = $('view');
  view.textContent = 'Loading customers…';
  const d = await api('/api/business/customers');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const customers = d.customers || [];
  view.innerHTML = `
    <div class="card">
      <h3>Customers (${customers.length})</h3>
      ${customers.length === 0 ? '<div class="empty">No customers yet.</div>' : `
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Leads</th><th>Status</th><th>Last Activity</th></tr></thead>
          <tbody>
            ${customers.slice(0, 50).map(c => `
              <tr>
                <td>${esc(c.name)}</td>
                <td class="muted">${esc(c.phone || '—')}</td>
                <td class="muted">${esc(c.email || '—')}</td>
                <td>${c.leadCount}</td>
                <td>${badge(esc(c.status || 'new'), 'info')}</td>
                <td class="muted" style="font-size:11px">${esc(fmtDate(c.lastActivity))}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>
  `;
}

// ─── Notifications ────────────────────────────────────────
async function renderNotifications() {
  const view = $('view');
  view.textContent = 'Loading notifications…';
  const d = await api('/api/business/notifications');
  if (!d.ok) { view.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(d.error)}</p></div>`; return; }

  const notifications = d.notifications || [];
  view.innerHTML = `
    <div class="card">
      <h3>Notifications (${notifications.length}, ${d.unreadCount} unread)</h3>
      ${notifications.length === 0 ? '<div class="empty">No notifications yet.</div>' : `
        <table>
          <thead><tr><th>Type</th><th>Subject</th><th>Created</th><th>Status</th></tr></thead>
          <tbody>
            ${notifications.slice(0, 50).map(n => `
              <tr>
                <td>${badge(esc(n.eventType?.replace(/_/g,' ') || '—'), 'info')}</td>
                <td>${esc(n.subject || '—')}</td>
                <td class="muted" style="font-size:11px">${esc(fmtDate(n.createdAt))}</td>
                <td>${n.readAt ? badge('read', 'neutral') : badge('unread', 'warn')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>
  `;
}

// ─── Voice Studio (v34.2: Voice Cloning UI) ───────────────
// Business owners can:
//   1. Record a voice sample directly in the browser (MediaRecorder API)
//   2. Upload an audio file (.webm/.mp3/.wav/.m4a/.ogg)
//   3. Configure browser TTS voice (rate, pitch, volume, voice name)
//   4. Preview the kiosk interface where the voice will be used
async function renderVoiceStudio() {
  const view = $('view');
  view.innerHTML = `
    <div class="card">
      <h3>Voice Cloning — How It Works</h3>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6">
        Upload or record a short voice sample (10–30 seconds works best).
        When customers chat through your <a href="${window.location.origin}/kiosk/${esc(state.owner?.tenantId || '')}" target="_blank" style="color:var(--accent-strong)">kiosk page</a>
        or website widget with voice replies on, they'll hear your voice signature at the start of each Nova reply.
        The actual reply text is spoken by the browser's text-to-speech engine — but your sample plays first as a recognizable voice tag.
      </p>
      <p style="font-size:12px;color:var(--text-faint);margin-top:8px">
        Tip: record yourself saying something like "Hi, this is John from CleanPro. Thanks for reaching out — I'll help you with that right away."
      </p>
    </div>

    <div class="card" id="voiceStatusCard">
      <h3>Current Voice Sample</h3>
      <div id="voiceStatus">Loading…</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Option 1 — Record in Browser</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Use your microphone to record a clip directly. Chrome or Edge recommended.</p>
        <div id="recordControls" style="display:flex;flex-direction:column;gap:10px;align-items:center;padding:14px;background:var(--surface-2);border-radius:10px">
          <button class="primary" id="recordBtn" style="width:auto;padding:14px 28px;font-size:14px;border-radius:999px">🎤 Start Recording</button>
          <div id="recordTimer" style="font-family:ui-monospace,Consolas,monospace;font-size:24px;color:var(--text-dim)">00:00</div>
          <div id="recordHint" style="font-size:11px;color:var(--text-faint);text-align:center">Tap start, speak naturally, then tap stop. Mic permission will be requested.</div>
          <audio id="recordPreview" controls style="display:none;width:100%;margin-top:6px"></audio>
          <button class="primary" id="saveRecordedBtn" style="display:none;width:auto;padding:10px 20px">Save Recording</button>
        </div>
      </div>

      <div class="card">
        <h3>Option 2 — Upload Audio File</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Drag &amp; drop or browse. Formats: .webm, .mp3, .wav, .m4a, .ogg (max 5 MB).</p>
        <div id="dropZone" style="border:2px dashed var(--border-strong);border-radius:10px;padding:30px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s">
          <div style="font-size:32px;color:var(--text-faint)">📁</div>
          <div style="margin-top:8px;font-size:13px;color:var(--text-dim)">Click to browse or drop file here</div>
          <input type="file" id="fileInput" accept="audio/webm,audio/mp3,audio/mpeg,audio/wav,audio/m4a,audio/mp4,audio/ogg" style="display:none">
        </div>
        <div id="filePreview" style="display:none;margin-top:10px"></div>
        <button class="primary" id="uploadFileBtn" style="display:none;margin-top:10px">Upload File</button>
      </div>
    </div>

    <div class="card">
      <h3>Browser TTS Voice Settings</h3>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:14px">
        Configure how Nova speaks reply text in the kiosk/widget when voice replies are turned on.
        These settings are applied on top of your uploaded voice sample.
      </p>
      <div class="grid-2">
        <div>
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px">Voice name (from browser's available voices)</label>
          <input id="vpVoiceName" placeholder="e.g. Samantha, Aria, Jenny, Google US English">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px">Speaking rate (0.5 = slow, 1.0 = normal, 1.5 = fast)</label>
          <input id="vpRate" type="number" step="0.05" min="0.5" max="1.5" value="0.95">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px">Pitch (0.0 = low, 1.0 = normal, 2.0 = high)</label>
          <input id="vpPitch" type="number" step="0.1" min="0" max="2" value="1.0">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px">Volume (0.0 to 1.0)</label>
          <input id="vpVolume" type="number" step="0.05" min="0" max="1" value="0.85">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--text-dim);cursor:pointer">
        <input id="vpEnabled" type="checkbox" checked style="width:auto"> Voice profile enabled (apply these settings in kiosk/widget)
      </label>
      <button class="primary" id="saveVoiceProfileBtn" style="margin-top:14px">Save Voice Profile</button>
      <div id="voiceProfileStatus" style="margin-top:10px;font-size:12px"></div>
    </div>

    <div class="card">
      <h3>Preview &amp; Test</h3>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Open your kiosk page to test how customers will experience the voice replies.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <a class="primary" href="${window.location.origin}/kiosk/${esc(state.owner?.tenantId || '')}" target="_blank" style="padding:10px 18px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;display:inline-block">Open Kiosk Page ↗</a>
        <a href="${window.location.origin}/widget-test" target="_blank" style="padding:10px 18px;border-radius:8px;background:var(--surface-3);color:var(--text);text-decoration:none;display:inline-block;border:1px solid var(--border-strong)">Open Widget Test ↗</a>
        <button id="previewSampleBtn" style="padding:10px 18px">▶ Play Uploaded Sample</button>
      </div>
      <audio id="previewAudio" controls style="display:none;width:100%;margin-top:14px"></audio>
    </div>
  `;

  // Wire up controls
  voiceStudio_loadStatus();
  voiceStudio_wireRecord();
  voiceStudio_wireUpload();
  voiceStudio_wireProfile();
  voiceStudio_wirePreview();
}

// Load current voice sample status
async function voiceStudio_loadStatus() {
  const statusEl = $('voiceStatus');
  try {
    const r = await api('/api/business/voice/sample');
    if (!r.ok) {
      statusEl.innerHTML = `<p style="color:var(--bad);font-size:13px">${esc(r.error || 'Failed to load voice sample')}</p>`;
      return;
    }
    if (!r.hasSample) {
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(245,181,74,.1);border-radius:8px;border:1px solid rgba(245,181,74,.3)">
          <span style="font-size:20px">⚠️</span>
          <div>
            <strong style="font-size:13px;color:var(--warn)">No voice sample uploaded yet</strong>
            <p style="font-size:12px;color:var(--text-dim);margin-top:2px">Record or upload a clip below to add your voice signature to kiosk replies.</p>
          </div>
        </div>`;
      return;
    }
    const meta = r.meta || {};
    const sizeKb = Math.round((meta.size || 0) / 1024);
    const date = meta.uploadedAt ? new Date(meta.uploadedAt).toLocaleString() : '—';
    statusEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(61,220,151,.08);border-radius:8px;border:1px solid rgba(61,220,151,.3);margin-bottom:12px">
        <span style="font-size:20px">✅</span>
        <div style="flex:1">
          <strong style="font-size:13px;color:var(--ok)">Voice sample active</strong>
          <p style="font-size:12px;color:var(--text-dim);margin-top:2px">
            ${esc(meta.mimeType || 'audio')} · ${sizeKb} KB · uploaded ${esc(date)} by ${esc(meta.uploadedBy || '—')}
          </p>
        </div>
      </div>
      <audio controls src="${esc(r.voiceSampleUrl)}" style="width:100%;margin-bottom:10px"></audio>
      <button class="danger" id="deleteSampleBtn">Delete Sample</button>
    `;
    // Populate voice profile fields if present
    if (r.voiceProfile) {
      const vp = r.voiceProfile;
      if ($('vpVoiceName')) $('vpVoiceName').value = vp.voiceName || '';
      if ($('vpRate')) $('vpRate').value = vp.rate ?? 0.95;
      if ($('vpPitch')) $('vpPitch').value = vp.pitch ?? 1.0;
      if ($('vpVolume')) $('vpVolume').value = vp.volume ?? 0.85;
      if ($('vpEnabled')) $('vpEnabled').checked = vp.enabled !== false;
    }
    $('deleteSampleBtn')?.addEventListener('click', async () => {
      if (!confirm('Delete this voice sample? The kiosk/widget will fall back to browser TTS only.')) return;
      const del = await api('/api/business/voice/sample', { method: 'DELETE' });
      if (del.ok) {
        voiceStudio_loadStatus();
        showVoiceProfileStatus('Sample deleted.', 'ok');
      } else {
        showVoiceProfileStatus(del.error || 'Delete failed', 'bad');
      }
    });
  } catch (err) {
    statusEl.innerHTML = `<p style="color:var(--bad);font-size:13px">${esc(err.message)}</p>`;
  }
}

function showVoiceProfileStatus(text, kind) {
  const el = $('voiceProfileStatus');
  if (!el) return;
  const color = kind === 'ok' ? 'var(--ok)' : (kind === 'bad' ? 'var(--bad)' : 'var(--text-dim)');
  el.innerHTML = `<span style="color:${color};font-size:12px">${esc(text)}</span>`;
}

// In-browser recording via MediaRecorder API
let voiceStudio_mediaRecorder = null;
let voiceStudio_chunks = [];
let voiceStudio_timer = null;
let voiceStudio_startTime = 0;
let voiceStudio_recordedBlob = null;
let voiceStudio_recordedMimeType = null;

function voiceStudio_wireRecord() {
  const btn = $('recordBtn');
  const timerEl = $('recordTimer');
  const preview = $('recordPreview');
  const saveBtn = $('saveRecordedBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (voiceStudio_mediaRecorder && voiceStudio_mediaRecorder.state === 'recording') {
      // Stop recording
      voiceStudio_mediaRecorder.stop();
      return;
    }
    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStudio_chunks = [];
      // Pick a supported mime type
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      voiceStudio_recordedMimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
      voiceStudio_mediaRecorder = new MediaRecorder(stream, voiceStudio_recordedMimeType ? { mimeType: voiceStudio_recordedMimeType } : undefined);
      voiceStudio_mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceStudio_chunks.push(e.data);
      };
      voiceStudio_mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        voiceStudio_recordedBlob = new Blob(voiceStudio_chunks, { type: voiceStudio_recordedMimeType || 'audio/webm' });
        const url = URL.createObjectURL(voiceStudio_recordedBlob);
        preview.src = url;
        preview.style.display = 'block';
        saveBtn.style.display = 'inline-block';
        btn.textContent = '🎤 Record Again';
        btn.classList.remove('danger');
        btn.classList.add('primary');
        clearInterval(voiceStudio_timer);
        $('recordHint').textContent = 'Recorded ' + Math.round(voiceStudio_recordedBlob.size / 1024) + ' KB. Save to use as voice sample.';
      };
      voiceStudio_mediaRecorder.start();
      btn.textContent = '⏹ Stop Recording';
      btn.classList.remove('primary');
      btn.classList.add('danger');
      $('recordHint').textContent = 'Recording… speak now. Tap stop when done.';
      voiceStudio_startTime = Date.now();
      voiceStudio_timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - voiceStudio_startTime) / 1000);
        const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const ss = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = `${mm}:${ss}`;
      }, 250);
    } catch (err) {
      $('recordHint').innerHTML = `<span style="color:var(--bad)">Microphone access failed: ${esc(err.message)}</span>`;
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!voiceStudio_recordedBlob) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    // Convert blob to base64
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const r = await api('/api/business/voice/upload', {
          method: 'POST',
          body: JSON.stringify({
            contentBase64: base64,
            mimeType: voiceStudio_recordedMimeType || 'audio/webm',
            filename: 'recorded-sample' + (voiceStudio_recordedMimeType ? '.' + voiceStudio_recordedMimeType.split('/')[1].split(';')[0] : '.webm')
          })
        });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Recording';
        if (r.ok) {
          saveBtn.style.display = 'none';
          voiceStudio_loadStatus();
          showVoiceProfileStatus('Recording saved! Kiosk will use this clip.', 'ok');
        } else {
          showVoiceProfileStatus(r.error || 'Save failed', 'bad');
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Recording';
        showVoiceProfileStatus(err.message, 'bad');
      }
    };
    reader.readAsDataURL(voiceStudio_recordedBlob);
  });
}

// File upload (drag-drop + click to browse)
function voiceStudio_wireUpload() {
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  const preview = $('filePreview');
  const uploadBtn = $('uploadFileBtn');
  if (!dropZone) return;

  let selectedFile = null;

  dropZone.addEventListener('click', () => fileInput.click());
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.style.background = 'rgba(45, 91, 209, 0.08)';
      dropZone.style.borderColor = 'var(--accent)';
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.style.background = '';
      dropZone.style.borderColor = '';
    });
  });
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });

  function handleFileSelect(file) {
    if (!file.type.startsWith('audio/')) {
      preview.innerHTML = `<p style="color:var(--bad);font-size:12px">Please select an audio file (.webm, .mp3, .wav, .m4a, .ogg)</p>`;
      preview.style.display = 'block';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      preview.innerHTML = `<p style="color:var(--bad);font-size:12px">File is too large. Max 5 MB (yours is ${Math.round(file.size / 1024 / 1024)} MB).</p>`;
      preview.style.display = 'block';
      uploadBtn.style.display = 'none';
      return;
    }
    selectedFile = file;
    const url = URL.createObjectURL(file);
    preview.innerHTML = `
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${esc(file.name)} · ${Math.round(file.size / 1024)} KB · ${esc(file.type)}</div>
      <audio controls src="${url}" style="width:100%"></audio>
    `;
    preview.style.display = 'block';
    uploadBtn.style.display = 'inline-block';
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading…';
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const r = await api('/api/business/voice/upload', {
          method: 'POST',
          body: JSON.stringify({
            contentBase64: base64,
            mimeType: selectedFile.type,
            filename: selectedFile.name
          })
        });
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload File';
        if (r.ok) {
          voiceStudio_loadStatus();
          showVoiceProfileStatus('File uploaded! Kiosk will use this clip.', 'ok');
          // Reset drop zone
          preview.style.display = 'none';
          uploadBtn.style.display = 'none';
          fileInput.value = '';
          selectedFile = null;
        } else {
          showVoiceProfileStatus(r.error || 'Upload failed', 'bad');
        }
      } catch (err) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload File';
        showVoiceProfileStatus(err.message, 'bad');
      }
    };
    reader.readAsDataURL(selectedFile);
  });
}

// Voice profile (TTS settings) save
function voiceStudio_wireProfile() {
  const btn = $('saveVoiceProfileBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const payload = {
      enabled: $('vpEnabled').checked,
      voiceName: $('vpVoiceName').value.trim() || null,
      rate: parseFloat($('vpRate').value) || 0.95,
      pitch: parseFloat($('vpPitch').value) || 1.0,
      volume: parseFloat($('vpVolume').value) || 0.85
    };
    try {
      const r = await api('/api/business/voice/profile', { method: 'PUT', body: JSON.stringify(payload) });
      btn.disabled = false;
      btn.textContent = 'Save Voice Profile';
      if (r.ok) {
        showVoiceProfileStatus('Voice profile saved. Open the kiosk to test.', 'ok');
      } else {
        showVoiceProfileStatus(r.error || 'Save failed', 'bad');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save Voice Profile';
      showVoiceProfileStatus(err.message, 'bad');
    }
  });
}

// Preview play button
function voiceStudio_wirePreview() {
  const btn = $('previewSampleBtn');
  const audio = $('previewAudio');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      const r = await api('/api/business/voice/sample');
      if (!r.ok || !r.hasSample) {
        showVoiceProfileStatus('No sample uploaded yet. Record or upload one first.', 'bad');
        return;
      }
      audio.src = r.voiceSampleUrl;
      audio.style.display = 'block';
      audio.play();
    } catch (err) {
      showVoiceProfileStatus(err.message, 'bad');
    }
  });
}

// ─── Kiosk & QR (v34.2) ────────────────────────────────────
// Business owners can:
//   - See their kiosk URL (full-screen chat, no popup, mobile-first)
//   - Download / display QR code linking to the kiosk
//   - Embed the kiosk in an iframe
async function renderKiosk() {
  const view = $('view');
  const tid = state.owner?.tenantId || '';
  const kioskUrl = `${window.location.origin}/kiosk/${encodeURIComponent(tid)}`;
  // v35.3: QR code via self-hosted endpoint (no external API, no CSP violation)
  const qrImgUrl = `${window.location.origin}/api/qr/${encodeURIComponent(tid)}.png`;
  const qrSvgUrl = `${window.location.origin}/api/qr/${encodeURIComponent(tid)}.svg`;

  view.innerHTML = `
    <div class="card">
      <h3>Your Kiosk Page</h3>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6;margin-bottom:12px">
        The kiosk page is a single full-screen chat interface designed for tablets and phones mounted at your front desk,
        storefront, or reception. Customers walk up, tap "Start Conversation", and chat with Nova directly — no name or phone number required.
        Idle for 5 minutes? It auto-resets for the next visitor.
      </p>
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Kiosk URL</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <code style="font-size:13px;color:var(--text);word-break:break-all;flex:1">${esc(kioskUrl)}</code>
          <button id="copyKioskUrl" style="width:auto">Copy</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="primary" href="${esc(kioskUrl)}" target="_blank" style="padding:10px 18px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;display:inline-block">Open Kiosk ↗</a>
        <button id="downloadQrBtn" style="width:auto">Download QR Code (PNG)</button>
        <button id="downloadQrSvgBtn" style="width:auto">Download QR Code (SVG)</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="card" style="text-align:center">
        <h3>QR Code</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:14px">Print this and place it on your counter or shop window. Customers scan with their phone camera to open your kiosk chat.</p>
        <div style="background:#fff;padding:20px;border-radius:12px;display:inline-block">
          <img src="${esc(qrImgUrl)}" alt="QR code for ${esc(tid)} kiosk" style="width:240px;height:240px;display:block">
        </div>
        <p style="font-size:11px;color:var(--text-faint);margin-top:10px;word-break:break-all">Links to: ${esc(kioskUrl)}</p>
      </div>

      <div class="card">
        <h3>Embed Options</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:8px">Embed the kiosk in an iframe on any page:</p>
        <pre style="font-size:11px">&lt;iframe
  src="${esc(kioskUrl)}"
  style="width:100%;height:600px;border:0"
  title="Nova Kiosk"&gt;&lt;/iframe&gt;</pre>

        <p style="font-size:12px;color:var(--text-dim);margin:18px 0 8px">Or open in a new tab as a progressive web app:</p>
        <pre style="font-size:11px">On mobile: open ${esc(kioskUrl)}
→ browser menu → "Add to Home Screen"
→ launches full-screen like a native app</pre>

        <p style="font-size:12px;color:var(--text-dim);margin:18px 0 8px">Embed the standard widget (popup bubble) instead:</p>
        <pre style="font-size:11px">&lt;script
  src="${window.location.origin}/widget.js"
  data-tenant="${esc(tid)}"
  data-server="${window.location.origin}"
  async&gt;&lt;/script&gt;</pre>
      </div>
    </div>

    <div class="card">
      <h3>Kiosk Best Practices</h3>
      <ul style="padding-left:18px;color:var(--text-dim);font-size:13px;line-height:1.7">
        <li>Mount a tablet at customer-eye level near the entrance.</li>
        <li>Keep device plugged in — kiosk stays awake while browser is open.</li>
        <li>Use Chrome or Edge for best voice input/output support.</li>
        <li>Turn on the device's "kiosk mode" or full-screen browser to hide the URL bar.</li>
        <li>Pair with a Voice Studio sample (see Voice Studio tab) so customers hear your voice when Nova replies.</li>
        <li>5-minute idle auto-reset keeps the next customer's chat private.</li>
      </ul>
    </div>
  `;

  // Wire copy / download
  $('copyKioskUrl')?.addEventListener('click', () => {
    navigator.clipboard.writeText(kioskUrl).then(() => {
      $('copyKioskUrl').textContent = 'Copied!';
      setTimeout(() => { $('copyKioskUrl').textContent = 'Copy'; }, 1800);
    }).catch(() => {
      $('copyKioskUrl').textContent = 'Press Ctrl+C';
      setTimeout(() => { $('copyKioskUrl').textContent = 'Copy'; }, 1800);
    });
  });
  $('downloadQrBtn')?.addEventListener('click', () => {
    window.open(qrImgUrl + '&download=1', '_blank');
  });
  $('downloadQrSvgBtn')?.addEventListener('click', () => {
    window.open(qrSvgUrl, '_blank');
  });
}

// ─── Settings ─────────────────────────────────────────────
async function renderSettings() {
  const view = $('view');
  view.innerHTML = `
    <div class="card">
      <h3>Account</h3>
      <p><strong>Name:</strong> ${esc(state.owner?.name || '—')}</p>
      <p><strong>Email:</strong> ${esc(state.owner?.email || '—')}</p>
      <p><strong>Tenant:</strong> ${esc(state.owner?.tenantId || '—')}</p>
      <p><strong>Role:</strong> ${esc(state.owner?.role || 'owner')}</p>
    </div>
    <div class="card">
      <h3>Widget Embed Snippet</h3>
      <p style="margin-bottom:8px;font-size:12px;color:var(--text-dim)">Add this to your website to start receiving customer chats:</p>
      <pre>&lt;script
  src="${window.location.origin}/widget.js"
  data-tenant="${esc(state.owner?.tenantId || '')}"
  data-server="${window.location.origin}"
  async&gt;&lt;/script&gt;</pre>
    </div>
    <div class="card">
      <h3>Other Dashboards</h3>
      <p><a href="/admin" target="_blank" style="color:var(--accent-strong)">Admin Dashboard ↗</a> (for Nova operators)</p>
      <p><a href="/developer" target="_blank" style="color:var(--accent-strong)">Developer Console ↗</a> (for testing)</p>
      <p><a href="/widget-test" target="_blank" style="color:var(--accent-strong)">Widget Test Page ↗</a></p>
    </div>
  `;
}

// ─── Boot ─────────────────────────────────────────────────
async function boot() {
  if (!state.token) { renderLogin(); return; }
  // Verify token
  const me = await api('/api/business/me');
  if (me.ok) {
    state.owner = me.owner;
    renderDashboard();
  } else {
    state.token = null;
    localStorage.removeItem('novaBusinessToken');
    renderLogin();
  }
}
boot();
