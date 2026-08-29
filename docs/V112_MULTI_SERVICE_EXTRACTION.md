# V11.2 Multi-Service Extraction

**Release**: v11.2 (patch over v11.0)
**Date**: 2026-08-29
**Sprint**: v11.2

## Problem

When users asked for multiple cleaning services in a single message
(e.g. "hello i want cleaning of my apartment and also sofa cleaning"),
Nova was **selecting only the highest-scoring service** (Sofa Cleaning)
and silently dropping the other (Apartment Cleaning).

## Root Cause

The `cleaning.multi_service_request` detection block called
`findServices(fullText, {minScore:60})` on the FULL text. For
"cleaning of my apartment and also sofa cleaning":
- Sofa Cleaning scored 100 (exact phrase match "sofa cleaning")
- Apartment Cleaning scored 40 (word overlap only — no phrase match for
  "apartment cleaning" in "cleaning of my apartment")

Only 1 match above threshold 60 → multi-service path didn't fire →
fell through to single-service `structured_service_request` picking
just Sofa Cleaning.

## Changes

### `capabilities/cleaning/conversation/index.js`

**New `detectMultiServiceMatches()` helper** — splits the message on
additive conjunctions (English `and|also|plus|along with`, Roman-Urdu
`aur|sath`, Urdu-script `اور`, Arabic `و|كما`) plus commas/semicolons.
Each segment is canonicalized independently and matched with a lower
threshold (35) when the segment contains an explicit service head
(apartment, villa, sofa, carpet, etc.).

**Extended `explicitAdditiveServiceLanguage`** — now includes Roman-Urdu
`aur`, `sath`, `sath mein` and Urdu-script `اور`.

### `packages/universal-vocabulary/src/vocabulary.json`

**63 new Urdu-script canonical replacements** for cleaning vocabulary:
- Property types: اپارٹمنٹ→apartment, فلیٹ→flat, ولا→villa, گھر→home, دفتر→office
- Cleaning nouns: صفائی→cleaning, کلیننگ→cleaning, صاف→clean
- Service subjects: صوفہ→sofa, کارپٹ→carpet, مٹراس→mattress, پردہ→curtain
- Cleaning-type adjectives: گہری→deep, معمالی→standard
- Urdu particles: کی→"", کے→"", کا→"", کو→"", میرے→my

### `capabilities/cleaning/src/index.js`

**`preferLegacyText:true`** on `cleaning_multi_service_started` payload
so the humanization engine preserves the multi-service reply lines
instead of replacing them with a single-field template.

## Verification

7 multi-service scenarios tested:
- MS1: "hello i want cleaning of my apartment and also sofa cleaning" → Apartment + Sofa ✓
- MS2: "Book office cleaning and a 3-seater sofa cleaning for 21/09/2026 at 11 AM." → Office + Sofa ✓
- MS3: "I need deep apartment cleaning plus carpet cleaning" → Deep Apartment + Carpet ✓
- MS4: "mujhy ghar ki safai aur sofa cleaning chahiye" (Roman Urdu) → Standard Home + Sofa ✓
- MS5: "مجھے اپارٹمنٹ کی صفائی اور صوفہ کلیننگ چاہیے" (Urdu script) → Apartment + Sofa ✓
- MS6: "I want office cleaning, sofa cleaning, and carpet cleaning" (3 services) → Office + Sofa + Carpet ✓
- MS7: Mid-workflow "actually add a 3-seater sofa cleaning too" → cleaning.additional_service_add ✓
