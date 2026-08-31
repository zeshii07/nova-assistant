# V20.0 — Multilingual Transformer Embeddings + Multi-Item Furniture Detection

## Overview

Nova v20.0 delivers two major improvements:

1. **Multilingual Transformer Embeddings** — adds `paraphrase-multilingual-MiniLM-L12-v2` (384-dim, 60MB) for better Roman-Urdu, Urdu-script, and Arabic semantic matching. The service automatically detects the query language and routes to the appropriate model.

2. **Multi-Item Furniture Detection** — fixes the user-reported bug where "2 sofa 3 seater and 1 king mattress" was reduced to a single sofa. The new `detectMultiItemFurniture()` function parses per-item quantities (2 sofas) and variants (3-seater, king) and produces a multi-service quote with correct per-item pricing.

## Part 1: Multilingual Transformer Embeddings

### Architecture

```
┌──────────────────────────────────────────────────────┐
│              TransformerEmbeddingService              │
│                                                       │
│  ┌─────────────────┐  ┌────────────────────────┐    │
│  │ English Model   │  │ Multilingual Model     │    │
│  │ all-MiniLM-L6-v2│  │ paraphrase-multilingual│    │
│  │ 384-dim, 22MB   │  │ -MiniLM-L12-v2         │    │
│  │ 7ms inference    │  │ 384-dim, 60MB          │    │
│  │                 │  │ 15ms inference         │    │
│  └────────┬────────┘  └───────────┬────────────┘    │
│           │                       │                  │
│           │   _needsMultilingualModel(text)         │
│           │   ┌─────────────────────────────┐       │
│           │   │ Urdu-script? → multi        │       │
│           │   │ Arabic? → multi             │       │
│           │   │ Roman-Urdu tokens? → multi  │       │
│           │   │ Otherwise → en              │       │
│           │   └─────────────────────────────┘       │
│           │                       │                  │
│           ▼                       ▼                  │
│      embed(text) → 384-dim Float32Array              │
└──────────────────────────────────────────────────────┘
```

### Language Detection

The `_needsMultilingualModel(text)` function detects:

| Pattern | Example | Routes to |
|---------|---------|-----------|
| Urdu-script (Arabic block `\u0600-\u06ff`) | `مجھے گھر کی صفائی چاہیے` | Multilingual |
| Arabic | `أريد تنظيف المنزل` | Multilingual |
| Roman-Urdu tokens | `mujhy ghar ki safai chahiye` | Multilingual |
| Pure English | `i want deep cleaning for my villa` | English |

### Lazy Loading

The multilingual model is **NOT loaded at startup** — it loads lazily on the first multilingual query. This avoids 60MB memory overhead when only English queries are used.

```javascript
// At startup: only English model loaded (22MB)
const svc = new TransformerEmbeddingService({ enableMultilingual: true });
await svc.isAvailable();
// svc.englishExtractor = ready
// svc.multilingualExtractor = null (not loaded yet)

// First Roman-Urdu query triggers lazy load
const emb = await svc.embed("mujhy ghar ki safai chahiye");
// svc.multilingualExtractor = loaded (60MB)
```

### Cross-Lingual Matching Results

| Query (non-English) | English Target | English Model Cosine | Multilingual Model Cosine | Improvement |
|---------------------|----------------|----------------------|---------------------------|-------------|
| `مجھے گھر کی صفائی چاہیے` (Urdu-script) | "i want home cleaning" | 0.04 | **0.41** | 10x better |
| `أريد تنظيف المنزل` (Arabic) | "i want home cleaning" | 0.05 | **0.42** | 8x better |
| `mujhy ghar ki safai chahiye` (Roman-Urdu) | "i want home cleaning" | 0.12 | **0.15** | 25% better |

### Force Model Override

Callers can override language detection:

```javascript
// Force English model (even for Urdu queries)
const emb1 = await svc.embed("صوفہ کلیننگ", { forceModel: 'en' });

// Force multilingual model (even for English queries)
const emb2 = await svc.embed("sofa cleaning", { forceModel: 'multi' });

// Index catalog with multilingual model (for tenants with non-English aliases)
await svc.indexTenant('cleaning-demo:cleaning', services, { forceModel: 'multi' });
```

## Part 2: Multi-Item Furniture Detection

### Bug Description

User reported:
> "system is unable to understand more thn one furniture type cleaning in sme request"

Example:
- **User**: "i want furniture cleaning service for 2 sofa having 3 setas and a king size mattress what are you charges"
- **Old Nova**: "Sure 😊 Cleaning a 3-seater sofa costs AED 110." (only 1 sofa, mattress dropped)
- **New Nova**: Shows both items: "3-seater sofa costs AED 220 × 2" + "Mattress Cleaning costs AED 200" = Total AED 420

### Root Cause

The existing `detectMultiServiceMatches()` function splits on conjunctions and calls `findService()` on each segment. But for furniture queries:
1. Segment 1 ("2 sofa having 3 setas") matched the umbrella "Furniture Cleaning" service (CLN023) instead of "Sofa Cleaning" (CLN003) because "furniture cleaning service" is an exact alias of CLN023.
2. Segment 2 ("a king size mattress") matched "Mattress Cleaning" with score 20, below the threshold of 35.
3. The `units` field was set to 3 (from "3 seater") instead of 2 (number of sofas).

### Fix: New `detectMultiItemFurniture()` Function

A dedicated furniture item detector that:
1. Matches furniture head words (sofa, couch, carpet, rug, mattress, curtain, chair, table)
2. Parses the preceding quantity ("2 sofa" → quantity=2, "two sofas" → quantity=2)
3. Parses the variant ("3-seater", "king", "queen", "5 metre")
4. Returns an array of `{ serviceId, serviceName, quantity, variant }` items

### Per-Item Quote Engine

The `cleaning.multi_service_quote_request` handler now:
1. Passes per-item `quantity` and `variant` to the quote engine
2. Extracts the size from the variant (e.g., "3-seater" → units=3 for sofa pricing)
3. Multiplies the per-item price by quantity (2 sofas × AED 110 = AED 220)
4. Sums all items into a total (AED 220 + AED 200 = AED 420)

### "Book the Service" Fix

The `quoteAcceptance` regex was extended to recognize:
- "ok book the service"
- "yes book"
- "book now"
- "book the services"

When `quotedServices` exists in state, these phrases now correctly route to `cleaning.quote_bundle_accept` instead of starting a new Standard Cleaning booking.

## Files Modified

### `packages/transformer-embeddings/src/transformerEmbeddingService.js`
- Added `enableMultilingual` option (default: true)
- Added `_needsMultilingualModel()` language detection
- Added `_ensureMultilingualLoaded()` lazy loading
- `embed()` now auto-routes to multilingual model for non-English queries
- `match()` returns `queryModel` and `indexModel` for debugging
- Added `isMultilingualAvailable()` method
- Added `forceModel` option for explicit model selection

### `capabilities/cleaning/conversation/index.js`
- Added `detectMultiItemFurniture()` function (95 lines)
- Added multi-item detection in the `structuredQuote` block (before segment-based detection)
- Extended `quoteAcceptance` regex to recognize "ok book the service", "yes book", "book now"
- Added typo tolerance: "setas"/"seta" → "seater", "sitr"/"sitar" → "seater"

### `capabilities/cleaning/src/index.js`
- `cleaning.multi_service_quote_request` handler now passes per-item quantity and variant to the quote engine
- Per-item quantity multiplication (2 sofas × AED 110 = AED 220)
- Quote line now shows "× N" for quantities > 1

## Test Coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `sprint93.v200-multilingual-embeddings.integration.test.js` | 22 | Language detection, multilingual availability, multilingual embedding, cross-lingual matching (Urdu/Arabic better than English), match routing, force model override, lazy loading, graceful fallback, configuration, multilingual indexing |
| `sprint94.v200-multi-item-detection.integration.test.js` | 11 | Multi-item quote, per-item quantity multiplication, typo tolerance (setas→seater), book the service after quote, book these services, variant detection, word quantities (two→2), full booking flow |

**Combined**: 33 new tests, all pass.

## Test Results

| Metric | Value |
|--------|-------|
| Total tests | 793 (760 v19.0 + 33 new) |
| Pass | 756 |
| Fail | 37 (pre-existing, 0 new regressions) |
| v15.0+v16.0+v17.0+v18.0+v19.0+v20.0 sprint tests | 194/194 pass |

## Installation

The `paraphrase-multilingual-MiniLM-L12-v2` model downloads automatically (~60MB) on the first multilingual query. No manual installation required — just ensure `@xenova/transformers` is installed:

```bash
npm install @xenova/transformers
```

## Performance

| Model | Size | Cold Start | Warm Inference | Memory |
|-------|------|------------|----------------|--------|
| all-MiniLM-L6-v2 (English) | 22MB | ~3s | 5-15ms | ~50MB |
| paraphrase-multilingual-MiniLM-L12-v2 | 60MB | ~5s | 10-20ms | ~60MB |
| Both models | 82MB | ~8s total | 5-20ms | ~110MB |

The multilingual model is loaded lazily — only when the first non-English query is received. This means tenants with English-only traffic pay zero multilingual overhead.
