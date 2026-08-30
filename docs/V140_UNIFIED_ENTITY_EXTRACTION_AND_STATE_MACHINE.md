# V14.0 Unified Entity Extraction & State Machine

**Release**: v14.0
**Date**: 2026-08-30

## Overview

Implements recommendations #4 (Unified Entity Extraction Layer) and #5
(State Machine with Schema Validation) from the architectural audit.

## New Packages

### `packages/entity-extraction/` — Unified Entity Extraction Layer

Consolidates entity extraction from 6+ scattered extractors into ONE
canonical `EntityModel`. All capabilities can now consume the same entity
output instead of each running their own regex patterns.

**Before** (6 separate extractors, each with its own regex):
```
message → temporalSemanticExtractor → { date, time, duration }
message → extractCleaningContext()  → { bedrooms, balconies, washrooms }
message → attributeExtractor        → { color, size, quantity }
message → multiProductExtractor     → { items[] }
message → fieldAmendmentExtractor   → { field, rawValue }
message → acquisitionIntent         → { requested, kind }
```

**After** (one unified extraction pass):
```
message → extractEntities() → EntityModel {
  temporal: { date, time, duration, weekday, timeWindow, invalidTime },
  property: { bedrooms, propertyType, washrooms, balconies, units, cleaningType, cleanerCount },
  fieldAmendment: { field, rawValue, action },
  acquisition: { requested, kind, isService, isProduct },
  identity: { name, phone, email, address },
  serviceSupport: { isSupportQuestion, category },
  businessIdentity: { isBusinessIdentity, facet },
  isPricingQuestion, isBookingAction, isListRequest, isCancelAction
}
```

The `EntityModel` is frozen (immutable) and available to all capabilities
via `context.entities` (stored in state.context.entities).

### `packages/state-machine/` — Typed State Machine

Replaces the flat JSON state blob with a typed state machine that:

1. **Deep-merges** state patches instead of shallow merging
   - Before: `{ ...state.capabilityState, ...patch.capabilityState }` — nested objects get overwritten
   - After: `deepMerge(state.capabilityState, patch.capabilityState)` — nested objects are recursively merged

2. **Validates** state shape against `STATE_SCHEMA`
   - Checks required fields, types, and enum values
   - Logs warnings (not errors — backward compatible)

3. **Guards transitions** between modes
   - `TRANSITIONS` map defines valid mode transitions (chatting → collecting → reviewing → confirmed)
   - Invalid transitions are logged as warnings

4. **Supports rollback** when a capability handler throws
   - `snapshotState()` creates a deep clone before processing
   - `rollbackState()` restores from snapshot, preserving durable data

## Wiring in ExecutionEngine

The execution engine now:
1. Calls `extractEntities(message.text)` at the start of `process()`
2. Logs the extracted entities at debug level
3. Uses `stateMachine.deepMerge()` for state patches in `#finalize()`
4. Uses `stateMachine.applyStatePatch()` with validation
5. Uses `stateMachine.snapshotState()` for the `stateBefore` snapshot
6. Stores the entity model in `state.context.entities` for future use

## Verification

### Stress Test Results (400 queries)

| Tenant | v13.0 | v14.0 |
|--------|-------|-------|
| Cleaning | 197/200 (98.5%) | 197/200 (98.5%) |
| Retail | 196/200 (98.0%) | 196/200 (98.0%) |
| **Total** | **393/400 (98.25%)** | **393/400 (98.25%)** |

Same pass rate — the new systems are backward compatible.

### Entity Extraction Test

```js
extractEntities('how much for deep cleaning a 3 bedroom apartment')
// → {
//   temporal: { date: null, time: null, durationHours: null },
//   property: { bedrooms: 3, propertyType: 'apartment', cleaningType: 'deep' },
//   isPricingQuestion: true,
//   serviceSupport: { isSupportQuestion: false },
//   businessIdentity: { isBusinessIdentity: false }
// }
```

### State Machine Test

```js
const state = createInitialState({ tenantId: 'test', ... });
const patch = { capabilityState: { cleaning: { step: 'date' } } };
const newState = applyStatePatch(state, patch);
// → newState.capabilityState.cleaning.step === 'date' (deep merged)
// → Validation: { valid: true, warnings: [] }
```

## Files Changed

| File | Change |
|------|--------|
| `packages/entity-extraction/src/unifiedEntityExtractor.js` | NEW — unified entity extraction |
| `packages/entity-extraction/src/index.js` | NEW — barrel export |
| `packages/entity-extraction/package.json` | NEW — package definition |
| `packages/state-machine/src/stateMachine.js` | NEW — typed state machine with deep-merge |
| `packages/state-machine/src/index.js` | NEW — barrel export |
| `packages/state-machine/package.json` | NEW — package definition |
| `packages/execution-engine/src/executionEngine.js` | Wired in entity extraction + state machine |
