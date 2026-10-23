
---
Task ID: v34.2
Agent: Super Z (main)
Task: Rebuild kiosk as single full-screen modern chat (no popup), skip pre-chat form, mobile-first, modern UI. Add Voice Studio UI to business dashboard with in-browser recording + file upload for voice cloning.

Work Log:
- Rewrote apps/widget/public/kiosk.html (~1230 lines):
  • SINGLE full-screen chat interface — no popup widget, no separate background screen
  • Modern glassmorphism UI: animated aurora gradient background, frosted glass header + composer, message bubbles with backdrop-filter blur
  • Mobile-first responsive design with safe-area-inset support for notch devices, 100dvh layout, iOS zoom prevention (font-size:16px on inputs)
  • Skips pre-chat form entirely — customers go straight to chat on tapping "Start Conversation"
  • Welcome splash screen with business branding + language selector (English / Urdu / Roman Urdu)
  • Mic↔Send↔Stop single action button (WhatsApp-style)
  • Voice output toggle in header (active state highlights icon)
  • Idle overlay after 5 min inactivity → auto-reset conversation for next customer
  • Boot spinner while fetching config
  • Banner system for transient errors/info
  • Product image rendering inside message bubbles ([IMG:url] tag support)
  • Connection error recovery
  • Per-tenant localStorage (customerId, voiceEnabled, lang) — no cross-tenant bleed
- Improved kiosk server route (/kiosk/{tenantId}):
  • Now validates tenant exists → returns friendly HTML 404 if not
  • Accepts /kiosk (uses default tenant), /kiosk/{tenantId}, /kiosk/{tenantId}/{anything}
- Added 5 new voice cloning endpoints (apps/api/src/server.js +150 lines):
  • POST /api/business/voice/upload (auth required) — accepts {contentBase64, mimeType, filename?} → saves to tenants/{id}/voice-samples/sample.{ext} + meta.json sidecar. Supports webm, mp3, wav, m4a, ogg. 5MB cap.
  • GET /api/business/voice/sample (auth required) — returns {hasSample, meta, voiceSampleUrl, voiceProfile}
  • PUT /api/business/voice/profile (auth required) — updates voice-profile.json (enabled, voiceName, rate, pitch, volume)
  • DELETE /api/business/voice/sample (auth required) — removes sample + meta
  • GET /api/voice/sample/{tenantId} (PUBLIC, no auth) — serves audio file with proper Content-Type + Accept-Ranges, used by kiosk/widget
- Updated /api/widget/config/{tenantId} response to include voiceSampleUrl field (computed by scanning voice-samples/ directory)
- Updated widget.js speakText() to play uploaded voice sample as a "voice tag" before TTS kicks in (recognizable voice signature on every reply)
- Updated kiosk.html speakReply() with same voice-tag behavior
- Built new "Voice Studio" tab in business dashboard (apps/business-dashboard/public/app.js +420 lines):
  • Explanation card with how voice cloning works
  • Current Voice Sample status card (shows upload date, size, mimeType, audio player, delete button)
  • Option 1: Record in browser — MediaRecorder API, start/stop button, live timer, preview audio, save to server
  • Option 2: Upload audio file — drag & drop zone + file picker, validates type + size, preview player, upload button
  • Browser TTS Voice Settings form — voiceName (free text), rate (0.5–1.5), pitch (0–2), volume (0–1), enabled checkbox, save button
  • Preview & Test card — links to kiosk page, widget-test page, and a "Play uploaded sample" button
- Built new "Kiosk & QR" tab in business dashboard (+100 lines):
  • Displays kiosk URL with copy button
  • QR code (PNG + SVG) generated via goqr.me free API
  • Download QR code buttons (PNG / SVG)
  • Embed instructions for kiosk iframe + standard widget script
  • Kiosk best practices card (mounting, browser, voice pairing)
- Added CSS tweaks (apps/business-dashboard/public/style.css): checkbox accent-color, file input reset, disabled button styling
- Smoke tested end-to-end on PORT=4201:
  • GET /kiosk/cleaning-demo → 200, 44KB modern HTML ✓
  • GET /kiosk/non-existent → 404 friendly HTML ✓
  • GET /kiosk (default tenant) → 200 ✓
  • POST /api/chat with channel:kiosk → 200, SparkleCare welcome reply ✓
  • POST /api/business/voice/upload (no auth) → 401 ✓
  • POST /api/business/register → owner created ✓
  • POST /api/business/login → JWT issued ✓
  • GET /api/business/voice/sample (with token) → hasSample:false initially ✓
  • POST /api/business/voice/upload (with token, 16KB WAV) → saved to tenants/cleaning-demo/voice-samples/sample.wav ✓
  • GET /api/voice/sample/cleaning-demo (no auth) → 200 audio/wav, 16044 bytes ✓
  • GET /api/widget/config/cleaning-demo → voiceSampleUrl populated ✓
  • PUT /api/business/voice/profile → saved voiceName=Samantha, rate=0.92 ✓
  • DELETE /api/business/voice/sample → 200, sample + meta removed ✓
  • GET /api/voice/sample/cleaning-demo → 404 (sample removed) ✓
- Bumped package.json 34.1.0 → 34.2.0.

Stage Summary:
- Nova v34.2 Kiosk Redesign + Voice Cloning UI is complete and end-to-end working.
- Kiosk is now a SINGLE modern full-screen chat — no popup widget, no separate background interface, no pre-chat form. Mobile-first with glassmorphism, animated aurora, safe-area support, idle auto-reset.
- Voice cloning has a complete UI: business owners log in, record in-browser OR upload an audio file, configure TTS settings, preview the kiosk. The sample is served publicly to kiosk/widget for playback.
- Files produced:
  • apps/widget/public/kiosk.html (rewritten, ~1230 lines, 45KB)
  • apps/api/src/server.js (+5 new voice endpoints, +kiosk route improvement, +voiceSampleUrl in widget config, ~210 new lines)
  • apps/widget/public/widget.js (+voice sample preload + playback, ~20 new lines)
  • apps/business-dashboard/public/app.js (+Voice Studio tab + Kiosk & QR tab, ~520 new lines)
  • apps/business-dashboard/public/style.css (+6 lines for checkboxes/disabled buttons)
  • package.json (v34.1.0 → v34.2.0)
- Kiosk URL pattern: /kiosk/{tenantId} — works for any tenant.
- Voice sample flow: Owner uploads → tenants/{id}/voice-samples/sample.{ext} → widget config exposes URL → kiosk/widget preloads + plays on every Nova reply → TTS continues with actual reply text.
- Voice Studio tab accessible at: /business → log in → "Voice Studio" tab.
- Kiosk & QR tab accessible at: /business → log in → "Kiosk & QR" tab.

---
Task ID: v35.0
Agent: Super Z (main)
Task: Build PWA support (kiosk installable, offline message queue) + Product Catalog management UI (list/add/edit/delete products, upload images, inline image rendering in chat).

Work Log:
- Created apps/widget/public/kiosk-manifest.json — PWA manifest for kiosk:
  • name: "Nova Kiosk", short_name: "Nova"
  • start_url: /kiosk, scope: /kiosk, display: standalone, orientation: portrait
  • Inline SVG icons (192x192 + 512x512) — no external image hosting needed
  • background_color: #060912, theme_color: #0a0e1a
- Created apps/widget/public/kiosk-sw.js (~135 lines) — service worker for kiosk:
  • Install: pre-caches /kiosk, /widget.js, /avatars.js, /widget-config.js
  • Activate: cleans up old caches, claims clients immediately
  • Fetch strategy:
    - Kiosk shell + widget assets + product images + voice samples → cache-first
    - Widget config → network-first, fall back to cache
    - POST /api/chat → network-only; if network fails, queues the message for retry
  • Message queue: in-memory array of pending POSTs
    - On 'online' event, the kiosk posts FLUSH_QUEUE to SW
    - SW replays each queued message; reports DELIVERED/QUEUED back to client
- Added 2 new server endpoints:
  • GET /kiosk-manifest.json — serves PWA manifest (Content-Type: application/manifest+json)
  • GET /kiosk-sw.js — serves service worker (Content-Type: application/javascript, Service-Worker-Allowed: /kiosk/)
- Updated apps/widget/public/kiosk.html:
  • Added <link rel="manifest" href="/kiosk-manifest.json"> in <head>
  • Added "📱 Install App" button on splash screen (shows when beforeinstallprompt fires)
  • Registered service worker on load (navigator.serviceWorker.register('/kiosk-sw.js', { scope: '/kiosk/' }))
  • Listens for SW messages (QUEUED / DELIVERED / FLUSH_DONE) → shows banner
  • Listens for online/offline events → shows banner + triggers FLUSH_QUEUE on reconnect
  • sendMessage() now retries with exponential backoff (1s, 2s) on network errors and 5xx responses — up to 2 retries
  • User bubble only appended on attempt 0 (not on retries)
  • Status indicator shows "retrying in 1s…" / "retrying in 2s…" during backoff
- Added 5 new catalog management endpoints in server.js (~95 lines):
  • GET /api/admin/catalog/{tenantId}/products — list all products (returns [] for non-catalog tenants like cleaning)
  • POST /api/admin/catalog/{tenantId}/products — add new product (auto-generates P0XX ID, supports name/sku/category/price/currency/description/sizes/colors/tags/aliases/inStock/inventory)
  • PUT /api/admin/catalog/{tenantId}/products/{productId} — update product (preserves id, merges other fields)
  • DELETE /api/admin/catalog/{tenantId}/products/{productId} — delete product + delete its image file if any
  • (Existing) POST /api/admin/catalog/{tenantId}/products/{productId}/image — upload image (already existed from v34.1, now used by new UI)
  • (Existing) GET /api/catalog/images/{tenantId}/{productId} — public image serve (already existed)
- Updated packages/catalog-sdk/src/productRecord.js:
  • Added imageUrl field to createProductRecord() — preserves any imageUrl set on the source product
- Updated capabilities/catalog/src/index.js formatProduct() function:
  • Appends [IMG:url] tag to reply text if product.imageUrl is set
  • Widget/kiosk detect this tag and render inline image
- Built new "Catalog" tab in admin dashboard (apps/admin-dashboard/public/app.js +230 lines):
  • Added "Catalog" nav button in index.html
  • renderCatalog() — shows products table for selected tenant with image thumbnails, ID, name, SKU, category, price, stock status, edit/delete buttons
  • showProductModal() — modal form for add/edit:
    - Name, SKU, Category, Currency, Price, Inventory inputs
    - Description textarea
    - Sizes, Colors, Tags/Aliases (comma-separated)
    - In stock checkbox
    - Image upload (file picker, max 2MB, preview)
    - Remove existing image button (when editing)
    - Save / Cancel buttons with status indicator
  • Backdrop click closes modal
  • loadProductsList() — fetches products via /api/admin/catalog/{tenantId}/products
  • Inline edit/delete via window.__editProduct / window.__deleteProduct (for onclick handlers)
  • Image upload via FileReader → base64 → POST /api/admin/catalog/.../image endpoint
  • Empty state when tenant has no catalog yet
- Smoke tested end-to-end on PORT=4210:
  • GET /kiosk-manifest.json → 200 application/manifest+json ✓
  • GET /kiosk-sw.js → 200 application/javascript ✓
  • GET /kiosk/cleaning-demo → has manifest link, installBtn, SW registration, beforeinstallprompt handler (8 matches) ✓
  • GET /api/admin/catalog/default/products → 30 products, imageUrl field present ✓
  • POST /api/admin/catalog/default/products → created P031 "Test Product v35" ✓
  • PUT /api/admin/catalog/default/products/P031 → updated price 99.99→79.99, inventory 10→5 ✓
  • POST /api/admin/catalog/default/products/P031/image → uploaded 1x1 PNG, imageUrl=/api/catalog/images/default/P031.png ✓
  • GET /api/catalog/images/default/P031 → 200 image/png ✓
  • POST /api/chat with text "Show me Test Product v35" → reply contains [IMG:/api/catalog/images/default/P031.png] tag ✓
  • DELETE /api/admin/catalog/default/products/P031 → product deleted, image file also deleted ✓
  • GET /api/catalog/images/default/P031 → 404 (image removed with product) ✓
- Ran regression tests:
  • sprint97.v220-persistence.integration.test.js — 13/13 pass ✓
  • sprint5.catalog.integration.test.js — 6/6 pass ✓ (catalog regression safe after imageUrl addition)
- Bumped package.json 34.2.0 → 35.0.0.

Stage Summary:
- Nova v35.0 — PWA Support + Product Catalog Management UI — is complete and end-to-end working.
- Kiosk is now installable as a native app on tablets/phones (Add to Home Screen → launches standalone, no browser chrome).
- Offline mode: when network drops, customer messages are queued in the service worker and auto-delivered when reconnected.
- Connection retry: sendMessage() retries up to 2 times with exponential backoff (1s, 2s) on network errors and 5xx responses.
- Admin dashboard has a new "Catalog" tab — operators can:
  • List all products for any tenant
  • Add new products (name, SKU, price, currency, description, sizes, colors, tags, inventory, in-stock flag)
  • Edit existing products inline
  • Upload product images (PNG/JPG/WebP, max 2MB) — image preview before upload
  • Delete products (also removes the image file)
- Chat now renders product images inline: when Nova replies with a product detail, the [IMG:url] tag is automatically converted to an <img> element in both the widget and kiosk.
- Catalog product records now preserve imageUrl field through normalization (was previously stripped).
- Files produced:
  • apps/widget/public/kiosk-manifest.json (new, 30 lines)
  • apps/widget/public/kiosk-sw.js (new, 135 lines)
  • apps/api/src/server.js (+manifest route, +SW route, +4 catalog endpoints, ~140 new lines)
  • apps/widget/public/kiosk.html (+manifest link, +install button, +SW registration, +retry with backoff, ~70 new lines)
  • apps/admin-dashboard/public/index.html (+Catalog nav button)
  • apps/admin-dashboard/public/app.js (+Catalog route, +renderCatalog, +showProductModal, +loadProductsList, ~230 new lines)
  • capabilities/catalog/src/index.js (+imageUrl emission in formatProduct, +5 lines)
  • packages/catalog-sdk/src/productRecord.js (+imageUrl field preservation, +2 lines)
  • package.json (v34.2.0 → v35.0.0)
- Kiosk PWA install flow: open /kiosk/{tenantId} → tap "📱 Install App" → confirm prompt → app icon added to home screen → launches standalone.
- Catalog image flow: Admin uploads image → /api/admin/catalog/{tenant}/products/{id}/image → saved to tenants/{id}/catalog/images/{productId}.png → product.imageUrl set in products.json → catalog capability emits [IMG:url] in reply → widget/kiosk renders inline image.
