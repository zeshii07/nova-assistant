# Nova Assistant — v46.0

**Multi-tenant SaaS conversation engine** for service businesses. Handles orders, bookings, and customer interactions across restaurants, salons, cleaning services, retail, healthcare, education, and driving schools.

---

## 🚀 What's New (v40.0 → v46.0)

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
