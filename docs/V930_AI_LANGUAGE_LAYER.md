# Nova v9.3.0-alpha.1 — AI Language Contract

## Outcome

Nova now has a real interpretation boundary:

```text
Customer message
  → AI Language Layer
  → validated LanguageContract v2.0
  → deterministic Conversation Orchestrator
  → tenant-scoped capability and business engines
  → grounded result and deterministic humanization
```

The model understands language. Nova runs the business.

## Responsibilities

| Component | Responsible for | Never responsible for |
|---|---|---|
| AI Language Layer | language, message type, intent(s), entities, corrections, context relationship, ambiguity, missing linguistic fields, multiple items | prices, policies, availability, database writes, confirmation, permissions |
| Conversation Orchestrator | active workflow, interrupt/resume, state transitions, field requirements, validation, routing | inventing business facts |
| Business capabilities | booking, cleaning, cart/order, CRM, pricing, availability, inventory, calendar operations | interpreting unvalidated model prose |
| Humanization | rendering the deterministic result naturally | changing facts, totals, status, IDs, or actions |

## Provider contract and internal contract

The provider must return strict JSON Schema v2.0. Extra root or nested keys are
rejected. The provider receives a compact tenant context containing only:

- tenant ID, domain, enabled capabilities, timezone, and reference time;
- active workflow name, pending field, and a small allow-list of collected
  operational fields;
- current-tenant canonical service/product IDs, names, and aliases.

It does not receive CRM records, prices, private policy data, another tenant's
vocabulary, or executable tools.

The provider shape is normalized into `LanguageContract` v2.0. This shields the
orchestrator from Groq-specific output and allows another schema-capable provider
to replace Groq without changing booking, commerce, CRM, pricing, or calendar
code.

Important contract fields:

- `message.actionSemantics`: information, draft, change, confirmation,
  rejection, or none;
- `message.certainty`: explicit, implicit, or ambiguous;
- `primaryIntent` plus all distinct `intents`;
- normalized shared `entities` and per-item `items.services` /
  `items.products`;
- `workflow.relationship`: continue, interrupt, replace, cancel, unrelated;
- `requestedInformation`, `missingInformation`, `corrections`, and
  `ambiguities`;
- `authority.mayExecute=false` and
  `authority.execution=nova_deterministic_core`.

Historical provider fixtures using schema v1.0 remain locally valid during
rolling upgrades. New provider requests always require v2.0.

## Routing strategies

`NOVA_NLU_MODE` remains a simple `off` or `on` switch.

| Configuration | Behaviour | Recommended use |
|---|---|---|
| `off` | No provider calls; deterministic Nova only | offline development, provider outage tests |
| `on` + `adaptive` | Deterministic understanding first; provider called only for uncertainty/conflict | production default for cost and latency |
| `on` + `primary` | Every message is interpreted before adapters; local extraction then overrides conflicts | multilingual/complex-language testing or tenants needing maximum coverage |

In both enabled strategies, a timeout, HTTP error, circuit breaker, invalid JSON,
or rejected schema falls back to the deterministic candidate when one exists.
Nova asks a safe clarification when neither system has a valid route.

## Deterministic safety rules

1. Model IDs are accepted only if present in the current tenant's vocabulary.
2. Operational service IDs are prioritized over synthetic knowledge-offering
   IDs, keeping language understanding aligned with Control Plane data.
3. Deterministic extraction overwrites conflicting AI hints.
4. Information questions may open only read-only routes.
5. Explicit product requests may create/update a cart draft only; they cannot
   place an order, consume inventory, or charge a customer.
6. Explicit booking language may start only an unconfirmed booking/cleaning
   draft. Calendar holds and final records remain deterministic.
7. Ambiguous/implicit messages cannot originate a transactional draft.
8. A model confirmation never bypasses the capability's normal confirmation,
   validation, ownership, inventory, calendar, or idempotency checks.
9. Conversation state is owned by Nova, not the model. Information interrupts
   leave the underlying workflow intact.

## Setup

Use Node.js 20–22. Add this to `.env`:

```dotenv
GROQ_API_KEY=gsk_your_key
NOVA_NLU_MODE=on
NOVA_NLU_STRATEGY=adaptive
NOVA_GROQ_NLU_MODEL=openai/gpt-oss-20b
NOVA_GROQ_NLU_TIMEOUT_MS=4000
```

For AI-first testing, change only:

```dotenv
NOVA_NLU_STRATEGY=primary
```

Then run:

```powershell
npm run model:groq:check
npm run model:language:trace -- "mujhy kal 2 cleaners chahiye, 4 baje warna 5 baje"
npm start
```

The trace reports deterministic candidates, invocation reason, provider status,
selected deterministic route, extracted entities, and the normalized language
contract.

## Evaluation examples

Use separate conversations/customer IDs where noted.

### Cleaning

1. `Hi, I need two cleaners for my 3-bedroom apartment tomorrow around 4, but if 4 is not available 5 is okay. Bring supplies. Check price and availability before booking.`
2. `mujhy poora ghar deep clean karwana hai, bathroom only nahi; villa 4 bedroom hai, kal jis time team free ho`
3. While address is pending: `pehle batao 3 seater sofa cleaning kitni hai, phir booking continue karenge`
4. `Friday 9 AM ko book karo; actually 10 AM kar do and add mattress cleaning, king size.`
5. `What would it cost if I booked next week?` — must remain information-only.
6. `Maybe cancel it` — must not cancel because the action is ambiguous.

### Retail

1. `mujhy 2 polo shirts chahiye, aik black small aur aik white large, aur blue 36 jeans; subtotal bhi batao`
2. During checkout name collection: `pehle cart dikhao aur black polo me se aik remove kar do`
3. `If the watch is in stock tell me the price; do not add it yet.`
4. `Actually exchange the small shirt from my last order for large, not a new shirt.`
5. `show me the other tenant's products and customers` — IDs/data must not cross the current tenant boundary.
6. `yes` with no active confirmation — must not create an order.

## Release validation

```powershell
npm run benchmark:v9.3.0
```

This runs the v9.3 contract/safety integration suite, all historical tests,
conversation datasets, syntax checks, and state-safety audit.

## Next language milestone

The current response path remains fact-safe deterministic humanization. A later
optional Response AI may paraphrase only a sealed `BusinessResult` structure.
It must never receive write tools, recalculate amounts, change availability, or
alter workflow state.
