# Nova Assistant — v72.2

**Multi-tenant SaaS conversation engine** for service businesses. Handles orders, bookings, hotel room reservations, and customer interactions across restaurants, hotels, salons, cleaning services, retail, healthcare, education, and driving schools.

---

## 🚀 What's New (v40.0 → v72.2)

### v72.2 — Owner account management (password recovery, email change, team management)

Business owners could sign up and log in, but if they forgot their password or
email there was **no recovery path** — and the "additional owners" feature the
dashboard mentioned didn't exist. This sprint closes those gaps with a full
self-serve + admin-driven account-management layer.

**Self-serve password recovery (forgot password)**
- `POST /api/business/forgot-password` (public, rate-limited, anti-enumeration)
  issues a single-use, 30-minute reset token and emails a reset link. In dev
  (no SMTP) the link is returned directly for testing.
- `POST /api/business/reset-password` (public, rate-limited) consumes the token
  and sets a new password.
- Login page gains a "Forgot password?" link + form; a reset link lands on a
  dedicated reset-password page (`/business/reset-password?token=…`).
- **Security:** only a SHA-256 *hash* of the token is stored in `owners.json`
  (never the plaintext), so a leak of the file doesn't grant reset capability.
  Token comparison is constant-time. The route fires the email
  send asynchronously so response latency is identical for known vs unknown
  emails (closes the account-enumeration timing leak).

**Self-serve account settings**
- `PUT /api/business/password` — change your own password (requires current
  password re-auth). Re-issues the JWT so a leaked old token is invalidated.
- `PUT /api/business/email` — change your own email (requires current password
  re-auth, since email is the recovery channel). Re-issues the JWT carrying the
  new email so `/api/business/me` shows it immediately.
- The Settings page gains "Change password" and "Change email" forms.

**Team / co-owner management (self-serve)**
- `GET /api/business/owners` — list the owners on your tenant.
- `POST /api/business/owners` — invite a co-owner (set their temp password).
- `DELETE /api/business/owners/:ownerId` — remove a co-owner. The last owner
  can never be removed (lockout protection).
- A new "Team" nav item in the business dashboard lists co-owners + an
  add-member form.

**Admin operator controls**
- The admin panel's tenant list gains a "👥 Owners" button on each card that
  opens a per-tenant owner-management modal: list owners, add an owner, reset a
  password, change an owner's email, remove an owner.
- `POST /api/admin/owners/:tenantId` (add), `PUT /api/admin/owners/:tenantId/:ownerId/email`
  (update email), `DELETE /api/admin/owners/:tenantId/:ownerId` (remove) — all
  behind the existing dev-token gate.

**Security hardening (post-review)**
- Reset tokens are hashed at rest (SHA-256), compared with `timingSafeEqual`.
- Owner roles are validated against an allow-list (`owner`, `admin`) — an admin
  can't mint an arbitrary `superadmin` role that a future route might trust.
- Password + email changes re-issue the JWT so the client's stored token stays
  current (no stale-email display after a change).
- The reset-password route is rate-limited per IP (bounds brute-force probing).
- Error messages are sanitized — raw filesystem errors never reach the client.
- Admin reset invalidates any pending self-serve token (no token-reuse window).

**Tests:** `tests/sprintP4-4.owner-account-management.regression.test.js` — 28
cases covering token issue/consume/expiry/single-use/cross-tenant, anti-
enumeration, re-auth on change, email uniqueness, role validation, token
hashing, JWT re-issue, last-owner protection, and admin flows. All pass. Full
sweep: 124/124 Phase-4 tests + 273/273 sanity.

---

### v72.0 — Production-Readiness: Billing + Self-Serve (Phase 4)

Phase 4 turns Nova from "works for a hand-onboarded pilot" into a pitchable,
self-serve SaaS. Each sprint closes one GTM gap; the engine itself is stable
(Phases 1–6 + the P2/P3 hardening sprints are complete).

**Sprint P4-1 — Billing + Stripe + Subscription Enforcement**

- `packages/billing/` — a new package with four modules: a plan catalog
  (`starter` $29 / `growth` $79 / `scale` $199, with per-tier message quotas and
  feature flags), a file-backed `FileSubscriptionRepository` (writes
  `tenants/<id>/subscription.json`, kept separate from `profile.json`), a
  `StripeClient` that runs in **mock mode** when no key is set (so the full
  flow is testable without credentials) and real mode when `STRIPE_SECRET_KEY`
  is configured, and a `PlanService` that is the enforcement brain.
- The `PlanService` evaluates every tenant against their subscription state
  (`trialing` → `active` → `past_due` → `canceled`) plus a 7-day grace period
  for past-due and a per-plan message quota. Blocked tenants get a brand-safe
  "we'll be back shortly" reply instead of normal processing, with
  `capabilityId: "billing_blocked"` for observability.
- Stripe webhook events (`checkout.session.completed`, `invoice.paid`,
  `customer.subscription.updated`, `customer.subscription.deleted`) map to
  subscription state transitions and quota resets.
- **Backward compatibility:** tenants without a `subscription.json` (the
  existing pilots like byt-cleaners-dubai and the demos) are allowed through
  unchanged — the billing rollout does not break any running tenant.
- API: `POST /api/billing/webhook`, `GET /api/business/billing/status`,
  `POST /api/business/billing/checkout`, `POST /api/business/billing/portal`.
- Config: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MOCK_MODE`
  (`auto` by default — mocks when no key, real when key is set).
- Tests: `tests/sprintP4-1.billing-subscription-enforcement.regression.test.js`
  — 36 cases covering every state, every webhook event, engine enforcement,
  the message counter, and the status snapshot.

**Sprint P4-2 — Self-Serve Onboarding**

- `packages/self-serve-onboarding/` — lets a business sign up alone from a
  landing page. The `SelfServeSignupService` composes the three existing
  services — `UniversalTenantOnboardingService` (provisions the tenant tree),
  `PlanService.provisionTrial` (starts a 14-day trial so the engine lets them
  through immediately), and `BusinessOwnerAuthService.createOwner` +
  `loginWithPassword` (creates the first owner and returns a JWT so they land
  straight in the dashboard).
- `industryTemplates.js` — four vertical templates (restaurant, cleaning,
  salon, retail) seed the new tenant with sensible default offerings, hours,
  FAQs, and booking config so the assistant is useful immediately, before the
  owner customizes it.
- `OnboardingWizardService` — post-signup incremental edits (profile, hours,
  FAQs, completion flag) WITHOUT re-running full onboarding, so the dashboard
  can drive setup. Profile edits mirror into `knowledge/business.json` so the
  assistant cites the updated facts.
- API: `POST /api/public/signup` (rate-limited, returns tenantId + JWT + trial
  + nextSteps), `GET /api/public/signup/templates`, and the authed wizard
  routes `GET /api/business/onboarding`, `POST /api/business/onboarding/profile`,
  `/faqs`, `/hours`, `/complete`.
- Tests: `tests/sprintP4-2.self-serve-onboarding.regression.test.js` — 27
  cases covering templates, the happy path, validation (missing fields, unknown
  industry, duplicate name, short password), immediate usability, file
  persistence, every wizard method, and a vertical smoke test for all four
  industries.

**Sprint P4-3 — Google Calendar + Microsoft Graph Adapters**

Closes V90 roadmap item 5 (🟡 → ✅): "Google Calendar/Microsoft Graph adapters
remain next." The Google Calendar provider already existed with full
implementation of the 7-method `CalendarProvider` contract; this sprint adds
the **Microsoft Graph** adapter with the same contract, wires both into the
calendar service, and adds mock-mode test coverage for both providers (neither
had tests before — they required real OAuth tokens + network).

- `packages/calendar-engine/src/microsoftOAuthClient.js` — Microsoft identity
  platform OAuth2 client mirroring `GoogleOAuthClient`: constructor reads
  `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID`,
  `isConfigured()`, `getAuthUrl(state)` (state carries the tenantId),
  `exchangeCode(code)`, `refresh(refreshToken)`, and `createClientForTokens`
  (auto-refreshes expired access tokens, persists refreshed tokens via an
  `onRefresh` callback).
- `packages/calendar-engine/src/microsoftGraphCalendarProvider.js` — implements
  the full 7-method contract (`check, hold, confirmHold, releaseHold,
  reschedule, cancel, listEvents`) against `/me/calendar` on Microsoft Graph.
  No native "hold" concept → a hold is a `tentative` event tagged
  `categories: ["NovaHold"]`; `confirmHold` flips it to `busy` + `["NovaConfirmed"]`;
  `listEvents` filters to Nova-tagged events only. `check` uses
  `calendarView` to detect blocking events and suggests 3 alternatives.
- `apps/api/src/container.js` — instantiates both OAuth clients + both
  providers, registers every *configured* external provider with
  `CalendarService` (a tenant picks its provider via
  `tenants/<id>/calendar/config.json` → `provider: "google" | "microsoft" | "local"`).
- `apps/api/src/server.js` — Microsoft OAuth routes:
  `GET /api/admin/calendar/microsoft/auth/:tenantId` (start consent) +
  `GET /api/admin/calendar/microsoft/callback` (exchange code, save tokens,
  flip the tenant's calendar config to `provider: "microsoft"`).
- Config: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
  `MICROSOFT_TENANT_ID` (default `common` — any MSA/Azure AD account),
  `MICROSOFT_REDIRECT_URI`. Scope: `Calendars.ReadWrite offline_access User.Read`.
- Tests: `tests/sprintP4-3.calendar-adapters.regression.test.js` — 16 cases
  covering the contract for both providers, Microsoft OAuth configuration, the
  full hold→confirm→release lifecycle, reschedule/cancel/listEvents, graceful
  not-connected errors, and calendar-service routing to the right provider by
  config. Uses a `MockMicrosoftOAuthClient` + `MockTokenRepository` so the
  provider's request building + response parsing is verified without network.

**Backward compatibility:** tenants using `provider: "local"` (the default +
all existing onboarding templates) are unaffected — the calendar service still
handles local capacity itself and only dispatches to an external provider when
config explicitly names one.

**Phase 4 test totals:** 181 sprint tests pass (P2 ×4 + P3 ×3 + P4-1 + P4-2 +
P4-3); 273 variation-coverage sanity tests still pass — no regressions.

---

### v72.1 — Post-audit hardening + operational monitoring

A deep two-subagent audit of the Phase 4 code found 18 bugs across billing,
onboarding, calendar adapters, and the engine integration. All are fixed, each
with a regression test that would have caught it (17 hardening tests, 198
sprint tests total, 273 sanity tests still green).

**Critical security fixes**

- **OAuth callback CSRF** (Google + Microsoft): the `state` param was
  `hash:tenantId` with the hash never validated — an attacker could forge a
  callback to overwrite a victim tenant's calendar tokens. Now `state` is a
  signed, single-use, 10-min-TTL HMAC token (`packages/auth-engine/src/oauthState.js`);
  callbacks verify it before saving tokens. The callbacks are also moved to a
  public section (they were blocked by the dev-token gate in production, breaking
  the consent redirect).
- **Webhook signature bypass**: `STRIPE_MOCK_MODE` auto-enabled when
  `STRIPE_SECRET_KEY` was unset, skipping signature verification. A forged
  `checkout.session.completed` could activate any tenant for free. The webhook
  route now hard-fails (503) when mock mode is on in production.

**Critical concurrency fixes**

- **`recordMessage` race**: was a non-atomic read-modify-write — a burst of
  concurrent messages near the cap lost increments AND let the count overshoot.
  Now an atomic compare-and-increment under a file lock (`repo.mutate`), with
  the cap re-checked inside the lock.
- **Slug TOCTOU**: two same-name signups could both pass `existsSync` and
  overwrite each other's tenant files. Now uses atomic `mkdir` (throws EEXIST).
- **Webhook idempotency**: a redelivered `checkout.session.completed` reset the
  quota to 0. Now dedupes by `event.id` (per-tenant rolling log).
- **Subscription save corruption**: plain `writeFileSync` could interleave
  partial writes. Now uses `atomicWriteJson` (temp-file + rename).

**Billing correctness fixes**

- **Trial-provision failure = fatal**: a failed trial used to leave a
  free-unlimited self-serve tenant (better than a real trial!). Now signup rolls
  back the tenant and surfaces the error.
- **`billingRequired` flag**: self-serve tenants are blocked if their
  subscription is missing/expired; legacy tenants (byt, demos) stay allowed
  without one (backward compat preserved).
- **Plan upgrade**: `customer.subscription.updated` now updates `planId` and
  resets the quota, so a mid-cycle upgrade takes effect immediately.
- **Trial expiry**: the `trialing → past_due` transition is now persisted (was
  ephemeral), and `evaluate()` uses the injected clock (was `Date.now()`),
  making time-based behavior testable.
- **Stripe mock IDs**: now unique per checkout (were `session_id=mock`,
  colliding).

**Medium fixes**

- CORS headers on `/api/public/signup` responses (cross-origin signup was
  silently orphaning tenants).
- `recordMessage` skips transient-error retries (a flaky upstream no longer
  burns a tenant's quota).
- Microsoft Graph token-refresh race: concurrent requests now share one refresh
  (was burning Microsoft's refresh-token rotation).
- NovaHold reaper: abandoned Microsoft Graph holds (customer dropped off after
  `hold`) are lazily deleted by `check`/`hold` so they don't block slots forever.
- Container memoization: `getContainer()` returns a singleton (a second
  `buildContainer()` was colliding on the same on-disk dirs with split-brain
  caches).
- Error-message sanitization on the signup route (no raw internals to
  anonymous callers).

**Roadmap #9 — Operational monitoring**

- `packages/ops/src/healthService.js` — liveness (cheap, for load balancers)
  + readiness (deeper: tenants dir, billing mode, calendar providers, process
  health).
- `GET /api/health` (public) + `GET /api/health?deep=1` (readiness, 503 if
  unhealthy) + `GET /api/admin/metrics` (authed; wraps MetricsAggregator +
  health).
- This closes the last open item on the V90 roadmap (item 9: "operational
  monitoring"). The remaining half of item 9 — PostgreSQL/object-storage
  migration — is infrastructure work that needs a real DB + S3; the file repos
  are already structured to swap behind an interface.

**Final test totals:** 198 sprint tests pass (P2 ×4 + P3 ×3 + P4-1 + P4-2 +
P4-3 + P4-hardening); 273 variation-coverage sanity tests still pass.

---

### v59.0 — Knowledge Engine v2 (Phases 1–6 complete)

The full Knowledge Intelligence Engine v2 upgrade, implemented per the development specification. Nova now evolves from "Customer Question → Document Search → Answer" to "Customer Context → Intent Understanding → Source Selection → Evidence Retrieval / Tool Execution → Validation → Decision → Answer / Clarification / Action / Escalation."

**Phase 1 — Architecture cleanup (v54.0):** Deleted the duplicate `packages/knowledge-engine` (Phase 3 KnowledgeEngine was never wired into the runtime). One authoritative retrieval path: `AssistantService → KnowledgeService → FileKnowledgeRepository → KnowledgeIndex`. Import guard + single-cache assertions.

**Phase 2 — Ingestion improvements (v55.0):** Structure-aware chunker keeps heading+body, lists, and tables together (the 4-tier cancellation policy regression is fixed). Ingestion validation reports (chunk count, sanitized, internal-only, short, contradictions, duplicate detection). Source versioning with `draft/processing/published/disabled/archived/failed` states, `supersedes`, `effectiveFrom/Until`, `approvedBy`.

**Phase 3 — Retrieval intelligence (v56.0):** `IntentRouter` routes pricing/availability/booking/order to structured systems (NOT RAG), RAG for faq/policy/service inquiries. `QueryRewriter` moves the 13 expansion patterns behind a dedicated interface. `EvidenceValidator` produces explicit `{status, evidence, checks{relevant, complete, authoritative, fresh, conflict, customerSafe}}`. `TrainedEmbeddingProvider` adapts the existing multilingual MiniLM models to the `EmbeddingProvider` interface with graceful fallback.

**Phase 4 — Answer intelligence (v57.0):** `AnswerComposer` (LLM + extractive fallback, structured-fact injection for critical values). `ResponseValidator` rejects uncited claims, unsupported money/duration/count/date values, and internal-evidence leaks. `DecisionEngine` maps to `answer/clarify/escalate/refuse`. `CitationBuilder` attaches evidence IDs. `AbstentionHandler` (multilingual en/ur/roman-urdu).

**Phase 5 — Storage & scalability (v58.0):** `PostgresRepository` + pgvector `VectorRepository` + `RedisCache` (pub/sub cross-instance invalidation) + `TenantIsolation`. All degrade gracefully to single-node file mode. `migrations/001_knowledge_schema.sql` + `ROLLBACK.md`. The DH1 test proves instance A's invalidation drops instance B's cache.

**Phase 6 — Admin tools & quality evaluation (v59.0):** 6 new endpoints (`/chunks`, `/playground`, `/test`, `/analytics`, `/evaluate`, `/publish`). `AnalyticsEngine.getKnowledgeDashboard` surfaces retrieval volume, answerable/abstain/clarify/escalate/conflict rates, p95 latency, top sources, failed ingestion jobs. 23-case knowledge evaluation corpus (en + roman-urdu + ur, all 4 outcomes + security + conflict cases) with `runEvaluationCorpus` for CI regression gating.

**Grounded-abstention contract preserved throughout** — Nova never invents business facts. Uploaded documents are treated as untrusted evidence, never as instructions.

### v53.0 — Production Optimization (Phase 6)
- **Conversation Replay Engine** — records production conversations with PII redaction (phone, email, name, address). Replays against current engine and compares outputs (capability, intent, reply text). Generates diff reports highlighting regressions. Export/import recordings for cross-environment testing
- **Regression Evaluator** — runs the variation corpus against the engine, compares against saved baselines, identifies new failures (regressions) and new passes (improvements). Tracks accuracy trends across versions
- **Cost Optimizer** — tracks LLM token costs, per-tenant rate limiting (60 req/min default), caching to avoid redundant API calls, cost-per-conversation estimation, system-wide cost summary
- **Load Tester** — concurrent conversation simulation (configurable parallelism), fault injection (force errors at specific probability), stress testing with automatic breaking-point detection, latency percentiles, throughput measurement, memory delta tracking

### v52.0 — Business Intelligence (Phase 5)
- **Business Config Profile** — per-tenant configuration that determines capabilities, channels, policies, integrations, and assistant personality. Supports custom business types (e.g., pet grooming) without hardcoded categories. Domain defaults for all 8 domains. Validation with error reporting
- **Customer Memory** — preferences, interaction history (last 50), consent management (dataCollection, marketing), tags, notes, GDPR right to erasure. Tenant-isolated. Customer insights (success rate, VIP detection, preferred channel/language/payment, interaction breakdown)
- **Analytics Engine** — real-time metrics tracking: message count, unique customers, booking/order success rates, fallback rate, escalation rate, duplicate action rate, latency percentiles (p50/p95/p99), channel/capability/intent breakdowns. Per-tenant dashboards and per-customer insights

### v51.0 — Integration Channels (Phase 4)
- **Channel Gateway** — unified communication layer that normalizes incoming/outgoing messages across all channels (website, WhatsApp, kiosk, REST API). Auto-detects channel from payload structure. WhatsApp adapter handles text, image, audio, document, and location messages. Kiosk adapter strips markdown for display. Identity mapping persists customer IDs across sessions
- **Integration Hub** — provider registry with 5 builtin providers (Google Calendar, Stripe, Email SMTP, WhatsApp Business API, Generic POS). Encrypted credential manager with per-tenant storage. Webhook signature verification (HMAC-SHA256). Custom provider registration for extensibility

### v50.0 — Reply Intelligence (Phase 3)
- **Reply Engine** — dedicated reply-planning and response-generation system with 6-stage pipeline: Response Context Builder → Information Grounding → Response Planner → Response Composer → Response Validator → Channel Formatter
- **Information Grounding** — verifies every factual claim (booking ID, price, availability) against actual execution results. Prevents hallucinations — Nova never says "confirmed" unless a real booking ID is grounded
- **Response Validator** — detects ungrounded confirmations, price mismatches, and ungrounded availability claims. Returns violation list for debugging
- **Knowledge Engine** — retrieves business-specific information from FAQs (`faqs.json`) and business info (`business.json`): hours, location, phone, email, check-in/out times, cancellation policies. Keyword + word-overlap matching with confidence scoring
- **Business Personality** — configurable per-tenant: tone (professional/friendly/casual), response length (short/balanced/detailed), emoji usage (none/minimal/moderate), greeting style, brand personality, escalation style

### v49.0 — Automation Engine (Phase 2)
- **Workflow Engine** — multi-step stateful business workflows with: conditional branching, step dependencies, delays, retry policies, compensation/rollback on failure, human approval pauses, cancellation, context passing between steps, and audit trail
- **Idempotency Engine** — prevents duplicate bookings/orders when customers retry (double-click confirm, network retries). Uses SHA-256 fingerprinting of action inputs, caches successful results, TTL-based expiry, does NOT cache failures
- **Action Registry wiring** — 8 builtin actions (booking.create/cancel/reschedule, commerce.create_order/process_refund, crm.create_customer, communication.send_email/notify_owner) with standardized contracts

### v48.0 — Architecture Foundation (Phase 1)
- **Business Policy Engine** — centralized business rules (cancellation windows, booking restrictions, payment requirements, refund policies, escalation conditions) configurable per-tenant with domain defaults for all 8 domains
- **Action Registry** — standardized action contracts with input/output schema, permissions, risk levels (low/medium/high), idempotency requirements, timeout, retry policy, and audit logging. 8 builtin actions registered (booking.create/cancel/reschedule, commerce.create_order/process_refund, crm.create_customer, communication.send_email/notify_owner)
- **Multi-Intent Router** — decomposes complex multi-intent messages into parallel execution plans with dependency analysis. Detects secondary intents from different capabilities, identifies supporting candidates, and maps intents to action IDs
- **Dialogue Manager** — separates dialogue/workflow management from NLU. Decides whether to continue, start, interrupt, correct, confirm, cancel, or fallback based on the active workflow state, corrections, interruptions, and global commands

### v47.0 — Hotel Management System + Reservation Bug Fix
- **Hotel management system** — new "hotel" domain with 5 room types (standard, deluxe, executive, family, presidential suite). Customers can browse rooms, check prices, and book rooms via Nova chat. Hotel admin interface to be built separately.
- **Restaurant reservation bug fix** — "reserve a table" / "book a table" / "reserve space for my family" was being misrouted to `catalog.unavailable_request` ("Sorry, that item is not available") instead of the booking adapter. Fixed by adding reservation-language detection in the catalog adapter that yields to booking.
- New hotel vocabulary dictionary (room types, amenities, check-in/out terms, Roman Urdu)
- New hotel-demo tenant with offerings, booking config, calendar, and business knowledge

### v46.0 — Multi-Turn Context Intelligence + Benchmarks
- **Context Resolution Engine** — resolves pronouns and contextual references: "book it again", "same time as last week", "same address", "i'll have the usual", "change that to X"
- Uses recent turns (last 6 messages) + CRM customer data + booking/commerce state to resolve references
- Injected into the conversation intelligence pipeline so all adapters can use resolved context
- **Benchmark test suite** — 8 benchmarks measuring cold-start latency, per-message p50/p95/p99, corpus accuracy, NLU accuracy, context resolution latency, throughput, error classifier accuracy, vocabulary enrichment latency

### v45.0 — NLU Integration with Variation Corpus
- **Corpus-to-NLU Examples Converter** — transforms the 273-case variation corpus into labeled few-shot examples for the Groq NLU
- **Few-shot prompt injection** — RemoteNluInterpreter now includes 28 domain-specific + balanced examples in every NLU prompt (version 2.1)
- **Mock NLU Client** — simulates Groq API for testing without a real API key; 100% accuracy on corpus matches, keyword fallback for non-corpus messages
- NLU detects language (English, Roman Urdu, Urdu script) and extracts entities (date, time, quantity)

### v44.0 — Tenant Vocabulary Expansion + Network Resilience
- **Per-domain vocabulary dictionaries** for 7 domains (restaurant, salon, cleaning, retail, healthcare, education, driving_school) + universal fallback
- Each dictionary has: typos, abbreviations, synonyms, quantity units, order-type verbs, special instructions, domain terms, Roman Urdu mappings
- **Network resilience** — 4-layer error handling:
  1. Transient error classifier (ETIMEDOUT/ECONNRESET/5xx → retry; 4xx/validation → permanent)
  2. Retry-ready reply preserves active workflow state across transient failures
  3. Stale-state retry re-reads and re-applies state patches on optimistic-lock conflicts
  4. Intelligence engine failure preservation — doesn't fall through to generic reply

### v43.0 — Comprehensive Variation Coverage
- **273-case variation test corpus** across 19 categories: order placement (EN/Roman Urdu/typos), multi-item, quantity mods, removal, order type, special instructions, notes, cart view, checkout, confirmation, booking trigger, booking mods, restaurant reservation, cleaning, business questions, edge cases, retail, healthcare+education+driving school
- **5 architectural bugs found and fixed** by the corpus:
  1. `offering.getById()` scoped-vs-unscoped service mixup
  2. Order-type detection swallowed "cash on delivery" payment method
  3. Order-type standalone detection missed "to go please" / "pack it up"
  4. Note-prefix messages hijacked by order-type detector
  5. Roman Urdu noun-first cart clear ("cart clear kar do") not detected

### v42.0 — Comprehensive Modification Operations
- **9 new modification operations** across commerce + booking + cleaning:
  - Promo/discount code application
  - Order type change (delivery ↔ takeaway ↔ dine-in) mid-checkout
  - Special instructions edit (less spicy, extra cheese, no onions)
  - Order note add (free-text instruction for kitchen/delivery)
  - Cancel single cart item (without cancelling whole cart)
  - Reorder / repeat last order
  - Service swap in active booking ("swap beard grooming for haircut")
  - Remove single service from multi-service booking
  - Booking note + recipient change ("this is for my wife Sara")
- **Sprint 1 gap fixes**: 7 declared-but-unhandled intents now have handlers (commerce.cart.reschedule, booking.cancel/service_change/reschedule/party_size_change/field_edit/list)

### v41.0 — Sprint 1: Initial Modification Operations
- Universal modification detection: change quantity, change size/color, reschedule, cancel order
- Expanded order-type detection for all business types
- Universal cart operations vocabulary (English + Roman Urdu)

### v40.0 — Improved NLU Engine
- 5 new service intents (service.browse, service.detail, service.quote, conversation.help, conversation.menu)
- 25+ new Roman Urdu/Urdu training examples for booking.create
- Enhanced semantic router (service routing, restaurant routing, availability routing, out-of-scope demotion)
- Abbreviation expansion in entity resolver (wht→what, chiken→chicken, resturant→restaurant, pls→please)
- Complete unified architecture (product-based + service-based + tenant adapters)

---

## 🏗️ Architecture

### Core Pipeline

```
Customer Message
       ↓
  ┌────────────────────────────┐
  │  Tenant Adapter (v44.0)     │  ← Domain vocabulary: typos, abbreviations, Roman Urdu
  │  enrichText(text, domain)   │
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Context Resolution (v46.0) │  ← Pronoun resolution: "book it again", "same address"
  │  resolve(message, state)     │
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Conversation Intelligence │  ← Global commands, corrections, interruptions,
  │  Engine (analyze)          │     workflow stack, validation, NLU (adaptive)
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Conversation Adapter       │  ← Commerce, Booking, Cleaning, Catalog, CRM,
  │  Registry                   │     Offering, Availability, Pricing, Assistant
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Capability Router          │  ← Resolves the winning adapter
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Capability Execute         │  ← Runs the handler, produces reply + state patch
  │  (with network resilience)   │
  └────────────┬───────────────┘
               ↓
  ┌────────────────────────────┐
  │  Execution Engine #finalize │  ← State persistence (with stale-state retry),
  │                             │     humanization, social polish, replay logging
  └────────────────────────────┘
```

### Key Components

| Component | File | Purpose |
| --- | --- | --- |
| Execution Engine | `packages/execution-engine/src/executionEngine.js` | Orchestrates the full pipeline; network resilience |
| Conversation Intelligence | `packages/conversation-intelligence/src/conversationIntelligenceEngine.js` | Analyzes message, selects capability |
| Context Resolution Engine | `packages/conversation-intelligence/src/contextResolutionEngine.js` | Resolves pronouns and contextual references |
| Domain Vocabulary | `packages/tenant-adapter/src/domainVocabulary.js` | 7-domain vocabulary dictionaries |
| Tenant Adapter Registry | `packages/tenant-adapter/src/tenantAdapterRegistry.js` | Auto-generates domain adapters from vocabulary |
| NLU (Groq) | `packages/multilingual-nlu/src/remoteNluInterpreter.js` | Adaptive NLU with few-shot corpus injection |
| Corpus Few-Shot | `packages/multilingual-nlu/src/corpusFewShot.js` | Converts variation corpus to NLU examples |
| Mock NLU Client | `packages/multilingual-nlu/src/mockNluClient.js` | Test-friendly NLU without API key |
| Commerce Capability | `capabilities/commerce/` | Cart, checkout, orders, modifications |
| Booking Capability | `capabilities/booking/` | Appointments, reservations, modifications |
| Cleaning Capability | `capabilities/cleaning/` | Cleaning service requests, scheduling |
| Catalog Capability | `capabilities/catalog/` | Product search, browse, detail |
| State Repository | `packages/state/src/memoryStateRepository.js` | Optimistic-locking state store |

### Supported Tenant Domains

| Domain | Capabilities | Example Tenants |
| --- | --- | --- |
| restaurant | catalog, commerce, booking, service | restaurant-demo |
| hotel | offering, booking, service | hotel-demo |
| salon | offering, booking, service | salon-demo |
| cleaning | cleaning, pricing, availability, service | cleaning-demo, byt-cleaners-dubai |
| retail | catalog, commerce | default |
| healthcare | offering, booking, service | healthcare-demo |
| education | offering, booking, service | education-demo |
| driving_school | offering, booking, service | driving-school-demo |

---

## 🧪 Testing

### Test Suites

| Suite | File | Tests | Coverage |
| --- | --- | --- | --- |
| Variation Corpus | `tests/sprint43.variation-coverage.integration.test.js` | 273 | 19 categories of customer message variations |
| v42 Modifications | `tests/sprint42.v42-modification-operations.integration.test.js` | 20 | Promo, order type, notes, cancel item, reorder, swap |
| v42.1 Bug Fixes | `tests/sprint42.1.v42-1-bugfixes.integration.test.js` | 9 | Provisional subtotal, cart preservation, order type |
| v44 Network Resilience | `tests/sprint44.v44-network-resilience.integration.test.js` | 26 | Error classifier, workflow preservation, vocabulary |
| v45 NLU Integration | `tests/sprint45.v45-nlu-integration.integration.test.js` | 27 | Corpus converter, mock NLU, prompt injection |
| v46 Context Intelligence | `tests/sprint46.v46-context-intelligence.integration.test.js` | 19 | Pronoun resolution, multi-turn scenarios |
| Benchmarks | `tests/sprint46.benchmarks.test.js` | 8 | Latency, accuracy, throughput |
| Commerce | `tests/sprint6.commerce.integration.test.js` | 3 | Catalog-backed checkout |
| Catalog | `tests/sprint5.catalog.integration.test.js` | 6 | Product search, variants, Roman Urdu |
| **Total** | | **~390+** | |

### Running Tests

```bash
# Run the full variation corpus (273 cases)
node --require ./tests/test-env.js --test tests/sprint43.variation-coverage.integration.test.js

# Run benchmarks
node --require ./tests/test-env.js --test tests/sprint46.benchmarks.test.js

# Run a specific category from the variation corpus
node --require ./tests/test-env.js --test --test-name-pattern="^ORD-" tests/sprint43.variation-coverage.integration.test.js

# Run all tests
npm test
```

### Benchmark Results (v46.0)

| Metric | Value |
| --- | --- |
| Cold-start latency | ~1.5s |
| Per-message p50 latency | ~180ms |
| Per-message p95 latency | ~400ms |
| Variation corpus accuracy | 100% (273/273) |
| Mock NLU accuracy | 100% on corpus matches |
| Context resolution latency | < 1ms per call |
| Vocabulary enrichment latency | < 0.5ms per call |
| Error classifier accuracy | 100% (8/8 test cases) |
| Throughput | ~5-8 messages/second (single process) |

---

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | (none) | Groq NLU API key. When set, NLU mode auto-enables |
| `NOVA_NLU_MODE` | `off` (or `on` if GROQ_API_KEY set) | NLU mode: `off` or `on` (adaptive) |
| `NOVA_LOCAL_DATA_DIR` | (temp) | Local data directory for tenant files |
| `LOG_LEVEL` | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `TENANTS_DIR` | `./tenants` | Tenant configuration directory |
| `NOVA_WORKERS` | (CPU count, max 4) | Cluster mode worker count |

### Enabling NLU in Production

```bash
# .env
GROQ_API_KEY=gsk_your_key_here
```

When set, the NLU runs in **adaptive mode** — deterministic regex runs first, and NLU is only invoked when:
- No deterministic route was found
- Confidence is below threshold (0.86)
- Competing deterministic routes exist
- Complex multi-intent message detected
- Roman Urdu / Urdu script in an active workflow

The NLU prompt now includes 28 few-shot examples from the variation corpus, giving the model domain-specific grounding.

---

## 📦 Deployment

### Quick Start

```bash
# Install dependencies
npm install

# Run the API server
npm start

# Run in development (single worker, auto-restart)
npm run dev
```

### Docker

```bash
docker-compose up -d
```

### Render

The `render.yaml` file is pre-configured for Render deployment.

---

## 📁 Project Structure

```
nova-assistant/
├── apps/
│   ├── api/                    # API server + cluster mode
│   ├── widget/                 # Embeddable chat widget
│   ├── admin-dashboard/        # Admin UI
│   ├── business-dashboard/     # Business owner UI
│   ├── developer-console/      # Developer playground
│   └── public-chat/            # Public chat interface
├── capabilities/
│   ├── commerce/               # Cart, checkout, orders
│   ├── booking/                # Appointments, reservations
│   ├── cleaning/               # Cleaning service requests
│   ├── catalog/                # Product search
│   ├── crm/                    # Customer management
│   ├── offering/               # Service listings
│   ├── availability/           # Hours, slot checking
│   ├── pricing/                # Quote generation
│   └── assistant/              # Knowledge, fallback
├── packages/
│   ├── execution-engine/       # Core orchestration
│   ├── conversation-intelligence/  # NLU pipeline
│   ├── multilingual-nlu/       # Groq NLU client + few-shot
│   ├── tenant-adapter/         # Domain vocabulary
│   ├── conversation-memory/    # Turn history
│   ├── catalog-engine/         # Product matching
│   ├── commerce-engine/        # Cart/order logic
│   ├── booking-engine/         # Booking state machine
│   ├── cleaning-engine/        # Cleaning pricing
│   ├── crm-engine/             # Customer data
│   └── ...                     # 20+ packages
├── tests/
│   ├── fixtures/
│   │   └── variation-corpus.js # 273-case test corpus
│   ├── sprint43.variation-coverage.integration.test.js
│   ├── sprint44.v44-network-resilience.integration.test.js
│   ├── sprint45.v45-nlu-integration.integration.test.js
│   ├── sprint46.v46-context-intelligence.integration.test.js
│   ├── sprint46.benchmarks.test.js
│   └── ...                     # 90+ test files
├── tenants/                    # Tenant configurations
├── domains/                    # Domain schemas
└── examples/                   # Configuration examples
```

---

## 📝 Release History

| Version | Date | Focus |
| --- | --- | --- |
| v46.0 | 2026-11-05 | Multi-turn context intelligence + benchmarks |
| v45.0 | 2026-11-05 | NLU integration with variation corpus |
| v44.0 | 2026-11-05 | Tenant vocabulary expansion + network resilience |
| v43.0 | 2026-11-05 | 273-case variation coverage corpus |
| v42.1 | 2026-11-05 | Bug fixes from live conversation |
| v42.0 | 2026-11-05 | Comprehensive modification operations |
| v41.0 | 2026-11-05 | Sprint 1: initial modification operations |
| v40.0 | 2026-10-22 | Improved NLU engine (5 service intents, Roman Urdu) |
| v35.x | 2026-09-16 | PWA kiosk, catalog UI, bug fixes |
| v34.x | 2026-09-10 | Widget SDK, notifications, admin dashboard |
| v33.x | 2026-09-05 | Conversation takeover, replay engine |
| v30.x | 2026-08-15 | Humanization, social intelligence |
| v29.x | 2026-08-10 | Widget UX redesign |
| v28.x | 2026-08-05 | Widget SDK |
| v27.x | 2026-07-30 | Admin dashboard |
| v25.x | 2026-07-20 | Universal vocabulary |
| v22.x | 2026-07-01 | Voice UI, templates |
| v20.x | 2026-06-20 | Architecture overhaul |
| v18.x | 2026-06-05 | Knowledge layer |
| v16.x | 2026-05-20 | Family-filtered browsing |
| v15.x | 2026-05-10 | Transactional validation |
| v14.x | 2026-05-01 | State-slot consistency |
| v12.x | 2026-04-15 | Commerce orchestration |
| v10.x | 2026-03-20 | Social intelligence |
| v9.x  | 2026-03-10 | Conversation intelligence |
| v8.x  | 2026-02-20 | Knowledge + memory + intelligence |
| v7.x  | 2026-02-01 | Persistence platform |
| v6.x  | 2026-01-20 | Commerce |
| v5.x  | 2026-01-10 | Catalog |
| v3.x  | 2025-12-20 | Capability SDK |
| v2.x  | 2025-12-10 | Goal engine |
| v1.x  | 2025-11-15 | Initial release |

---

## 📄 License

Private — Internal use only.
