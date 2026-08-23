# Nova v8.9.10 — Semantic Actions and Scope Pricing

Nova v8.9.10 connects interpreted meaning to deterministic workflow actions.
The remote NLU remains an untrusted language parser: it can propose intents and
entities, but it cannot update bookings, orders, carts, CRM records, prices, or
tenant data. Nova validates the proposal and performs every mutation itself.

## Corrected conversation behavior

- Roman-Urdu whole-home deep-cleaning requests resolve to the whole-property
  service rather than Bathroom Deep Cleaning.
- Negated corrections such as `bathroom deep cleaning nhn, pura ghar` replace
  the service without retaining the rejected bathroom scope.
- `jis time team available ho` stores an `any_available` preference and advances
  the workflow. It does not invent or confirm a live slot.
- Times such as `subha 10 bjy` normalize to 10:00 AM before business-hours
  validation.
- Return and exchange language is routed to commerce order actions before
  catalog matching. A shirt size mentioned in a return request is therefore not
  interpreted as a request to browse small shirts.
- Exchange and return operations use tenant- and customer-scoped order history,
  preserve the order, and append a durable revision/timeline entry.

## SparkleCare pricing model

| Service class | Pricing basis |
|---|---|
| Standard cleaning | AED 40 per hour per cleaner for apartments, villas, houses, and other properties |
| Deep cleaning | Configured matrix by property type and bedroom count |
| Sofa/furniture cleaning | Configured matrix by furniture type or seating units |
| Mattress cleaning | Configured mattress-size variants |
| Curtain cleaning | Configured curtain-size variants |
| Carpet cleaning | Configured size/area tiers |

An unlisted scope becomes a custom-quotation request. Nova never extrapolates a
price that the tenant did not configure.

## Remote NLU model name

`openai/gpt-oss-20b` is a Groq-hosted model identifier. The `openai/` prefix is
the model publisher namespace; requests still go to the configured Groq API
endpoint and use `GROQ_API_KEY`. The trace exposes both provider and model so the
runtime can be audited.

## Validation

```powershell
npm run benchmark:v8.9.10
npm run model:groq:trace -- "jis time team available ho"
npm run model:groq:trace -- "actually i want to replace my small shirts with large ones"
```

For deterministic-only testing, set `NOVA_NLU_MODE=off`. With
`NOVA_NLU_MODE=on`, Groq is invoked adaptively; Nova still falls back safely to
its deterministic understanding if the provider is unavailable or invalid.
