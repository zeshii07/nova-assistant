# Nova v8.9.13 Stress Stability

Version: `8.9.13-alpha.1`

This release converts the supplied retail and cleaning stress transcripts into
deterministic regression coverage. Groq remains an optional language interpreter;
it never owns business execution, pricing, tenant data, CRM writes, cart changes,
or booking confirmation.

## Root causes found

The v8.9.12 check output mixed genuine conversation defects with two test-environment
problems:

- the developer `.env` enabled Groq during automated tests, so parallel tests made
  live requests and received HTTP 429 responses;
- parallel Node test workers reused one `.nova-data` directory on Windows, causing
  concurrent temporary-file renames to fail with `EPERM`;
- cart-view, removal, exchange, and review-confirmation commands could lose ownership
  to a pending product attribute or checkout field;
- product variants were stored at product level instead of being reliably anchored
  to individual draft lines;
- plural multi-word catalog names such as `cotton t-shirts` could collapse to the
  ambiguous family word `shirt`;
- cleaning service selection did not consistently respect negation, contrast,
  post-renovation scope, or the difference between home, apartment and villa deep
  cleaning;
- an hourly pricing rule shared by several operational cleaning services could be
  rejected as an operational-service ID conflict;
- cancellation evidence could be confused with an arrival policy that merely used
  the words `cancellation fee`;
- a failed remote-NLU arbitration could either suppress a valid pending workflow or
  allow a weak greeting match to answer unrelated content.

## Runtime fixes

### Commerce

- Cart commands execute before pending variant collection.
- Multi-action messages can add/configure products and show the resulting cart in
  one turn.
- Several variants of the same product retain independent size/color anchors.
- A single amendment can change both size and color.
- `ok` can advance a final review; product/order interruptions preserve checkout.
- Order history no longer destroys the active review state.
- Return and exchange requests revise the stored tenant/customer order instead of
  opening catalog browsing.
- Plural forms work for full multi-word product identities.

### Cleaning

- Negated or contrasted language uses the final intended service, for example
  `not deep cleaning but standard home cleaning`.
- `post-renovation` selects its custom-quotation service instead of a bedroom-only
  deep-villa matrix.
- `house deep cleaning` maps to Deep Home Cleaning; an explicit villa or apartment
  maps to its property-specific pricing service.
- Standard cleaning remains AED 40 per hour per cleaner and can share that pricing
  rule across apartment, villa, office and other operational service identities.
- Exact sofa units are retained when a quotation becomes a booking request.
- Compound price questions retain every service and keep exact-price and custom-
  quotation lines separate.
- Flexible-time spelling variants such as `jis time team avaialable ho` are accepted
  without bypassing deterministic scheduling validation.

### Knowledge and NLU fallback

- Policy evidence must match the actual policy topic. An arrival-window statement
  is not accepted as an ordinary cancellation rule.
- Higher-priority tenant knowledge can refine a broad packaged fact, while lower-
  priority stale documents cannot replace higher-priority structured truth.
- The demo does not invent an exact cancellation/rescheduling fee. Upload an
  approved tenant policy to answer those questions; otherwise Nova safely asks the
  business team to confirm.
- Canonical knowledge queries are used after typo-tolerant intent recognition.
- On remote timeout/rate-limit, a strong deterministic workflow owner continues.
  A weak or absent deterministic route still asks for clarification.

## Test isolation

`tests/test-env.js` now overrides external provider mode and creates unique local,
knowledge and operational data roots for every process/worker. This is deliberate:
unit/integration tests must not spend Groq quota and must not share mutable JSON
files. Provider integration is tested with mocked HTTP contracts and can be checked
manually with `npm run model:groq:check`.

## Verification

Run on PowerShell or a normal terminal:

```powershell
npm test
npm run test:conversations
npm run check
node scripts/audit-state-safety.js
npm run benchmark:v8.9.13
```

Acceptance baseline for this release:

- 473 automated tests;
- 156 conversation-dataset cases;
- 17 new transcript-derived stress regressions;
- 293 JavaScript files syntax-checked;
- state-safety audit clean;
- the complete automated suite also passes when the parent shell sets
  `NOVA_NLU_MODE=on`, a Groq key, and a shared `NOVA_LOCAL_DATA_DIR`.

Live calendar availability remains intentionally unimplemented. Nova records a
requested slot and makes no final availability promise until the future calendar
adapter confirms it.
