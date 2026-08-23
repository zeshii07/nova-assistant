# Nova v8.9.11 — Intent Boundaries and Variant Cart Updates

Nova v8.9.11 fixes transaction starts, contextual price questions, multi-variant
product extraction, checkout-time cart changes, and repetitive social replies.

## Information and transaction boundary

Cleaning messages are separated into four deterministic meanings:

| Meaning | Example | Nova action |
| --- | --- | --- |
| Price information | `What is the price for a 2-bedroom villa deep clean?` | Quote only; do not create a booking draft |
| Contextual price follow-up | `And what about 3 bedrooms?` | Reuse the last quoted service and calculate again |
| Price comment | `That is too expensive` | Acknowledge without changing a workflow or price |
| Transaction request | `Book the 2-bedroom villa deep clean tomorrow at 10` | Start the deterministic cleaning workflow |

Groq may interpret uncertain wording when `NOVA_NLU_MODE=on`, but it has no
execution authority. Nova validates the interpretation, tenant scope, service,
price, cart, workflow state, and every mutation.

## SparkleCare test pricing

- Standard cleaning: AED 40 per hour per cleaner.
- Deep villa: AED 300 for one bedroom, plus AED 70 per additional bedroom.
- Deep apartment: AED 200 for a studio; AED 250 for one bedroom, plus AED 50 per
  additional bedroom.
- Sofa cleaning: AED 50 for one seat, plus AED 30 per additional seat.
- Unlisted sizes and scopes remain custom quotations; Nova does not invent a
  value.

Tenant knowledge and structured pricing now contain the same figures, preventing
RAG answers from contradicting deterministic calculations.

## Product variants and checkout interruption

`2 large and 1 small polo shirt` is represented as two draft lines belonging to
the same product. Generic family words such as `shirt` no longer introduce a
Cotton T-Shirt when a more specific `polo shirt` identity is present.

During checkout, a message such as `change one small shirt to large` is treated
as a cart command before name, phone, or address validation. Nova changes only
the requested quantity, splits the source line when needed, preserves the cart
total and timeline, and resumes the paused checkout field.

## Human response variation

Greeting, thanks, and small-talk templates can be arrays. Nova rotates through
tenant-approved variants using conversation state. This changes wording only:
capability routing, business facts, validation, pricing, and execution remain
deterministic.

Relative dates are resolved from the configured business timezone rather than
the host computer timezone. The test commands load a fixed test-only clock so
`today`, `tomorrow`, and weekday assertions remain reproducible on every date;
production continues to use the real clock.

## Validation

Run the release gate:

```powershell
npm run benchmark:v8.9.11
```

Run without Groq:

```powershell
$env:NOVA_NLU_MODE="off"
npm start
```

Run with adaptive Groq interpretation:

```powershell
$env:NOVA_NLU_MODE="on"
npm run model:groq:check
npm start
```
