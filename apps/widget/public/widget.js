/* ============================================================
   Nova Website Widget SDK — v30.1.1
   Bugfixes:
     - Better error messages that tell the user WHAT went wrong
     - Network connectivity check with helpful hints
     - Auto-retry on cold start (Render free tier sleeps after 15min)
     - Fixed form submit + close button (from v30.1)
   UI enhancements:
     - Improved message bubbles with better spacing
     - Animated typing indicator with agent avatar
     - Better empty state with retry button
     - Connection status indicator
     - Smoother animations
     - Better mobile layout
   ============================================================ */

(function () {
  'use strict';

  if (window.__NOVA_WIDGET_MOUNTED__) return;
  window.__NOVA_WIDGET_MOUNTED__ = true;

  const SCRIPT_TAG = document.currentScript;
  const TENANT_ID = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-tenant')) || '';
  const DATA_POSITION = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-position')) || null;
  const DATA_COLOR = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-color')) || null;
  const DATA_LANGUAGE = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-language')) || null;
  const DATA_WELCOME = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-welcome')) || null;
  const DATA_AVATAR = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-avatar')) || null;

  if (!TENANT_ID) {
    console.error('[Nova Widget] data-tenant attribute is required. Example: <script src="/widget.js" data-tenant="cleaning-demo"></script>');
    return;
  }

  // v30.1.1: Allow overriding the Nova server URL via data-server attribute.
  // If not set, use the script's src origin (standard behavior).
  // This fixes issues where the widget is loaded from a CDN but the API
  // is on a different origin.
  const DATA_SERVER = (SCRIPT_TAG && SCRIPT_TAG.getAttribute('data-server')) || null;
  const NOVA_ORIGIN = DATA_SERVER || new URL(SCRIPT_TAG ? SCRIPT_TAG.src : window.location.href).origin;
  const API_CHAT = `${NOVA_ORIGIN}/api/chat`;
  const API_CONFIG = `${NOVA_ORIGIN}/api/widget/config/${encodeURIComponent(TENANT_ID)}`;
  const AVATARS_URL = `${NOVA_ORIGIN}/avatars.js`;
  const STORAGE_KEY = `nova-widget:${TENANT_ID}`;
  const VISITED_KEY = `nova-widget-visited:${TENANT_ID}`;
  const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

  const state = {
    config: null,
    open: false,
    customerId: null,
    customerName: null,
    messages: [],
    inFlight: false,
    queue: [],
    typing: false,
    error: null,
    connectionError: null,
    preChatCompleted: false,
    proactiveShown: false,
    avatars: null,
    retries: 0
  };

  // ─── Avatars loader ───────────────────────────────────────────────
  async function loadAvatars() {
    if (state.avatars) return;
    try {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-nova-avatars]');
        if (existing && window.NOVA_AVATARS) { resolve(); return; }
        const s = document.createElement('script');
        s.src = AVATARS_URL;
        s.setAttribute('data-nova-avatars', 'true');
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load avatars.js'));
        document.head.appendChild(s);
      });
      state.avatars = window.NOVA_AVATARS || {};
    } catch {
      state.avatars = {
        get: () => ({ name: 'Nova', title: 'Assistant', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#2d5bd1"/><text x="50" y="62" text-anchor="middle" fill="#fff" font-size="32" font-weight="bold" font-family="sans-serif">N</text></svg>' })
      };
    }
  }
  function getAvatarSvg() {
    if (!state.avatars || !state.config) return '';
    const key = state.config.agent?.avatar || 'marcus';
    const avatar = state.avatars.get ? state.avatars.get(key) : state.avatars[key];
    return avatar?.svg || '';
  }

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
        customerName: state.customerName,
        preChatCompleted: state.preChatCompleted,
        messages: state.messages.slice(-50),
        savedAt: Date.now()
      }));
    } catch {}
  }
  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    state.customerId = null;
    state.customerName = null;
    state.preChatCompleted = false;
    state.messages = [];
    saveSession();
  }
  function isReturningVisitor() {
    return !!localStorage.getItem(VISITED_KEY);
  }
  function markVisited() {
    try { localStorage.setItem(VISITED_KEY, '1'); } catch {}
  }
  function generateCustomerId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `widget-${crypto.randomUUID()}`;
    return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ─── Network with better error handling ────────────────────────────
  // v30.1.1: Distinguish between network errors (server down, CORS) and
  // HTTP errors (404, 429, 500) so we can show the right message.
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
        // Don't retry on 4xx (client errors) — only retry on network errors
        if (err.name === 'AbortError') {
          // Timeout — likely server is cold-starting (Render free tier)
          // Wait longer before next retry
          if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
        } else if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
          // Network error — server unreachable or CORS blocked
          if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        } else {
          // Other error — don't retry
          break;
        }
      }
    }
    throw lastError;
  }

  // v30.1.1: Classify the error so we can show the right message
  function classifyError(err) {
    if (!err) return { type: 'unknown', message: 'Unknown error' };
    if (err.name === 'AbortError') return { type: 'timeout', message: 'Server is starting up. Please wait a moment and try again.' };
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      // Could be: server down, CORS blocked, mixed content, wrong URL
      const isHttps = window.location.protocol === 'https:';
      const novaIsHttp = NOVA_ORIGIN.startsWith('http://');
      if (isHttps && novaIsHttp) {
        return { type: 'mixed_content', message: 'This page is HTTPS but Nova is HTTP. Use HTTPS for Nova server.' };
      }
      return { type: 'network', message: 'Cannot reach Nova server. It may be starting up (free tier) or the URL is wrong.' };
    }
    return { type: 'unknown', message: err.message || 'Unknown error' };
  }

  async function loadConfig() {
    try {
      state.connectionError = null;
      const r = await fetchWithRetry(API_CONFIG, { method: 'GET' }, 2);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Config load failed');
      state.config = {
        ...data,
        position: DATA_POSITION || data.position || 'bottom-right',
        themeColor: DATA_COLOR || data.themeColor || '#2d5bd1',
        language: DATA_LANGUAGE || data.language || 'auto',
        welcomeMessage: DATA_WELCOME || data.welcomeMessage || 'Hi! How can I help?'
      };
      state.retries = 0;
    } catch (err) {
      const classified = classifyError(err);
      state.config = {
        ok: true, tenantId: TENANT_ID,
        assistantName: 'Nova', welcomeMessage: 'Hi! How can I help you today?',
        themeColor: DATA_COLOR || '#2d5bd1', position: DATA_POSITION || 'bottom-right',
        language: DATA_LANGUAGE || 'auto', suggestions: [], businessName: '', enabled: true,
        agent: { avatar: DATA_AVATAR || 'marcus', name: 'Nova', title: 'Assistant', online: true },
        preChatForm: { enabled: false, fields: [] },
        proactiveGreeting: { enabled: false, delaySeconds: 5, message: null, pageRules: [] }
      };
      state.connectionError = classified;
      // Don't show this as a permanent error — the chat might still work
      console.warn('[Nova Widget] Config load failed:', classified.message);
    }
  }

  async function sendMessage(text) {
    if (!text || !text.trim()) return;
    if (state.inFlight) { state.queue.push(text); return; }
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
    updateConnectionStatus('connecting');

    try {
      const response = await fetchWithRetry(API_CHAT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          customerId: state.customerId,
          text: text.trim(),
          channel: 'widget',
          metadata: state.customerName ? { customerName: state.customerName } : {}
        })
      }, 3);

      state.typing = false;
      renderTyping();

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retryAfter = data.retryAfterSeconds || 60;
        state.messages.push({ role: 'system', text: `⏳ You're sending too quickly. Please wait ${retryAfter}s and try again.`, ts: Date.now() });
        renderMessages(); saveSession(); updateConnectionStatus('rate-limited'); return;
      }
      if (response.status === 404) {
        clearSession();
        state.messages.push({ role: 'system', text: '⚠️ This assistant is no longer available.', ts: Date.now() });
        renderMessages(); updateConnectionStatus('error'); return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      state.messages.push({ role: 'nova', text: data.reply || '(no reply)', ts: Date.now() });
      renderMessages(); saveSession();
      updateConnectionStatus('connected');
      state.retries = 0;
    } catch (err) {
      state.typing = false;
      renderTyping();
      const classified = classifyError(err);
      // Show a helpful error message with retry hint
      const errorMsg = classified.type === 'timeout'
        ? `⏳ Nova is starting up. Please try again in a few seconds.`
        : classified.type === 'mixed_content'
        ? `🔒 ${classified.message}`
        : classified.type === 'network'
        ? `📡 Cannot reach Nova server. Check your connection or try again.`
        : `❌ ${classified.message}`;
      state.messages.push({ role: 'system', text: errorMsg, ts: Date.now() });
      // Also add a retry button as a system message
      state.messages.push({ role: 'system_action', text: 'retry', ts: Date.now() });
      renderMessages(); saveSession();
      updateConnectionStatus('error');
    } finally {
      state.inFlight = false;
      if (state.queue.length > 0) { const next = state.queue.shift(); await sendMessage(next); }
    }
  }

  // ─── Shadow DOM rendering ─────────────────────────────────────────
  let shadow, bubbleEl, panelEl, messagesEl, inputEl, formEl, preChatEl, welcomeBubbleEl, typingEl, minimizeBtn, resetBtn, connectionStatusEl;

  function mountWidget() {
    const host = document.createElement('div');
    host.id = 'nova-widget-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;all:initial';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const cfg = state.config;
    const position = cfg.position || 'bottom-right';
    const color = cfg.themeColor || '#2d5bd1';
    const isLeft = position === 'bottom-left';
    const isCenter = position === 'bottom-center';
    const isSide = position === 'side-panel';
    const sideHorizontal = isSide ? 'right' : (isLeft ? 'left' : 'right');

    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

        /* ─── Agent avatar bubble ─── */
        .nova-bubble {
          position: fixed;
          ${sideHorizontal}: ${isSide ? '0px' : (isCenter ? '50%' : '20px')};
          ${isCenter ? 'transform: translateX(-50%);' : ''}
          bottom: ${isSide ? '80px' : '20px'};
          width: 64px; height: 64px;
          border-radius: 50%;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0;
          box-shadow: 0 4px 20px rgba(0,0,0,.25);
          transition: transform .15s, opacity .2s;
          z-index: 2147483647;
        }
        .nova-bubble:hover { transform: ${isCenter ? 'translateX(-50%)' : 'none'} scale(1.06); }
        .nova-bubble.hidden { opacity: 0; pointer-events: none; transform: ${isCenter ? 'translateX(-50%)' : 'none'} scale(0.6); }
        .nova-bubble svg { width: 100%; height: 100%; border-radius: 50%; display: block; }
        .nova-bubble .online-dot {
          position: absolute; bottom: 2px; ${sideHorizontal === 'right' ? 'right' : 'left'}: 2px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #3ddc97; border: 2px solid #fff;
        }
        .nova-bubble .pulse-ring {
          position: absolute; inset: 0; border-radius: 50%;
          border: 2px solid ${color}; opacity: 0;
          animation: nova-pulse 2.5s infinite;
        }
        @keyframes nova-pulse {
          0% { opacity: .6; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.5); }
        }
        .nova-bubble.show-pulse .pulse-ring { opacity: 1; }

        /* ─── Proactive welcome speech bubble ─── */
        .nova-welcome-bubble {
          position: fixed;
          ${sideHorizontal}: ${isSide ? '80px' : (isCenter ? '50%' : '94px')};
          ${isCenter ? 'transform: translateX(-50%);' : ''}
          bottom: ${isSide ? '80px' : '24px'};
          max-width: 280px;
          background: #fff; color: #1f2937;
          padding: 12px 16px; border-radius: 14px;
          box-shadow: 0 4px 20px rgba(0,0,0,.15);
          font-size: 13px; line-height: 1.5;
          z-index: 2147483646;
          opacity: 0; transform: translateY(8px) ${isCenter ? 'translateX(-50%)' : 'none'};
          transition: opacity .3s, transform .3s;
          pointer-events: none;
        }
        .nova-welcome-bubble.visible { opacity: 1; transform: translateY(0) ${isCenter ? 'translateX(-50%)' : 'none'}; pointer-events: auto; }
        .nova-welcome-bubble::before {
          content: ''; position: absolute;
          ${sideHorizontal === 'right' ? 'left' : 'right'}: -6px;
          bottom: 16px; width: 0; height: 0;
          border-top: 6px solid transparent; border-bottom: 6px solid transparent;
          ${sideHorizontal === 'right' ? 'border-right' : 'border-left'}: 8px solid #fff;
        }
        .nova-welcome-bubble .close-welcome {
          position: absolute; top: 4px; right: 6px;
          background: none; border: none; cursor: pointer;
          color: #9ca3af; font-size: 14px; line-height: 1; padding: 2px;
        }
        .nova-welcome-bubble .agent-name { font-weight: 600; color: ${color}; }

        /* ─── Chat panel ─── */
        .nova-panel {
          position: fixed;
          ${isSide ? `right: 0;` : `${sideHorizontal}: 20px;`}
          ${isCenter ? `left: 50%; transform: translateX(-50%);` : ''}
          bottom: ${isSide ? '0' : '94px'};
          width: ${isSide ? '380px' : '380px'};
          max-width: ${isSide ? '380px' : 'calc(100vw - 40px)'};
          height: ${isSide ? '100vh' : '560px'};
          max-height: ${isSide ? '100vh' : 'calc(100vh - 114px)'};
          background: #11182a; color: #e8edf7;
          border-radius: ${isSide ? '16px 0 0 16px' : '16px'};
          box-shadow: 0 8px 32px rgba(0,0,0,.4);
          display: flex; flex-direction: column;
          overflow: hidden;
          transform-origin: bottom ${sideHorizontal === 'right' ? 'right' : 'left'};
          transition: transform .25s ease, opacity .25s ease;
          z-index: 2147483647;
        }
        .nova-panel.hidden { opacity: 0; pointer-events: none; transform: ${isCenter ? 'translateX(-50%)' : 'none'} scale(0.92) translateY(8px); }

        .nova-header {
          padding: 12px 14px; background: ${color}; color: #fff;
          display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
        }
        .nova-header-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .nova-header-avatar {
          width: 38px; height: 38px; border-radius: 50%; overflow: hidden;
          background: rgba(255,255,255,.15); flex-shrink: 0; position: relative;
        }
        .nova-header-avatar svg { width: 100%; height: 100%; display: block; }
        .nova-header-avatar .status-dot {
          position: absolute; bottom: 0; right: 0;
          width: 10px; height: 10px; border-radius: 50%;
          background: #3ddc97; border: 2px solid ${color};
        }
        .nova-title-block { min-width: 0; }
        .nova-title { font-size: 14px; font-weight: 600; line-height: 1.2; }
        .nova-subtitle { font-size: 11px; opacity: .85; margin-top: 2px; display:flex; align-items:center; gap:4px; }
        .nova-subtitle .conn-dot { width:6px; height:6px; border-radius:50%; background:#3ddc97; display:inline-block; }
        .nova-subtitle.connecting .conn-dot { background:#f5b54a; animation: nova-blink 1s infinite; }
        .nova-subtitle.error .conn-dot { background:#ff6b6b; }
        .nova-subtitle.rate-limited .conn-dot { background:#f5b54a; }
        @keyframes nova-blink { 50% { opacity: 0.3; } }
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
          display: flex; flex-direction: column; gap: 12px;
          scroll-behavior: smooth;
        }
        .nova-messages::-webkit-scrollbar { width: 6px; }
        .nova-messages::-webkit-scrollbar-track { background: transparent; }
        .nova-messages::-webkit-scrollbar-thumb { background: #28324b; border-radius: 3px; }

        .nova-message {
          max-width: 80%; padding: 10px 14px;
          border-radius: 16px; font-size: 13.5px; line-height: 1.5;
          white-space: pre-wrap; word-break: break-word;
          animation: nova-msg-in .2s ease;
        }
        @keyframes nova-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
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
          background: rgba(245,181,74,.1); color: #f5b54a;
          font-size: 12px; text-align: center; padding: 8px 14px;
          align-self: center; max-width: 90%;
          border: 1px solid rgba(245,181,74,.2);
          border-radius: 12px;
        }
        .nova-message.system_action {
          background: transparent; padding: 0; margin: -4px 0;
          align-self: center;
        }
        .nova-retry-btn {
          background: ${color}; color: #fff;
          border: none; border-radius: 16px;
          padding: 8px 18px; cursor: pointer;
          font-size: 12px; font-weight: 600;
          display: inline-flex; align-items: center; gap: 6px;
          transition: filter .12s;
        }
        .nova-retry-btn:hover { filter: brightness(1.15); }

        .nova-typing {
          align-self: flex-start; padding: 10px 14px;
          background: #1b263e; border: 1px solid #2c3955;
          border-radius: 16px; border-bottom-left-radius: 4px;
          display: flex; gap: 4px; align-items: center;
        }
        .nova-typing-dot { width: 7px; height: 7px; background: #91a0bd; border-radius: 50%; animation: nova-bounce 1.4s infinite ease-in-out; }
        .nova-typing-dot:nth-child(2) { animation-delay: .2s; }
        .nova-typing-dot:nth-child(3) { animation-delay: .4s; }
        @keyframes nova-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-6px); opacity: 1; } }

        /* ─── Pre-chat form ─── */
        .nova-prechat {
          padding: 24px 20px; background: #0b1020; flex: 1; overflow-y: auto;
        }
        .nova-prechat h3 { margin: 0 0 8px; font-size: 16px; color: #e8edf7; }
        .nova-prechat p { margin: 0 0 20px; font-size: 13px; color: #91a0bd; line-height: 1.5; }
        .nova-prechat-field { margin-bottom: 14px; }
        .nova-prechat-field label { display: block; font-size: 12px; color: #a9b8d4; margin-bottom: 5px; font-weight: 500; }
        .nova-prechat-field input {
          width: 100%; background: #172139; color: #e8edf7;
          border: 1px solid #34415f; border-radius: 8px; padding: 10px 12px;
          font-size: 14px; font-family: inherit;
        }
        .nova-prechat-field input:focus { outline: none; border-color: ${color}; }
        .nova-prechat-submit {
          width: 100%; background: ${color}; color: #fff;
          border: none; border-radius: 8px; padding: 12px;
          font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 6px;
          transition: filter .12s;
        }
        .nova-prechat-submit:hover { filter: brightness(1.1); }
        .nova-prechat-skip {
          width: 100%; background: transparent; color: #91a0bd;
          border: none; cursor: pointer; padding: 10px; font-size: 12px; margin-top: 8px;
        }
        .nova-prechat-skip:hover { color: #e8edf7; }

        .nova-suggestions { display: flex; gap: 6px; padding: 8px 14px; overflow-x: auto; flex-wrap: nowrap; background: #0b1020; border-top: 1px solid #28324b; }
        .nova-suggestion-btn { background: #172139; color: #c9d6f0; border: 1px solid #34415f; border-radius: 16px; padding: 6px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background .12s; }
        .nova-suggestion-btn:hover { background: #223050; }

        .nova-composer { padding: 10px; border-top: 1px solid #28324b; background: #11182a; display: flex; gap: 8px; flex-shrink: 0; }
        .nova-input { flex: 1; resize: none; min-height: 38px; max-height: 120px; background: #172139; color: #e8edf7; border: 1px solid #34415f; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; font-family: inherit; line-height: 1.4; }
        .nova-input::placeholder { color: #7485a8; }
        .nova-input:focus { outline: none; border-color: ${color}; }
        .nova-send { background: ${color}; color: #fff; border: none; border-radius: 10px; padding: 0 14px; cursor: pointer; font-weight: 600; font-size: 13.5px; min-width: 44px; transition: filter .12s; }
        .nova-send:hover { filter: brightness(1.1); }
        .nova-send:disabled { opacity: .5; cursor: not-allowed; }

        @media (max-width: 480px) {
          .nova-panel { width: 100vw !important; height: 100dvh !important; max-height: 100dvh !important; bottom: 0 !important; ${sideHorizontal}: 0 !important; ${isCenter ? 'transform: none !important;' : ''} border-radius: 0 !important; }
          .nova-bubble { bottom: 16px !important; ${sideHorizontal === 'right' ? 'right' : 'left'}: ${isCenter ? '50% !important; transform: translateX(-50%) !important;' : '16px !important;'} }
          .nova-welcome-bubble { display: none !important; }
        }
      </style>

      <button class="nova-bubble" aria-label="Open chat" title="Chat with us">
        <span class="pulse-ring"></span>
        <span id="nova-bubble-avatar"></span>
        <span class="online-dot"></span>
      </button>

      <div class="nova-welcome-bubble" id="nova-welcome-bubble">
        <button class="close-welcome" aria-label="Dismiss">✕</button>
        <span class="agent-name"></span><span class="welcome-text"></span>
      </div>

      <div class="nova-panel hidden" role="dialog" aria-label="Chat with assistant">
        <div class="nova-header">
          <div class="nova-header-info">
            <div class="nova-header-avatar" id="nova-header-avatar">
              <span class="status-dot"></span>
            </div>
            <div class="nova-title-block">
              <div class="nova-title" id="nova-title">Nova</div>
              <div class="nova-subtitle" id="nova-subtitle"><span class="conn-dot"></span> Online</div>
            </div>
          </div>
          <div class="nova-header-actions">
            <button type="button" class="nova-icon-btn" id="nova-reset" title="Start new chat" aria-label="Start new chat">↻</button>
            <button type="button" class="nova-icon-btn" id="nova-close" title="Close" aria-label="Close chat">✕</button>
          </div>
        </div>

        <div class="nova-prechat" id="nova-prechat" style="display:none">
          <h3>Hi! I'm <span id="prechat-name"></span> 👋</h3>
          <p id="prechat-intro">Before we start, please share a few details so I can help you better.</p>
          <form id="nova-prechat-form"></form>
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
    preChatEl = shadow.querySelector('#nova-prechat');
    welcomeBubbleEl = shadow.querySelector('#nova-welcome-bubble');
    connectionStatusEl = shadow.querySelector('#nova-subtitle');
    const titleEl = shadow.querySelector('#nova-title');
    const subtitleEl = connectionStatusEl;
    const headerAvatar = shadow.querySelector('#nova-header-avatar');
    const bubbleAvatar = shadow.querySelector('#nova-bubble-avatar');
    const prechatName = shadow.querySelector('#prechat-name');

    // Apply config
    const agent = cfg.agent || {};
    titleEl.textContent = agent.name || cfg.assistantName || 'Nova';
    subtitleEl.innerHTML = `<span class="conn-dot"></span> ${agent.title || 'Assistant'}`;
    inputEl.placeholder = `Message ${agent.name || cfg.assistantName || 'Nova'}…`;

    // Set avatars (header + bubble)
    const avatarSvg = getAvatarSvg();
    if (avatarSvg) {
      headerAvatar.insertAdjacentHTML('afterbegin', avatarSvg);
      bubbleAvatar.innerHTML = avatarSvg;
    }

    if (prechatName) prechatName.textContent = agent.name || 'Nova';

    // Wire events — these MUST be attached before any errors can occur
    bubbleEl.addEventListener('click', () => { hideWelcomeBubble(); openPanel(); });
    minimizeBtn = shadow.querySelector('#nova-close');
    resetBtn = shadow.querySelector('#nova-reset');
    minimizeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Start a new conversation? Current messages will be cleared.')) {
        clearSession();
        showPreChatOrWelcome();
      }
    });

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
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
        const text = inputEl.value;
        if (text.trim()) {
          inputEl.value = '';
          autoResize();
          sendMessage(text);
        }
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) closePanel();
    });

    // Welcome bubble close button
    const closeWelcome = shadow.querySelector('.close-welcome');
    if (closeWelcome) closeWelcome.addEventListener('click', (e) => { e.stopPropagation(); hideWelcomeBubble(); });

    // Initial render — show pre-chat form or welcome messages
    showPreChatOrWelcome();
    renderSuggestions();

    // Show proactive greeting after delay (if configured + not returning visitor)
    scheduleProactiveGreeting();
  }

  function updateConnectionStatus(status) {
    if (!connectionStatusEl) return;
    const agent = state.config?.agent || {};
    const title = agent.title || 'Assistant';
    const labels = { connected: title, connecting: 'Connecting…', error: 'Connection issue', 'rate-limited': 'Rate limited' };
    connectionStatusEl.className = `nova-subtitle ${status === 'connected' ? '' : status}`;
    connectionStatusEl.innerHTML = `<span class="conn-dot"></span> ${labels[status] || title}`;
  }

  function showPreChatOrWelcome() {
    const saved = loadSession();
    if (saved) {
      state.customerId = saved.customerId;
      state.customerName = saved.customerName;
      state.preChatCompleted = saved.preChatCompleted;
      state.messages = saved.messages || [];
    }

    const preChatForm = state.config.preChatForm || { enabled: false, fields: [] };
    if (preChatForm.enabled === true && !state.preChatCompleted) {
      preChatEl.style.display = 'block';
      messagesEl.style.display = 'none';
      shadow.querySelector('#nova-suggestions').style.display = 'none';
      formEl.style.display = 'none';
      renderPreChatForm(preChatForm);
    } else {
      hidePreChat();
      showWelcomeMessages();
    }
  }

  function renderPreChatForm(preChatForm) {
    const formContainer = shadow.querySelector('#nova-prechat-form');
    formContainer.innerHTML = '';
    for (const field of (preChatForm.fields || [])) {
      const wrap = document.createElement('div');
      wrap.className = 'nova-prechat-field';
      const label = document.createElement('label');
      label.textContent = field.label || field.id;
      if (field.required) label.textContent += ' *';
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.name = field.id;
      input.placeholder = field.placeholder || '';
      input.required = !!field.required;
      wrap.appendChild(label);
      wrap.appendChild(input);
      formContainer.appendChild(wrap);
    }
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'nova-prechat-submit';
    submitBtn.textContent = 'Start chat';
    formContainer.appendChild(submitBtn);

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'nova-prechat-skip';
    skipBtn.textContent = 'Skip and chat anonymously';
    skipBtn.addEventListener('click', () => {
      state.preChatCompleted = true;
      state.customerName = 'Guest';
      hidePreChat();
      showWelcomeMessages();
      saveSession();
    });
    formContainer.appendChild(skipBtn);

    formContainer.onsubmit = (e) => {
      e.preventDefault();
      const formData = new FormData(formContainer);
      const data = {};
      for (const [k, v] of formData.entries()) data[k] = v;
      state.customerName = data.name || 'Guest';
      state.preChatCompleted = true;
      state._preChatData = data;
      hidePreChat();
      showWelcomeMessages();
      saveSession();
    };
  }

  function hidePreChat() {
    preChatEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    shadow.querySelector('#nova-suggestions').style.display = 'flex';
    formEl.style.display = 'flex';
  }

  function showWelcomeMessages() {
    messagesEl.innerHTML = '';
    if (state.messages.length === 0 && state.config.welcomeMessage) {
      const welcome = document.createElement('div');
      welcome.className = 'nova-message nova';
      welcome.textContent = state.config.welcomeMessage;
      messagesEl.appendChild(welcome);
    } else {
      for (const msg of state.messages) {
        appendMessageEl(msg.role, msg.text);
      }
    }
    // If there's a connection error, show it
    if (state.connectionError) {
      const errEl = document.createElement('div');
      errEl.className = 'nova-message system';
      errEl.textContent = `⚠️ ${state.connectionError.message}`;
      messagesEl.appendChild(errEl);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function scheduleProactiveGreeting() {
    const pg = state.config.proactiveGreeting;
    if (!pg || pg.enabled !== true) return;
    if (state.open) return;
    if (isReturningVisitor() && !pg.alwaysShow) return;
    if (state.proactiveShown) return;

    const delay = (pg.delaySeconds || 5) * 1000;
    setTimeout(() => {
      if (state.open) return;
      state.proactiveShown = true;
      showWelcomeBubble(pg.message);
      setTimeout(() => {
        if (!state.open && welcomeBubbleEl.classList.contains('visible')) {
          openPanel();
        }
      }, 3000);
    }, delay);
  }

  function showWelcomeBubble(customMessage) {
    const agent = state.config.agent || {};
    const message = customMessage || state.config.welcomeMessage || 'Hi! How can I help?';
    const nameEl = welcomeBubbleEl.querySelector('.agent-name');
    const textEl = welcomeBubbleEl.querySelector('.welcome-text');
    nameEl.textContent = `${agent.name || 'Nova'}: `;
    textEl.textContent = message.length > 100 ? message.slice(0, 100) + '…' : message;
    welcomeBubbleEl.classList.add('visible');
    bubbleEl.classList.add('show-pulse');
  }

  function hideWelcomeBubble() {
    welcomeBubbleEl.classList.remove('visible');
    bubbleEl.classList.remove('show-pulse');
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
    hideWelcomeBubble();
    markVisited();
    setTimeout(() => inputEl.focus(), 100);
  }
  function closePanel() {
    state.open = false;
    panelEl.classList.add('hidden');
    bubbleEl.classList.remove('hidden');
  }

  function appendMessageEl(role, text) {
    // Handle system_action messages (like retry buttons)
    if (role === 'system_action' && text === 'retry') {
      const wrap = document.createElement('div');
      wrap.className = 'nova-message system_action';
      const btn = document.createElement('button');
      btn.className = 'nova-retry-btn';
      btn.innerHTML = '↻ Retry';
      btn.addEventListener('click', () => {
        // Remove the last user message + error messages and resend
        const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
        if (lastUser) {
          // Remove the error + retry button
          while (state.messages.length > 0 && state.messages[state.messages.length - 1].role !== 'user') {
            state.messages.pop();
          }
          // Also remove the last user message (we'll re-add it)
          if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'user') {
            state.messages.pop();
          }
          renderAllMessages();
          sendMessage(lastUser.text);
        }
      });
      wrap.appendChild(btn);
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }
    const el = document.createElement('div');
    el.className = `nova-message ${role}`;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }
  function renderMessages() {
    const last = state.messages[state.messages.length - 1];
    if (last) appendMessageEl(last.role, last.text);
  }
  function renderAllMessages() {
    messagesEl.innerHTML = '';
    for (const msg of state.messages) appendMessageEl(msg.role, msg.text);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
    if (suggestions.length === 0) { box.style.display = 'none'; return; }
    for (const suggestion of suggestions.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.className = 'nova-suggestion-btn';
      btn.textContent = suggestion;
      btn.addEventListener('click', () => sendMessage(suggestion));
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
    await loadAvatars();
    mountWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
