/* ============================================================
   Nova Website Widget SDK — v28.0
   Drop-in embeddable chat widget for any website.

   USAGE (3 lines on any HTML page):
     <script src="https://your-nova.com/widget.js"
             data-tenant="cleaning-demo" async></script>

   The script auto-mounts a floating chat bubble on the bottom-right
   corner. All HTML/CSS is encapsulated in a Shadow DOM so it never
   collides with the host page's styles. All user input is rendered
   via textContent (XSS-safe). Session is persisted in localStorage
   so users can refresh the page without losing context. If the
   server has lost state (memory mode + restart), the widget sends
   a fresh customerId so the conversation gracefully restarts.

   SECURITY:
     - No eval, no innerHTML with user input (only textContent)
     - Shadow DOM isolation (host page CSS can't leak in, widget CSS can't leak out)
     - localStorage keys are tenant-scoped (no cross-tenant data leakage)
     - CustomerId is generated with crypto.randomUUID() (no PII)
     - All requests include Origin header; server verifies tenant exists
     - Rate-limited client-side: max 1 in-flight request, queue subsequent messages

   AVAILABILITY:
     - 3 retries with exponential backoff (1s, 2s, 4s) on network errors
     - Graceful degradation: shows error bubble if server unreachable
     - Typing indicator while waiting for response
     - Never blocks page load (async + defer behavior)
   ============================================================ */

(function () {
  'use strict';

  // Prevent double-mount if script is included twice on the same page
  if (window.__NOVA_WIDGET_MOUNTED__) return;
  window.__NOVA_WIDGET_MOUNTED__ = true;

  const SCRIPT_TAG = document.currentScript;
  const TENANT_ID = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-tenant')) || '';
  const DATA_POSITION = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-position')) || null;
  const DATA_COLOR = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-color')) || null;
  const DATA_LANGUAGE = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-language')) || null;
  const DATA_WELCOME = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-welcome')) || null;

  if (!TENANT_ID) {
    console.error('[Nova Widget] data-tenant attribute is required. Example: <script src="/widget.js" data-tenant="cleaning-demo"></script>');
    return;
  }

  // ─── State ────────────────────────────────────────────────────────
  const NOVA_ORIGIN = new URL(SCRIPT_TAG ? SCRIPT_TAG.src : window.location.href).origin;
  const API_CHAT = `${NOVA_ORIGIN}/api/chat`;
  const API_CONFIG = `${NOVA_ORIGIN}/api/widget/config/${encodeURIComponent(TENANT_ID)}`;
  const STORAGE_KEY = `nova-widget:${TENANT_ID}`;
  const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

  const state = {
    config: null,
    open: false,
    customerId: null,
    messages: [], // [{role:'user'|'nova'|'system', text, ts}]
    inFlight: false,
    queue: [],     // pending user messages waiting to be sent
    typing: false,
    error: null
  };

  // ─── localStorage session persistence ──────────────────────────────
  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.savedAt || (Date.now() - data.savedAt > SESSION_TTL_MS)) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch { return null; }
  }
  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        customerId: state.customerId,
        messages: state.messages.slice(-50), // cap to last 50 messages
        savedAt: Date.now()
      }));
    } catch { /* localStorage full or blocked */ }
  }
  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    state.customerId = null;
    state.messages = [];
    renderMessages();
    saveSession();
  }
  function generateCustomerId() {
    // crypto.randomUUID() is universally available in modern browsers
    // (Chrome 92+, Firefox 95+, Safari 15.4+). Fall back to Math.random
    // for ancient browsers.
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `widget-${crypto.randomUUID()}`;
    }
    return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ─── Network ───────────────────────────────────────────────────────
  async function fetchWithRetry(url, options, retries = 3) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        return response;
      } catch (err) {
        lastError = err;
        // Exponential backoff: 1s, 2s, 4s
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  }

  async function loadConfig() {
    try {
      const r = await fetchWithRetry(API_CONFIG, { method: 'GET' }, 2);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Failed to load widget config');
      // Allow data-* attributes on the script tag to override tenant config
      state.config = {
        ...data,
        position: DATA_POSITION || data.position || 'bottom-right',
        themeColor: DATA_COLOR || data.themeColor || '#2d5bd1',
        language: DATA_LANGUAGE || data.language || 'auto',
        welcomeMessage: DATA_WELCOME || data.welcomeMessage || 'Hi! How can I help?'
      };
    } catch (err) {
      // Config endpoint unreachable: fall back to safe defaults so the widget still renders
      state.config = {
        ok: true,
        tenantId: TENANT_ID,
        assistantName: 'Nova',
        welcomeMessage: 'Hi! How can I help you today?',
        themeColor: DATA_COLOR || '#2d5bd1',
        position: DATA_POSITION || 'bottom-right',
        language: DATA_LANGUAGE || 'auto',
        suggestions: [],
        businessName: '',
        enabled: true
      };
      state.error = 'Could not reach Nova server. Using defaults.';
    }
  }

  async function sendMessage(text) {
    if (!text || !text.trim()) return;
    if (state.inFlight) {
      // Queue: don't send immediately, wait for the previous one to finish
      state.queue.push(text);
      return;
    }
    if (!state.customerId) {
      const saved = loadSession();
      state.customerId = saved?.customerId || generateCustomerId();
    }
    state.messages.push({ role: 'user', text: text.trim(), ts: Date.now() });
    renderMessages();
    saveSession();
    state.inFlight = true;
    state.typing = true;
    renderTyping();

    try {
      const response = await fetchWithRetry(API_CHAT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          customerId: state.customerId,
          text: text.trim(),
          channel: 'widget'
        })
      }, 3);

      state.typing = false;
      renderTyping();

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retryAfter = data.retryAfterSeconds || 60;
        state.messages.push({
          role: 'system',
          text: `You're sending messages too quickly. Please wait ${retryAfter}s and try again.`,
          ts: Date.now()
        });
        renderMessages();
        saveSession();
        return;
      }
      if (response.status === 404) {
        // Tenant no longer exists — reset session
        clearSession();
        state.messages.push({
          role: 'system',
          text: 'This assistant is no longer available.',
          ts: Date.now()
        });
        renderMessages();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      state.messages.push({ role: 'nova', text: data.reply || '(no reply)', ts: Date.now() });
      renderMessages();
      saveSession();
    } catch (err) {
      state.typing = false;
      renderTyping();
      state.messages.push({
        role: 'system',
        text: 'Could not reach the assistant. Please check your connection and try again.',
        ts: Date.now()
      });
      renderMessages();
      saveSession();
    } finally {
      state.inFlight = false;
      // Process queue
      if (state.queue.length > 0) {
        const next = state.queue.shift();
        await sendMessage(next);
      }
    }
  }

  // ─── Shadow DOM rendering ─────────────────────────────────────────
  // All HTML/CSS lives in a Shadow DOM so the host page's styles
  // cannot leak into the widget, and the widget's styles cannot
  // leak out to the host page.
  let shadow, bubbleEl, panelEl, messagesEl, inputEl, formEl, headerEl, resetBtn, minimizeBtn;

  function mountWidget() {
    const host = document.createElement('div');
    host.id = 'nova-widget-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;all:initial';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const position = state.config.position || 'bottom-right';
    const color = state.config.themeColor || '#2d5bd1';
    const isLeft = position === 'bottom-left';

    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .nova-bubble {
          position: fixed;
          ${isLeft ? 'left' : 'right'}: 20px;
          bottom: 20px;
          width: 60px; height: 60px;
          border-radius: 50%;
          background: ${color};
          color: #fff;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(0,0,0,.3);
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; font-weight: 700;
          transition: transform .15s, opacity .15s;
          z-index: 2147483647;
        }
        .nova-bubble:hover { transform: scale(1.06); }
        .nova-bubble.hidden { opacity: 0; pointer-events: none; transform: scale(0.6); }
        .nova-bubble::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid ${color}; opacity: 0; animation: pulse 2.5s infinite; }
        @keyframes pulse { 0% { opacity: .6; transform: scale(1); } 100% { opacity: 0; transform: scale(1.4); } }
        .nova-bubble.has-unread::after { opacity: 1; }

        .nova-panel {
          position: fixed;
          ${isLeft ? 'left' : 'right'}: 20px;
          bottom: 90px;
          width: 360px;
          max-width: calc(100vw - 40px);
          height: 540px;
          max-height: calc(100vh - 110px);
          background: #11182a;
          color: #e8edf7;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,.4);
          display: flex; flex-direction: column;
          overflow: hidden;
          transform-origin: bottom ${isLeft ? 'left' : 'right'};
          transition: transform .2s ease, opacity .2s ease;
          z-index: 2147483647;
        }
        .nova-panel.hidden { opacity: 0; pointer-events: none; transform: scale(0.9) translateY(8px); }

        .nova-header {
          padding: 14px 16px;
          background: ${color};
          color: #fff;
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
        }
        .nova-header-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .nova-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(255,255,255,.2);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 16px; flex-shrink: 0;
        }
        .nova-title-block { min-width: 0; }
        .nova-title { font-size: 14px; font-weight: 600; line-height: 1.2; }
        .nova-subtitle { font-size: 11px; opacity: .85; line-height: 1.2; margin-top: 2px; }
        .nova-header-actions { display: flex; gap: 4px; }
        .nova-icon-btn {
          background: rgba(255,255,255,.15); border: none; color: #fff;
          width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; transition: background .12s;
        }
        .nova-icon-btn:hover { background: rgba(255,255,255,.3); }

        .nova-messages {
          flex: 1; overflow-y: auto; padding: 14px;
          background: #0b1020;
          display: flex; flex-direction: column; gap: 10px;
        }
        .nova-message {
          max-width: 80%; padding: 9px 13px;
          border-radius: 14px; font-size: 13px; line-height: 1.45;
          white-space: pre-wrap; word-break: break-word;
        }
        .nova-message.user {
          background: ${color}; color: #fff;
          align-self: flex-end;
          border-bottom-right-radius: 4px;
        }
        .nova-message.nova {
          background: #1b263e; color: #e8edf7;
          border: 1px solid #2c3955;
          align-self: flex-start;
          border-bottom-left-radius: 4px;
        }
        .nova-message.system {
          background: transparent; color: #91a0bd;
          font-size: 11px; text-align: center; padding: 6px;
          align-self: center; max-width: 90%;
        }
        .nova-typing {
          align-self: flex-start; padding: 9px 14px;
          background: #1b263e; border: 1px solid #2c3955;
          border-radius: 14px; border-bottom-left-radius: 4px;
          font-size: 12px; color: #91a0bd;
          display: flex; gap: 4px; align-items: center;
        }
        .nova-typing-dot {
          width: 6px; height: 6px; background: #91a0bd; border-radius: 50%;
          animation: nova-bounce 1.4s infinite ease-in-out;
        }
        .nova-typing-dot:nth-child(2) { animation-delay: .2s; }
        .nova-typing-dot:nth-child(3) { animation-delay: .4s; }
        @keyframes nova-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: .4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }

        .nova-suggestions {
          display: flex; gap: 6px; padding: 8px 14px;
          overflow-x: auto; flex-wrap: nowrap;
          background: #0b1020; border-top: 1px solid #28324b;
        }
        .nova-suggestion-btn {
          background: #172139; color: #c9d6f0;
          border: 1px solid #34415f; border-radius: 16px;
          padding: 6px 12px; font-size: 12px; cursor: pointer;
          white-space: nowrap; flex-shrink: 0;
          transition: background .12s;
        }
        .nova-suggestion-btn:hover { background: #223050; }

        .nova-composer {
          padding: 10px; border-top: 1px solid #28324b;
          background: #11182a;
          display: flex; gap: 8px; flex-shrink: 0;
        }
        .nova-input {
          flex: 1; resize: none; min-height: 38px; max-height: 120px;
          background: #172139; color: #e8edf7;
          border: 1px solid #34415f; border-radius: 10px;
          padding: 9px 12px; font-size: 13px; font-family: inherit;
          line-height: 1.4;
        }
        .nova-input::placeholder { color: #7485a8; }
        .nova-input:focus { outline: none; border-color: ${color}; }
        .nova-send {
          background: ${color}; color: #fff;
          border: none; border-radius: 10px;
          padding: 0 14px; cursor: pointer; font-weight: 600;
          font-size: 13px; min-width: 44px;
          transition: background .12s;
        }
        .nova-send:hover { filter: brightness(1.1); }
        .nova-send:disabled { opacity: .5; cursor: not-allowed; }

        @media (max-width: 480px) {
          .nova-panel {
            width: 100vw; height: 100dvh; max-height: 100dvh;
            bottom: 0; ${isLeft ? 'left' : 'right'}: 0;
            border-radius: 0;
          }
          .nova-bubble { bottom: 16px; ${isLeft ? 'left' : 'right'}: 16px; }
        }
      </style>

      <button class="nova-bubble" aria-label="Open chat" title="Chat with us">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </button>

      <div class="nova-panel hidden" role="dialog" aria-label="Chat with assistant">
        <div class="nova-header">
          <div class="nova-header-info">
            <div class="nova-avatar" id="nova-avatar">N</div>
            <div class="nova-title-block">
              <div class="nova-title" id="nova-title">Nova</div>
              <div class="nova-subtitle" id="nova-subtitle">Online</div>
            </div>
          </div>
          <div class="nova-header-actions">
            <button class="nova-icon-btn" id="nova-reset" title="Start new chat" aria-label="Start new chat">↻</button>
            <button class="nova-icon-btn" id="nova-close" title="Close" aria-label="Close chat">✕</button>
          </div>
        </div>
        <div class="nova-messages" id="nova-messages" aria-live="polite"></div>
        <div class="nova-suggestions" id="nova-suggestions"></div>
        <form class="nova-composer" id="nova-form">
          <textarea class="nova-input" id="nova-input" placeholder="Type a message…" rows="1" maxlength="4000" aria-label="Message"></textarea>
          <button type="submit" class="nova-send" id="nova-send">Send</button>
        </form>
      </div>
    `;

    bubbleEl = shadow.querySelector('.nova-bubble');
    panelEl = shadow.querySelector('.nova-panel');
    messagesEl = shadow.querySelector('#nova-messages');
    inputEl = shadow.querySelector('#nova-input');
    formEl = shadow.querySelector('#nova-form');
    headerEl = shadow.querySelector('.nova-header');
    resetBtn = shadow.querySelector('#nova-reset');
    minimizeBtn = shadow.querySelector('#nova-close');
    const avatarEl = shadow.querySelector('#nova-avatar');
    const titleEl = shadow.querySelector('#nova-title');
    const subtitleEl = shadow.querySelector('#nova-subtitle');

    // Apply config to UI
    const cfg = state.config;
    titleEl.textContent = cfg.assistantName || 'Nova';
    avatarEl.textContent = (cfg.assistantName || 'N').charAt(0).toUpperCase();
    subtitleEl.textContent = cfg.businessName ? `${cfg.businessName} · Online` : 'Online';
    inputEl.placeholder = `Message ${cfg.assistantName || 'Nova'}…`;

    // Wire events
    bubbleEl.addEventListener('click', toggleOpen);
    minimizeBtn.addEventListener('click', closePanel);
    resetBtn.addEventListener('click', () => {
      if (confirm('Start a new conversation? Current messages will be cleared.')) {
        clearSession();
        showWelcome();
      }
    });

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = inputEl.value;
      if (!text.trim()) return;
      inputEl.value = '';
      autoResize();
      sendMessage(text);
    });
    inputEl.addEventListener('input', autoResize);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        formEl.dispatchEvent(new Event('submit'));
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) closePanel();
    });

    // Initial render
    showWelcome();
    renderSuggestions();
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  }

  function toggleOpen() {
    if (state.open) closePanel();
    else openPanel();
  }
  function openPanel() {
    state.open = true;
    panelEl.classList.remove('hidden');
    bubbleEl.classList.add('hidden');
    setTimeout(() => inputEl.focus(), 100);
  }
  function closePanel() {
    state.open = false;
    panelEl.classList.add('hidden');
    bubbleEl.classList.remove('hidden');
  }

  function showWelcome() {
    messagesEl.innerHTML = '';
    if (state.config.welcomeMessage) {
      const welcome = document.createElement('div');
      welcome.className = 'nova-message nova';
      welcome.textContent = state.config.welcomeMessage; // textContent = XSS-safe
      messagesEl.appendChild(welcome);
    }
    // Restore saved messages if any
    const saved = loadSession();
    if (saved && saved.messages && saved.messages.length > 0) {
      state.customerId = saved.customerId;
      state.messages = saved.messages;
      // Don't re-add the welcome — it's already in saved.messages typically.
      // Re-render all saved messages instead.
      messagesEl.innerHTML = '';
      for (const msg of state.messages) {
        appendMessageEl(msg.role, msg.text);
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessageEl(role, text) {
    const el = document.createElement('div');
    el.className = `nova-message ${role}`;
    el.textContent = text; // textContent = XSS-safe
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function renderMessages() {
    // Re-render the last message only (optimization)
    const last = state.messages[state.messages.length - 1];
    if (last) appendMessageEl(last.role, last.text);
  }

  function renderTyping() {
    const existing = shadow.querySelector('.nova-typing');
    if (state.typing) {
      if (existing) return;
      const el = document.createElement('div');
      el.className = 'nova-typing';
      el.innerHTML = '<span class="nova-typing-dot"></span><span class="nova-typing-dot"></span><span class="nova-typing-dot"></span>';
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (existing) {
      existing.remove();
    }
  }

  function renderSuggestions() {
    const box = shadow.querySelector('#nova-suggestions');
    const suggestions = state.config.suggestions || [];
    box.innerHTML = '';
    if (suggestions.length === 0) {
      box.style.display = 'none';
      return;
    }
    for (const suggestion of suggestions.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.className = 'nova-suggestion-btn';
      btn.textContent = suggestion;
      btn.addEventListener('click', () => {
        sendMessage(suggestion);
      });
      box.appendChild(btn);
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────
  async function boot() {
    await loadConfig();
    if (state.config.enabled === false) {
      console.info(`[Nova Widget] Widget is disabled for tenant "${TENANT_ID}".`);
      return;
    }
    mountWidget();
    if (state.error) {
      setTimeout(() => {
        appendMessageEl('system', state.error);
      }, 500);
    }
  }

  // Run after DOMContentLoaded so we don't block page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
