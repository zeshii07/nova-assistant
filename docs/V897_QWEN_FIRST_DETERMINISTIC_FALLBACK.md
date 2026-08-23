# Nova v8.9.7 — Qwen-first understanding, deterministic execution

> Historical document. Model-first behavior and the local Qwen runtime were
> removed in v8.9.8. Use `V898_ADAPTIVE_GROQ_NLU.md` for current setup.

## Runtime contract

Nova keeps only two public NLU modes:

- `NOVA_NLU_MODE=off`: no model call; the deterministic language and business
  engines handle the entire message.
- `NOVA_NLU_MODE=on`: every message is sent to Qwen first. Qwen returns a
  schema-validated semantic record, then Nova's deterministic adapters select,
  validate, and execute the business workflow.

Qwen is not an autonomous tool-calling agent. It has no tools and receives only
bounded current-tenant vocabulary plus compact workflow context. It may identify
multiple intents, a correction, a workflow interrupt, language, service/product
names, customer fields, and scheduling text. It cannot decide prices, policies,
stock, opening hours, availability, permissions, tenant access, or the success of
an action.

The deterministic engine independently produces capability candidates. A valid,
high-confidence Qwen interpretation may choose the semantically aligned candidate
instead of an unrelated keyword match. Transactional routes still require a real
deterministic candidate or may only open an unconfirmed booking draft. Final
confirmation, cancellation, CRM/order writes, and all business validation remain
inside Nova.

If Qwen fails, times out, returns malformed JSON, or is stopped, Nova uses the
deterministic winner. After one transport failure the client opens a short
15-second circuit by default; messages during that interval skip the unavailable
model immediately instead of waiting for the same timeout repeatedly.

## Start Qwen on Windows without Docker

If the model was downloaded by Nova into the project:

```powershell
cd E:\nova-saas-sprint2
llama-server -m ".model-cache\Qwen3-0.6B-GGUF\Qwen3-0.6B-Q8_0.gguf" `
  --alias nova-qwen-nlu `
  --host 127.0.0.1 `
  --port 8000 `
  --ctx-size 4096 `
  --parallel 1 `
  --chat-template-kwargs '{"enable_thinking":false}'
```

If llama.cpp manages the Hugging Face cache, the equivalent command is:

```powershell
llama-server -hf Qwen/Qwen3-0.6B-GGUF:Q8_0 `
  --alias nova-qwen-nlu `
  --host 127.0.0.1 `
  --port 8000 `
  --ctx-size 4096 `
  --parallel 1 `
  --chat-template-kwargs '{"enable_thinking":false}'
```

Keep that terminal open. In a second PowerShell terminal:

```powershell
cd E:\nova-saas-sprint2
$env:NOVA_QWEN_NLU_BASE_URL="http://127.0.0.1:8000/v1"
$env:NOVA_QWEN_NLU_MODEL="nova-qwen-nlu"
$env:NOVA_QWEN_NLU_TIMEOUT_MS="45000"
npm run model:qwen:check
$env:NOVA_NLU_MODE="on"
npm run model:qwen:trace -- "hello, I need two cleaners tomorrow at 9 AM"
npm start
```

The trace must show `strategy: model_first`, `used: true`,
`invocationReason: model_first`, and `executionAuthority:
nova_deterministic_core`.

To run Nova without Qwen:

```powershell
$env:NOVA_NLU_MODE="off"
npm start
```

## Performance note

Model-first mode adds one local inference to every message. A 0.6B model is the
smallest practical Qwen option in this project, but CPU inference still adds
latency. If a supported GPU is available, add `--n-gpu-layers 99` to the server
command. Deterministic-only mode remains the lowest-latency option.

## Verification

```powershell
npm run benchmark:v8.9.7
```

The benchmark covers every-message invocation, deterministic candidate
alignment, model failure fallback, `off` mode, circuit-breaker behavior, all
existing unit/integration tests, conversation datasets, syntax checks, and state
safety.
