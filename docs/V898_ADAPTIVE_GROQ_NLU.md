# Nova v8.9.8 — Adaptive Groq NLU with deterministic execution

Nova v8.9.8 removes the local Qwen runtime from the active application and test
path. There are no model weights to download, no `llama-server` process, and no
Docker model service.

Groq is an optional language interpreter. It never receives Nova tools and
never decides prices, policies, stock, availability, permissions, CRM writes,
bookings, orders, confirmations, cancellations, or whether an action succeeded.
Those decisions remain inside tenant-scoped deterministic engines.

## Runtime modes

- `NOVA_NLU_MODE=off`: deterministic-only. Nova makes no Groq NLU request.
- `NOVA_NLU_MODE=on`: adaptive. Nova first runs its deterministic message frame,
  entity extraction, workflow ownership, and capability candidates. It calls
  Groq only when the result is uncertain, conflicting, or linguistically
  complex.

There is intentionally no public `model-first` mode. Clear messages stay fast.

## Request path

```text
Customer message
  -> universal message frame + local extractors
  -> deterministic tenant capability candidates
  -> confidence/conflict/complexity gate
       -> clear: deterministic engine directly
       -> uncertain: Groq strict intent/entity JSON
  -> schema and current-tenant ID validation
  -> deterministic policy arbitration
  -> booking / commerce / cleaning / CRM / knowledge engine
  -> deterministic humanization and channel rendering
```

Conversation state belongs to Nova. The Groq prompt receives a compact current-
tenant vocabulary and limited active-workflow fields, not CRM history, customer
lists, prices, stock, policy documents, or another tenant's identifiers.

## Configure on Windows PowerShell

Edit the project-root `.env` file and set:

```dotenv
GROQ_API_KEY=gsk_your_key_here
NOVA_NLU_MODE=on
NOVA_GROQ_NLU_MODEL=openai/gpt-oss-20b
NOVA_GROQ_NLU_TIMEOUT_MS=4000
```

Do not commit or paste the API key into tenant JSON, source code, chat logs, or
the Developer Console.

Check direct Groq schema connectivity:

```powershell
npm run model:groq:check
```

Trace adaptive routing without starting the HTTP server:

```powershell
npm run model:groq:trace -- "hello"
npm run model:groq:trace -- "thora adjust kar do na, kal wali request ko"
```

The first example should normally show `remoteNlu.used: false` and
`invocationReason: deterministic_confident`. The second should normally show a
Groq invocation because the requested target/field is unclear.

Then start Nova normally:

```powershell
npm start
```

No `llama-server` terminal is required.

## What invokes Groq

With mode `on`, the main invocation reasons are:

- no deterministic route;
- a route below the configured confidence threshold;
- two incompatible capability routes with close confidence;
- a semantic message-frame intent that conflicts with the selected capability;
- a social prefix followed by unresolved business content;
- an ambiguous correction such as “change that one”;
- an invalid pending-field reply that might actually be an interruption;
- a genuinely complex message containing three or more business intents.

Examples likely to invoke Groq:

```text
thora adjust kar do na, kal wali request ko
Actually use the other one, tell me its price, and check whether it is available
غداً الساعة الخامسة (while a workflow is waiting for a time)
```

Examples that should stay deterministic and make no Groq NLU call:

```text
I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment.
Show me all products.
Remove the Comfort Slides from my cart.
My name is Zeeshan Ahmad and my phone is 03019299608.
```

## Failure and safety behavior

Groq output must pass the strict Nova NLU schema. Tenant service/product IDs are
accepted only when they exist in the current tenant vocabulary. A timeout,
invalid response, missing key, or provider error cannot authorize an action.

The client has a short circuit breaker. After a failed remote request, repeated
eligible messages temporarily skip the network delay. Nova then either uses a
safe high-confidence deterministic candidate or asks a tenant-aware clarification
question while leaving the active draft unchanged.

## Verification

Run the release-specific suite:

```powershell
npm run benchmark:v8.9.8
```

The suite verifies adaptive skip/invoke behavior, strict JSON schema requests,
no tool exposure, no-key behavior, timeout safety, deterministic compound-
message fallback, current-tenant grounding, Arabic assistant wording, the full
regression suite, conversation corpus, syntax check, and state-safety audit.
