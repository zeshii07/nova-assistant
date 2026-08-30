# V12.0 Service Availability & Deep Cleaning Scope Info

**Release**: v12.0
**Date**: 2026-08-30

## Problem

1. "do you provide furniture cleaning" → assistant said "I don't have approved information"
2. "do you offer furniture cleaning services" → assistant listed ALL services (unfiltered)
3. "do you do stndard cleaning for apartments" → assistant said "Apartment Cleaning" (knowledge answer)
4. "will you provide deep cleaning service" → cleaning quoted single service instead of listing deep services
5. "how many hours will it take for deep cleaning 3 bedroom" → said "no approved information"
6. "what is included in deep cleaning" → no handler existed

## Changes

### `capabilities/availability/conversation/index.js`
- Extended `explicitSupport` to match "do you do", "do you have", "will you provide", "will you offer", "will you"
- Extended `hasExplicitSupportQuestion` to match "will you" and include "standard" in the cleaning keyword list

### `capabilities/assistant/conversation/index.js`
- `looksInformational()` now returns `false` for "do you/can you/will you ... provide/offer/do/have/give ... cleaning/service" so the availability adapter wins

### `capabilities/cleaning/conversation/index.js`
- Updated both `isServiceSupportQuestion` guards to include "will you" and use `/i` flag
- New `cleaning.scope_info` intent routing — detects "what is included in deep cleaning"
- New `cleaning.duration_info` for non-workflow "how many hours will it take" questions

### `capabilities/cleaning/src/index.js`
- New `cleaning.scope_info` handler — explains what Deep cleaning includes:
  - All bedrooms deep cleaned
  - One kitchen deep cleaning
  - One washroom/bathroom deep cleaning
  - Does NOT include furniture deep cleaning (separate service)
  - Light vacuuming of all furniture in rooms
- Improved `cleaning.duration_info` — Deep cleaning is scope-based not hourly

## Verification

| Query | Before | After |
|-------|--------|-------|
| "do you provide furniture cleaning" | "I don't have approved information" | Lists 8 furniture services ✓ |
| "do you offer furniture cleaning services" | Lists ALL 30 services | Lists 8 furniture services ✓ |
| "do you do stndard cleaning for apartments" | "Apartment Cleaning" (knowledge) | "Yes — we provide Apartment Cleaning" ✓ |
| "will you provide deep cleaning service" | Quotes single "Deep Home Cleaning" | Lists 5 deep services ✓ |
| "i want deep cleaning service do you provide it" | Auto-starts booking | Starts booking ✓ (has "i want") |
| "how many hours will it take for deep cleaning 3 bedroom" | "I don't have approved information" | "Deep cleaning is priced by property size... not by the hour" ✓ |
| "what is included in deep cleaning" | Error / no handler | Full scope explanation ✓ |
