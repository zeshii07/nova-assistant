# V11.3 Multi-Service Scope Clarification Flow

**Release**: v11.3 (patch over v11.2)
**Date**: 2026-08-29
**Sprint**: v11.3

## Problem

When Nova detected a multi-service cleaning request, it immediately
showed **base/starting prices** (AED 40/hour, AED 50) without first
asking whether the user wanted Standard or Deep cleaning, what the
property size was, or what the sofa size was. Those base prices don't
reflect the customer's actual scope.

## Solution

New `cleaning.multi_service_clarify` flow: when multi_service_request
fires, check each selected service for required scope. If any service
needs clarification, set `step='multi_service_clarify'` and
`pendingClarifications[]`. Reply shows what's needed — NO prices yet.

## Changes

### `capabilities/cleaning/src/index.js`

**4 new helper functions:**

1. `requiresScopeClarification(service, semantic)` — returns the missing
   scope field or null:
   - Property services need `cleaningType` (Standard vs Deep)
   - Standard property cleaning needs `cleanerCount` + `durationHours`
   - Deep property cleaning needs `bedrooms`
   - Furniture services need `units` or `serviceVariant`
   - Furniture services are excluded from the deep-cleaning bedrooms check

2. `clarificationQuestion(missing, language)` — localized questions
   (English + Roman-Urdu + Urdu) for each missing field.

3. `resolveCleaningTypeFromSemantic(semantic)` — extracts cleaningType
   from `selectedCleaningType` / `cleaningType` / text scan.

4. `applyServiceScope(state, service, cleaningType, semantic)` — applies
   a resolved scope answer to the correct service. Treats both the
   state's primary AND its Deep variant as "primary" so bedrooms=3 ends
   up on the top-level state.

**New `cleaning.multi_service_clarify` handler** — parses user's
response, assigns each parsed answer to its service, re-checks for
remaining missing scope, and either asks the next question or prices
all services and proceeds to date/time/address.

**Deep-variant swap** — when user says "deep cleaning" for a generic
property service (Apartment CLN008, Villa CLN009, Home CLN001), the
primary service ID is swapped to the Deep variant (CLN010, CLN011,
CLN002) so the correct pricing rule applies.

### `capabilities/cleaning/conversation/index.js`

**New `cleaning.multi_service_clarify` intent routing** — when
`step==='multi_service_clarify'`, route the user's response to this
intent with `priority:300`. Surfaces cleaningType/bedrooms/units/
cleanerCount/durationHours from the temporal extractor.

**`step!=='multi_service_clarify'` guards** — added to ALL single-service
workflow blocks (cleanerCount, duration, pricing_request, structuredRequest,
service_change) so phrases like "2 cleaners for 3 hours" or "3 bedroom"
don't get stolen by the single-service path during a multi-service
clarification turn.

**`interruption.type!=='business_question'` exclusion** — prevents a
pricing question from dropping the multi-service context.

### `capabilities/cleaning/src/index.js`

**`normalizeText` import** added — was previously undefined, causing
"normalizeText is not defined" runtime errors in
`resolveCleaningTypeFromSemantic`.

## Example Flow

```
User: hello i want cleaning of my apartment and also sofa cleaning
Nova: I've kept these as 2 separate services in one request:
      • Apartment Cleaning
      • Sofa Cleaning

      To give you the configured estimate, I need a few details first:
      • Apartment Cleaning: Standard or Deep cleaning?
      • Sofa Cleaning: What is the size/quantity?

User: deep cleaning and 3 seater sofa
Nova: Thanks. Still need a few details:
      • Deep Apartment Cleaning: How many bedrooms?

User: 3 bedroom
Nova: Here's your configured estimate:
      Deep Apartment Cleaning — AED 350
      • Sofa Cleaning — AED 110

      Configured estimate total: AED 460

      What date would you prefer?
```

## Verification
- 49/49 stress tests pass (39 original + 7 multi-service + 3 clarification)
- 120 regression tests pass
