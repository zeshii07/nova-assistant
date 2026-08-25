# Nova v10.1.1 — Adaptive Semantic Acquisition and Customer Memory

## Outcome

Nova now distinguishes a request to obtain a service or product from a greeting
or a general information question across natural paraphrases. This behavior is
central platform logic: onboarding a new tenant still requires only its business
profile, offerings or products, prices, policies, and enabled capabilities.
Tenant-specific phrase code is not required.

## Understanding pipeline

1. The universal message frame detects domain-neutral acquisition language such
   as “looking for”, “trying to find”, “set me up with”, “help me arrange”, and
   “could your team come…”.
2. The lightweight local semantic router combines word/bigram and character
   n-gram probabilities with the current tenant's product and service vocabulary.
3. The relevant deterministic adapter resolves the exact configured service,
   product, price model, required fields, and workflow transition.
4. If the local result is uncertain, conflicting, referential, or genuinely
   complex, Groq may return a validated interpretation contract. It never gains
   permission to create a booking, order, payment, cancellation, or CRM change.
5. The deterministic core validates and executes every business action.

This is deliberately a hybrid system. A small local model handles common
paraphrases cheaply and quickly; Groq is the final interpretation fallback for
ambiguity, not the source of business truth.

## Groq activation

If either `GROQ_API_KEY` or `NOVA_GROQ_NLU_API_KEY` is configured and
`NOVA_NLU_MODE` is omitted, Nova enables the adaptive language layer. Override
that behavior explicitly when no provider calls are wanted:

```dotenv
NOVA_NLU_MODE=off
```

To make the production intent explicit, use:

```dotenv
GROQ_API_KEY=your_key_here
NOVA_NLU_MODE=on
NOVA_NLU_STRATEGY=adaptive
```

## Cleaning behavior fixed

- “Hello, I was looking for a cleaning service for my villa” begins the Villa
  Cleaning workflow and asks Standard versus Deep Cleaning.
- “Do you provide cleaning service for villa?” answers yes briefly and presents
  the same useful choice instead of dumping the complete service catalog.
- Bounded typos such as `vill` and `vila` retain the Villa Cleaning meaning.
- A generic property request never silently selects the hourly/standard pricing
  model when Standard versus Deep is still unresolved.

## Saved customer details

Saved contact information does not replace service-specific booking choices.
Nova still needs the requested service, scope, date, and time. After those fields
are complete, it hydrates the current tenant's saved name, phone, optional email,
and address, displays them in one review, and asks the customer to keep all
details or identify a field to change. Only genuinely absent required values are
requested from the customer.

## Verification

Focused semantic regression:

```powershell
node --require ./tests/test-env.js --test tests/sprint79.semantic-acquisition-breadth.integration.test.js
```

Complete release gate:

```powershell
npm run benchmark:v10.1.1
```
