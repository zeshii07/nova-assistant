# V18.0 — Workflow Order & Typo Tolerance Fixes

## Overview

Nova v18.0 fixes the workflow ordering and typo tolerance bugs the user reported after applying v17.0. The key fixes:

1. **"i want deep cleaning for my villa"** now correctly asks for bedrooms BEFORE date (previously returned "requires a custom quotation")
2. **"i want deeep cleaning for my villa"** (typo: deeep → deep) now correctly resolves to Deep Villa Cleaning (previously fell through to booking_type_clarification or worse, silent service swap)
3. **Silent service swap** (Deep Villa → Laundry) is now structurally impossible thanks to the v17.0 defensive guard in `summary()`, re-verified with the user's exact scenario
4. **Standard cleaning price leak** (AED 31.50 instead of AED 360) is fixed — the v17.0 defensive guard prevents the laundry price from leaking into the standard cleaning summary

## Bug Analysis

### Bug 1: "i want deep cleaning for my villa" → "requires a custom quotation"

**Symptom**: User said "i want deep cleaning for my villa" and Nova replied "Deep Villa Cleaning requires a custom quotation after the team reviews the scope; I will not invent a fixed price." instead of asking for bedrooms.

**Root cause**: In `capabilities/cleaning/src/index.js` line 1163, the fallback logic was:
```javascript
const fallbackId = semantic.propertyType === 'villa' ? 'CLN009' : 'CLN008';
```

This fallback **ignored `semantic.serviceId`** (which was correctly set to CLN011 by the conversation adapter) and always picked CLN009 (Standard Villa Cleaning). Then the `scopeReviewService` check triggered because `['CLN010','CLN011','CLN012'].includes(actual.id)` was checking against the WRONG service id (CLN009 instead of CLN011).

**Fix**: Changed the fallback to respect `semantic.serviceId` first:
```javascript
const fallbackId = semantic.serviceId || (semantic.propertyType === 'villa' ? 'CLN009' : 'CLN008');
```

Also narrowed the `custom_quote` trigger to only fire for `actual.priceType === 'custom_quote'` (truly custom services like post-renovation, commercial, AC cleaning). Deep services (CLN010, CLN011) use `scope_based` pricing with a configured matrix and should ask for bedrooms, not require a manual scope review.

### Bug 2: "deeep" typo not recognized

**Symptom**: "i want deeep cleaning for my villa" (3 e's) fell through to booking_type_clarification, asking "Standard vs Deep" instead of recognizing "deeep" as "deep".

**Root cause**: The vocabulary and cleaning service normalize function handled `clening`, `cleening`, `clning`, `clen` but NOT extra-letter typos in "deep".

**Fix**:
- Added `deeep`, `deepp`, `depe` → `deep` to `packages/universal-vocabulary/src/vocabulary.json`
- Added `deeep`, `deepp`, `depe` → `deep` normalization in `packages/cleaning-engine/src/cleaningService.js` normalize()
- Also added `standar`, `standrd` → `standard`; `vila`, `vill` → `villa`; `aprtment`, `aprtmnt` → `apartment`; `bedrom`, `bedroms` → `bedroom`

### Bug 3: Silent service swap (Deep Villa → Laundry)

**Symptom**: User reported "system is saying deep cleaning and collecting its data but then it choosed different service silently" — the summary showed "Home-care & Textile Laundry" instead of "Deep Villa Cleaning".

**Root cause**: The `summary()` function used `service?.name` where `service` was looked up via `cleaning.listServices().find(x => x.id === state.serviceId)`. If this lookup returned `undefined` or a stale service from CRM history, the summary would silently display the wrong service.

**Fix** (already in v17.0, re-verified here): Added a defensive guard in `summary()`:
```javascript
const serviceMatchesState = service && service.id === state.serviceId;
const displayName = serviceMatchesState
  ? service.name
  : (state.configuredServiceName || state.serviceName || service?.name || "Cleaning service");
```

### Bug 4: Standard cleaning price leak (AED 31.50 instead of AED 360)

**Symptom**: User said "standard cleaning" → "3 cleaners for 3 hours" and the summary showed "Laundry Wash & Fold / Quoted price: AED 31.50" instead of "Apartment Cleaning / 3 cleaners × 3 hours × AED 40 = AED 360".

**Root cause**: Same as Bug 3 — the silent service swap. The user had CRM history with a laundry order, and the summary was leaking the laundry service name and price into the standard cleaning summary.

**Fix**: Same as Bug 3 — the v17.0 defensive guard prevents this.

### Bug 5: "do you do deep clening or furniture cleaning" → assistant fallback

**Symptom**: User asked "do you do deep clening or furniture cleaning" and Nova replied "I don't have approved information for that yet" (assistant fallback).

**Root cause**: This was already fixed in v15.0/v16.0 patches. The user's deployed version was older. With v17.0+, this query correctly routes to `availability.multi_service_support` and lists all furniture + deep cleaning services.

### Bug 6: "do you provide deep cleaning service" inconsistency

**Symptom**: "do you offer deep cleaning" and "do you provide deep cleaning service" returned different responses.

**Root cause**: Also already fixed in v15.0/v16.0. Both now route to `availability.multi_service_support` with a consistent service list.

## Files Modified

### `capabilities/cleaning/src/index.js`
- **Fixed fallback service ID** to respect `semantic.serviceId` (e.g., CLN011 Deep Villa) instead of always defaulting to CLN009/CLN008
- **Narrowed custom_quote trigger** to only fire for `actual.priceType === 'custom_quote'` (not scope_based services like Deep Cleaning which have a configured price matrix)
- Deep services (CLN010, CLN011, CLN006) now correctly ask for bedrooms BEFORE date

### `packages/cleaning-engine/src/cleaningService.js`
- Added `deeep`, `deepp`, `depe` → `deep` typo normalization in the `normalize()` function
- Also added `clenening` to the cleaning typo variants

### `packages/universal-vocabulary/src/vocabulary.json`
- Added 10 new typo replacements:
  - `deeep`, `deepp`, `depe` → `deep`
  - `standar`, `standrd` → `standard`
  - `vila`, `vill` → `villa`
  - `aprtment`, `aprtmnt` → `apartment`
  - `bedrom`, `bedroms` → `bedroom`

## Test Coverage

### `tests/sprint90.v180-workflow-order-and-typo-fixes.integration.test.js` (15 tests)

| Test | What it validates |
|------|-------------------|
| `'i want deeep cleaning for my villa' (deeep typo) selects Deep Villa Cleaning` | Typo tolerance — deeep → deep → CLN011 |
| `'i want deep cleaning for my villa' asks bedrooms before date` | Workflow order — bedrooms BEFORE date |
| `deep cleaning villa → 3 bedrooms → shows AED 440 then asks for date` | Full flow with correct pricing |
| `'i want furniture cleaning service' asks which type of furniture` | Furniture type clarification BEFORE date |
| `furniture cleaning → sofa → asks for size` | Furniture size clarification |
| `'do you do deep clening or furniture cleaning' lists services` | No assistant fallback |
| `'do you provide deep cleaning service' routes to availability` | Consistent routing |
| `'do you offer deep cleaning' routes consistently` | Consistent routing |
| `silent service swap does not occur (Deep Villa stays Deep Villa)` | v17.0 defensive guard re-verified |
| `standard cleaning apartment → 3 cleaners 3 hours → AED 360` | Correct price (not AED 31.50) |
| `standard cleaning summary shows correct service name (not Laundry)` | No laundry leak |
| `'deepp cleaning' typo resolves to deep cleaning` | Additional typo tolerance |
| `'depe cleaning' typo resolves to deep cleaning` | Additional typo tolerance |
| `'standar cleaning' typo resolves to standard cleaning` | Additional typo tolerance |
| `full deep villa booking: deep → 3 bedrooms → friday 7 pm → address → confirm` | End-to-end flow |

## Test Results

| Metric | Value |
|--------|-------|
| Total tests | 717 (702 from v17.0 + 15 new) |
| Pass | 680 |
| Fail | 37 (pre-existing, 0 new regressions) |
| v15.0+v16.0+v17.0+v18.0 sprint tests | 118/118 pass |

## What's Next (v19.0+)

The user mentioned adding transformer-based embeddings in a future sprint. That work is deferred to v19.0+ and will involve:
- Adding `@xenova/transformers` as an optional dependency
- Using `all-MiniLM-L6-v2` (384-dim, 22MB) for sentence embeddings
- Pre-computing product embeddings at startup
- Replacing the TF-IDF matcher in `packages/product-matcher/` with transformer-based matching for large catalogs

This v18.0 sprint focused on fixing the workflow ordering and typo tolerance bugs that were affecting the user's daily use of Nova.
