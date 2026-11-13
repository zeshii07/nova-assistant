/* ═══════════════════════════════════════════════════════════════════════
   Nova Public Chat — frontend controller
   Spec: Nova_Public_Chat_Frontend_UI_UX_Development_Specification.md
   Calls POST /api/public/chat (SSE streaming), /api/public/lead, /api/public/demo
   State model §23, copy library §28, safe Markdown §25, RTL §20.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  // ── DOM references ──
  const $ = (s) => document.querySelector(s);
  const conversation = $("#conversation");
  const composer = $("#composer");
  const messageInput = $("#message");
  const sendButton = $("#send-button");
  const newConversationBtn = $("#new-conversation");
  const starterRow = $("#starter-row");
  const suggestedActions = $("#suggested-actions");
  const menuToggle = $("#menu-toggle");
  const mobileNav = $("#mobile-nav");
  const headerDemo = $("#header-demo");
  const mobileDemo = $("#mobile-demo");
  const demoSheet = $("#demo-sheet");
  const demoClose = $("#demo-close");
  const leadForm = $("#lead-form");
  const leadSubmit = $("#lead-submit");
  const formStatus = $("#form-status");

  // ── Copy library (§28) ──
  const COPY = {
    welcome: "I'm Nova's product assistant. Tell me what kind of business you run, or ask me anything about Nova.",
    thinking: "Finding the most relevant Nova information…",
    error: "I couldn't reach Nova just now. Please try again.",
    retry: "Try again",
    newConversation: "New conversation",
    demoTitle: "See Nova in action",
    demoSupport: "Get a walkthrough based on the workflow you want to improve.",
    consent: "I agree that the Nova team may contact me about this request.",
    success: "Request received",
    successDetail: "Thanks. Your request has been sent to the Nova team.",
  };

  // ── State (§23) ──
  let conversationState = "idle"; // idle | sending | streaming | completed | error
  let leadCaptureState = "closed"; // closed | collecting | submitting | submitted | failed
  let conversationId = createConversationId();
  let lastIntent = null;
  let abortController = null;

  function createConversationId() { return `pub-${crypto.randomUUID()}`; }

  // ═══════════════════════════════════════════════════════════════════════
  // Safe Markdown renderer (§25) — escapes first, then applies a small
  // whitelist of formatting. No raw HTML survives. Links are validated.
  // ═══════════════════════════════════════════════════════════════════════
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function isSafeUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      if (u.protocol === "http:" || u.protocol === "https:") return true;
      return false;
    } catch { return false; }
  }
  function renderMarkdown(text) {
    const src = String(text || "");
    let html = escapeHtml(src);
    html = html.replace(/`([^`\n]+)`/g, (m, c) => `<code>${c}</code>`);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      if (!isSafeUrl(url)) return label;
      const full = url.startsWith("http") ? url : new URL(url, window.location.origin).href;
      return `<a href="${escapeHtml(full)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    });
    const blocks = html.split(/\n{2,}/);
    const out = [];
    let listType = null;
    const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    for (const rawBlock of blocks) {
      const block = rawBlock.trim();
      if (!block) continue;
      const lines = block.split("\n");
      const h = block.match(/^(#{1,3})\s+(.+)$/);
      if (h) { flushList(); out.push(`<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`); continue; }
      if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
        if (listType !== "ul") { flushList(); out.push("<ul>"); listType = "ul"; }
        lines.forEach((l) => out.push(`<li>${l.trim().replace(/^[-*]\s+/, "")}</li>`));
        continue;
      }
      if (lines.every((l) => /^\d+\.\s+/.test(l.trim()))) {
        if (listType !== "ol") { flushList(); out.push("<ol>"); listType = "ol"; }
        lines.forEach((l) => out.push(`<li>${l.trim().replace(/^\d+\.\s+/, "")}</li>`));
        continue;
      }
      flushList();
      out.push(`<p>${lines.join("<br>")}</p>`);
    }
    flushList();
    return out.join("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Conversation rendering
  // ═══════════════════════════════════════════════════════════════════════
  function isNearBottom() {
    return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 80;
  }
  function scrollToBottom(force = false) {
    if (force || isNearBottom()) conversation.scrollTop = conversation.scrollHeight;
  }

  const NOVA_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18V6l10 12V6"/></svg>`;

  function addMessage(text, role) {
    const row = document.createElement("article");
    row.className = `message-row ${role}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (role === "visitor") avatar.textContent = "You";
    else avatar.innerHTML = NOVA_SVG;
    const stack = document.createElement("div");
    stack.className = "message-stack";
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = role === "visitor" ? "You" : "Nova";
    const bubble = document.createElement("div");
    bubble.className = "message";
    if (role === "assistant") bubble.innerHTML = renderMarkdown(text);
    else bubble.textContent = String(text || "");
    stack.append(label, bubble);
    row.append(avatar, stack);
    conversation.append(row);
    scrollToBottom();
    return bubble;
  }

  function addErrorMessage() {
    const row = document.createElement("article");
    row.className = "message-row assistant error";
    const stack = document.createElement("div");
    stack.className = "message-stack";
    const bubble = document.createElement("div");
    bubble.className = "message";
    bubble.textContent = COPY.error;
    const retry = document.createElement("button");
    retry.className = "retry-button";
    retry.type = "button";
    retry.textContent = COPY.retry;
    retry.addEventListener("click", () => { row.remove(); retryLastMessage(); });
    stack.append(bubble, retry);
    row.append(stack);
    conversation.append(row);
    scrollToBottom(true);
  }

  function showTypingIndicator() {
    const row = document.createElement("article");
    row.className = "message-row assistant";
    row.id = "typing-row";
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = NOVA_SVG;
    const stack = document.createElement("div");
    stack.className = "message-stack";
    const bubble = document.createElement("div");
    bubble.className = "message typing-indicator";
    bubble.setAttribute("aria-label", COPY.thinking);
    bubble.innerHTML = "<span></span><span></span><span></span>";
    stack.append(bubble);
    row.append(avatar, stack);
    conversation.append(row);
    scrollToBottom();
  }
  function removeTypingIndicator() {
    const t = document.getElementById("typing-row");
    if (t) t.remove();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Welcome state
  // ═══════════════════════════════════════════════════════════════════════
  function renderWelcomeState() {
    const welcome = document.createElement("div");
    welcome.className = "welcome-state";
    const avatar = document.createElement("div");
    avatar.className = "welcome-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = NOVA_SVG;
    const h2 = document.createElement("h2");
    h2.textContent = "Nova Product Assistant";
    const p = document.createElement("p");
    p.textContent = COPY.welcome;
    welcome.append(avatar, h2, p);
    conversation.append(welcome);
    scrollToBottom();
  }

  function renderSuggestedActions(actions) {
    if (!actions || !actions.length) { suggestedActions.hidden = true; suggestedActions.replaceChildren(); return; }
    const items = actions.slice(0, 3).map((action) => {
      const btn = document.createElement("button");
      btn.className = "action-chip";
      btn.type = "button";
      btn.dataset.action = action.action;
      if (action.value) btn.dataset.value = action.value;
      const icon = action.action === "open_url"
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-9 9M19 13v6H5V5h6"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
      btn.innerHTML = `<span>${escapeHtml(action.label)}</span>${icon}`;
      btn.addEventListener("click", () => handleAction(action));
      return btn;
    });
    suggestedActions.replaceChildren(...items);
    suggestedActions.hidden = false;
  }

  function handleAction(action) {
    if (!action || !action.action) return;
    switch (action.action) {
      case "ask":
        if (action.value) sendMessage(action.value);
        break;
      case "open_url":
        if (action.value && isSafeUrl(action.value)) window.open(action.value, "_blank", "noopener,noreferrer");
        break;
      case "demo_request":
      case "contact_sales":
        revealDemoSheet();
        break;
      case "select_industry":
        if (action.value) sendMessage(`My business is ${action.value}. How can Nova help?`);
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sending + streaming (§11)
  // ═══════════════════════════════════════════════════════════════════════
  let lastSentText = null;
  function retryLastMessage() {
    if (lastSentText) sendMessage(lastSentText);
  }

  async function sendMessage(text) {
    text = String(text || "").trim();
    if (!text || conversationState === "sending" || conversationState === "streaming") return;
    lastSentText = text;

    const welcome = conversation.querySelector(".welcome-state");
    if (welcome) welcome.remove();
    suggestedActions.hidden = true;
    suggestedActions.replaceChildren();

    addMessage(text, "visitor");
    messageInput.value = "";
    resizeInput();
    messageInput.focus();
    starterRow.classList.add("waiting");

    conversationState = "sending";
    composer.dataset.sending = "true";
    sendButton.disabled = true;

    showTypingIndicator();
    abortController = new AbortController();

    try {
      const response = await fetch("/api/public/chat", {
        method: "POST",
        signal: abortController.signal,
        headers: { "content-type": "application/json", "accept": "text/event-stream" },
        body: JSON.stringify({ conversation_id: conversationId, message: text, locale: detectLocale(), stream: true }),
      });
      if (!response.ok) {
        let msg = COPY.error;
        if (response.status === 429) msg = "You're sending messages a bit too quickly. Please wait a moment and try again.";
        throw new Error(msg);
      }
      removeTypingIndicator();

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || COPY.error);
        conversationId = data.conversation_id || conversationId;
        addMessage(data.reply || "", "assistant");
        if (data.suggested_actions) renderSuggestedActions(data.suggested_actions);
        conversationState = "completed";
        finishSend();
        if (data.lead && data.lead.capture_state === "qualifying") revealDemoSheet();
        return;
      }

      const assistantBubble = addMessage("", "assistant");
      assistantBubble.classList.add("streaming");
      let fullText = "";
      conversationState = "streaming";

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const wasNearBottom = isNearBottom();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop();
        for (const frame of frames) {
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === "meta") {
            if (parsed.data.conversation_id) conversationId = parsed.data.conversation_id;
            if (parsed.data.intent) lastIntent = parsed.data.intent;
          } else if (parsed.event === "delta") {
            fullText += parsed.data.text || "";
            assistantBubble.innerHTML = renderMarkdown(fullText);
            scrollToBottom(wasNearBottom);
          } else if (parsed.event === "done") {
            if (parsed.data.suggested_actions) renderSuggestedActions(parsed.data.suggested_actions);
            if (parsed.data.lead && parsed.data.lead.capture_state === "qualifying") revealDemoSheet();
          } else if (parsed.event === "error") {
            throw new Error(parsed.data.error || COPY.error);
          }
        }
      }
      assistantBubble.classList.remove("streaming");
      assistantBubble.innerHTML = renderMarkdown(fullText || COPY.error);
      conversationState = "completed";
    } catch (error) {
      removeTypingIndicator();
      if (error.name === "AbortError") {
        conversationState = "idle";
      } else {
        addErrorMessage();
        conversationState = "error";
      }
    } finally {
      finishSend();
    }
  }

  function finishSend() {
    composer.dataset.sending = "false";
    sendButton.disabled = false;
    starterRow.classList.remove("waiting");
    abortController = null;
  }

  function parseSseFrame(frame) {
    const lines = frame.split("\n");
    let event = "message", dataStr = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataStr += line.slice(6);
    }
    if (!dataStr) return null;
    try { return { event, data: JSON.parse(dataStr) }; } catch { return null; }
  }

  function detectLocale() {
    const lang = document.documentElement.lang || "en";
    if (lang === "ur") return "ur";
    return "en";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Lead capture (§13)
  // ═══════════════════════════════════════════════════════════════════════
  function revealDemoSheet() {
    if (leadCaptureState === "submitted") return;
    demoSheet.hidden = false;
    leadCaptureState = "collecting";
    setTimeout(() => $("#lead-name").focus(), 100);
  }
  function hideDemoSheet() {
    demoSheet.hidden = true;
    if (leadCaptureState !== "submitted") leadCaptureState = "closed";
    messageInput.focus();
  }

  function validateLeadForm() {
    let valid = true;
    const name = $("#lead-name");
    const contact = $("#lead-contact");
    const consent = $("#lead-consent");
    const errName = $("#err-name");
    const errContact = $("#err-contact");
    [name, contact].forEach((el) => el.removeAttribute("aria-invalid"));
    errName.hidden = true; errContact.hidden = true;

    if (!name.value.trim()) {
      name.setAttribute("aria-invalid", "true");
      errName.textContent = "Please enter your name.";
      errName.hidden = false;
      valid = false;
    }
    if (!contact.value.trim()) {
      contact.setAttribute("aria-invalid", "true");
      errContact.textContent = "Please enter an email or phone number.";
      errContact.hidden = false;
      valid = false;
    } else if (!/^\S+@\S+\.\S+$/.test(contact.value.trim()) && !/^[\d\s+()-]{7,}$/.test(contact.value.trim())) {
      contact.setAttribute("aria-invalid", "true");
      errContact.textContent = "Please enter a valid email or phone number.";
      errContact.hidden = false;
      valid = false;
    }
    if (!consent.checked) valid = false;
    return valid;
  }

  async function submitLead(event) {
    event.preventDefault();
    if (leadCaptureState === "submitting") return;
    if (!validateLeadForm()) return;

    const name = $("#lead-name").value.trim();
    const business = $("#lead-business").value.trim();
    const contact = $("#lead-contact").value.trim();
    const workflow = $("#lead-workflow").value.trim();
    const consent = $("#lead-consent").checked;

    const isEmail = /^\S+@\S+\.\S+$/.test(contact);
    const payload = {
      conversation_id: conversationId,
      name,
      business_name: business || null,
      demo_requested: true,
      consent: { contact_allowed: true, consent_text_version: "v1" },
    };
    if (isEmail) payload.email = contact; else payload.phone = contact;
    if (workflow) payload.business_problem = workflow;

    leadCaptureState = "submitting";
    leadSubmit.disabled = true;
    setFormStatus("Submitting…", "");

    try {
      const leadRes = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const leadData = await leadRes.json();
      if (!leadData.ok) {
        const msg = leadData.errors && leadData.errors.length ? leadData.errors.join("; ") : "Submission failed. Please try again.";
        setFormStatus(msg, "error");
        leadCaptureState = "failed";
        leadSubmit.disabled = false;
        return;
      }
      if (workflow) {
        await fetch("/api/public/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lead_id: leadData.lead_id, requested_scenario: workflow, preferred_contact_method: isEmail ? "email" : "phone" }),
        });
      }
      leadCaptureState = "submitted";
      setFormStatus(`${COPY.success} — ${COPY.successDetail} (Ref: ${leadData.lead_id})`, "success");
      leadSubmit.disabled = true;
      addMessage(`Thank you, ${name}! Your request has been received. The Nova team will follow up${isEmail ? ` at ${contact}` : ""}. (Reference: ${leadData.lead_id})`, "assistant");
      setTimeout(hideDemoSheet, 5000);
    } catch (error) {
      setFormStatus("Network error — please try again.", "error");
      leadCaptureState = "failed";
      leadSubmit.disabled = false;
    }
  }

  function setFormStatus(text, cls) {
    formStatus.textContent = text;
    formStatus.className = "form-status" + (cls ? " " + cls : "");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // New conversation
  // ═══════════════════════════════════════════════════════════════════════
  function startNewConversation() {
    if (abortController) { try { abortController.abort(); } catch {} }
    conversationId = createConversationId();
    conversation.replaceChildren();
    suggestedActions.hidden = true;
    suggestedActions.replaceChildren();
    leadCaptureState = "closed";
    leadSubmit.disabled = false;
    leadForm.reset();
    demoSheet.hidden = true;
    conversationState = "idle";
    renderWelcomeState();
    messageInput.focus();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Composer textarea auto-resize
  // ═══════════════════════════════════════════════════════════════════════
  function resizeInput() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 144)}px`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Mobile menu
  // ═══════════════════════════════════════════════════════════════════════
  function toggleMenu() {
    const open = mobileNav.hidden;
    mobileNav.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Event wiring
  // ═══════════════════════════════════════════════════════════════════════
  composer.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(messageInput.value); });
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(messageInput.value); }
  });
  messageInput.addEventListener("input", resizeInput);
  newConversationBtn.addEventListener("click", startNewConversation);
  headerDemo.addEventListener("click", revealDemoSheet);
  mobileDemo.addEventListener("click", () => { toggleMenu(); revealDemoSheet(); });
  demoClose.addEventListener("click", hideDemoSheet);
  leadForm.addEventListener("submit", submitLead);
  menuToggle.addEventListener("click", toggleMenu);

  // Delegate clicks for data-prompt buttons (nav links, starter chips, capability rows, mobile nav).
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-prompt]");
    if (el) {
      e.preventDefault();
      if (el.closest(".mobile-nav")) toggleMenu();
      sendMessage(el.dataset.prompt);
    }
  });

  // Close mobile menu on outside click.
  document.addEventListener("click", (e) => {
    if (!mobileNav.hidden && !mobileNav.contains(e.target) && !menuToggle.contains(e.target)) {
      toggleMenu();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════════════
  renderWelcomeState();
  resizeInput();
})();
