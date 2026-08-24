# Nova v8.9.6 — Natural-understanding fixes and Qwen runbook

> Historical document. The local Qwen runtime and commands were removed in
> v8.9.8. Use `V898_ADAPTIVE_GROQ_NLU.md` for the current adaptive Groq setup.

> Historical v8.9.6 behavior: v8.9.7 supersedes the adaptive invocation policy.
> In the current release, `on` is Qwen-first and `off` is deterministic-only.
> See `V897_QWEN_FIRST_DETERMINISTIC_FALLBACK.md`.

## Fixed deterministic failures

This release fixes false high-confidence routes before adding model latency:

- An explicit service in a price question wins over an older cleaning draft.
  Asking for the sofa-cleaning price while a deep-cleaning request is open
  answers the sofa price without silently changing the request.
- Changing service families clears stale scope. A former one-bedroom deep-clean
  description cannot leak into a later sofa-cleaning quote.
- A named deep-cleaning price question stays attached to Deep Home Cleaning and
  cannot fall into the generic hourly-cleaner calculation.
- A fresh exact product request replaces an old family-browse goal. After viewing
  shirts, `I want a bottle` resolves the configured Steel Water Bottle.
- `Are you available in Sharjah?` is a service-area knowledge question, not a
  calendar availability request.
- A full address needs at least two meaningful alphabetic location components;
  numeric noise plus one arbitrary word is not stored.

Qwen should not repair these cases. They contain enough deterministic evidence,
so the correct fix is to remove the wrong high-confidence rule.

## Qwen responsibility

`NOVA_NLU_MODE=off` runs Nova without Qwen. `NOVA_NLU_MODE=on` still runs every
deterministic adapter first and invokes Qwen only for no route, low confidence,
genuinely competing routes, unresolved text after a greeting, or an ambiguous
correction. Qwen returns schema-constrained language interpretation only. Nova
still validates tenant IDs, services, products, dates, hours, fields, prices,
knowledge, permissions, workflow transitions, and every final action.

Examples that can invoke Qwen when mode is `on`:

- `thora adjust kar do na, kal wali request ko` — the correction target is not
  explicit enough for a safe deterministic mutation.
- `kal wali booking thori dair baad kar do, 5 ya 6 jo available ho` — mixed
  correction, alternative times, and an availability condition need structured
  interpretation before Nova asks for clarification or proposes a change.

Clear messages such as `change my booking from 9 AM to 10 AM`, `I want a Steel
Water Bottle`, and `how much is Sofa Cleaning?` remain on the fast deterministic
path and should report `qwen.used=false`.

## Windows PowerShell setup

Requirements: Node.js 20–22 and either Docker Desktop or a local `llama-server`
binary.

```powershell
# Configure the existing project-root .env file first.
npm install
npm run model:qwen:download
docker compose -f docker-compose.qwen.yml up -d
$env:NOVA_QWEN_NLU_TIMEOUT_MS="45000"
npm run model:qwen:check
```

The default model is Qwen3 0.6B Q8 GGUF (about 640 MB), served as
`nova-qwen-nlu` at `http://127.0.0.1:8000/v1`.

After the connection check succeeds:

```powershell
$env:NOVA_NLU_MODE="on"
npm run model:qwen:trace -- "thora adjust kar do na, kal wali request ko"
npm start
```

The trace prints `used`, `validated`, `invocationReason`, `decision`, `model`,
`latencyMs`, the final selected route, and extracted entities. Use it to prove
whether Qwen ran. To trace a different tenant:

```powershell
$env:NOVA_QWEN_TRACE_TENANT="salon-demo"
npm run model:qwen:trace -- "kal wali booking thori dair baad kar do"
```

To return to the fast deterministic-only system:

```powershell
$env:NOVA_NLU_MODE="off"
npm start
```

If port 8000 is already occupied, stop the older Qwen container/process before
starting another. If port 3000 is occupied, stop the older Nova process or set a
different `PORT`. Model timeouts do not authorize fallback actions; Nova keeps
the workflow unchanged and asks for clarification where necessary.

## Release verification

Run:

```powershell
npm run benchmark:v8.9.6
```

This executes the transcript regressions, full automated suite, conversation
corpus, syntax validation, and state-safety audit. It does not require Qwen;
model integration is tested with a schema-valid mock, while the two model check
commands validate the real local server separately.
