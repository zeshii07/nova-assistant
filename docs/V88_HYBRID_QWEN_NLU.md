# Nova v8.8 — Hybrid Qwen multilingual NLU

> Historical document. The local Qwen runtime and commands were removed in
> v8.9.8. Use `V898_ADAPTIVE_GROQ_NLU.md` for the current adaptive Groq setup.

## Architectural boundary

Nova owns conversation state, workflow transitions, tenant scoping, knowledge,
prices, availability, validation, CRM, booking, orders, and final actions. Qwen
only converts the current customer message plus a minimal tenant vocabulary and
active-workflow summary into a versioned JSON NLU record.

The Qwen prompt contains no CRM record, customer history, prices, stock,
schedules, policy text, or another tenant's data. Canonical service/product IDs
are accepted only when they occur in the current tenant's bounded vocabulary.

```text
channel -> conversation state -> universal multi-intent message frame
        -> tenant-scoped deterministic adapters and field extractors
        -> confidence/conflict gate -> optional Qwen NLU
        -> strict schema validator -> deterministic decision policy
        -> tenant knowledge or deterministic capability -> response composer
```

Qwen never receives Nova tools. It cannot call booking, CRM, catalog, knowledge,
or commerce services. A high-confidence deterministic rule skips Qwen entirely.
Qwen may route read-only questions, enrich missing fields in an active workflow,
or start an unconfirmed draft for an explicit request above the action threshold.
It may never confirm, cancel, or directly create a final transaction.

## Universal multi-intent frame

`packages/conversation-intelligence/src/universalMessageFrame.js` records every
detected conversational act and shared entity before route selection. It is
domain-neutral: greeting, customer update, booking/order request, price question,
availability question, business-information question, correction, cancellation,
and confirmation can coexist in one message. Shared date, time, duration, name,
phone, email, and explicit address values are merged into adapter entities so a
workflow cannot ask again for a value the customer already supplied.

Tenant adapters then add resolved domain intents such as `booking.start`,
`catalog.category_browse`, `cleaning.structured_service_request`, or
`offering.unavailable`. The complete set is exposed as
`intelligence.messageFrame.resolvedIntents` in replays and the developer console.
The router chooses one primary transactional owner to avoid duplicate writes;
validated CRM fields are safe cross-cutting updates, and read-only side questions
may temporarily interrupt and then resume that owner.

Examples covered by integration tests:

- greeting + name + phone + salon service + date + time + price question;
- name + phone + product browse + price question;
- business contact question + phone update while a booking is waiting for time;
- multiple property-cleaning requests added and deduplicated before confirmation.

## NLU contract

The strict `1.0` schema is in
`packages/multilingual-nlu/src/nluSchema.js`. It includes language, message type,
domain-independent intent, confidence, workflow relationship, entities, customer
fields, requested information, corrections, and ambiguities. Every object rejects
unknown keys. Invalid JSON, invalid enums, extra properties, timeouts, and network
errors cannot trigger a guessed action. If deterministic evidence is sufficient,
Nova continues on that route; if Qwen was needed to arbitrate an unresolved
message, Nova asks for clarification without changing conversation state.
The bounded context includes an explicit reference time and tenant timezone so
relative phrases can be normalized, while Nova still validates the resulting date
and time. Replay records the `nova-nlu-1.1` prompt version and model identity.

## Rollout

1. Download the official model with `npm run model:qwen:download`. The downloader
   uses Node.js directly and therefore works in Windows PowerShell, Linux, and
   macOS without Bash or curl. Interrupted `.part` downloads resume automatically.
2. Start the bundled OpenAI-compatible llama.cpp server with
   `docker compose -f docker-compose.qwen.yml up -d`.
3. Run `npm run model:qwen:check`.
4. Keep `NOVA_NLU_MODE=off` while validating deterministic replay.
5. Evaluate intent accuracy, entity F1, date/time accuracy, correction and interrupt
   detection, schema validity, latency, and especially false-action rate.
6. Set `NOVA_NLU_MODE=on` only after the tenant/domain evaluation passes.

`off` makes no Qwen calls. `on` enables the guarded ambiguity fallback. Confident
deterministic messages and compatible evidence pairs (for example booking plus
offering details for the same service) stay on Nova's fast path. Low-confidence
routes, genuine cross-capability conflicts, unresolved greeting-prefixed tasks,
and ambiguous corrections may contact Qwen. A tenant can explicitly opt out with
`features.qwenNlu=false`.

## Runtime notes

The default served-model alias is `nova-qwen-nlu`, intended for a lightweight
Qwen3 0.6B quantized model. Model weights stay outside the source archive. The
model server exposes an OpenAI-compatible endpoint on port 8000 and enforces the
JSON schema through `response_format.json_schema`.

The app defaults to `off`, so environments without a compatible GPU or vLLM keep
all v8.7 deterministic behavior. Qwen failures are non-fatal and do not block a
message.
