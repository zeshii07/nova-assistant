# Nova v9.4.1 Stress-Test Patch — File Manifest (v4)

## What's new in v4

1. **"do you provide deep cleaning"** — now lists ALL deep cleaning services
   (Deep Home, Move-in/Move-out, Deep Apartment, Deep Villa, Post-renovation)
   instead of a single match.

2. **"do you provide furniture cleaning service"** — now lists ALL furniture
   cleaning services (Sofa, Carpet, Mattress, Dining Chair, Curtain,
   Furniture Package, Office Chair, Table) instead of only "Furniture
   Cleaning Package".

3. **"what type of cleaning you do"** — now routes to the cleaning service
   list (grouped by category with prices) instead of a vague knowledge
   abstention.

4. **"i was looking for a cheap cleaning service for my apartment"** — now
   asks Standard vs Deep (doesn't auto-select Standard). This was already
   fixed in v3 but the user was testing on an unpatched clone.

5. **Move-in/Move-out cleaning** — now uses the same pricing model as Deep
   cleaning (scope_based, bedrooms-based matrix). Updated service definition
   from `priceType: "starting_from"` to `priceType: "scope_based"` with
   `pricingServiceId: "move-in-out-cleaning"` and
   `requiredPricingFields: ["propertyType", "bedrooms"]`. Added CLN006 to the
   `isDeepProperty` and `bookingRequirementState` checks so it asks for
   bedrooms before pricing, just like Deep Apartment/Villa Cleaning.

## Files changed in v4 (over v3)

| File | What changed |
|------|--------------|
| `capabilities/availability/conversation/index.js` | NEW `detectCategoryServices()` async helper — detects category questions ("do you provide furniture/deep/laundry cleaning") and returns ALL services in that category instead of a single best match. |
| `capabilities/assistant/conversation/index.js` | `looksInformational()` now returns `false` for "what type/kind of cleaning" so the cleaning adapter's `service_list` wins over the assistant's `knowledge_question`. |
| `capabilities/cleaning/conversation/index.js` | Extended `cleaning.service_list` regex to match "what type of cleaning", "what kind of cleaning", "what cleaning do you do", "which cleaning". Added `priority:230` so it beats the assistant's knowledge_question (priority 150, confidence 1.0). |
| `capabilities/cleaning/src/index.js` | Added CLN006 (Move-in/Move-out) to `isDeepProperty` array and `bookingRequirementState` so it's treated as a Deep-cleaning-style service (bedrooms-based pricing). |
| `tenants/cleaning-demo/cleaning/services.json` | Updated CLN006 from `priceType: "starting_from"` to `priceType: "scope_based"` with `pricingServiceId: "move-in-out-cleaning"` and `requiredPricingFields: ["propertyType", "bedrooms"]`. |

## All patched files (15)

| File | v1-v3 changes | v4 changes |
|------|---------------|------------|
| `packages/conversation-intelligence/src/fieldAmendmentExtractor.js` | Urdu/Arabic field labels, Unicode boundaries, SOV patterns, action-verb guard | — |
| `packages/conversation-intelligence/src/clauseSemanticEngine.js` | Urdu/Arabic conjunction splitting | — |
| `packages/conversation-intelligence/src/temporalSemanticExtractor.js` | `detectInvalidClock()` | — |
| `packages/conversation-intelligence/src/text.js` | `numberFromText` 1-20 | — |
| `packages/conversation-intelligence/src/acquisitionIntent.js` | Mixed-script support | — |
| `packages/catalog-engine/src/attributeExtractor.js` | COLOR_ALIASES 7→16 | — |
| `packages/universal-vocabulary/src/index.js` | Unicode-aware canonicalize | — |
| `packages/universal-vocabulary/src/vocabulary.json` | 129 Urdu replacements | — |
| `packages/multilingual-nlu/src/nluContextBuilder.js` | `recent_turns[]` | — |
| `packages/execution-engine/src/executionEngine.js` | `recentTurns[]` window | — |
| `capabilities/cleaning/conversation/index.js` | Multi-service extraction + clarification flow | Extended `service_list` regex for "what type of cleaning" |
| `capabilities/cleaning/src/index.js` | Multi-service clarification handler + helpers | Added CLN006 to deep-property checks |
| `capabilities/availability/conversation/index.js` | — | NEW `detectCategoryServices()` for category questions |
| `capabilities/assistant/conversation/index.js` | — | `looksInformational()` excludes "what type of cleaning" |
| `tenants/cleaning-demo/cleaning/services.json` | — | CLN006 Move-in/Move-out → scope_based pricing (same as Deep) |

## How to apply

```bash
cd /path/to/your/nova-assistant
git stash

unzip /path/to/nova-v9.4.1-patches-v4.zip -d /tmp/nova-patch-v4
cp -r /tmp/nova-patch-v4/packages/* packages/
cp -r /tmp/nova-patch-v4/capabilities/* capabilities/
cp -r /tmp/nova-patch-v4/tenants/* tenants/
cp -r /tmp/nova-patch-v4/scripts/* scripts/

npm install
PORT=3000 NOVA_NLU_MODE=off NOVA_SEMANTIC_ROUTER_MODE=on npm start
```

## How to verify

1. `npm run benchmark:v9.4.1` → 9/9 pass.
2. `node scripts/stress-test-harness.js` → 49/49 pass.
3. Spot-check the 5 reported issues:
   - "do you provide deep cleaning" → lists 5 Deep services
   - "do you provide furniture cleaning service" → lists 8 Furniture services
   - "what type of cleaning you do" → shows grouped service list with prices
   - "i was looking for a cheap cleaning service for my apartment" → asks Standard vs Deep
   - "book move in cleaning for my 3 bedroom apartment" → prices at AED 2,609.10 (matrix), asks for date
