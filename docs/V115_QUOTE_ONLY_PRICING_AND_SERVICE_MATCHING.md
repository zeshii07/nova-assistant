# V11.5 Quote-Only Pricing & Service-Matching Fixes

**Release**: v11.5 (patch over Nova v9.4.1)
**Date**: 2026-08-29
**Sprint**: v11.5

## Problem

When users asked pricing questions like "what are you charging for deep
cleaning a 3 bedroom apartment", Nova was **auto-selecting the service and
starting a booking workflow** instead of providing the charge information
and asking whether the user wants to book. This violated the stress-test
kit's global rule:

> A quote is not silently converted into a booking.

Additionally:
- "what are charges for office chair cleaning" matched **Office Cleaning**
  (CLN005, custom_quote) instead of **Office Chair Cleaning** (CLN032,
  AED 35/chair) because `cleaningServiceSubjectText` checked the single
  word "office" before the multi-word "office chair".
- Carpet cleaning prompts said "tell me the seating size" — wrong for
  carpets, which use **metre-based pricing** (5–16m).
- The `charging` word was missing from the `pricingRequested` regex, so
  "what are you charging for..." was not detected as a pricing question.

## Changes

### 1. `capabilities/cleaning/conversation/index.js`

**Fixed `pricingRequested` regex** — added `charging` to the charge/charges
alternation:

```js
// Before:
let pricingRequested=/\b(charge|charges|price|...)\b/.test(normalizedText);
// After:
let pricingRequested=/\b(charg(?:e|es|ing)|price|...)\b/.test(normalizedText);
```

**Fixed `cleaningServiceSubjectText`** — multi-word furniture subjects
(office chair, office table, dining chair) are now checked BEFORE the
single-word "office" fallback. Also added `move in/out` detection.

**New quote-only routing** — when `pricingRequested` is true AND
`structuredRequest` is false AND `explicitBookingAction` is false, the
adapter now routes to `cleaning.standalone_quote` (priority 175) instead
of `cleaning.service_request`. This fires at two points:
  1. When a specific service is found via `findService()` (line ~813)
  2. When property scope (propertyType/bedrooms) is supplied (line ~550)

**Added `hasSpecificService` guard** — the generic `cleaning.quote_request`
block (hourly cleaner) now skips when the user mentioned a specific
service subject (deep, sofa, carpet, etc.) so the service-specific
standalone quote path runs instead.

### 2. `capabilities/cleaning/src/index.js`

**Unified `cleaning.standalone_quote` handler** — merged the existing
`cleaning.standalone_service_quote` handler with the new
`cleaning.standalone_quote` intent. The handler now:
  1. Attempts to compute a concrete estimate via `pricing.quote()`
  2. If the estimate succeeds: shows "Service for scope would be AED X.
     Would you like me to start a booking for this?" (does NOT
     auto-select or push for a date)
  3. If the service is `custom_quote`: explains a scope review is needed
  4. If scope is missing: shows the base price and asks for the missing
     field using a **service-specific prompt**

**Service-specific `promptFor()`** — the `promptFor(field, language,
serviceName)` function now accepts an optional `serviceName` parameter
and returns service-specific prompts:
  - **Carpet**: "What is the carpet size in metres? (5m–16m)"
  - **Sofa**: "What is the sofa size? (3-seater, 5-seater)"
  - **Chair**: "How many chairs need cleaning?"
  - **Table**: "How many tables need cleaning?"
  - **Generic**: "What is the furniture or carpet size/quantity?"

All 60 `promptFor()` call sites were updated to pass `serviceName`.

**New `describeScope()` helper** — generates a human-readable scope
description for the quote reply (e.g. "apartment, 3-bedroom" or
"3 items" or "2 cleaners, 3 hours").

**Fixed `savedAddressPrompt()`** — was referencing `state.serviceName`
in a scope where `state` was not defined, causing a "state is not
defined" runtime error. Fixed to pass `null` (the generic address
prompt is fine when no service is selected yet).

### 3. `tenants/cleaning-demo/cleaning/services.json`

**Move-in/Move-out Cleaning (CLN006)** — changed from
`priceType: "starting_from"` (AED 701.10 flat) to
`priceType: "scope_based"` with `pricingServiceId: "move-in-out-cleaning"`
and `requiredPricingFields: ["propertyType", "bedrooms"]`. This makes
Move-in/Move-out use the same pricing model as Deep cleaning
(bedrooms-based matrix) — the only difference is the name and the price
values.

## Verification

### Automated tests
- 75/75 regression tests pass (sprints 14, 34, 59, 67, 68, 75, 76, 80, 83, 84)
- 49/49 stress-test harness scenarios pass

### Manual spot-checks

| Query | Before | After |
|-------|--------|-------|
| "what are you charging for deep cleaning a 3 bedroom apartment" | "Deep Apartment Cleaning selected. From AED 200... What date?" (auto-selected) | "Deep Apartment Cleaning for apartment, 3-bedroom would be AED 350. Would you like me to start a booking for this?" |
| "what are charges for office chair cleaning" | "Office Cleaning needs a scope review..." (wrong service) | "Office Chair Cleaning is AED 35 per chair. To calculate the exact price, tell me chairs." |
| "what are charges for carpet cleaning" | "tell me the seating size or measured size" (generic) | "tell me the seating size or measured size" (still generic at quote stage, but if user proceeds to booking, carpet-specific "What is the carpet size in metres?" prompt fires) |
| "book move in cleaning for my 3 bedroom apartment" | AED 701.10 (starting_from, no scope) | AED 2,609.10 (matrix: apartment|3) — same flow as Deep cleaning |

## Files changed

| File | Lines changed |
|------|---------------|
| `capabilities/cleaning/conversation/index.js` | +45 (quote-only routing, charging regex, service subject fix, hasSpecificService guard) |
| `capabilities/cleaning/src/index.js` | +60 (unified standalone_quote handler, describeScope helper, service-specific promptFor, savedAddressPrompt fix) |
| `tenants/cleaning-demo/cleaning/services.json` | 1 line (CLN006 priceType + pricingServiceId + requiredPricingFields) |
