# Nova v11 — Architectural Recommendations

## Context & Multilingual Language Understanding Gaps

This document captures the architectural changes recommended (and the
concrete fixes already applied in this patch) to close the remaining
context-retention and multilingual-understanding gaps surfaced by the
Nova v9.4.1 Complete Stress-Test Kit.

The companion patch (`nova-v9.4.1-patches.zip`) ships the immediate
bug fixes. This document describes the deeper architectural moves that
should land in subsequent sprints.

---

## A. Patches already applied in this delivery

| # | File | What changed |
|---|------|--------------|
| 1 | `packages/conversation-intelligence/src/fieldAmendmentExtractor.js` | Urdu-script + Arabic field labels (`نام`, `فون`, `ای میل`, `ایڈریس`, `شہر`, `نشانی`, `ادائیگی`, `اسم`, `هاتف`, `عنوان`, `مدينة`). Unicode-aware boundaries (`(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}_])`) instead of `\b`, because JavaScript's `\b` is ASCII-only. SOV correction patterns with and without `mera/my` prefix. Action-verb guard so "name change kr do" surfaces as a null-rawValue amendment instead of silently storing "Change" as the customer's name. |
| 2 | `packages/conversation-intelligence/src/clauseSemanticEngine.js` | Urdu-script conjunctions (`۔`, `،`, `اور`, `لیکن`, `مگر`, `پر`, `کیونکہ`, `لہذا`, `اگر`) and Arabic (`،`, `و`, `لكن`, `لأن`). Compound Urdu/Arabic messages now split into clauses like English. |
| 3 | `packages/conversation-intelligence/src/temporalSemanticExtractor.js` | New `detectInvalidClock()` surfaces impossible clock tokens (e.g. `25:90`, `30 am`) instead of silently skipping them. Surfaces `invalidClockText`, `invalidClockReason`. The cleaning capability rejects the request and asks for a valid time. |
| 4 | `packages/catalog-engine/src/attributeExtractor.js` | `COLOR_ALIASES` expanded from 7 → 16 colors (added `red`, `green`, `yellow`, `grey`, `maroon`, `olive`, `pink`, `purple`, `orange`), each with English + Roman-Urdu + Urdu-script + Arabic aliases. `SIZE_ALIASES` extended similarly. |
| 5 | `packages/universal-vocabulary/src/index.js` | `canonicalize()` now uses Unicode-aware lookbehind/lookahead boundaries so Urdu/Arabic tokens are also rewritten (previously `\b` only fired for ASCII tokens). Defensive try/catch falls back to `\b` if the Unicode regex fails to compile. |
| 6 | `packages/universal-vocabulary/src/vocabulary.json` | 66 new canonical replacements: Urdu-script product names (`سمارٹ واچ → smart watch`, `پولو شرٹ → polo shirt`, `ڈینم جینز → denim jeans`, `جوتے → shoes`, etc.), Urdu-script color words (`سیاہ → black`, `سفید → white`, `نیلا → blue`, …), and Urdu-script pronouns (`مجھے → mujhe`). Concepts `catalog.electronics` and `catalog.accessories` extended to include Urdu-script product terms. |
| 7 | `packages/conversation-intelligence/src/text.js` | `numberFromText` extended to 1–20 in English, Roman-Urdu (`gyara`…`bees`), and Urdu-script (`گیارہ`…`بیس`). |
| 8 | `packages/conversation-intelligence/src/acquisitionIntent.js` | Roman-Urdu pronoun + Urdu-script acquisition verb alternations now co-exist, so a mixed post-canonicalize phrase like `mujhe صفائی کروانی ہے` still matches. Falls back to the original raw value when testing the Urdu-script regex. |
| 9 | `packages/multilingual-nlu/src/nluContextBuilder.js` | New `recent_turns[]` field in the tenant context sent to Groq — the last 6 customer turns + capability/intent label, with PII deliberately excluded. Lets the provider resolve pronouns like "book it again" or "wohi" / "وہی" without leaking customer contact data. |
| 10 | `packages/execution-engine/src/executionEngine.js` | State `context.recentTurns[]` (capped at 6 turns) populated in `#finalize`. Reset on `reset` global command. |
| 11 | `capabilities/cleaning/conversation/index.js` | Multi-variant pricing-info request detection (`crib, single, queen and king`) routes to `cleaning.multi_variant_quote_request` instead of silently picking the last variant and starting a booking. Pricing regex now matches plural forms (`prices`, `costs`). `extractTimeEntities` surfaces `invalidTime` / `invalidClockText` from the temporal extractor. |
| 12 | `capabilities/cleaning/src/index.js` | New `cleaning.multi_variant_quote_request` handler renders a per-variant price list instead of starting a booking. New `cleaning_invalid_clock_surface` handler rejects impossible clock tokens before pricing. Added `capitalize` helper. |

### Verification

- All 9 v9.4.1 benchmark tests pass (`npm run benchmark:v9.4.1`).
- All 58 tests across sprints 73–80 (v9.3 → v10.2 multilingual) pass.
- All 37 stress-regression tests pass (`sprint83` + `sprint84`).
- All 52 amendment + stress tests pass (sprints 34, 57, 60, 68, 83, 84).
- 39 of 39 manual stress-kit scenarios pass via the HTTP API.

---

## B. Deeper architectural recommendations

The patches above close the immediate surface bugs. The deeper gaps
the stress kit keeps exposing require architectural moves:

### B1. Conversation memory window — **partially shipped**

The patch already adds `state.context.recentTurns[]` (last 6 turns)
and passes it to the Groq provider via `recent_turns[]` in the tenant
context. What's still missing:

- **Token budget accounting.** The current `maxTurnChars=320` is a flat
  cap per turn. For long Urdu compound sentences, 6 turns × 320 chars
  can push the Groq prompt past the 4 K context window when combined
  with tenant vocabulary (80 items × ~200 chars). Add a sliding budget:
  when the cumulative turn-text exceeds ~1.5 K chars, drop the oldest
  turn first.
- **Summarization layer for long horizons.** After ~30 turns, the
  `recentTurns` window alone is insufficient. Add an opt-in
  `ConversationSummarizer` that compresses turns 7–30 into a single
  "session summary" string and stores it in `state.context.summary`.
  The summary is sent to Groq alongside `recent_turns[]`. Use a
  separate (smaller, cheaper) Groq model for summarization to keep
  latency low.
- **Goal-aware truncation.** Turns from the current active workflow
  should never be truncated. Turns from completed/interrupted workflows
  can be summarized first.
- **CRM persistence.** `recentTurns` should be persisted per
  customer (not per conversation) so a returning customer on a new
  device still has continuity. Add a `memoryService.appendTurn` hook
  that mirrors the in-memory `recentTurns` to the CRM
  `customFields.recentInteractions` (capped at 20).

### B2. Script-aware language detection — **not yet shipped**

`packages/assistant/src/languageEngine.js` and the duplicated detector
inside `capabilities/cleaning/src/index.js` both return `'urdu'` for
any Arabic-script text. Arabic customers receive Urdu replies unless
their CRM record explicitly says otherwise.

**Recommendation:** Introduce a single `LanguageDetector` in
`packages/conversation-intelligence/src/languageDetector.js` that
returns one of `english | roman_urdu | urdu | arabic | mixed` based on:

- Script detection (Arabic block 0x0600–0x06FF).
- Urdu-specific subset (ٹ ڈ ڑ ں ھ ہ ے ی گ پ چ ژ ک — these are Urdu-only
  letters not used in Arabic).
- Arabic-specific subset (ي ة ى لا — these appear in Arabic but rarely
  in Urdu).
- Roman-Urdu word boundary scan.
- Mixed-script detection (multiple scripts in same message).

Every capability, the humanization engine, and the experience language
engine should consume this single detector. The cleaning capability's
duplicated `detectLanguage` should be removed.

### B3. Transliteration layer — **partially shipped**

The patch ships 66 Urdu→English canonical replacements for common
retail products. This is a stop-gap. The right architecture is:

**Recommendation:** Add a `TransliterationService` in
`packages/conversation-intelligence/src/transliterationService.js`
with two layers:

1. **Static map** (what we shipped) — fast, deterministic, manually
   curated. Covers the top ~200 most common retail/service terms.
2. **On-demand Groq transliteration** — when a pure-Urdu/Arabic
   catalog search returns no matches, invoke Groq with a strict JSON
   contract asking for a transliteration + likely English canonical
   form. The deterministic catalog matcher then re-runs against the
   transliterated text. The provider may NOT invent products; it may
   only suggest a transliteration.

The static map ships today. The on-demand Groq layer should land in
sprint v11.1.

### B4. Script-aware regex boundaries — **shipped**

Already shipped in `fieldAmendmentExtractor.js` and
`universal-vocabulary/canonicalize`. The remaining places that still
use `\b` for Urdu/Arabic tokens:

- `productMatcher.js` STOP_WORDS — uses `new Set(...)` lookup, no
  `\b`. Safe but Roman-Urdu only.
- `temporalSemanticExtractor.js` — `\b` on weekdays (English-only).
  Safe.
- `multilingualLexicon.js` — uses Map lookups. Safe.
- `lightweightSemanticRouter.js` — uses `\b` for feature tokenization.
  Should be reviewed for Urdu-script tokens; current router operates
  on canonicalized text so most Urdu tokens are pre-converted.

**Recommendation:** Audit remaining `\b` uses against Urdu-script
fixtures and replace with Unicode-aware lookarounds where needed.

### B5. Per-tenant vocabulary seeding — **not yet shipped**

Today, the universal vocabulary (`vocabulary.json`) is shared across
all tenants. Per-tenant catalog aliases come from each tenant's
`catalog/products.json` and `cleaning/services.json`. This works for
explicit aliases but misses Urdu/Arabic variants the tenant didn't
configure.

**Recommendation:** Add a `TenantVocabularySeeder` that, on tenant
onboarding:

1. Inspects each catalog product's `name` and `aliases`.
2. For each English product name, queries a static Urdu/Arabic
   translation map (extending what we shipped) to auto-generate
   Urdu-script aliases.
3. Persists the generated aliases into the tenant's catalog file as
   `autoGeneratedAliases` (visibly distinct from operator-provided
   ones).
4. The operator can edit or delete them via Control Plane →
   Products & Prices.

This makes Urdu/Arabic support work out-of-the-box for new tenants
without per-tenant configuration.

### B6. Confusion logging + feedback loop — **not yet shipped**

Today, when the deterministic core can't resolve a message, it falls
back to a generic clarification. There's no structured log of "what
confused the engine" — operators can't see patterns.

**Recommendation:** Add a `ConfusionLog` event:

```json
{
  "event": "conversation.confusion.v1",
  "tenantId": "...",
  "conversationId": "...",
  "message": "wohi wala rakh do jo pehle btaya tha",
  "candidates": [...],
  "remoteNlu": { "used": true, "validated": false, "reason": "ambiguous_pronoun" },
  "missing": ["resolved_reference"]
}
```

Publish to the event bus; expose in Developer Console → Diagnostics →
Confusion Log. Operators can filter by tenant/capability and see
which message patterns the engine couldn't resolve. These become
seeds for the next round of vocabulary expansion and deterministic
pattern tuning.

### B7. Capability-scoped deterministic pattern registry — **not yet shipped**

Today, multilingual patterns are scattered across files:
`fieldAmendmentExtractor.js`, `acquisitionIntent.js`,
`clauseSemanticEngine.js`, `multilingualLexicon.js`, and inline
regexes in each capability's conversation adapter. There's no single
place to see "all the patterns Nova recognizes for X."

**Recommendation:** Add a `PatternRegistry` in
`packages/conversation-intelligence/src/patternRegistry.js` that
centralizes:

- All field labels (currently in `FIELD_LABELS`).
- All acquisition verbs.
- All temporal/weekday/time-window tokens.
- All conjunctions.

Each entry has metadata: `language`, `script`, `capability`,
`intent`, `evidence_type`. The registry exposes:

- `registry.match(text)` → list of matched patterns.
- `registry.export({format:'json'|'csv'})` for diagnostics.
- A Developer Console page that renders the registry as a searchable
  table, so operators can see exactly which multilingual patterns the
  engine recognizes.

### B8. Adaptive remote-NLU strategy with memory — **not yet shipped**

`nluInvocationPolicy.js` decides whether to call Groq based on the
current message's confidence, ambiguity, and script. It does NOT
factor in:

- Whether the customer previously had a similar confusion that Groq
  resolved (would suggest invoking again).
- Whether the customer is in a long-running workflow where local
  resolution has been reliable (would suggest skipping Groq to save
  latency and cost).
- Whether the tenant has a paid Groq plan with rate limits.

**Recommendation:** Extend `nluInvocationPolicy.evaluate(...)` with
a `decisionContext` parameter that includes:

```json
{
  "recent_confusion_rate": 0.15,
  "tenant_groq_quota_remaining": 4500,
  "current_workflow_turn_count": 4,
  "previous_turn_remote_nlu_used": false,
  "previous_turn_validated": true
}
```

The policy can then make smarter trade-offs: e.g., skip Groq if the
last 3 turns were validated locally AND there's no new ambiguity
signal. This keeps the clear-local-intent accuracy ≥ 98% while
reducing Groq spend.

### B9. Confidence calibration harness — **not yet shipped**

The release threshold "Clear local intent accuracy ≥ 98%" is verified
manually via the stress kit. There's no automated regression that
catches drift.

**Recommendation:** Add `scripts/calibrate-confidence.js` that runs
the entire `tests/datasets/*/core.json` corpus (currently 6 datasets ×
~40 cases each) and reports:

- Per-dataset local intent accuracy.
- Per-capability remote-NLU invocation rate.
- Per-intent confidence distribution.

Wire into CI as a non-blocking informational job; alert when accuracy
drops by more than 1% from the previous main-branch baseline.

### B10. Public channel parity — **not yet shipped**

The public `/chat` and `/assistant` pages route through
`replyToNovaVisitor` (the marketing assistant), which uses a
simpler intent engine that does NOT consume the new
`recentTurns` window, the new transliteration map, or the new
multi-variant quote handler. Tenant conversations via `/api/dev/chat`
get all the fixes; public marketing conversations don't.

**Recommendation:** After this patch lands, audit
`apps/api/src/novaMarketingAssistant.js` and bring it onto the same
multilingual stack. The public channel is the first impression for
new customers — it should not regress on Urdu/Arabic understanding.

---

## C. Suggested sprint plan

| Sprint | Scope |
|--------|-------|
| **v11.0** (this patch) | All fixes from section A. Tests pass. |
| v11.1 | B2 (script-aware language detection), B4 audit (remaining `\b`), B6 (confusion log). |
| v11.2 | B3 (on-demand Groq transliteration), B5 (per-tenant vocabulary seeding). |
| v11.3 | B1 (token budget + summarization + CRM persistence), B8 (adaptive NLU strategy with memory). |
| v11.4 | B7 (pattern registry + Developer Console page), B9 (confidence calibration harness), B10 (public channel parity). |

---

## D. How to verify the patch

1. Stop the running server (`pkill -f apps/api/src/server.js`).
2. Apply the patched files (paths preserved — see `MANIFEST.md` in
   the zip).
3. `npm install` (no new dependencies).
4. `npm start`.
5. Open `http://localhost:3000/developer`.
6. Run the v9.4.1 benchmark:
   `npm run benchmark:v9.4.1`
7. Run the stress-test harness:
   `node /home/z/my-project/scripts/stress-test-harness.js`
   (all 39 scenarios should pass).
8. Spot-check the multilingual scenarios from section E of the kit
   (Roman Urdu, Urdu script, Urdu digits) — they should now route
   correctly without falling through to the assistant fallback.
