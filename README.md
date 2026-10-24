# Nova Assistant — v35.2

**Multi-tenant SaaS conversation engine** for service businesses. Deterministic NLU pipeline, capability adapters, embeddable widget, voice cloning, PWA kiosk, and admin/business owner dashboards.

---

## 🐛 What's Fixed in v35.2

### Conversation Engine Bugs (HIGH priority)
- **"I'll take 2 of those" after viewing an offering** now correctly starts an order with quantity — previously fell through to the assistant and returned irrelevant knowledge answers
- **"Yes, confirm" / "confirm order" after a ready order** now confirms — previously only matched bare "confirm"/"yes"/"done" keywords
- **"Tomorrow at 3pm" after viewing a salon service** now starts a booking workflow — previously returned location/address info
- **"book a cleaning for tomorrow"** now asks which type of cleaning (Home, Deep, Sofa, Carpet, Office) — previously dumped a 30-line service list

### Frontend Bugs
- **Widget `data-kiosk` attribute**: when set to `true`, the widget skips the pre-chat form AND sends `channel: 'kiosk'` to the chat API. Useful for embedding in kiosk contexts where customers shouldn't type a name/phone
- **Admin Catalog tab smart empty state**: service-based tenants (cleaning, salon, restaurant) show "This is a service-based business" instead of "No products yet" — points owners to the right dashboard
- **Business dashboard mobile responsive (≤480px)**: tighter padding, stacked header actions, full-screen modals, smaller KPI cards, no horizontal scroll

---

## 🚀 What's New in v35.1

### Kiosk UX Fixes
- **Real agent avatar picture** in splash + header (was mic icon before). Loads from `/avatars.js` with 10 pre-built SVG portraits — Natalie for restaurants, David for cleaning, etc.
- **Agent speaks "Welcome to {businessName}"** when customer taps Start Conversation. Voice auto-enables on first chat (mobile-friendly user gesture)
- **Stop TTS when customer taps mic** — `speechSynthesis.cancel()` runs immediately before mic starts, so no overlapping audio

---

## 📦 What's New in v35.0

### PWA Support — Kiosk is installable as a native app
- PWA manifest + service worker
- "Install App" button on splash (uses `beforeinstallprompt`)
- Offline message queue: messages auto-delivered on reconnect
- Auto-retry with exponential backoff (1s, 2s) on network errors

### Product Catalog Management UI
- New Catalog tab in admin dashboard
- Operators can: list, add, edit, delete products; upload product image
- Chat renders product images **inline** — `[IMG:url]` tag becomes `<img>` element

---

## 🎙️ What's New in v34.2

### Modern Kiosk Interface
- Single full-screen chat (no popup widget, no separate background)
- Glassmorphism UI with animated aurora gradient, frosted glass header + composer
- Mobile-first, safe-area-inset for notch devices, 100dvh layout
- Skips pre-chat form — customers go straight to chat
- Idle auto-reset after 5 min
- Multi-language: English, Urdu, Roman Urdu

### Voice Cloning Studio
- Business owners record in-browser (MediaRecorder API) OR upload audio file
- Sample plays as "voice tag" before every Nova reply — customers hear YOUR voice

### Kiosk & QR Tab
- Kiosk URL with copy button
- Auto-generated QR code (PNG + SVG) via goqr.me free API

---

## 🌐 Live Demo (Production)

| Page | URL |
|------|-----|
| Kiosk (cleaning) | https://nova-saas-test.onrender.com/kiosk/cleaning-demo |
| Kiosk (restaurant) | https://nova-saas-test.onrender.com/kiosk/restaurant-demo |
| Kiosk (salon) | https://nova-saas-test.onrender.com/kiosk/salon-demo |
| Widget test page | https://nova-saas-test.onrender.com/widget-test |
| Admin dashboard | https://nova-saas-test.onrender.com/admin |
| Business dashboard | https://nova-saas-test.onrender.com/business |

> **Note:** The live Render deployment reflects what's pushed to GitHub main. If you don't see the v35.2 fixes there, push the latest code from this zip to your repo.

---

## 🏗️ Quick Start (Local Dev)

```bash
# 1. Extract the zip
unzip nova-v35.2.zip
cd nova-assistant

# 2. Install dependencies
npm install

# 3. (Optional) Configure email + calendar
cp .env.example .env
# Edit .env with your Gmail SMTP + Google OAuth creds

# 4. Start the server
npm start

# 5. Open in browser
# Admin:       http://localhost:3000/admin
# Business:    http://localhost:3000/business
# Kiosk:       http://localhost:3000/kiosk/cleaning-demo
# Widget test: http://localhost:3000/widget-test
```

The server boots in ~5 seconds. No Redis/PostgreSQL required — file-based JSON storage for dev.

---

## 🏢 Available Tenants (Demo Businesses)

| Tenant ID | Business | Domain | Agent |
|-----------|----------|--------|-------|
| `cleaning-demo` | SparkleCare Cleaning | cleaning | David (Booking Agent) |
| `byt-cleaners-dubai` | BYT Cleaners Dubai | cleaning | David |
| `default` | Nova Retail Store | retail | Marcus (Store Assistant) |
| `salon-demo` | Nova Salon | salon | Sophie (Booking Agent) |
| `restaurant-demo` | Nova Bistro | restaurant | Natalie (Reservation Desk) |
| `healthcare-demo` | Nova Health | healthcare | Aria (Customer Success) |
| `education-demo` | Nova Academy | education | Emma (Consultant) |
| `tutor-demo` | Nova Tutors | education | Olivia (Support) |
| `driving-school-demo` | Nova Driving School | driving-school | Liam (Assistant) |

---

## 📋 Tenant Templates (Instant Onboarding)

| Template | Use Case | Capabilities |
|----------|----------|--------------|
| `cleaning-template` | Cleaning companies | cleaning, pricing, availability, booking, crm |
| `retail-template` | Retail stores | catalog, commerce, pricing, crm |
| `salon-template` | Salons & spas | offering, booking, pricing, availability, crm |
| `restaurant-template` | Restaurants | offering, booking, availability, crm |
| `gym-template` | Gyms / fitness | offering, booking, crm (custom-built) |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (CommonJS) |
| Frontend | Vanilla JavaScript (no build step, no React/Vue) |
| Storage | File-based JSON (no Redis/PostgreSQL for dev) |
| Auth | bcryptjs + JWT (7-day expiry) |
| Email | nodemailer + Gmail SMTP |
| Calendar | Google OAuth 2.0 + Google Calendar API |
| Voice Input | Web Speech API (SpeechRecognition) |
| Voice Output | Web Speech API (SpeechSynthesis) + voice sample playback |
| Voice Recording | MediaRecorder API |
| PWA | Service Worker + Web App Manifest |
| QR Codes | goqr.me API (free, no auth) |
| Deployment | Render.com (free tier + cron-job.org keep-alive) |

---

## 🔌 API Endpoints

### Public (no auth)
- `POST /api/chat` — main chat endpoint (rate-limited 30/min per IP+tenant)
- `GET /api/widget/config/{tenantId}` — widget config (includes `voiceSampleUrl`)
- `GET /api/voice/sample/{tenantId}` — public voice sample audio
- `GET /api/catalog/images/{tenantId}/{productId}` — public product image
- `GET /api/chat/poll` — customer polling for owner replies during takeover
- `GET /kiosk/{tenantId}` — modern full-screen kiosk chat
- `GET /kiosk-manifest.json` — PWA manifest
- `GET /kiosk-sw.js` — service worker
- `GET /widget.js` — embeddable widget script (cross-origin)
- `GET /avatars.js` — 10 pre-built agent avatars

### Admin (`x-nova-dev-token` required in production)
- `/api/admin/tenants` — list/create/suspend/activate/delete tenants
- `/api/admin/templates` — list/create templates
- `/api/admin/catalog/{tenantId}/products` — list/add products
- `/api/admin/catalog/{tenantId}/products/{id}` — update/delete
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
- `/api/business/voice/upload` — upload voice sample
- `/api/business/voice/sample` — get/delete voice sample
- `/api/business/voice/profile` — update TTS voice profile
- `/api/business/leads` — lead list with scores
- `/api/business/bookings` — service requests + calendar bookings
- `/api/business/customers` — CRM customer list
- `/api/business/notifications` — notification feed

---

## 🎙️ Voice Cloning Flow

1. Business owner logs in to `/business`
2. Opens **Voice Studio** tab
3. Records in-browser (MediaRecorder API) OR uploads audio file
4. Sample saved to `tenants/{tenantId}/voice-samples/sample.{ext}`
5. Widget config endpoint exposes `voiceSampleUrl` publicly
6. Kiosk/widget preload the audio on startup
7. On every Nova reply, the sample plays as a "voice tag" → customers hear the owner's voice
8. TTS continues with the actual reply text using the configured voice profile

---

## 📱 Kiosk PWA Flow

1. Customer opens `/kiosk/{tenantId}` on tablet/phone
2. Sees splash screen with business name + agent avatar portrait
3. (Optional) Taps "Install App" → app icon added to home screen
4. Tap "Start Conversation" → agent speaks "Welcome to {businessName}. I'm {agentName}..."
5. Goes straight to chat (no name/phone form)
6. Tap mic → Nova stops speaking immediately → customer can talk
7. Idle for 5 min → auto-resets for next customer
8. If network drops mid-chat → message queued in service worker
9. On reconnect → queued message auto-flushed and delivered

---

## 🖼️ Catalog Image Flow

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

## 🔒 Security Controls

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

## 🧪 Tests

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

## ☁️ Production Deployment (Render.com)

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
# 6. Set up external cron at cron-job.org to ping https://your-app.onrender.com/health
#    every 10 min (prevents Render free tier from sleeping)
```

---

## 📊 Feature Timeline (v9 → v35.2)

| Version | Highlights |
|---------|------------|
| v9–v12 | Core NLU engine, deterministic conversation pipeline, 22-module NLU, capability adapters |
| v13–v16 | Multi-tenant isolation, tenant template system, file-based JSON storage |
| v17–v20 | Lead scoring, CRM capability, availability checking, conversation replays |
| v21–v24 | Test runner, ML intent classifier, conversation datasets, benchmark suite |
| v25–v27 | Admin dashboard, developer console, public chat page |
| v28–v29 | Website widget SDK (Shadow DOM, 10 avatars, 4 positions, pre-chat form, proactive greetings) |
| v30 | Gmail SMTP email notifications (5 templates), notification log, preferences editor |
| v30.1 | Tenant templates & onboarding wizard (4 pre-built + custom) |
| v31 | Google Calendar OAuth 2.0 integration with real availability checking |
| v32 | Business owner dashboard (separate from admin) with JWT auth |
| v33 | Conversation takeover, customer polling, message queue |
| v34.0 | Core engine bug fixes, WhatsApp-style mic/send toggle |
| v34.1 | Voice profile + TTS improvements, kiosk mode, QR codes |
| v34.2 | Modern kiosk redesign, Voice Cloning Studio UI, Kiosk & QR tab |
| v35.0 | PWA support (installable + offline queue), Catalog management UI with image upload, inline product images in chat |
| v35.1 | Kiosk UX fixes: real agent avatar picture, spoken "Welcome to {business}", stop TTS on mic tap |
| **v35.2** | **Bug fixes: offering order quantity recognition, order confirmation broadening, offering→booking transition, cleaning booking type clarification, widget data-kiosk mode, mobile responsive dashboards** |

---

## 📝 Version

**v35.2.0** — Engine + frontend bug fixes (offering order quantity, confirmation broadening, booking transition, cleaning type clarification, mobile responsive)

Released: 2026-10-24

---

## 📄 License

Proprietary. All rights reserved.

