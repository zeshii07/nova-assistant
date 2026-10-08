# Nova Website Widget SDK v28.0 — Security Architecture

This document describes the security model, threat surface, and mitigations for the Nova Website Widget SDK.

## Threat Model

The widget runs **untrusted code on untrusted websites**. We assume:

1. The host page may be compromised or hostile
2. The user's browser may have malicious extensions
3. The network (between browser and Nova server) may be intercepted
4. Attackers will probe the public `/api/chat` endpoint for abuse vectors

## Security Controls

### 1. Shadow DOM Isolation (CSS/HTML containment)

The widget mounts all HTML and CSS inside a Shadow DOM:

```javascript
const host = document.createElement('div');
host.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>/* scoped */</style>...`;
```

**What it prevents**:
- Host page CSS cannot leak into the widget (no `* { color: red }` hijacking)
- Widget CSS cannot leak out to the host page (no `.nova-bubble { display: none }` attacks)
- Host page JavaScript cannot access widget internals (Shadow DOM `mode: 'open'` allows inspection but not modification of internals)

**What it doesn't prevent**:
- Host page can still remove the entire `<div id="nova-widget-host">` element
- Host page can override `crypto.randomUUID` before widget.js loads (defense: widget validates UUID format on server)

### 2. XSS-Safe Rendering

All user input and assistant replies are rendered via `textContent`, never `innerHTML`:

```javascript
el.textContent = text; // XSS-safe — HTML is escaped automatically
```

**What it prevents**:
- `<script>alert(1)</script>` in user messages is displayed as text, not executed
- HTML injection in assistant replies (if a malicious tenant config has `<img onerror=...>`) cannot execute
- No `eval`, no `Function()`, no `setTimeout(string, ...)`, no `setInterval(string, ...)`

**What it doesn't prevent**:
- A compromised Nova server could serve a malicious `widget.js` that uses `innerHTML`. Defense: the widget is served with `Content-Security-Policy: default-src 'none'; script-src 'self'`, which prevents the script from injecting other origins' content.

### 3. CORS (Cross-Origin Resource Sharing)

The server sets permissive CORS on `/api/chat` and `/api/widget/config/*`:

```
Access-Control-Allow-Origin: <requesting origin>  (echoed, not *)
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type, x-nova-tenant-id
Access-Control-Max-Age: 600
Access-Control-Expose-Headers: X-Request-Id, X-RateLimit-Remaining
```

**Why permissive**: The widget MUST be embeddable on any website without a proxy. Restricting origins would require a per-tenant allowlist, which defeats the "drop-in" use case.

**What it prevents**:
- Other origins cannot read widget responses without going through the widget (cookies are NOT sent cross-origin — `credentials: 'omit'` is implicit since the widget doesn't send cookies)

**What it doesn't prevent**:
- Any website can POST to `/api/chat` programmatically. Defense: rate limiter + tenant verification + input validation.

### 4. Rate Limiting (in-memory, no Redis)

**Limit**: 30 messages per 60 seconds per (IP + tenantId) bucket.

**Implementation**: `apps/api/src/server.js` → `checkWidgetRateLimit(key)`

- Sliding window: first request starts the window, count increments per request
- Window resets after 60s of inactivity
- Buckets older than 5 minutes are garbage-collected
- Returns HTTP 429 with `Retry-After` header and JSON body

**Multi-instance caveat**: In a multi-pod deployment WITHOUT Redis, each Nova instance has its own bucket. So 3 pods × 30/min = 90/min effective limit. When Redis is configured (v26 hardening), swap `checkWidgetRateLimit` for a Redis-based counter for global counting.

**What it prevents**:
- DoS via message flooding
- Brute-force tenant ID probing
- Resource exhaustion (CPU, memory) from rapid message processing

**What it doesn't prevent**:
- Distributed DoS from many IPs — needs a WAF/Cloudflare in front
- Slow-loris attacks — needs a reverse proxy with timeout enforcement

### 5. Tenant Verification

The server verifies the `tenantId` exists before processing:

```javascript
try { container.tenantRepository.getById(tenantId); }
catch { return sendJson(res, 404, { ok:false, error:'Unknown tenant' }); }
```

**What it prevents**:
- Tenant ID enumeration (returns 404 for unknown, not 500)
- State pollution (cannot create state for non-existent tenants)

**What it doesn't prevent**:
- Known tenant ID discovery (anyone can read the public `/api/widget/config/{tenantId}` endpoint, but this only exposes `assistantName`, `welcomeMessage`, `themeColor`, `position`, `language`, `suggestions`, `businessName`, `businessDescription` — no sensitive data)

### 6. Customer ID Validation

The `customerId` field is validated server-side:

```javascript
let customerId = String(body.customerId || '').trim();
if (customerId.length === 0) {
  customerId = `widget-${crypto.randomUUID()}`;
} else if (customerId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(customerId)) {
  return sendJson(res, 400, { ok:false, error:'Invalid customerId' });
}
```

**What it prevents**:
- SQL injection via customerId (regex allows only `[a-zA-Z0-9_-]`, no quotes or operators)
- Path traversal via customerId (no `/` or `.` allowed)
- DoS via huge customerId strings (128-char max)
- Tenant ID injection via customerId (the regex would reject `tenant-2:malicious`)

**What it doesn't prevent**:
- The same customerId being used by multiple browsers (the widget uses `crypto.randomUUID()` which has 122 bits of entropy — collision is astronomically unlikely)

### 7. Message Length Cap

```javascript
if (String(body.text||'').trim().length > 4000)
  throw new ValidationError('Message is too long. Please keep it under 4,000 characters.');
```

**What it prevents**:
- Memory exhaustion via huge messages
- LLM token-limit DoS (if a remote NLU is configured)

### 8. Session Isolation (localStorage)

Each tenant's session is stored under a tenant-scoped key:

```javascript
const STORAGE_KEY = `nova-widget:${TENANT_ID}`;
```

**What it prevents**:
- Cross-tenant data leakage (Tenant A's widget cannot read Tenant B's conversation)
- Session fixation (each tenant has its own customerId)

**What it doesn't prevent**:
- Other scripts on the same origin reading localStorage (defense: widget doesn't store PII — only a random UUID and message text)

### 9. No PII Collection

The widget collects **zero** personally identifiable information client-side:
- No name, email, phone, address
- No fingerprinting (no canvas, no WebGL, no font detection)
- No analytics, no tracking pixels
- Customer ID is a cryptographically random UUID

The only data stored is:
- `customerId` (random UUID)
- `messages` (last 50 message texts, capped)
- `savedAt` (timestamp)

### 10. CSP Headers on Widget Assets

```
Content-Security-Policy: default-src 'none'; script-src 'self'
X-Content-Type-Options: nosniff
```

**What it prevents**:
- MIME sniffing attacks (X-Content-Type-Options)
- The widget script from being hijacked to load other origins' content (CSP)
- Inline script injection via the widget (CSP `script-src 'self'` only)

## Audit Trail

Every widget request is logged with:
- `clientIp` (from `x-forwarded-for` or `socket.remoteAddress`)
- `origin` (from `Origin` header)
- `tenantId`
- `customerId`
- `requestId` (correlation ID, returned in `X-Request-Id` header)
- `channel: 'widget'` (marks it as a widget-originated request)

Replays are stored in the `replayService` and visible in the Admin Dashboard → Conversations tab.

## Production Hardening Recommendations

1. **Add a WAF** (Cloudflare, AWS WAF) in front of Nova to filter malicious traffic before it hits the rate limiter
2. **Set up Redis** for distributed rate limiting across multiple Nova instances (see v26.0 hardening)
3. **Set up PostgreSQL** for persistent conversation state (so users don't lose context on server restart — see `.env.example`)
4. **Enable TLS** — widget works over HTTPS only on HTTPS sites (mixed-content blocking)
5. **Monitor `/health`** endpoint for uptime and storage status
6. **Set `NODE_ENV=production` and `NOVA_DEV_TOKEN`** to protect `/api/dev/*` and `/api/admin/*` endpoints
7. **Rotate `NOVA_DEV_TOKEN`** regularly (quarterly minimum)
8. **Audit `tenants/*/profile.json`** changes — the `widget` block controls what customers see

## Vulnerability Disclosure

Found a security issue? Please report it privately to the project maintainers before publishing. Do not include exploit payloads in public issues.
