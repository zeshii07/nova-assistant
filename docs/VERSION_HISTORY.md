# Nova Assistant — Version History & Architecture Documentation

This document tracks every version of Nova, what it added, key files, and architecture decisions. Use this as a reference when extending or debugging the system.

---

## Version Numbering

Nova uses semantic versioning: `MAJOR.MINOR.PATCH`
- **MAJOR** = significant new milestone (new dashboard, new integration, new capability)
- **MINOR** = new feature or improvement (new endpoint, new config option)
- **PATCH** = bug fix (no new features)

---

## v9.4.1 → v23.0 — Foundation (Sprints 1–23)

**What was built:**
- Multi-tenant conversation routing with 9 capabilities (cleaning, commerce, catalog, booking, offering, availability, pricing, crm, assistant)
- Deterministic conversation intelligence engine (22 modules, no LLM execution authority)
- Per-tenant file-based configuration (profile.json, knowledge/, pricing/, catalog/, etc.)
- WhatsApp Cloud API webhook receiver (signature verification, message parsing)
- Public chat widget at `/assistant`
- Developer Console at `/developer` with conversation playground

**Key files:**
- `packages/conversation-intelligence/src/conversationIntelligenceEngine.js` — 22-module deterministic NLU pipeline
- `packages/execution-engine/src/executionEngine.js` — Central coordinator (16-stage processing pipeline)
- `packages/capability-sdk/src/baseCapability.js` — Capability contract
- `apps/api/src/container.js` — Wires ~95 services together
- `apps/api/src/server.js` — Bare HTTP server with all routes

**Architecture principles established:**
1. Deterministic core: rules and semantic matching, NOT probabilistic LLM
2. LLM as second opinion only: ML may suggest, never execute state-changing actions
3. Per-tenant isolation: each business has private CRM, state, knowledge
4. File-based config: no database required for development

---

## v24.0 — Message Plan Architecture

**What was added:**
- `MessagePlanBuilder` — handles multi-intent messages, interruptions, corrections in a single message
- Example: "Book deep cleaning tomorrow at 10 and also do you accept card?" → answers payment question + continues booking
- `isReadOnlyIntent()` classifies read-only vs state-changing intents

**Key files:**
- `packages/conversation-intelligence/src/messagePlan.js`

**Why:** Customers often combine multiple intents in one message. Before v24, Nova would only handle the primary intent and silently drop the rest.

---

## v25.0 — NER Enhancement Layer

**What was added:**
- Rule-based + optional transformer NER that fills gaps in deterministic entity extraction
- Detects: vague dates ("next Friday"), times ("half past 2"), property types, furniture variants, quantities, person names, phone numbers
- Fills gaps the deterministic extractor missed; NEVER overrides deterministic results

**Key files:**
- `packages/ner-enhancement/src/nerEnhancementLayer.js`

**Why:** The deterministic extractor was missing edge cases like "next Friday at half past 2" → now both are caught.

---

## v26.0 — Production Hardening

**What was added:**
- Redis distributed lock for calendar slots (prevents double-booking across instances)
- Conversation state optimistic versioning (prevents lost updates from concurrent messages)
- Webhook idempotency (UNIQUE provider_event_id prevents duplicate processing)
- Protect `/api/dev/*` with env-gated auth token (`NOVA_DEV_TOKEN`)
- Correlation IDs (`requestId`) in all logs

**Key files:**
- `packages/concurrency-control/src/concurrencyControl.js`

**Why:** For production with multiple instances, you need distributed locks to prevent race conditions.

---

## v27.0 — Admin Dashboard

**What was added:**
- New app: `apps/admin-dashboard/` — operator console for Nova administrators
- Routes: `/admin` (dashboard), `/api/admin/*` (9 consolidated endpoints)
- Views: Overview, Tenants, Conversations, Leads, ML Insights, Capabilities, Test Runner, Data Inspector, Settings
- Real-time system health monitoring (Postgres, Redis, ML status)
- ML feedback loop viewer + online learner trigger

**Key files:**
- `apps/admin-dashboard/public/{index.html, style.css, app.js}`
- `apps/api/src/server.js` — added `/api/admin/*` endpoints

**Why:** Operators needed a single place to see all tenants, conversations, and system health without using curl.

---

## v28.0 — Website Widget SDK

**What was added:**
- Drop-in embeddable chat widget: `<script src="/widget.js" data-tenant="cleaning-demo" async></script>`
- Shadow DOM isolation (host page CSS can't leak in/out)
- XSS-safe rendering (textContent only, never innerHTML with user input)
- CORS preflight + IP-based rate limiting (30 msgs/min per IP+tenant)
- Tenant verification (rejects unknown tenant IDs)
- Session persistence in localStorage (7-day TTL)
- Retry with exponential backoff (3 retries: 1s, 2s, 4s)
- Mobile responsive (fullscreen on ≤480px)

**Key files:**
- `apps/widget/public/widget.js` — the embeddable script
- `apps/widget/public/widget-config.js` — optional config helper
- `apps/api/src/server.js` — CORS, rate limiter, `/api/widget/config/*`, `/api/chat` hardening

**Why:** Businesses needed to embed Nova on their own websites. Without a widget, Nova was only accessible via the developer console.

---

## v29.0 — Widget UX: Agent Persona

**What was added:**
- 10 pre-built SVG agent avatars (aria, marcus, sophie, david, emma, liam, natalie, james, olivia, noah)
- Agent avatar replaces generic message icon
- Speech-bubble welcome message (visible before chat opens)
- 4 positions: bottom-right, bottom-left, bottom-center, side-panel
- Pre-chat form (name + phone) captures lead info before chat starts
- Proactive greeting (auto-opens after N seconds, first-visit only)
- "Online" pulse ring on avatar

**Key files:**
- `apps/widget/public/avatars.js` — 10 SVG portraits
- `apps/widget/public/widget.js` — rewritten with agent persona + 4 positions + pre-chat + proactive
- `apps/api/src/server.js` — `/api/widget/config` extended with agent, preChatForm, proactiveGreeting

**Why:** The generic message icon felt impersonal. Businesses wanted a branded agent that looks like a real person.

---

## v30.0 — Business Email Notifications

**What was added:**
- Email notification engine (Gmail SMTP via nodemailer)
- 5 email templates: booking_confirmed, order_placed, lead_captured, handoff_requested, nova_failed
- Per-tenant notification preferences (recipient emails, event toggles, quiet hours, daily digest)
- Notification log (persists to `.nova-notifications/{tenantId}.json`)
- Admin dashboard Notifications tab (KPIs, table, preferences editor, SMTP test)
- Dev mode (logs emails instead of sending if SMTP not configured)

**Key files:**
- `packages/notification-engine/src/{emailTemplates,emailService,fileNotificationLogRepository,notificationService,index}.js`
- `apps/api/src/server.js` — 6 `/api/admin/notifications/*` endpoints
- `apps/admin-dashboard/public/app.js` — Notifications tab

**Why:** Business owners needed to know the moment a booking happened — that's the whole point of Nova.

---

## v30.1 — Tenant Templates & Onboarding Wizard

**What was added:**
- 4 pre-built templates (cleaning, retail, salon, restaurant) extracted from demo tenants
- Custom template creation (define new business type from scratch: gym, vet, real estate)
- 2-minute onboarding wizard: pick template → enter business details → customize branding → get embed snippet
- Tenant management list with search, filter, stats
- Services & Prices editor (Step 4 in wizard) — edit services/products and prices before creating
- API key security (optional per-tenant `widget.apiKey` + `allowedDomains` whitelist)
- Tenant export endpoint (download tenant config for git commit — solves Render ephemeral filesystem)

**Key files:**
- `tenants/_templates/{cleaning,retail,salon,restaurant}-template/`
- `apps/api/src/server.js` — tenant creation logic (direct copy from source tenant + name replacement)
- `scripts/extract-templates.js`, `scripts/fix-template-placeholders.js`
- `apps/admin-dashboard/public/app.js` — Onboard Business tab + enhanced Tenants view

**Architecture decision (v30.1.5):** New tenants are created by DIRECTLY COPYING the entire source demo tenant folder (byte-for-byte clone), NOT from the template with placeholders. This guarantees the new tenant is an exact replica of the demo tenant — same routing, same conversation quality, same capabilities. Only profile.json, personality.json, templates/assistant.json, knowledge/business.json, and pricing files are modified with the new business name.

**Why:** Each business must be its own tenant (isolated CRM, bookings, leads). But manually configuring a new tenant from scratch took hours. Templates + wizard reduced this to 2 minutes.

---

## v30.1.6 — Bugfixes

- Fixed business hours parser to handle abbreviated formats ("Mon-Sat, 8 AM - 8 PM")
- Fixed deep recursive name replacement (catches nested fields like `pricingBenchmark.affiliation`)

---

## v30.1.7 — Bugfixes

- Fixed duplicate reply paragraphs (when both interruption handler and main capability produce the same answer)
- Added `deduplicateParagraphs()` function in executionEngine.js

---

## v31.0 — Google Calendar Integration

**What was added:**
- Google OAuth 2.0 connection (business owner authorizes Nova to read/write their calendar)
- Real-time availability check (queries Google Calendar freeBusy API before confirming bookings)
- Calendar event creation (creates events with customer details, service, address)
- Customer calendar invites (adds customer email as attendee → they get a Google Calendar invite)
- Hold → confirm flow (tentative events for holds, confirmed events for bookings)
- Calendar event listing (list only Nova-created events using extendedProperties)
- Admin dashboard Calendar tab (connect, test, disconnect, view upcoming events)
- Per-tenant token storage (`.nova-calendar-tokens/{tenantId}.json`)

**Key files:**
- `packages/calendar-engine/src/googleOAuthClient.js` — OAuth2 client, getAuthUrl, exchangeCode, refresh
- `packages/calendar-engine/src/googleCalendarProvider.js` — implements check, hold, confirmHold, releaseHold, reschedule, cancel, listEvents
- `packages/calendar-engine/src/fileCalendarTokenRepository.js` — per-tenant token storage
- `apps/api/src/server.js` — 6 `/api/admin/calendar/*` endpoints (auth, callback, status, disconnect, events, test)
- `apps/api/src/container.js` — wires GoogleCalendarProvider into CalendarService
- `apps/admin-dashboard/public/app.js` — Calendar tab

**Architecture:** The GoogleCalendarProvider satisfies the existing `CalendarProvider` contract (REQUIRED_METHODS: check, hold, confirmHold, releaseHold, reschedule, cancel, listEvents). When a tenant's `calendar/config.json` has `provider: "google"`, the CalendarService delegates to GoogleCalendarProvider. When `provider: "local"`, it uses the in-memory local calendar. This means the cleaning/booking workflows don't need to change — they just call `calendarService.check()` and the provider handles the rest.

**Setup required:**
1. Google Cloud Console: create project, enable Calendar API, create OAuth 2.0 credentials
2. Set env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
3. Dashboard → Calendar tab → Connect Google Calendar

---

## v32.0 — Business Manager Dashboard

**What was added:**
- Per-business-owner authentication (email + password, bcrypt-hashed, JWT sessions)
- Separate dashboard at `/business` (distinct from `/admin` which is for Nova operators)
- Business owner sees ONLY their tenant's data (not all tenants)
- Views: Today Overview, Inbox (conversations), Bookings, Leads Pipeline, Customers (CRM), Settings

**Key files:**
- `packages/auth-engine/src/businessOwnerAuthService.js` — auth + JWT
- `apps/business-dashboard/public/{index.html, style.css, app.js}` — the business owner dashboard
- `apps/api/src/server.js` — `/api/business/*` endpoints + `/business` route
- `tenants/{tenantId}/owners.json` — owner credentials per tenant

**Why:** Business owners need their own login and view. They shouldn't see other tenants' data. The admin dashboard is for Nova operators; the business dashboard is for business owners.

---

## v33.0 — Conversation Takeover (current)

**What was added:**
- Business owners can "take over" a conversation — Nova stops auto-replying
- Owner replies are stored in conversation state and delivered to the customer via polling
- Widget polls `/api/chat/poll` every 5 seconds when takeover is active (near-real-time delivery without WebSockets)
- Auto-release: takeover expires after 2 hours if owner doesn't respond (configurable)
- Customer sees "💬 Your message has been forwarded to [Owner Name]" when takeover is active
- Owner sees pending customer messages in the conversation detail view
- Conversation timeline shows who sent each message (🤖 Nova vs 👤 Owner)

**How it works:**
1. Owner opens Business Dashboard → Inbox → clicks a conversation
2. Owner clicks "Take Over" (or simply types a reply — takeover starts automatically)
3. Nova's execution engine checks `state.context.takeover.active` before processing
4. If active: customer messages are stored as "pending" for the owner, Nova does NOT auto-reply
5. Owner types a reply → stored in `state.context.takeover.ownerReplies[]`
6. Widget polls `/api/chat/poll` → gets undelivered owner replies → displays them
7. Owner clicks "Release to Nova" → takeover deactivated → Nova resumes auto-replying

**Key files:**
- `packages/execution-engine/src/executionEngine.js` — takeover check at the top of `process()`, before conversation intelligence
- `apps/api/src/server.js` — endpoints: `/api/business/takeover`, `/api/business/release`, `/api/business/conversation/{customerId}`, `/api/business/reply` (modified), `/api/chat/poll` (new)
- `apps/business-dashboard/public/app.js` — conversation detail view with timeline, takeover/reply/release buttons
- `apps/widget/public/widget.js` — polling functions `startTakeoverPolling()` / `stopTakeoverPolling()`

**Architecture decision:** The takeover check runs BEFORE conversation intelligence analysis. This means when takeover is active, the entire NLU pipeline (22 modules, ML classifier, semantic router) is skipped — just a simple state check + store message + return "forwarded" reply. This is intentional: if the owner is handling the conversation, there's no need to waste CPU on intent classification.

**Why:** Without takeover, business owners have no way to intervene when Nova is handling a conversation poorly. Takeover gives them real control — they can step in, reply directly, and step back when they're done.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nova Server                              │
│  apps/api/src/server.js — HTTP server + all routes               │
│  apps/api/src/container.js — wires ~95 services together         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Widget SDK │  │   Admin     │  │  Business   │            │
│  │  /widget.js │  │  Dashboard  │  │  Dashboard  │            │
│  │  (v28-29)   │  │  /admin     │  │  /business   │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                    │
│         ▼                ▼                ▼                    │
│  ┌─────────────────────────────────────────────┐              │
│  │              API Layer (server.js)            │              │
│  │  /api/chat  /api/widget/*  /api/admin/*       │              │
│  │  /api/business/*  /webhooks/whatsapp/*        │              │
│  └──────────────────────┬──────────────────────┘              │
│                         │                                       │
│  ┌──────────────────────▼──────────────────────┐              │
│  │           Execution Engine                   │              │
│  │  packages/execution-engine/src/              │              │
│  │  16-stage pipeline: analyze → route →        │              │
│  │  execute → humanize → persist → notify       │              │
│  └──────────────────────┬──────────────────────┘              │
│                         │                                       │
│  ┌──────────┐  ┌────────┴────────┐  ┌──────────────┐          │
│  │  9 Caps  │  │  Conversation   │  │  Calendar    │          │
│  │  cleaning│  │  Intelligence   │  │  Service     │          │
│  │  commerce│  │  Engine (22     │  │  ┌─────────┐ │          │
│  │  catalog │  │  modules)       │  │  │ Google  │ │          │
│  │  booking │  │  + ML hybrid    │  │  │ Provider│ │          │
│  │  offering│  │  router         │  │  │ (v31)   │ │          │
│  │  avail.  │  └─────────────────┘  │  └─────────┘ │          │
│  │  pricing │                      └──────────────┘          │
│  │  crm     │  ┌─────────────┐  ┌──────────────┐            │
│  │  assistant│  │ Notification │  │  Auth Engine │            │
│  └──────────┘  │ Engine (v30) │  │  (v32)       │            │
│                └─────────────┘  └──────────────┘            │
│                                                                  │
│  ┌─────────────────────────────────────────────┐              │
│  │           Tenant Storage (file-based)         │              │
│  │  tenants/{tenantId}/profile.json               │              │
│  │  tenants/{tenantId}/knowledge/                │              │
│  │  tenants/{tenantId}/cleaning/services.json    │              │
│  │  tenants/{tenantId}/calendar/config.json       │              │
│  │  .nova-notifications/{tenantId}.json           │              │
│  │  .nova-calendar-tokens/{tenantId}.json         │              │
│  │  .nova-feedback/{tenantId}.json                │              │
│  └─────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

1. **Deterministic core**: Rules and semantic matching, NOT probabilistic LLM. LLM is second opinion only.
2. **Per-tenant isolation**: Each business has private CRM, state, knowledge, calendar, notifications.
3. **File-based config**: No database required for development. PostgreSQL + Redis optional for production.
4. **Provider pattern**: Calendar, LLM, NLU all use provider contracts — swap implementations without changing business logic.
5. **Capability SDK**: Each capability (cleaning, commerce, etc.) is a self-contained module with a manifest.
6. **Template + instance**: Templates are frozen starting points; new tenants are exact replicas of demo tenants.

---

## Environment Variables Reference

See `.env.example` for the complete list. Key ones:

| Variable | Purpose | Required |
|----------|---------|----------|
| `NODE_ENV` | `development` or `production` | Yes |
| `PORT` | HTTP port (default 3000) | Yes |
| `NOVA_DEV_TOKEN` | Protects `/api/dev/*` and `/api/admin/*` | Production only |
| `NOVA_SMTP_HOST` | Gmail SMTP host | For email notifications |
| `NOVA_SMTP_USER` | Gmail address | For email notifications |
| `NOVA_SMTP_PASS` | Gmail App Password | For email notifications |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For Google Calendar |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | For Google Calendar |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | For Google Calendar |
| `DATABASE_URL` | PostgreSQL connection string | For persistent storage |
| `REDIS_URL` | Redis connection string | For distributed locks |

---

## URL Reference

| URL | Who | What |
|-----|-----|------|
| `/widget-test` | Developers | Test the embeddable widget |
| `/widget.js` | Websites | Embeddable widget script |
| `/assistant` | Customers | Public chat widget |
| `/developer` | Developers | Conversation playground |
| `/admin` | Nova operators | Admin dashboard |
| `/business` | Business owners | Business manager dashboard (v32) |
| `/health` | Monitoring | System health check |
| `/api/chat` | Widget | Send a chat message |
| `/api/widget/config/{tenantId}` | Widget | Get widget configuration |
| `/api/admin/*` | Admin dashboard | Operator endpoints |
| `/api/business/*` | Business dashboard | Business owner endpoints (v32) |
| `/webhooks/whatsapp/{tenantId}` | Meta | WhatsApp webhook receiver |

---

## v33.1 — Keep-alive, Login Clarity, Password Reset, Voice (current)

**What was added:**

### 1. Render keep-alive (prevents server sleep)
- Server self-pings `/health` every 10 minutes
- Prevents Render free tier from sleeping after 15 min of inactivity
- First message is no longer delayed by cold-start
- Can be disabled with `NOVA_KEEP_ALIVE=false` env var
- Logs: `keep_alive.started` and `keep_alive.ping`

### 2. Login error clarity
- **Wrong email**: `No account found with email "X". Check the email or contact your Nova administrator to create an account.`
- **Wrong password**: `Incorrect password. Please try again, or contact your Nova administrator to reset your password.`
- Previously both returned the same vague "Invalid email or password"

### 3. Admin password reset
- `GET /api/admin/owners/{tenantId}` — list all business owner accounts
- `POST /api/admin/owners/{tenantId}/reset-password` — reset any owner's password
- Admin (Nova operator) uses the dev token to access these endpoints
- Owner can then log in with the new password immediately

### 4. Voice input + Voice output (widget)
- **🎤 Microphone button** — customer clicks to speak, browser transcribes via Web Speech API, auto-sends
- **🔊 Voice toggle** — enables/disables voice replies; when on, Nova's replies are spoken aloud via Speech Synthesis API
- Falls back gracefully if browser doesn't support speech APIs (mic button hidden, no TTS)
- Voice preference saved in localStorage (persists across page refreshes)
- Tries to use a female voice for more natural assistant experience

**Key files:**
- `apps/api/src/server.js` — keep-alive interval + admin owner management endpoints
- `packages/auth-engine/src/businessOwnerAuthService.js` — improved login errors + `resetPassword()` + `listOwners()`
- `apps/widget/public/widget.js` — microphone button, voice toggle, `speakText()`, `SpeechRecognition` integration

**Browser support for voice:**
- Chrome 25+ ✅ (full support)
- Edge 79+ ✅
- Safari 14.1+ ✅
- Firefox 44+ ✅ (TTS only, no STT in some versions)

**Why these features:**
1. Render sleep was causing 30-50s delays on first message — unacceptable for customer experience
2. Generic "invalid email or password" was frustrating for business owners who couldn't tell what was wrong
3. Admins need to reset passwords for owners who forget them
4. Voice makes Nova feel like a real assistant, not just a chatbot — customers can talk instead of type
