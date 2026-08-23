# Nova v4.3 — Universal Vocabulary Architecture

## Where to add aliases

Edit:

`packages/universal-vocabulary/src/vocabulary.json`

Use this file only for language that is useful across many businesses: greetings, common Roman-Urdu spellings, browse/list language, generic product/service words, quantities, and broad categories such as footwear.

Example:

```json
"catalog.footwear": ["shoes", "jootay", "joty", "jutay"]
```

or:

```json
"social.how_are_you": ["how are you", "kaise ho", "kysy ho", "kia hal hai"]
```

Do not add entire conversations. Add reusable words/phrases for a semantic concept.

## Where business-specific aliases belong

Business/domain terminology belongs with tenant offerings/knowledge, for example:

`tenants/<tenant-id>/offerings/items.json`

```json
{
  "name": "Beard Grooming",
  "aliases": ["beard trim", "darhi trim", "darhi set"]
}
```

The upcoming Knowledge Layer should extract and propose these aliases from uploaded PDFs, DOCX files, spreadsheets, websites, menus, catalogs, FAQs and policies. Approved aliases are then stored with tenant knowledge/offerings rather than added to Nova core.

## Resolution path

Human text
→ Universal Vocabulary canonicalization
→ Concept/semantic resolution
→ Tenant/domain knowledge resolution
→ Universal Engagement workflow
→ deterministic validation/fulfillment
→ optional LLM fallback

## ML / LLM boundary

`packages/universal-vocabulary/src/semanticMatcher.js` is an ML-ready provider boundary. The default implementation is deterministic and auditable. A future embedding or compact classifier can implement `scoreConcept()` without changing capabilities.

Recommended order:
1. exact/canonical vocabulary and tenant aliases
2. deterministic fuzzy/entity resolution
3. optional embedding/small classifier for ranking ambiguous concepts
4. LLM fallback for open-ended paraphrases and reasoning
5. deterministic validation before any transaction is committed
