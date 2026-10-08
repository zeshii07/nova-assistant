# Nova Website Widget SDK v28.0 — Embed Guide

Drop-in chat widget for any website. Embed in 3 lines, no build step, no dependencies.

## Quick Start (3 lines)

Add this snippet to any HTML page (before `</body>`):

```html
<script src="https://your-nova-server.com/widget.js"
        data-tenant="cleaning-demo"
        async></script>
```

That's it. A floating chat bubble appears in the bottom-right corner. Click to open.

## Requirements

- A running Nova server (v28.0+) at a public URL
- A configured tenant (one of: `cleaning-demo`, `default`, `healthcare-demo`, `salon-demo`, `restaurant-demo`, `education-demo`, `tutor-demo`, `driving-school-demo`)
- The tenant's `profile.json` must have `"widget": { "enabled": true }` (default since v28.0)

## 3 Ways to Embed

### Method 1 — Drop-in Script Tag (recommended)

```html
<script src="https://your-nova.com/widget.js"
        data-tenant="cleaning-demo"
        data-position="bottom-right"
        data-color="#10b981"
        async></script>
```

**Pros**: Simplest, smallest, auto-mounts, no JavaScript knowledge required.

### Method 2 — Iframe (for strict CSP sites)

If your site's Content Security Policy blocks third-party scripts, use an iframe:

```html
<iframe
  src="https://your-nova.com/widget-test?tenant=cleaning-demo"
  style="position:fixed;bottom:0;right:0;width:360px;height:540px;border:0;z-index:999999"
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
<script src="/widget.js" data-tenant="cleaning-demo" async></script>
```

**Pros**: Runtime control. **Cons**: Slightly more code.

## data-* Attributes (all optional, override tenant config)

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| `data-tenant` | string (required) | — | Your tenant ID |
| `data-position` | `bottom-right` \| `bottom-left` | `bottom-right` | Bubble + panel position |
| `data-color` | hex color | tenant's `themeColor` | Bubble + header color |
| `data-language` | `auto` \| `english` \| `roman_urdu` | `auto` | Display language |
| `data-welcome` | string | tenant's welcome message | Override welcome message |

## Customizing Per-Tenant Config

Edit `tenants/{tenantId}/profile.json` and add/modify the `widget` block:

```json
{
  "widget": {
    "enabled": true,
    "position": "bottom-right",
    "themeColor": "#10b981",
    "language": "auto",
    "welcomeMessage": "Hi! How can I help you today?",
    "welcomeMessageRomanUrdu": "Salam! Main aap ki kaise madad kar sakta hoon?",
    "suggestions": [
      "What services do you offer?",
      "Book an appointment",
      "What are your hours?"
    ]
  }
}
```

Changes take effect immediately (no server restart needed; widget.js has `Cache-Control: no-store`).

## Test Page

Visit `https://your-nova.com/widget-test` for an interactive test page with:
- Tenant switcher (try all 8 demo tenants)
- Live embed code generator
- Security + availability feature checklist

## Session Persistence

The widget stores conversation state in `localStorage` under the key `nova-widget:{tenantId}`:
- `customerId` — random UUID, generated on first message
- `messages` — last 50 messages (capped to avoid quota issues)
- `savedAt` — timestamp; session expires after 7 days

On page reload, the widget restores the session and resumes the conversation.
If the server has lost state (e.g., restarted in memory mode), the widget
detects this and gracefully starts a new session.

## Mobile Behavior

On viewports ≤ 480px, the panel expands to full-screen takeover for better UX:
- Full width + height
- No border radius
- Bottom-anchored

## Browser Support

- Chrome 92+, Firefox 95+, Safari 15.4+ (uses `crypto.randomUUID()`)
- Falls back to `Math.random` for older browsers
- Requires Shadow DOM (all modern browsers; IE11 not supported)

## Rate Limiting

The server enforces **30 messages per minute** per (IP + tenant) bucket.
When exceeded, the server returns HTTP 429 with:
- `Retry-After` header (seconds until reset)
- `X-RateLimit-Remaining: 0`
- JSON body: `{ "ok": false, "error": "Rate limit exceeded...", "retryAfterSeconds": 46 }`

The widget displays a friendly "please wait" message and disables sending until the window resets.

## Troubleshooting

### Widget doesn't appear
1. Open browser DevTools Console — check for `[Nova Widget]` errors
2. Verify `data-tenant` is set and matches a real tenant ID
3. Verify `/widget.js` loads: `curl https://your-nova.com/widget.js` should return JavaScript
4. Verify tenant's `widget.enabled` is `true` in `profile.json`

### Messages don't send
1. Check Network tab for `/api/chat` request — should be 200
2. If 429: you're rate-limited, wait 60s
3. If 404: tenant ID doesn't exist
4. If 400: customerId format is wrong (must be `^[a-zA-Z0-9_-]+$`)
5. If CORS error: verify OPTIONS preflight returns 204 with `Access-Control-Allow-Origin: <your-origin>`

### Widget styles look broken
The widget uses Shadow DOM, so host page CSS cannot affect it. If styles look broken:
1. Hard-refresh (Shift+Reload) — `Cache-Control: no-store` should prevent this
2. Check that no browser extension is stripping CSP headers
3. The widget CSS is inline in `widget.js` — it cannot be customized externally

## Production Deployment Checklist

- [ ] Nova server reachable at a public URL (e.g., `https://nova.yourdomain.com`)
- [ ] TLS configured (Let's Encrypt, Cloudflare, etc.) — widget works over HTTPS only on HTTPS sites
- [ ] Tenant's `widget.enabled = true`
- [ ] Tested end-to-end on `/widget-test` page
- [ ] Rate limit (30/min) is sufficient for your traffic — if not, scale horizontally or add Redis
- [ ] Set `NODE_ENV=production` and `NOVA_DEV_TOKEN` to protect admin/dev endpoints
- [ ] Monitor `/health` endpoint for uptime
- [ ] Consider adding PostgreSQL + Redis for persistent sessions across server restarts (see `.env.example`)
