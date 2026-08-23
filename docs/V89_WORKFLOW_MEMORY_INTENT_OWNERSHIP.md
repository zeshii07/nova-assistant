# Nova v8.9 — Workflow memory and intent ownership

## Release boundary

Nova's deterministic engines remain authoritative for tenant scope, workflow
state, field extraction, business validation, knowledge, pricing, CRM, booking,
inventory, and order execution. Qwen is a language-understanding fallback only.
It receives no tools and cannot directly mutate business data or confirm an
action.

`NOVA_NLU_MODE=off` disables all Qwen requests. `NOVA_NLU_MODE=on` preserves the
same deterministic-first architecture and sends only unresolved messages to the
configured Qwen endpoint. A model timeout, invalid schema, or low-confidence
interpretation cannot authorize a guessed transaction.

## v8.9 corrections

- Multi-product purchases outrank stale catalog browsing state.
- Colors, sizes, and quantities are merged into the correct product lines over
  multiple turns; incomplete variants never silently modify the cart.
- Checkout/review owns final confirmation phrases such as `ok final` and
  `confirm order`.
- Unsupported catalog identities such as `LED bulb` are not substituted with a
  configured `LED Desk Lamp`.
- Cleaning requirements such as balconies and windows update the active request
  without being mistaken for knowledge questions or customer names.
- Replacing a cleaning service preserves schedule, property scope, address,
  identity, phone, and the review stage.
- Accepting an alternative quote can reuse the prior request snapshot.
- A combined answer such as `Monday at 2 PM` fills both date and time.
- Stored identity references, social interruptions, and required-field refusals
  do not corrupt the pending workflow.
- Arrival and pricing questions retain their informational route rather than
  becoming accidental workflow updates.

These are reusable ownership and extraction rules. They are not keyed to one
customer transcript or one tenant's product/service names.

## When Qwen is invoked

With `NOVA_NLU_MODE=on`, Qwen is eligible only after deterministic parsing cannot
produce one safe, sufficiently confident route. Examples:

1. During an active booking, `غداً الساعة الخامسة` may invoke Qwen with the
   `multilingual_pending_utterance` reason so it can identify tomorrow and 5 PM.
   Nova still normalizes the timezone and validates availability.
2. `Move the other one later, but keep this one the same` when multiple bookings
   or items are plausible may invoke Qwen with an unresolved/ambiguous-reference
   reason. Nova uses the structured interpretation only after schema validation;
   otherwise it asks the customer which record they mean.
3. A vague code-switched correction such as `thora adjust kar do na` with no
   clear target may invoke Qwen because the deterministic route has insufficient
   evidence. It must still ask a clarification before any risky action.

Clear requests such as `I need two cleaners Monday at 2 PM` or `add black jeans
size 36` do not invoke Qwen.

## Release gate

Run:

```powershell
npm run benchmark:v8.9
```

The gate covers the v8.9 focused workflow suite, the complete integration suite,
the conversation compliance corpus, JavaScript syntax validation, and the
state-safety audit.

Release result:

- integration tests: 387/387 passed;
- conversation compliance corpus: 156/156 passed;
- JavaScript syntax validation: 280 files passed;
- state-safety audit: passed.
