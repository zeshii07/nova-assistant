# V13.0 Architectural Improvements — Routing Inversion, Caching, Trace

**Release**: v13.0
**Date**: 2026-08-30

## Overview

This release implements the top 3 architectural recommendations from the
system audit:

1. **Invert assistant routing** — assistant is now the LAST fallback, not
   the first winner
2. **Request-scoped caching** — listServices() and listProducts() are
   cached per-request to avoid redundant file I/O
3. **Intent trace logging** — every routing decision is logged with the
   full candidate list for debugging

## Changes

### 1. Assistant Routing Inversion

**Problem**: The assistant adapter had confidence 1.0 and priority 150
for `knowledge_question`, making it win over cleaning/catalog/availability
adapters (which typically had confidence ~0.98 and priority 85). This
required 30+ exclusion regexes in `looksInformational()` to prevent
the assistant from stealing turns.

**Fix**: Lowered assistant confidence/priority to be a fallback:
- `knowledge_question`: confidence 1.0→0.5, priority 150→50
- `multi_info_question`: confidence 1.0→0.5, priority 120→50
- `domain_mismatch`: confidence 1.0→0.6, priority 140→60
- `service_area_question`: confidence 1.0→0.6, priority 155→55

**Business identity intents** (name, hours, contact, location, payment,
returns, delivery, FAQ) are still given high confidence (0.95) and
priority (120) so they win over domain capabilities but NOT over safety
guardrails (220+).

**Safety guardrails** (data_access_denied at 220, refund at 210) remain
at confidence 1.0 — these must always win.

**Files changed**:
- `capabilities/assistant/conversation/index.js`

### 2. Request-Scoped Caching

**Problem**: Every message triggers 9 conversation adapters, each of
which may call `listServices()` or `listProducts()` (file I/O). For a
single message, the same services/products are loaded 3-5 times.

**Fix**: Wrapped the `this.services` object with a Proxy that caches
`listServices()` and `listProducts()` results in a per-request `Map`.
The cache is created at the start of `process()` and discarded after
the message is processed. The Proxy intercepts property access for
`cleaningService` and `catalogService` and returns cached versions.

**Files changed**:
- `packages/execution-engine/src/executionEngine.js`

### 3. Intent Trace Logging

**Problem**: When a conversation goes wrong, there's no way to see WHY
a particular capability won. The only debugging tool was manual curl
testing.

**Fix**: Added `capability.routing_trace` log entry in
`CapabilityRouter.resolve()` that logs:
- The message text (truncated to 80 chars)
- The winning capability ID
- Whether the routing was forced (by conversation intelligence)
- The full candidate list (top 5) with confidence, priority, reason

**Example log output**:
```json
{
  "message": "capability.routing_trace",
  "text": "how much for deep cleaning",
  "winner": "cleaning",
  "forced": true,
  "confidence": 1,
  "reason": "explicit_cleaning_service_price_question"
}
```

**Files changed**:
- `packages/capability-engine/src/capabilityRouter.js`

### 4. Business Identity Guard in Cleaning Adapter

Added `isBusinessIdentityQuestion` guard in the cleaning adapter's
bare-service-mention → quote path. When the user asks about business
name, hours, contact, etc., the cleaning adapter skips the quote path
and lets the assistant adapter handle it.

**Files changed**:
- `capabilities/cleaning/conversation/index.js`

## Verification

### Stress Test Results (400 queries)

| Tenant | Before | After |
|--------|--------|-------|
| Cleaning | 197/200 (98.5%) | 197/200 (98.5%) |
| Retail | 196/200 (98.0%) | 196/200 (98.0%) |
| **Total** | **393/400 (98.25%)** | **393/400 (98.25%)** |

Same pass rate — the routing inversion didn't break any previously
passing queries. The same 7 edge-case failures remain (all acceptable:
missing order tracking, missing refund policy, missing shipping system,
pure Urdu for unstocked products).

### Key Queries Verified

| Query | Result |
|-------|--------|
| "do you provide furniture cleaning" | Lists 8 furniture services ✓ |
| "do you provide deep cleaning service" | Lists 5 deep services ✓ |
| "do you clean curtains" | "Yes — Curtain Cleaning" ✓ |
| "what are charges for 3 bdroom apartment deep cleaning" | "AED 350" ✓ |
| "hello" | Greeting ✓ |
| "What is your business name" | SparkleCare ✓ |
| "what are your opening hours" | Hours ✓ |
| "what is your phone number" | Contact ✓ |
| "villa deep cleaning" → "3 bedroom" | "AED 440" ✓ |
| "ok use" (saved details) | Accepts saved details ✓ |
