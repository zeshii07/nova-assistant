# V16.0 — ML Intent Classifier

## Overview

Nova v16.0 introduces a **multilingual ML intent classifier** that runs alongside the existing regex-based capability router as a hybrid routing signal. This is the first sprint in the architectural roadmap to bring statistical learning into Nova's deterministic core, without sacrificing the deterministic guarantees that the v9.4.1–v15.0 sprints established.

The classifier is **dependency-free** (no `@tensorflow/tfjs`, no `@xenova/transformers`, no Python bridge). It is a hand-rolled TF-IDF + logistic regression ensemble that trains in ~600ms at startup and infers in ~2ms per query.

## Architecture

```
                            ┌──────────────────────────────────────────────┐
                            │             ExecutionEngine                   │
                            │  (packages/execution-engine)                  │
                            └────────────────┬─────────────────────────────┘
                                             │
                            ┌────────────────▼─────────────────────────────┐
                            │          CapabilityRouter                    │
                            │  (packages/capability-engine)                │
                            │                                              │
                            │  ┌────────────────┐  ┌────────────────────┐  │
                            │  │  regex canHandle│  │ MlIntentClassifier │  │
                            │  │  loop (existing)│  │  (NEW v16.0)       │  │
                            │  └────────┬───────┘  └─────────┬──────────┘  │
                            │           │                     │            │
                            │           └──────────┬──────────┘            │
                            │                      ▼                       │
                            │           ┌────────────────────┐             │
                            │           │   HybridRouter     │             │
                            │           │   (combines signals│             │
                            │           │    boost / demote) │             │
                            │           └─────────┬──────────┘             │
                            └─────────────────────┼───────────────────────┘
                                                  ▼
                                       winning capability
```

### Three feature channels

The classifier extracts three independent feature channels from each query and combines them with learned weights:

| Channel | Description | Weight | Captures |
|---------|-------------|--------|----------|
| **WORD** | TF-IDF word unigrams + bigrams | 0.40 | Lexical signal (most discriminative for clean queries) |
| **CHAR** | TF-IDF char 3-grams + 4-grams | 0.20 | Typos, OOV, morphological variants |
| **PROTOTYPE** | Max cosine to training utterances | 0.40 | Word-order-aware semantic similarity (paraphrases) |

After combining channels, a **softmax with temperature 0.10** produces a calibrated probability distribution across all 36 intents. A power transform (`x^0.55`) sharpens the output so confident matches stay above 0.85.

### Intent catalog

The seed catalog (`packages/ml-intent-classifier/src/intentCatalog.js`) defines 36 business intents across 6 capability domains:

- **cleaning** (8 intents): `booking.create`, `booking.modify`, `booking.cancel`, `booking.status`, `cleaning.service_request`, `cleaning.multi_service_request`, `cleaning.scope_info`, `cleaning.service_list`, `service.price`, `service.duration`
- **catalog** (3 intents): `product.list`, `product.info`, `product.price`
- **commerce** (8 intents): `cart.add`, `cart.view`, `cart.update`, `cart.remove`, `order.create`, `order.status`, `order.cancel`, `order.return`, `order.exchange`
- **availability** (1 intent): `availability.check`
- **assistant** (6 intents): `conversation.greeting`, `conversation.thanks`, `conversation.small_talk`, `business.info`, `business.name`, `business.contact`, `business.hours`, `business.location`, `knowledge.question`
- **cross-cutting** (3 intents): `conversation.confirm`, `conversation.reject`, `conversation.correct`

Each intent ships with **8-20 multilingual training utterances** covering English, Roman-Urdu, Urdu-script, and Arabic. Total: 359 seed documents.

### Hybrid routing strategy

The `HybridRouter` combines the regex-based candidate list with the ML prediction using these rules:

| Situation | Action | Adjustment |
|------------|--------|------------|
| Regex confidence ≥ 0.85 | Keep regex winner | ML is informational only |
| Regex confidence < 0.85 AND ML agrees (same capability) | Boost regex confidence | `+0.05 * (ml_conf - 0.5)` |
| Regex confidence < 0.85 AND ML disagrees (different capability, ml_conf > 0.7) | Demote regex confidence | `-0.05 * (ml_conf - 0.7)` |
| No regex candidates AND ML confidence > 0.6 | Record ML hint for execution engine | (logged, not yet auto-routed) |

The adjustments are intentionally small (±0.05) to avoid regressions. They are tunable per-tenant in future sprints.

### Recent-turns bias

The classifier applies a weak prior based on the last 2 conversation turns. If both turns were in the same capability (e.g., `cleaning`), intents belonging to that capability get a +0.03 confidence boost. This helps with conversational follow-ups like "what about for 4 bedrooms?" — the ML classifier is slightly more likely to predict `service.price` (continuing the pricing conversation) instead of `cleaning.service_request`.

### Contextual boost

When the tenant vocabulary matcher (from the existing semantic router) finds a strong product/service match (score ≥ 0.78), the ML classifier boosts the relevant intents by up to +0.05. For example, if the query mentions "Apple Watch" and the tenant has that product, the `product.info` and `product.price` intents get a small boost.

## Files added / modified

### NEW files

| Path | Purpose |
|------|---------|
| `packages/ml-intent-classifier/package.json` | Package manifest |
| `packages/ml-intent-classifier/src/index.js` | Public exports |
| `packages/ml-intent-classifier/src/intentCatalog.js` | 36-intent seed catalog with multilingual examples |
| `packages/ml-intent-classifier/src/featureExtractor.js` | TF-IDF word/char feature extractor |
| `packages/ml-intent-classifier/src/mlIntentClassifier.js` | Main classifier (train + classify) |
| `packages/ml-intent-classifier/src/hybridRouter.js` | Combines regex + ML signals |
| `tests/sprint86.v160-ml-intent-classifier.integration.test.js` | 27 unit tests for the classifier |
| `tests/sprint87.v160-hybrid-routing.integration.test.js` | 19 integration tests for hybrid routing |
| `docs/V160_ML_INTENT_CLASSIFIER.md` | This document |

### MODIFIED files

| Path | Change |
|------|--------|
| `packages/capability-engine/src/capabilityRouter.js` | Added `mlClassifier` + `hybridRouter` injection; runs ML alongside regex; logs `mlTopIntent` / `mlConfidence` / `mlCapabilityId` to routing_trace |
| `apps/api/src/container.js` | Instantiates `MlIntentClassifier` + `HybridRouter`; attaches to `capabilityRouter`; exports to container for testing |

## Performance characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Training time (cold start) | ~600 ms | One-time at container build |
| Inference time (per query) | 1-3 ms typical | Sub-50ms worst case (longest messages) |
| Memory (resident) | ~200 KB | Feature vectors + prototype cache |
| Catalog size | 36 intents, 359 docs | Multilingual seed |
| Vocabulary size | ~5,400 features | Word + char n-grams combined |

## Routing trace logging

The existing `capability.routing_trace` log now includes ML fields:

```json
{
  "message": "capability.routing_trace",
  "text": "how much for 3 bedroom apartment deep cleaning",
  "winner": "cleaning",
  "forced": true,
  "confidence": 1,
  "reason": "cleaning_structured_quote",
  "mlTopIntent": "service.price",
  "mlConfidence": 0.99,
  "mlCapabilityId": "cleaning"
}
```

For non-forced routing, the candidates array now includes `mlAdjusted` and `mlAdjustment` per candidate:

```json
{
  "candidates": [
    {
      "rank": 1,
      "capabilityId": "cleaning",
      "confidence": 0.85,
      "mlAdjusted": true,
      "mlAdjustment": 0.05
    }
  ],
  "hybridAdjustments": 1,
  "mlTopIntent": "service.price",
  "mlConfidence": 0.94
}
```

## Design decisions

### Why not use `@xenova/transformers` or `@tensorflow/tfjs`?

Nova runs in constrained environments (Render free tier, low-RAM VPS). Pulling in a transformer library would:
- Bloat the Docker image by ~500 MB
- Slow cold-start by 5-10 seconds (model loading)
- Require a GPU for reasonable inference latency

A hand-rolled TF-IDF + logistic regression achieves the same multilingual intent classification quality for our 36-intent catalog while remaining <500 lines and ~2 ms inference. The vocabulary size (5,400 features) is small enough that a single Node.js Map lookup is faster than even a quantized transformer's forward pass.

### Why combine THREE channels instead of just word TF-IDF?

- **Word TF-IDF alone** misses typos. "3 bdroom apartment" produces different word features than "3 bedroom apartment".
- **Char n-grams alone** over-match. "cleaning" and "cleansing" share many char n-grams, leading to false positives.
- **Prototype cosine alone** is O(N × M) where N is intent count and M is utterances per intent. Too slow without an index.

The three channels complement each other: word provides precision, char provides recall, prototype provides paraphrase robustness. The weighted sum (0.40, 0.20, 0.40) was tuned empirically on the v9.4.1 + v13.0 stress kit.

### Why is the ML classifier's output a SECOND OPINION and not the primary router?

Nova's deterministic guarantees (verified by 400+ stress-kit queries and 27+ integration test files) depend on the regex-based capability router. The regex router encodes business rules like:
- "3 bdroom" → bedrooms entity (typo tolerance added in v9.4.1)
- "do you provide X" → service_support question (not a booking)
- "deep cleaning" without "charges" → scope_info (not a price quote)

These rules are too domain-specific to encode in a generic ML classifier. By running ML alongside regex and only modulating confidence by ±0.05, we get the best of both worlds: the deterministic guarantees of regex plus the statistical signal of ML for tie-breaking and ambiguity detection.

### Why softmax temperature 0.10 and confidence power 0.55?

Without temperature scaling, softmax on 36 classes tends to be overconfident (top prediction ~0.99 even for ambiguous queries). With temperature 0.10, the distribution is sharper, which is what we want for clean queries.

The power transform `x^0.55` further spreads the output: a softmax probability of 0.7 becomes confidence ~0.83, and 0.4 becomes ~0.61. This makes the confidence threshold (>0.85 = high confidence) more meaningful.

These hyperparameters were tuned on the 11-query smoke test (see commit history). They may need further tuning as the catalog grows.

## What's NOT in v16.0

These are deferred to future sprints:

1. **Product matching with embeddings** (v17.0+): The user's stated next priority. Will use a sentence-embedding model to match user product mentions ("Apple Watch Series 9") to tenant catalog entries, handling brand variants, color synonyms, and partial matches. Will likely require `@xenova/transformers` or a custom embedding cache.

2. **ML classifier as primary router for low-regex-confidence cases**: Currently, when the regex router returns no candidates, the hybrid router logs an `ml_inject_no_regex_candidate` adjustment but doesn't auto-route. A future sprint could enable auto-routing when ML confidence is very high (>0.9).

3. **Online learning**: The classifier trains once at startup. Future sprints could add incremental retraining when the conversation intelligence engine logs a confirmed intent (e.g., when the user accepts a quote, that utterance becomes a positive training example for `service.price`).

4. **Tenant-specific fine-tuning**: Currently all tenants share the same seed catalog. Future sprints could allow per-tenant training examples (e.g., a retail tenant adds "Apple Watch Series 9" as a `product.info` example).

5. **A/B testing**: No mechanism to compare ML-on vs ML-off routing in production. A future sprint could add a feature flag and metrics dashboard.

## Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `sprint86.v160-ml-intent-classifier.integration.test.js` | 27 | Training, predictions (en/ur/ar), typo tolerance, channel scores, performance, immutability |
| `sprint87.v160-hybrid-routing.integration.test.js` | 19 | Container wiring, hybrid router unit tests, end-to-end conversation flows, trace logging, recent-turns bias, performance |

**Combined**: 46 new tests, 0 regressions in the existing sprint1-85 test suite.

## Future: Product matching with embeddings

The user's stated next priority is product matching with embeddings. This will likely live in a new package `packages/product-matcher/` and:
- Use sentence embeddings (probably `all-MiniLM-L6-v2` via `@xenova/transformers`)
- Pre-compute embeddings for all tenant products at startup
- At inference time, embed the user's query and find the top-k similar products via cosine similarity
- Replace the existing `findService` / `findProducts` regex matchers in the cleaning and catalog adapters
- Add a new `product.match` intent to the ML classifier catalog
- Handle brand variants ("iPhone" → "Apple iPhone"), color synonyms ("siyah" → "black"), and partial matches ("watch series 9" → "Apple Watch Series 9")

This is a larger undertaking than v16.0 because it requires:
- Adding `@xenova/transformers` as a dependency
- Pre-computing and caching product embeddings
- Building a vector index (probably brute-force cosine for the first cut, then HNSW if scale demands)
- Wiring the matcher into both the cleaning and catalog adapters

Estimated effort: 2 sprints (v17.0 for the matcher itself, v18.0 for full integration with adapters).
