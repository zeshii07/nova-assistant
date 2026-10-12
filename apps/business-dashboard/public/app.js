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
