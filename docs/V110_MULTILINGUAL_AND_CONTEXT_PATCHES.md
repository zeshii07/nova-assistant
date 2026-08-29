# V11.0 Multilingual & Context Patches

**Release**: v11.0 (initial patch over Nova v9.4.1)
**Date**: 2026-08-29
**Sprint**: v11.0

## Problem

The Nova v9.4.1 stress-test kit exposed 6 concrete failures when
exercising the HTTP API end-to-end (39 scenarios across sections A–N):

1. **B11** — "mattress prices for crib, single, queen, king" started a
   booking for `king` instead of listing all 4 prices.
2. **C06** — impossible clock time `25:90` was silently skipped.
3. **H05** — pure Urdu product request "مجھے ایک سیاہ رنگ کی سمارٹ واچ
   چاہیے" fell through to the assistant fallback.
4. **Urdu field labels** — "میرا نام علی بدل دو" not recognized.
5. **Urdu clause splitting** — compound Urdu sentences not split into
   clauses.
6. **Color/size aliases** — only 7 colors, no Urdu/Arabic aliases.

## Changes (12 files)

### Multilingual NLU

| File | What changed |
|------|--------------|
| `packages/conversation-intelligence/src/fieldAmendmentExtractor.js` | Urdu/Arabic field labels (نام، فون، ای میل، ایڈریس، شہر، نشانی، ادائیگی). Unicode-aware boundaries `(?<![\p{L}\p{N}_])`. SOV correction patterns with/without `mera` prefix. Action-verb guard. |
| `packages/conversation-intelligence/src/clauseSemanticEngine.js` | Urdu/Arabic conjunction splitting (اور، لیکن، مگر، پر،کیونکہ، لہذا، اگر). |
| `packages/conversation-intelligence/src/temporalSemanticExtractor.js` | `detectInvalidClock()` surfaces `25:90`, `30 am`, etc. |
| `packages/conversation-intelligence/src/text.js` | `numberFromText` extended to 1–20 (English, Roman-Urdu, Urdu-script). |
| `packages/conversation-intelligence/src/acquisitionIntent.js` | Mixed-script support; raw fallback for Urdu regex. |
| `packages/catalog-engine/src/attributeExtractor.js` | `COLOR_ALIASES` 7→16 colors with Urdu/Arabic aliases. `SIZE_ALIASES` extended. |
| `packages/universal-vocabulary/src/index.js` | `canonicalize()` uses Unicode-aware lookarounds instead of ASCII `\b`. |
| `packages/universal-vocabulary/src/vocabulary.json` | 66 Urdu canonical replacements (smart watch, polo shirt, colors, pronouns). |
| `packages/multilingual-nlu/src/nluContextBuilder.js` | `recent_turns[]` field added to Groq context (last 6 turns, PII-excluded). |
| `packages/execution-engine/src/executionEngine.js` | `state.context.recentTurns[]` conversation memory window (capped at 6, cleared on reset). |

### Cleaning capability

| File | What changed |
|------|--------------|
| `capabilities/cleaning/conversation/index.js` | Multi-variant pricing-info detection (`crib, single, queen, king` → price list). Plural `prices` regex. `invalidTime` surfacing. |
| `capabilities/cleaning/src/index.js` | `cleaning.multi_variant_quote_request` handler (per-variant price list). `cleaning_invalid_clock_surface` handler. `capitalize` helper. |

## Verification
- 39/39 manual stress-test scenarios pass.
- 126 sprint1–25 tests pass.
- 58 sprint73–80 multilingual tests pass.
- 37 sprint83+84 stress-regression tests pass.
