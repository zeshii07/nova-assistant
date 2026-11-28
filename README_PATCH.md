# Nova v73.1 Patch — Real-time Sync, Grouped Inbox, Handoff Alerts, Dashboard Charts

This zip contains ONLY the files changed for the 5 fixes requested:
1. Modernize admin + business dashboards (multicolor palette + Chart.js charts)
2. Group inbox messages by conversation (one row per conversation, not per message)
3. Real-time sync via WebSockets (no manual refresh needed)
4. Business owner replies send immediately (not after next customer message)
5. Human-intent alert when a customer asks for a person/manager

## How to install

Extract the zip into your Nova project root (the directory containing
`package.json`, `apps/`, `packages/`). The paths inside the zip mirror the
repo structure, so extracting with "preserve folder structure" will overwrite
the right files:

```bash
cd /path/to/your/nova-assistant
unzip -o nova-v73.1-realtime-and-dashboard-patch.zip
npm install        # installs the new 'ws' dependency
npm test           # optional: verify nothing broke
```

Then restart your server. The WebSocket server attaches to the same port as
your REST API at path `/ws` — no new env vars or port config needed.

## Files in this patch (13 total)

### New file (1)
- `packages/realtime/src/realtimeBridge.js` — the WebSocket bridge module.
  Hooks into the in-process EventBus, authenticates business + customer
  clients, and broadcasts filtered events (tenant-scoped). Uses the `ws`
  library, attached to the same HTTP server as the REST API.

### Backend (4)
- `apps/api/src/server.js` — wires the RealtimeBridge to the HTTP server;
  adds `GET /api/business/conversations/grouped` (one row per conversation
  with needsHuman + takeover flags); makes `/api/business/reply` push the
  owner's reply to the customer immediately over WS; adds
  `POST /api/chat/reply/delivered` (so the poll fallback doesn't
  double-deliver); broadcasts `takeover.changed.v1` on takeover/release.
- `packages/execution-engine/src/executionEngine.js` — when a customer
  triggers human-handoff, now publishes `handoff.alert.v1` on the EventBus
  (picked up by the bridge and pushed to the dashboard as a toast).
- `packages/conversation-intelligence/src/globalCommandEngine.js` — expanded
  the handoff keyword detector: now catches "talk to a manager/supervisor/
  person", "transfer me to a person", Roman Urdu + Arabic phrases, while
  avoiding false positives like "are you a human or a bot?".
- `package.json` + `package-lock.json` — added `ws@^8.23.1` dependency.

### Business owner dashboard (3)
- `apps/business-dashboard/public/index.html` — loads Chart.js v4 from CDN.
- `apps/business-dashboard/public/app.js` — grouped inbox (one row per
  conversation with ⚠ Human / 🎯 Takeover badges), WebSocket client for
  live message/handoff/takeover updates, handoff toast notifications,
  overview charts (7-day activity line, lead funnel donut, conversation
  status bar).
- `apps/business-dashboard/public/style.css` — extended multicolor palette
  (purple/blue/teal/pink/etc.), KPI card icons + gradient accents, chart-grid
  layout, toast container, live status dot, inbox summary bar.

### Admin dashboard (3)
- `apps/admin-dashboard/public/index.html` — loads Chart.js v4 from CDN.
- `apps/admin-dashboard/public/app.js` — overview now renders 3 charts
  (capability health bar, storage donut, system snapshot horizontal bar) +
  multicolor KPI kinds.
- `apps/admin-dashboard/public/style.css` — same multicolor palette + the
  chart-grid layout.

### Customer widget (1)
- `apps/widget/public/widget.js` — opens a WebSocket when takeover starts
  so owner replies appear instantly. The existing 5s poll stays as a
  fallback; both paths coordinate via `/api/chat/reply/delivered` so a
  reply is never double-rendered.

## Verification (done before zipping)
- All 13 files pass `node --check` (syntax valid).
- Server boots cleanly; WS bridge logs `realtime.started`.
- Real WS upgrade test: connect → auth → subscribe → all confirmed.
- Handoff keyword detector: 18/18 test cases pass (broader coverage, no
  false positives).
- Handoff integration test: 8/8 pass (including "human request creates a
  real handoff record").
- The 2 sprint43 test failures are pre-existing (fail identically with the
  original code — NOT caused by this patch).

## Technical approach (per fix)

### 1. Real-time sync → WebSocket server
Used the `ws` v8 library (not Socket.IO — Nova already has an in-process
EventBus, and `ws` is lighter with no protocol overhead). One
`WebSocketServer` attached to the SAME HTTP server at `/ws` (Render exposes
only one port). The bridge subscribes to `EventBus '*'` and filters by
tenantId/customerId before pushing. Clients authenticate on connect
(business JWT or customer customerId). Heartbeat every 30s prunes dead
connections.

### 2. Inbox grouping
New endpoint `GET /api/business/conversations/grouped` groups replays by
customerId into a Map, computes per-conversation summary (messageCount,
lastMessage, lastSeen), enriches with live state (needsHuman from
state.context.handoff.status, takeoverActive from state.context.takeover),
sorts needsHuman-first. Frontend renders one row per conversation with
status badges + tinted row backgrounds.

### 3. Immediate owner-reply delivery
`/api/business/reply` now calls `realtimeBridge.broadcastToCustomer()` right
after storing the reply — pushing it to the customer's widget instantly.
The widget's WS handler renders it and POSTs `/api/chat/reply/delivered`
to mark it delivered, so the 5s poll fallback doesn't re-render it. The
widget de-duplicates by timestamp as a safety net.

### 4. Human-handoff alerts
Expanded the keyword detector (see globalCommandEngine.js). When it fires,
the execution engine publishes `handoff.alert.v1` with the trigger message.
The bridge pushes it to the business dashboard, which shows a slide-in
toast (customer ID + message excerpt + View button) and flags the
conversation with a ⚠ Human badge in the inbox.

### 5. Dashboard modernization
Chart.js v4 loaded from CDN in both dashboards (degrades gracefully if CDN
unreachable). Business dashboard overview: 7-day activity line chart, lead
funnel donut, conversation status bar. Admin dashboard overview: capability
health bar, storage donut, system snapshot horizontal bar. Both got an
extended multicolor CSS palette (purple/blue/teal/pink/orange/indigo) with
gradient accents on KPI cards and active nav items.
