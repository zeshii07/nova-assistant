# Nova v9.4.0-alpha.1 — Lightweight Local Semantic Router

## Outcome

Nova now has three levels of language understanding:

1. deterministic extraction and rules for exact, auditable facts;
2. a fast local probabilistic semantic router for paraphrases and multilingual
   intent evidence;
3. optional Groq interpretation only when the first two levels cannot establish
   a safe meaning.

Neither probabilistic layer performs business actions. Nova’s orchestrator and
capability engines remain the only execution authority.

## Runtime structure

```text
Channel adapters
  -> Message gateway
  -> Conversation manager + durable workflow state
  -> Deterministic language engines
       clauses, dates/times, corrections, interruptions, customer fields
  -> Local statistical semantic router
       intent probability, paraphrase similarity, tenant vocabulary,
       ambiguity and complexity signals
  -> Semantic policy
       confirms/reorders only deterministic candidates;
       may originate a small allow-list of read-only routes
  -> Adaptive escalation policy
       clear/aligned -> stay local
       unclear/conflicting/complex -> optional Groq LanguageContract JSON
  -> Deterministic orchestrator
  -> Tenant-scoped capability engines
       Assistant / Knowledge / Catalog / Commerce / Offering / Booking /
       Cleaning / Pricing / Availability / Calendar / CRM / Inventory
  -> Response model + deterministic humanization
  -> Customer
```

The Control Plane is the sole source for structured products/prices,
services/pricing rules, hours, calendar capacity, and business profile. Knowledge
Manager contains unstructured FAQs and policies, not duplicate prices.

## Local probabilistic router

`packages/semantic-router` trains at process start from domain-independent seed
utterances. It is small, requires no model download, and makes no network call.
Its classifier combines:

- multinomial Naive Bayes probability;
- word and word-bigram features;
- prefix and character 3/4-gram features for spelling variation;
- nearest-example cosine similarity;
- current-tenant product/service vocabulary;
- active-workflow, language, ambiguity, and multi-intent signals.

It recognizes general meanings such as `booking.create`, `booking.modify`,
`service.price`, `product.list`, `cart.remove`, `order.exchange`,
`business.contact`, and social conversation. Business-specific entities are
still validated against the selected tenant.

The router output includes confidence, confidence margin, similarity,
alternatives, tenant matches, complexity, and an escalation recommendation. It
has `authority.mayExecute=false`.

## When Groq is used

With `NOVA_NLU_MODE=on` and `NOVA_NLU_STRATEGY=adaptive`, Groq is requested when
language meaning remains unresolved, for example:

- no deterministic route exists and local semantic confidence is insufficient;
- local meaning conflicts with the capability selected by deterministic rules;
- an active workflow receives an unclear interruption or reference;
- several dependent intents cannot be safely separated locally;
- multilingual phrasing is outside the local router’s reliable coverage.

Examples likely to escalate:

```text
thora kal wali request ko adjust kar do, lekin doosri wali nahi
Use the earlier option unless the later one was already moved, then cancel that one
```

Clear requests remain local:

```text
show my cart
what services do you offer
I need two cleaners tomorrow for three hours
change my booked time from 9 AM to 10 AM
123
```

The last example stays local when Nova is validating a phone field: Groq cannot
turn an invalid business value into a valid one.

Groq receives a compact, tenant-scoped context and returns strict schema JSON. It
gets no tools, prices, policies, secrets, CRM records, or write authority. Invalid
JSON, timeout, quota failure, or provider downtime falls back safely.

## Cleaning property-type boundary

Nova never decides Standard versus Deep Cleaning merely from `villa cleaning`,
`house cleaning`, `apartment cleaning`, or `flat cleaning`.

```text
Customer: I want my villa cleaned Friday at 9 AM
Nova:     Standard Cleaning or Deep Cleaning?

Customer: Standard Cleaning
Nova:     How many cleaners do you need?
          -> then asks hours

Customer: Deep Cleaning
Nova:     How many bedrooms does the property have?
```

Existing date, time, property type, bedroom count, and other supplied scope stay
in the draft while Nova asks only the missing pricing fields.

- Standard Cleaning: hourly price per cleaner; requires `cleanerCount` and
  `durationHours`.
- Deep Cleaning: scope price; requires `propertyType` and `bedrooms`.
- Explicit staffing plus duration is sufficient evidence for the Standard
  hourly pricing model, even if the customer did not repeat the word standard.

Customer-facing wording uses **Standard Cleaning** and **Deep Cleaning**. Internal
operational IDs may continue to share the existing hourly pricing engine.

## Configuration

```dotenv
# Local semantic classifier (no API key or model download)
NOVA_SEMANTIC_ROUTER_MODE=on
NOVA_SEMANTIC_ROUTER_MIN_CONFIDENCE=0.72
NOVA_SEMANTIC_ROUTER_MIN_MARGIN=0.08
NOVA_SEMANTIC_ROUTER_MIN_SIMILARITY=0.20
NOVA_SEMANTIC_ROUTER_MAX_LOCAL_INTENTS=2

# Optional remote interpretation
NOVA_NLU_MODE=on
NOVA_NLU_STRATEGY=adaptive
GROQ_API_KEY=your_key_here
```

For fully local operation:

```dotenv
NOVA_SEMANTIC_ROUTER_MODE=on
NOVA_NLU_MODE=off
```

Nova remains functional without Groq; very unclear language may require a
clarifying question more often.

## Commands

```powershell
# No provider call; inspect local probabilities and deterministic candidates
npm run model:semantic:trace -- "mujhy apni kal wali booking late karni hai"

# Inspect real adaptive routing and whether Groq was invoked
npm run model:groq:trace -- "mujhy apni kal wali booking late karni hai"

# Validate Groq key/model/schema connectivity
npm run model:groq:check

# Full v9.4 release gate
npm run benchmark:v9.4.0
```

Use `NOVA_SEMANTIC_TRACE_TENANT=default` before the local trace command to test
the retail tenant; it defaults to `cleaning-demo`.

## Safety invariants

- Tenant vocabulary and identifiers never cross tenant boundaries.
- Local semantic output never writes state or calls a capability.
- Groq output never writes state or calls a capability.
- Transactional intent requires a deterministic executable candidate and
  business validation.
- Read-only AI-originated routes are allow-listed and read current-tenant data.
- Dates, times, names, phone numbers, addresses, inventory, prices, capacity,
  permissions, and confirmations remain deterministic.
- A probabilistic disagreement cannot override a high-confidence specific
  deterministic route.
