# Nova Website Widget SDK v36.0 — Embed Guide

Drop-in chat widget for any website. Embed in 3 lines, no build step, no dependencies. The widget renders inside a **Shadow DOM**, so your site's CSS can never break it and its styles never leak into your page.

## Quick Start (3 lines)

Add this snippet to any HTML page (before `</body>`):

```html
<script src="https://your-nova-server.com/widget.js"
        data-tenant="byt-cleaners-dubai"
        async></script>
```

That's it. A floating chat bubble appears in the bottom-right corner. Click to open. The bubble and panel use the **medium** size preset by default (bubble 68px, panel 392×600px) and the conversation starts immediately — **no name/phone pre-chat screen**.

## Requirements

- A running Nova server (v36.0+) at a public URL
- A configured tenant (e.g. `byt-cleaners-dubai`, `cleaning-demo`, `salon-demo`, `restaurant-demo`, `healthcare-demo`, `education-demo`, `tutor-demo`, `driving-school-demo`, `default`)
- The tenant's `profile.json` must have `"widget": { "enabled": true }` (default)

## 3 Ways to Embed

### Method 1 — Drop-in Script Tag (recommended)

```html
<script src="https://your-nova.com/widget.js"
        data-tenant="byt-cleaners-dubai"
        data-position="bottom-right"
        data-color="#0ea5e9"
        data-size="medium"
        data-skip-prechat="true"
        async></script>
```

**Pros**: Simplest, smallest, auto-mounts, no JavaScript knowledge required.

### Method 2 — Iframe (for strict CSP sites)

If your site's Content Security Policy blocks third-party scripts, use an iframe:

```html
<iframe
  src="https://your-nova.com/widget-test?tenant=byt-cleaners-dubai"
  style="position:fixed;bottom:0;right:0;width:392px;height:600px;border:0;z-index:999999"
  allow="clipboard-read; clipboard-write"
  title="Chat with us"></iframe>
```

**Pros**: Complete isolation from host page. **Cons**: No auto-mount bubble; takes fixed space.

### Method 3 — Programmatic (for SPAs)

```html
<script>
  // Configure before loading widget.js
  window.NOVA_WIDGET_CONFIG = {
    language: 'roman_urdu',
    autoOpen: true,
    autoOpenDelayMs: 5000
  };
</script>
<script src="/widget-config.js"></script>
<script src="/widget.js" data-tenant="byt-cleaners-dubai" async></script>
```

**Pros**: Runtime control. **Cons**: Slightly more code.

---

# All `data-*` Attributes (the control panel)

Every attribute below is **optional** and overrides the tenant's `profile.json` config for that page only. None are required except `data-tenant`.

## Core

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-tenant` | string | — *(required)* | Your tenant ID, e.g. `byt-cleaners-dubai` |
| `data-server` | URL | *(auto-detected)* | Override the Nova server origin, e.g. `https://nova.yourdomain.com`. Use this if the script is hosted on a CDN different from the API. |
| `data-api-key` | string | *(none)* | Public API key if your tenant requires one |

## Position & size — "where it sits and how big it is"

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-position` | `bottom-right` \| `bottom-left` \| `bottom-center` \| `side-panel` | `bottom-right` | Bubble + panel anchor corner. `side-panel` docks a full-height panel to the right edge. |
| `data-size` | `small` \| `medium` \| `large` | `medium` | Scales the whole widget. `small` = legacy compact (bubble 60px, panel 360×540). `medium` = bubble 68px, panel 392×600. `large` = bubble 76px, panel 420×640. |
| `data-offset-x` | number (px) | `0` | Nudge the bubble horizontally away from the viewport edge. Use when the widget overlaps a sticky footer, cookie bar, or WhatsApp button. |
| `data-offset-y` | number (px) | `0` | Nudge the bubble vertically. |
| `data-radius` | number (px) | `16` | Panel corner radius. `0` = square corners. |

### Position + size examples

Bottom-right, large widget, nudged up to clear a sticky footer:
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-position="bottom-right" data-size="large" data-offset-y="80" async></script>
```

Bottom-left, compact:
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-position="bottom-left" data-size="small" async></script>
```

Full-height side panel docked right:
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-position="side-panel" async></script>
```

## Appearance — color, icon, shape

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-color` | hex color | tenant's `themeColor` | Drives the bubble pulse ring, header background, message bubbles, send button, pre-chat submit. Example: `#0ea5e9`. |
| `data-avatar` | string | tenant's `agentAvatar` | One of the built-in portrait keys: `marcus`, `aria`, `david`, `maya`, `sofia`, `leo`, `emma`, `noah`, `luna`, `kai`. |
| `data-icon` | emoji \| image URL \| inline `<svg>` | *(uses avatar)* | Replace the bubble icon entirely. See "Custom bubble icon" below. |
| `data-radius` | number (px) | `16` | Panel corner radius (also settable via size preset). |

### Custom bubble icon (`data-icon`)

Three accepted formats — Nova detects which one you used:

**Emoji** (quickest — great for a friendly brand):
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-icon="🧹" data-color="#0ea5e9" async></script>
```

**Image URL** (your own logo — uses a circular crop):
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-icon="https://yourdomain.com/logo.png" async></script>
```

**Inline SVG** (full control, crisp at any size):
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-icon="<svg viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><path d='M3 21h18M5 21V8l7-5 7 5v13'/></svg>"
        data-color="#0ea5e9" async></script>
```

## Language & messaging — "what it says"

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-language` | `auto` \| `english` \| `roman_urdu` | `auto` | Display language. `auto` detects from the browser. |
| `data-welcome` | string | tenant's `welcomeMessage` | The **first in-panel message** shown when the visitor opens the chat. |
| `data-greeting` | string | tenant's proactive message | The **proactive auto-pop bubble** message that appears near the launcher before the visitor clicks. Enabling this also turns the proactive greeting on. |

### Recommended attractive greetings

Use `data-greeting` to proactively draw visitors in. A few proven patterns:

**Question hook** (highest engagement — invites an answer):
```html
data-greeting="Hi! 👋 Looking for a cleaning quote? I can price it in seconds."
```

**Offer / benefit lead**:
```html
data-greeting="Hi! 👋 Book a deep clean this week and get a free sofa refresh. Want a quick quote?"
```

**Help-oriented** (low pressure):
```html
data-greeting="Hi! 👋 I'm Maya. Need help choosing a cleaning service or booking a slot? Just ask."
```

**Urgency / availability**:
```html
data-greeting="Hi! 👋 We have cleaning slots open today. Want me to check availability for your area?"
```

> The proactive bubble auto-opens the full panel 3 seconds after it appears, so the visitor lands in the conversation with minimal friction.

## Pre-chat form — "skip the name/number screen"

By default (v36) the cleaning tenants skip the pre-chat form and start the conversation immediately. You can control this per-page:

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-skip-prechat` | `true` \| `false` | *(tenant config)* | `true` = never show the name/phone form, start chatting immediately. `false` = force the form on even if the tenant has it off. |
| `data-kiosk` | `true` | `false` | Legacy alias for `data-skip-prechat="true"`. Use in kiosk / public-terminal contexts. |

Skip the form entirely:
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-skip-prechat="true" async></script>
```

Force the form on (collect name + phone before chat):
```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-skip-prechat="false" async></script>
```

> When the form is skipped, the visitor chats as "Guest". Their name and contact details can still be captured later through the in-conversation lead/demo flow.

## Auto-open — "open the panel without a click"

| Attribute | Values | Default | Description |
|---|---|---|---|
| `data-auto-open` | `true` \| `false` | `false` | Automatically open the chat panel on page load. Skipped for returning visitors with an existing session. |
| `data-auto-open-delay` | number (ms) | `0` | Delay before auto-opening. e.g. `4000` opens after 4 seconds. |

```html
<script src="/widget.js" data-tenant="byt-cleaners-dubai"
        data-auto-open="true" data-auto-open-delay="4000" async></script>
```

---

# Full example — every attribute

```html
<script src="https://nova.yourdomain.com/widget.js"
        data-tenant="byt-cleaners-dubai"
        data-server="https://nova.yourdomain.com"
        data-position="bottom-right"
        data-size="large"
        data-offset-x="0"
        data-offset-y="0"
        data-radius="16"
        data-color="#0ea5e9"
        data-icon="🧹"
        data-language="auto"
        data-welcome="Hi! 👋 Tell me what you'd like cleaned and I'll quote it in seconds."
        data-greeting="Hi! 👋 Looking for a cleaning quote? I can price it in seconds."
        data-skip-prechat="true"
        data-auto-open="true"
        data-auto-open-delay="5000"
        async></script>
```

---

# Per-tenant config (in `profile.json`)

Any `data-*` attribute above has a corresponding key in `tenants/{tenantId}/profile.json` under the `widget` block. The page-level `data-*` attribute always wins. Edit the profile to set the tenant-wide default:

```json
{
  "widget": {
    "enabled": true,
    "position": "bottom-right",
    "themeColor": "#0ea5e9",
    "language": "auto",
    "size": "medium",
    "offsetX": 0,
    "offsetY": 0,
    "radius": 16,
    "welcomeMessage": "Hi! 👋 Welcome to Byt Cleaners Dubai. Tell me what you'd like cleaned…",
    "welcomeMessageRomanUrdu": "Assalam-o-alaikum! 👋 …",
    "customIcon": null,
    "suggestions": [
      "Get a deep cleaning quote",
      "Sofa & carpet cleaning prices",
      "Book a cleaning for tomorrow"
    ],
    "agentAvatar": "aria",
    "agentName": "Maya",
    "agentTitle": "Booking Agent — Online now",
    "preChatForm": { "enabled": false, "fields": [] },
    "proactiveGreeting": {
      "enabled": true,
      "delaySeconds": 6,
      "message": "Hi! 👋 I'm Maya from Byt Cleaners Dubai. Need a quick quote or want to book a cleaning? I'm here — just say hi.",
      "pageRules": []
    },
    "autoOpen": false,
    "autoOpenDelayMs": 0
  }
}
```

Changes take effect immediately (no server restart needed; `widget.js` has `Cache-Control: no-store`).

---

# Size reference

| Preset | Bubble | Panel (W×H) | Best for |
|---|---|---|---|
| `small` | 60px | 360×540 | Minimalist sites, secondary pages |
| `medium` *(default)* | 68px | 392×600 | Most business sites |
| `large` | 76px | 420×640 | Primary conversion pages, dedicated landing pages |

# Position reference

| Value | Behaviour |
|---|---|
| `bottom-right` | Bubble bottom-right, panel opens above-left of bubble |
| `bottom-left` | Bubble bottom-left, panel opens above-right of bubble |
| `bottom-center` | Bubble centered along bottom; panel opens centered |
| `side-panel` | Full-height docked panel on the right edge (no floating bubble) |

---

# Test page

Visit `https://your-nova.com/widget-test` for an interactive test page with:
- Tenant switcher (try all demo tenants)
- Live embed code generator
- Security + availability feature checklist

# Session persistence

The widget stores conversation state in `localStorage` under `nova-widget:{tenantId}`:
- `customerId` — random UUID, generated on first message
- `messages` — last 50 messages (capped to avoid quota issues)
- `savedAt` — timestamp; session expires after 7 days

On page reload, the widget restores the session and resumes the conversation.
Returning visitors skip the proactive greeting (unless `alwaysShow: true` is set in the tenant config).

# Mobile behaviour

On viewports ≤ 480px, the panel expands to full-screen takeover for better UX:
- Full width + height
- No border radius
- Bottom-anchored
- Proactive bubble hidden (would crowd a small screen)

The `data-size` preset is ignored on mobile — the panel is always full-screen there.

# Browser support

- Chrome 92+, Firefox 95+, Safari 15.4+ (uses `crypto.randomUUID()`)
- Falls back to `Math.random` for older browsers
- Requires Shadow DOM (all modern browsers; IE11 not supported)

# Rate limiting

The server enforces **30 messages per minute** per (IP + tenant) bucket.
When exceeded, the server returns HTTP 429 with:
- `Retry-After` header (seconds until reset)
- `X-RateLimit-Remaining: 0`
- JSON body: `{ "ok": false, "error": "Rate limit exceeded...", "retryAfterSeconds": 46 }`

The widget displays a friendly "please wait" message and disables sending until the window resets.

# Troubleshooting

### Widget doesn't appear
1. Open browser DevTools Console — check for `[Nova Widget]` errors
2. Verify `data-tenant` is set and matches a real tenant ID
3. Verify `/widget.js` loads: `curl https://your-nova.com/widget.js` should return JavaScript
4. Verify tenant's `widget.enabled` is `true` in `profile.json`
5. If the API is on a different domain, add `data-server="https://nova.yourdomain.com"`

### Pre-chat form still shows / still hidden
- `data-skip-prechat="true"` forces it off; `data-skip-prechat="false"` forces it on.
- Otherwise the tenant's `widget.preChatForm.enabled` in `profile.json` decides.
- Clear `localStorage` key `nova-widget:{tenantId}` to reset the "form already completed" flag.

### Bubble icon looks wrong
- `data-icon` accepts emoji, image URL, or inline `<svg>`. Inline SVG must start with `<svg`.
- Image URLs are cropped to a circle — use a square image for best results.
- To revert to the agent portrait, remove `data-icon` and set `data-avatar` to a portrait key.

### Panel too big / too small
- Use `data-size="small"` / `"medium"` / `"large"`.
- For pixel-level control, combine `data-radius` with `data-offset-x` / `data-offset-y`. The panel width/height follow the size preset and cannot be set to arbitrary px via attributes — edit the tenant's `profile.json` `size` field or request a custom preset.

### Messages don't send
1. Check Network tab for `/api/chat` request — should be 200
2. If 429: you're rate-limited, wait 60s
3. If 404: tenant ID doesn't exist
4. If 400: customerId format is wrong (must be `^[a-zA-Z0-9_-]+$`)
5. If CORS error: verify OPTIONS preflight returns `204` with `Access-Control-Allow-Origin: <your-origin>`

### Widget styles look broken
The widget uses Shadow DOM, so host page CSS cannot affect it. If styles look broken:
1. Hard-refresh (Shift+Reload) — `Cache-Control: no-store` should prevent this
2. Check that no browser extension is stripping CSP headers
3. The widget CSS is inline in `widget.js` — it cannot be customized externally; use the `data-*` attributes instead

# Production deployment checklist

- [ ] Nova server reachable at a public URL (e.g., `https://nova.yourdomain.com`)
- [ ] TLS configured (Let's Encrypt, Cloudflare, etc.)
- [ ] Tenant's `widget.enabled = true`
- [ ] `data-server` set if the API differs from the script host
- [ ] Tested end-to-end on `/widget-test` page
- [ ] Rate limit (30/min) is sufficient for your traffic — if not, scale horizontally or add Redis
- [ ] Set `NODE_ENV=production` and `NOVA_DEV_TOKEN` to protect admin/dev endpoints
- [ ] Monitor `/health` endpoint for uptime
- [ ] Consider adding PostgreSQL + Redis for persistent sessions across server restarts (see `.env.example`)
