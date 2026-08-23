# Nova v8.9.9 — Groq schema compatibility and diagnostics

Nova v8.9.9 corrects the Groq strict structured-output request used by the
adaptive multilingual NLU layer.

## Provider and model naming

`GROQ_API_KEY` selects Groq as the provider. Nova sends requests to:

```text
https://api.groq.com/openai/v1/chat/completions
```

`openai/gpt-oss-20b` is Groq's model identifier for an OpenAI-published
open-weight model served on Groq infrastructure. The `openai/` prefix describes
the model family; it does not route the request to OpenAI.

## Fixed in this release

- Converts Nova's fixed schema version from `const` to a one-value `enum` in
  the provider-facing schema.
- Removes `pattern`, `maxItems`, and `uniqueItems` from the Groq-facing schema.
  Nova's internal validator still enforces its complete validation contract.
- Ensures every Groq strict-mode object is closed with
  `additionalProperties: false` and requires every declared property.
- Uses `max_completion_tokens` instead of the deprecated `max_tokens` field.
- Uses low reasoning effort for the small intent/entity extraction task.
- Prints Groq's safe error message, error type, request ID, configured model,
  and endpoint when a connection check fails.

## Configure and test on Windows PowerShell

In `.env`:

```dotenv
GROQ_API_KEY=gsk_your_key_here
NOVA_NLU_MODE=on
NOVA_GROQ_NLU_BASE_URL=https://api.groq.com/openai/v1
NOVA_GROQ_NLU_MODEL=openai/gpt-oss-20b
NOVA_GROQ_NLU_TIMEOUT_MS=4000
```

Then run:

```powershell
npm run model:groq:check
npm run model:groq:trace -- "hello"
npm run model:groq:trace -- "thora adjust kar do na, kal wali request ko"
npm start
```

Expected routing:

- `hello`: `remoteNlu.used` is `false` because Nova is already confident.
- The ambiguous Roman Urdu change: `remoteNlu.used` and `validated` are `true`.
- `executionAuthority` always remains `nova_deterministic_core`.

If the check still fails, its output now includes the real provider diagnostic.
Do not share the API key; only share the error message, type, and request ID.

## Verification

```powershell
npm run benchmark:v8.9.9
```
