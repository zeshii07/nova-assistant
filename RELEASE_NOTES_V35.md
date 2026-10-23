# Nova Assistant v35.0

**Multi-tenant SaaS conversation engine** for service businesses — cleaning, salon, restaurant, retail, healthcare, education, driving school, tutor. Deterministic NLU pipeline + capability adapters + embeddable widget + business owner dashboard.

---

## Live Demo

- **Kiosk (full-screen chat):** https://nova-saas-test.onrender.com/kiosk/cleaning-demo
- **Widget test page:** https://nova-saas-test.onrender.com/widget-test
- **Admin dashboard:** https://nova-saas-test.onrender.com/admin
- **Business owner dashboard:** https://nova-saas-test.onrender.com/business

---

## What's New in v35.0

### 1. PWA Support — Kiosk is installable as a native app
- **PWA manifest** (`/kiosk-manifest.json`) with inline SVG icons
- **Service worker** (`/kiosk-sw.js`) with offline message queue:
  - Caches kiosk shell + widget assets + product images + voice samples
  - When network drops, customer messages are queued in SW and auto-delivered on reconnect
  - Widget config is fetched network-first, falls back to cache
- **"Install App" button** appears on kiosk splash (uses `beforeinstallprompt`)
- Once installed, kiosk launches standalone — no browser chrome, like a native app
- **Auto-retry with exponential backoff**: `sendMessage()` retries up to 2 times (1s, 2s delays) on network errors and 5xx responses — handles Render cold starts gracefully

### 2. Product Catalog Management UI
- New **"Catalog"** tab in admin dashboard (`/admin`)
- Operators can:
  - **List** products for any tenant
  - **Add** new products (name, SKU, price, currency, description, sizes, colors, tags, inventory, in-stock)
  - **Edit** products inline
  - **Upload product image** (PNG/JPG/WebP, max 2MB, preview before upload)
  - **Delete** products (also removes image file)
- Chat now renders product images **inline** — when Nova replies with product details, the `[IMG:url]` tag is automatically converted to an `<img>` element in both widget and kiosk
- Catalog product records preserve `imageUrl` through normalization (was previously stripped)

### 3. v34.2 — Modern Kiosk + Voice Cloning UI
- **Single full-screen chat** kiosk interface (no popup widget, no separate background)
- Modern glassmorphism UI with animated aurora gradient, frosted glass header + composer
- Mobile-first responsive design with safe-area-inset support for notch devices, 100dvh layout
- Skips pre-chat form entirely — customers go straight to chat
- Welcome splash with business branding + language selector (English / Urdu / Roman Urdu)
- Mic↔Send↔Stop single action button (WhatsApp-style)
- Voice output toggle in header
- Idle overlay after 5 min inactivity → auto-reset conversation for next customer
- **Voice Cloning Studio** in business dashboard:
  - Record in-browser using MediaRecorder API
  - Or upload audio file (.webm, .mp3, .wav, .m4a, .ogg, up to 5 MB)
  - Configure TTS voice profile (voice name, rate, pitch, volume)
  - Sample plays as "voice tag" before every Nova reply — customers hear YOUR voice
- **Kiosk & QR** tab in business dashboard:
  - Kiosk URL with copy button
  - Auto-generated QR code (PNG + SVG) via goqr.me free API
  - Download QR code buttons
  - Embed instructions for kiosk iframe + standard widget script

### 4. v34.1 — Voice Profile + TTS Improvements
- Per-tenant voice profile (voice name, rate, pitch, volume) stored in `voice-profile.json`
- Improved TTS with sentence-level processing, natural pauses, better voice selection
- Voice profile exposed via `/api/widget/config` so widget applies it without login
- Emoji/markdown stripping for cleaner speech

### 5. v34.0 — Core Engine Bug Fixes
- Routing improvements, language drift prevention, time formatting fixes
- WhatsApp-style mic/send toggle in widget
- Futuristic chat background
- External cron keep-alive (cron-job.org)

---

## Feature Timeline (v9 → v35)

| Version | Highlights |
|---------|------------|
| v9–v12 | Core NLU engine, deterministic conversation pipeline, 22-module NLU, capability adapters |
| v13–v16 | Multi-tenant isolation, tenant template system, file-based JSON storage |
| v17–v20 | Lead scoring, CRM capability, availability checking, conversation replays |
| v21–v24 | Test runner, ML intent classifier, conversation datasets, benchmark suite |
| v25–v27 | Admin dashboard, developer console, public chat page |
| v28–v29 | Website widget SDK (Shadow DOM, embeddable, 10 pre-built avatars, 4 positions, pre-chat form, proactive greetings) |
| v30 | Gmail SMTP email notifications (5 templates), notification log, preferences editor |
| v30.1 | Tenant templates & onboarding wizard (4 pre-built templates + custom) |
| v31 | Google Calendar OAuth 2.0 integration with real availability checking |
| v32 | Business owner dashboard (separate from admin) with JWT auth |
| v33 | Conversation takeover, customer polling, message queue |
| v34.0 | Core engine bug fixes, WhatsApp-style mic/send toggle |
| v34.1 | Voice profile + TTS improvements, kiosk mode, QR codes |
| v34.2 | Modern kiosk redesign, Voice Cloning Studio UI, Kiosk & QR tab |
| **v35.0** | **PWA support (installable + offline queue), Catalog management UI with image upload, inline product images in chat** |

---

## Architecture

```
nova-assistant/
├── apps/
│   ├── api/                       # Node.js HTTP server (all routes)
│   │   └── src/
│   │       ├── server.js          # Main server (~2440 lines, 100+ routes)
│   │       └── container.js       # DI container wiring ~100 services
│   ├── widget/                    # Embeddable website widget + kiosk
│   │   └── public/
│   │       ├── widget.js          # Shadow DOM widget SDK
│   │       ├── kiosk.html         # Modern full-screen kiosk (v34.2)
│   │       ├── kiosk-sw.js        # Service worker (v35.0)
│   │       ├── kiosk-manifest.json # PWA manifest (v35.0)
│   │       ├── avatars.js         # 10 pre-built SVG agent portraits
│   │       ├── widget-config.js
│   │       └── index.html         # Widget test page
│   ├── admin-dashboard/           # Admin dashboard for Nova operators
│   │   └── public/
│   │       ├── app.js             # 1700+ lines (overview, tenants, onboard, conversations, leads, ML, capabilities, datasets, notifications, calendar, catalog, inspector, settings)
│   │       ├── index.html
│   │       ├── style.css
│   │       ├── manifest.json      # PWA manifest for admin
│   │       └── sw.js              # Admin service worker
│   └── business-dashboard/        # Business owner dashboard
│       └── public/
│           ├── app.js             # Login, overview, inbox, bookings, leads, customers, Voice Studio, Kiosk & QR, notifications, settings
│           ├── index.html
│           └── style.css
├── packages/                      # Domain engines (75 packages)
│   ├── execution-engine/          # 16-stage execution pipeline
│   ├── conversation-intelligence/ # 22-module NLU pipeline
│   ├── auth-engine/               # Business owner JWT auth (bcryptjs)
│   ├── calendar-engine/           # Google OAuth + calendar provider
│   ├── notification-engine/       # Email (Gmail SMTP) + notification log
│   ├── catalog-engine/            # Product catalog + image serving
│   ├── catalog-sdk/               # Product record normalization
│   ├── service-availability/      # Business hours + static provider
│   ├── channel/                   # HTTP chat adapter
│   └── ... (60+ more)
├── capabilities/                  # Capability adapters (9)
│   ├── assistant/
│   ├── availability/
│   ├── booking/
│   ├── catalog/                   # Product browsing + image emission (v35.0)
│   ├── cleaning/
│   ├── commerce/
│   ├── crm/
│   ├── offering/
│   └── pricing/
├── tenants/                       # Per-tenant data (JSON files)
│   ├── cleaning-demo/             # SparkleCare Cleaning (main demo)
│   ├── byt-cleaners-dubai/        # Production tenant
│   ├── default/                   # Retail catalog demo
│   ├── salon-demo/
│   ├── restaurant-demo/
│   ├── healthcare-demo/
│   ├── education-demo/
│   ├── tutor-demo/
│   ├── driving-school-demo/
│   └── _templates/                # 4 pre-built templates (cleaning, retail, salon, restaurant, gym)
├── tests/                         # Integration + regression tests
├── scripts/                       # Setup + maintenance scripts
├── docs/                          # Documentation
├── render.yaml                    # Render.com deployment config
├── package.json                   # v35.0.0
└── README.md
```

---

## Tech Stack

- **Runtime:** Node.js 22 (CommonJS)
- **Frontend:** Vanilla JavaScript (no build step, no React/Vue)
- **Storage:** File-based JSON (no Redis/PostgreSQL required for dev)
- **Auth:** bcryptjs + JWT (7-day expiry)
- **Email:** nodemailer + Gmail SMTP
- **Calendar:** Google OAuth 2.0 + Google Calendar API
- **Voice I/O:** Web Speech API (SpeechRecognition + SpeechSynthesis)
- **Voice Recording:** MediaRecorder API
- **PWA:** Service Worker + Web App Manifest
- **QR Codes:** goqr.me API (free, no auth)
- **Deployment:** Render.com (free tier + cron-job.org keep-alive)

---

## API Endpoints (v35.0)

### Public (no auth)
- `POST /api/chat` — main chat endpoint (rate-limited 30/min per IP+tenant)
- `GET /api/widget/config/{tenantId}` — widget configuration (now includes `voiceSampleUrl`)
- `GET /api/voice/sample/{tenantId}` — public voice sample audio (v34.2)
- `GET /api/catalog/images/{tenantId}/{productId}` — public product image
- `GET /api/chat/poll` — customer polling for owner replies during takeover
- `GET /kiosk/{tenantId}` — modern full-screen kiosk chat
- `GET /kiosk-manifest.json` — PWA manifest (v35.0)
- `GET /kiosk-sw.js` — service worker (v35.0)
- `GET /widget.js` — embeddable widget script (cross-origin)
- `GET /avatars.js` — 10 pre-built agent avatars

### Admin (`x-nova-dev-token` required in production)
- `/api/admin/tenants` — list/create/suspend/activate/delete tenants
- `/api/admin/templates` — list/create templates
- `/api/admin/catalog/{tenantId}/products` — list/add products (v35.0)
- `/api/admin/catalog/{tenantId}/products/{id}` — update/delete (v35.0)
- `/api/admin/catalog/{tenantId}/products/{id}/image` — upload image
- `/api/admin/notifications/{tenantId}` — notification log + preferences
- `/api/admin/calendar/auth/{tenantId}` — Google OAuth flow
- `/api/admin/voice-profile/{tenantId}` — get/save voice profile
- `/api/admin/tenants/{id}/qr-code` — QR code generation

### Business Owner (JWT required)
- `/api/business/login` — email + password login
- `/api/business/register` — first owner setup
- `/api/business/overview` — KPIs (conversations, leads, bookings today)
- `/api/business/conversations` — inbox with takeover
- `/api/business/conversation/{customerId}` — full conversation detail
- `/api/business/takeover` — take over from Nova
- `/api/business/release` — release back to Nova
- `/api/business/reply` — owner replies to customer
- `/api/business/voice/upload` — upload voice sample (v34.2)
- `/api/business/voice/sample` — get/delete voice sample (v34.2)
- `/api/business/voice/profile` — update TTS voice profile (v34.2)
- `/api/business/leads` — lead list with scores
- `/api/business/bookings` — service requests + calendar bookings
- `/api/business/customers` — CRM customer list
- `/api/business/notifications` — notification feed

---

## Setup

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure email notifications
cp .env.example .env
# Edit .env with your Gmail SMTP credentials

# 3. (Optional) Configure Google Calendar
# Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env

# 4. Start the server
npm start
# Server runs on http://localhost:3000

# 5. Open dashboards
# Admin:      http://localhost:3000/admin
# Business:   http://localhost:3000/business
# Kiosk:      http://localhost:3000/kiosk/cleaning-demo
# Widget test: http://localhost:3000/widget-test
```

### Production (Render.com)
```bash
# 1. Push to GitHub
# 2. Create new Web Service on Render, connect repo
# 3. Build Command: npm install
# 4. Start Command: npm start
# 5. Add environment variables:
#    - NODE_ENV=production
#    - NOVA_DEV_TOKEN=<your-strong-secret>
#    - NOVA_SMTP_HOST, NOVA_SMTP_USER, NOVA_SMTP_PASS (for email)
#    - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (for calendar)
# 6. Set up external cron at cron-job.org to ping https://your-app.onrender.com/health every 10 min
#    (prevents Render free tier from sleeping)
```

---

## Tenant Templates

4 pre-built templates for instant onboarding:

| Template | Use Case | Capabilities |
|----------|----------|--------------|
| `cleaning-template` | Cleaning companies | cleaning, pricing, availability, booking, crm |
| `retail-template` | Retail stores | catalog, commerce, pricing, crm |
| `salon-template` | Salons & spas | offering, booking, pricing, availability, crm |
| `restaurant-template` | Restaurants | offering, booking, availability, crm |

Custom templates can be created from scratch via the admin dashboard for totally new business types (gym, vet clinic, real estate, etc.).

---

## Voice Cloning Flow

1. Business owner logs in to `/business`
2. Opens **Voice Studio** tab
3. Records in-browser (MediaRecorder API) OR uploads audio file
4. Sample saved to `tenants/{tenantId}/voice-samples/sample.{ext}`
5. Widget config endpoint exposes `voiceSampleUrl` publicly
6. Kiosk/widget preload the audio on startup
7. On every Nova reply, the sample plays as a "voice tag" → customers hear the owner's voice
8. TTS continues with the actual reply text using the configured voice profile

---

## Kiosk PWA Flow

1. Customer opens `/kiosk/{tenantId}` on tablet/phone
2. Sees splash screen with business name + "Start Conversation" button
3. (Optional) Taps "Install App" → app icon added to home screen
4. Once installed, launches standalone (no browser chrome)
5. Tap "Start Conversation" → goes straight to chat (no name/phone form)
6. Idle for 5 min → auto-resets for next customer
7. If network drops mid-chat → message queued in service worker
8. On reconnect → queued message auto-flushed and delivered

---

## Catalog Image Flow

1. Admin opens **Catalog** tab in `/admin`
2. Selects tenant, clicks "+ Add Product" or edits existing
3. Fills product details (name, SKU, price, sizes, colors, tags, inventory)
4. Uploads product image (PNG/JPG/WebP, max 2MB)
5. Image saved to `tenants/{tenantId}/catalog/images/{productId}.{ext}`
6. Product record updated with `imageUrl` field
7. When customer asks about the product in chat:
   - Nova replies with product details
   - Reply contains `[IMG:/api/catalog/images/{tenantId}/{productId}.png]` tag
   - Widget/kiosk detects the tag → renders inline `<img>` element
8. Image is publicly accessible (no auth needed for kiosk/widget)

---

## Security

- Shadow DOM widget isolation (prevents host page CSS bleed)
- XSS-safe textContent rendering (never innerHTML for user content)
- CORS preflight + Access-Control-Allow-Origin echo per request
- Rate limiting: 30 msgs/min per IP+tenant
- Tenant verification on every endpoint
- CustomerId validation: alphanumeric + dash/underscore only, max 128 chars
- Message length cap: 4,000 chars
- Business owner JWT auth (bcryptjs hashing, 7-day expiry)
- Admin dev token (required in production, optional in dev)
- Voice sample upload: 5MB cap, mime type whitelist
- Product image upload: 2MB cap, mime type whitelist

---

## Tests

```bash
# Run full test suite
npm test

# Run specific regression tests
node --test tests/sprint97.v220-persistence.integration.test.js
node --test tests/sprint5.catalog.integration.test.js

# Run conversation datasets
npm run test:conversations

# Audit state safety
npm run check
```

---

## Documentation

- `README.md` — comprehensive setup and usage guide
- `ARCHITECTURAL_RECOMMENDATIONS.md` — architecture deep-dive
- `MANIFEST.md` — feature manifest
- `docs/` — 60+ documentation files including:
  - WIDGET_EMBED_GUIDE.md
  - WIDGET_SECURITY.md
  - VOICE_CLONING_GUIDE.md (v34.2)
  - KIOSK_DEPLOYMENT_GUIDE.md (v34.2)
  - CATALOG_MANAGEMENT_GUIDE.md (v35.0)
  - PWA_SETUP_GUIDE.md (v35.0)

---

## Version

**v35.0.0** — PWA Support + Product Catalog Management UI

Released: 2026-10-23

---

## License

Proprietary. All rights reserved.
