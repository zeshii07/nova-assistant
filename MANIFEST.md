# Nova v11.6 Patch — File Manifest

## What's new in v11.6

1. **Bedroom typo tolerance** — "3 bdroom" (missing 'e') now recognized.
2. **Quote follow-up context** — "3 bedroom" after a pricing question
   correctly completes the quote (AED 440 for Deep Villa) instead of
   losing context to the assistant fallback.
3. **Bare service mention → quote** — "villa deep cleaning" (no pricing
   keyword, no booking action) now shows the price and asks whether to
   book, instead of auto-starting a booking workflow.

## All patches in this release (v11.0 → v11.6)

| Patch | Doc | Summary |
|-------|-----|---------|
| v11.0 | `docs/V110_MULTILINGUAL_AND_CONTEXT_PATCHES.md` | Urdu/Arabic field labels, Unicode canonicalize, color aliases, conversation memory window |
| v11.2 | `docs/V112_MULTI_SERVICE_EXTRACTION.md` | Multi-service extraction from compound messages |
| v11.3 | `docs/V113_MULTI_SERVICE_SCOPE_CLARIFICATION.md` | Ask scope (Std/Deep, bedrooms, seater) BEFORE pricing |
| v11.4 | `docs/V114_CATEGORY_DETECTION_AND_MOVE_IN_PRICING.md` | Category detection, Move-in/Move-out = Deep pricing |
| v11.5 | `docs/V115_QUOTE_ONLY_PRICING_AND_SERVICE_MATCHING.md` | Quote-only pricing flow, office chair fix, carpet metres prompt |
| v11.6 | `docs/V116_QUOTE_FOLLOWUP_AND_BEDROOM_TYPO_FIXES.md` | Bedroom typo tolerance, quote follow-up context, bare service mention → quote |

## All patched files (15 source + 6 docs + README + package.json)

### Source files
1. `packages/conversation-intelligence/src/fieldAmendmentExtractor.js`
2. `packages/conversation-intelligence/src/clauseSemanticEngine.js`
3. `packages/conversation-intelligence/src/temporalSemanticExtractor.js`
4. `packages/conversation-intelligence/src/text.js`
5. `packages/conversation-intelligence/src/acquisitionIntent.js`
6. `packages/catalog-engine/src/attributeExtractor.js`
7. `packages/universal-vocabulary/src/index.js`
8. `packages/universal-vocabulary/src/vocabulary.json`
9. `packages/multilingual-nlu/src/nluContextBuilder.js`
10. `packages/execution-engine/src/executionEngine.js`
11. `capabilities/cleaning/conversation/index.js`
12. `capabilities/cleaning/src/index.js`
13. `capabilities/availability/conversation/index.js`
14. `capabilities/assistant/conversation/index.js`
15. `tenants/cleaning-demo/cleaning/services.json`

### Documentation
- `docs/V110_MULTILINGUAL_AND_CONTEXT_PATCHES.md`
- `docs/V112_MULTI_SERVICE_EXTRACTION.md`
- `docs/V113_MULTI_SERVICE_SCOPE_CLARIFICATION.md`
- `docs/V114_CATEGORY_DETECTION_AND_MOVE_IN_PRICING.md`
- `docs/V115_QUOTE_ONLY_PRICING_AND_SERVICE_MATCHING.md`
- `docs/V116_QUOTE_FOLLOWUP_AND_BEDROOM_TYPO_FIXES.md`

### Updated files
- `README.md` (updated with v11.6 release notes)
- `package.json` (version bumped to 11.6.0)

## How to apply

```bash
cd /path/to/your/nova-assistant
git stash

unzip /path/to/nova-v11.6-patches.zip -d /tmp/nova-patch-v6
cp -r /tmp/nova-patch-v6/packages/* packages/
cp -r /tmp/nova-patch-v6/capabilities/* capabilities/
cp -r /tmp/nova-patch-v6/tenants/* tenants/
cp -r /tmp/nova-patch-v6/docs/* docs/
cp /tmp/nova-patch-v6/README.md .
cp /tmp/nova-patch-v6/package.json .
cp -r /tmp/nova-patch-v6/scripts/* scripts/

npm install
PORT=3000 NOVA_NLU_MODE=off NOVA_SEMANTIC_ROUTER_MODE=on npm start
```

## How to verify

1. `npm run benchmark:v9.4.1` → 9/9 pass
2. Spot-check the key fixes:
   - "hello what are charges for 3 bdroom apartment deep cleaning" → "AED 350"
   - "villa deep cleaning" → "tell me the bedroom count"
   - "3 bedroom" (follow-up) → "AED 440. Would you like me to start a booking?"
   - "do you provide deep cleaning for villa" → lists 5 Deep services
