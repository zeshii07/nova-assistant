# V15.0 Conversation Memory for Deterministic Core

**Release**: v15.0
**Date**: 2026-08-30

## Overview

Implements recommendation #6 (Conversation Memory for Deterministic Core)
from the architectural audit. The deterministic core can now resolve
contextual references like "book it again", "same time as last week",
and "use the same address" using three layers of memory.

Also includes `sprint85` benchmark test suite with 21 automated tests
covering conversation memory, entity extraction, state machine, and
full conversation flows.

## New Package: `packages/conversation-memory/`

### Three Memory Layers

**1. Short-Term (Working Memory)**
- Last 6 turns with text, capability, intent, and entity snapshot
- PII (name, phone, email, address) is explicitly excluded from entity snapshots
- Used for pronoun resolution and context continuity
- Stored in `state.context.recentTurns[]`

**2. Medium-Term (Session Summary)**
- When short-term exceeds 8 turns, older turns are compressed into a summary string
- Summary includes capability, intent, and truncated text for each turn
- Capped at 1000 characters
- Stored in `state.context.sessionSummary`

**3. Long-Term (CRM-Linked)**
- Past orders, bookings, and customer preferences from CRM
- Already existed in CRM but now made accessible to the routing layer
- Used for "same address" resolution (looks up `customer.customFields.primaryAddress`)

### Context Resolution API

The `resolve()` method detects contextual references:

| Phrase | Detected | Resolved |
|-------|----------|----------|
| "book it again" | `wantsRepeat: true` | `lastBookingCapability` from recent turns |
| "same time as last week" | `wantsSameTime: true` | `lastBookingTime` from entity snapshot |
| "use the same address" | `wantsSameAddress: true` | `lastAddress` from CRM |
| "change that to deep cleaning" | `wantsChange: true` | `referencedService` from last turn |

### PII Protection

Entity snapshots stored in memory are sanitized:
- `identity` (name, phone, email, address) is stripped before storage
- Only `temporal`, `property`, `acquisition`, `serviceSupport`, `businessIdentity` are kept
- The raw message text is stored (already shown to the user) but PII entities are not

## New Benchmark Test: `tests/sprint85.v150-conversation-memory-entity-state.integration.test.js`

21 automated tests covering:

### Conversation Memory Tests (8 tests)
- Recent turns stored with entity snapshots
- "book it again" reference detection
- "same address" reference detection
- PII excluded from entity snapshots
- Session summary activates after threshold
- "same time" reference resolution
- "change that" reference resolution
- Context summary is human-readable

### Entity Extraction Tests (6 tests)
- Temporal entities (date, time, duration)
- Property entities (bedrooms, propertyType, cleaningType)
- Pricing question detection
- Service support question detection
- Business identity question detection
- Booking action detection

### State Machine Tests (4 tests)
- Deep-merge of nested objects
- State schema validation
- Transition guards (chatting → collecting → reviewing → confirmed)
- Snapshot and rollback

### Integration Tests (3 tests)
- Intent trace logging
- Full cleaning booking flow (5 turns: book → address → name → phone → confirm)
- Full retail checkout flow with saved details (2 orders: create → reuse saved → confirm)

## Wiring in ExecutionEngine

1. `ConversationMemoryEngine` instantiated in constructor
2. `resolve()` called at start of `process()` — detects references before routing
3. `addTurn()` called in `#finalize()` — stores turn with sanitized entities
4. `memoryContext` stored in `state.context.memoryContext` for debugging
5. `sessionSummary` stored in `state.context.sessionSummary` for long conversations
6. Reference resolution logged at info level when detected

## Verification

### Benchmark Test Results
```
✔ 21 tests pass (0 fail)
✔ Duration: 8.2 seconds
```

### Stress Test Results (400 queries)

| Tenant | v14.0 | v15.0 |
|--------|-------|-------|
| Cleaning | 197/200 (98.5%) | 197/200 (98.5%) |
| Retail | 196/200 (98.0%) | 196/200 (98.0%) |
| **Total** | **393/400 (98.25%)** | **393/400 (98.25%)** |

Same pass rate — conversation memory is backward compatible.

### Memory Resolution Test

```
"book it again" → wantsRepeat: true, lastBookingCapability: cleaning ✓
"use the same address" → wantsSameAddress: true ✓
"same time as last booking" → wantsSameTime: true, lastBookingTime: 10:00 ✓
"change that to deep cleaning" → wantsChange: true, referencedService: standard ✓
```

## Files Changed

| File | Change |
|------|--------|
| `packages/conversation-memory/src/conversationMemoryEngine.js` | NEW — conversation memory engine |
| `packages/conversation-memory/src/index.js` | NEW — barrel export |
| `packages/conversation-memory/package.json` | NEW — package definition |
| `packages/execution-engine/src/executionEngine.js` | Wired in memory engine (resolve + addTurn) |
| `tests/sprint85.v150-conversation-memory-entity-state.integration.test.js` | NEW — 21 benchmark tests |

## How to Run the Benchmark

```bash
npm test -- --test tests/sprint85.v150-conversation-memory-entity-state.integration.test.js
```

Or add to `package.json` scripts:
```json
"benchmark:v15.0": "node --require ./tests/test-env.js --test tests/sprint85.v150-conversation-memory-entity-state.integration.test.js"
```
