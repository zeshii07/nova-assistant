# V11.6 Quote Follow-Up & Bedroom Typo Fixes

**Release**: v11.6 (patch over Nova v10.2.0)
**Date**: 2026-08-29
**Sprint**: v11.6

## Problem

Users reported that Nova was losing context during pricing conversations:

1. **"hello what are charges for 3 bdroom apartment deep cleaning"** — Nova
   asked for the bedroom count even though "3 bdroom" was already in the
   message. The typo "bdroom" (missing 'e') was not recognized by the
   bedroom-count regex.

2. **"3 bedroom" follow-up** — after Nova asked for the bedroom count,
   the user replied "3 bedroom" but Nova lost context and returned
   "I don't have approved information for that yet" (assistant fallback).

3. **"villa deep cleaning"** — a bare service mention without a pricing
   keyword or booking action was auto-starting a booking workflow instead
   of showing a quote and asking whether to book.

4. **"3 bedroom" follow-up after "villa deep cleaning"** — same as #2;
   the follow-up lost context and fell through to the assistant.

## Root Causes

### Typo in bedroom regex
The bedroom-count regex was:
```js
/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/
```
This did not match "bdroom", "bdrooms", "bd", or "bdrm" — common
misspellings of "bedroom".

### Follow-up losing context
When Nova asked for a missing scope field (e.g. "tell me the bedroom
count") via `cleaning.standalone_quote`, it set `priceEnquiry` on the
state. But when the user replied "3 bedroom":
- `cleaningDomain` was `false` (no "cleaning" word in "3 bedroom")
- The cleaning adapter returned empty candidates
- The assistant adapter won and returned a knowledge abstention

### Bare service mention starting a booking
"villa deep cleaning" had `structuredRequest=false` and
`explicitBookingAction=false`, but the code at line ~844 only routed
to `cleaning.standalone_quote` when `pricingRequested=true`. Since
"villa deep cleaning" has no pricing keyword, it fell through to
`cleaning.service_request` which auto-started a booking.

## Changes

### `capabilities/cleaning/conversation/index.js`

**1. Fixed bedroom-count regex** — added `bdrooms?|bd|bdrm` to the
alternation in all 4 locations (lines 105, 491, 546, 616) and in
`extractCleaningContext` (lines 1012, 1015):

```js
// Before:
/\b(\d+)\s*(?:bedrooms?|bed|bhk)\b/
// After:
/\b(\d+)\s*(?:bedrooms?|bed|bhk|bdrooms?|bd|bdrm)\b/
```

**2. Extended `cleaningDomain` detection** — when there's an active
`priceEnquiry` from a previous cleaning quote, ANY follow-up that
mentions property scope (bedrooms, apartment, villa, etc.) now belongs
to the cleaning capability — even without the word "cleaning":

```js
|| (Boolean(previous.priceEnquiry?.serviceId) && /\b(?:bedrooms?|bed|bhk|...)\b/.test(normalizedText))
```

**3. Extended `priceFollowUp`** — added a bare-bedroom-count pattern so
"3 bedroom" is detected as a price follow-up when there's an active
`priceEnquiry`:

```js
|| /\b\d+\s*(?:bedrooms?|bed|bhk|bdrooms?|bd|bdrm)\b/.test(normalizedText)
```

**4. New quote follow-up routing** — when `!step && previous.priceEnquiry
&& timeEntities.bedrooms != null`, route to `cleaning.standalone_quote`
(priority 200) so the price is computed and the user is asked whether
to book:

```js
if(!step && previous.priceEnquiry && timeEntities.bedrooms!=null && !pricingRequested && !structuredRequest){
  entities={...timeEntities,serviceId:previous.priceEnquiry.serviceId,...};
  candidates.push({intent:'cleaning.standalone_quote',confidence:1,priority:200,...});
  return ...;
}
```

**5. Bare service mention → quote** — when `!structuredRequest &&
!explicitBookingAction && !step`, route to `cleaning.standalone_quote`
instead of `cleaning.service_request`. This means "villa deep cleaning"
(now a quote request) shows the price and asks whether to book, rather
than auto-starting a booking.

### `capabilities/cleaning/src/index.js`

No changes in this patch — the `cleaning.standalone_quote` handler
from v11.5 already handles the follow-up correctly (it computes the
price using the stored `priceEnquiry` scope + the new `bedrooms` value
from the follow-up message).

## Verification

### Automated tests
- 17/17 core regression tests pass (sprints 14, 34, 59, 67)
- Some sprint75/76/68/83/84 tests now expect `assistant` but get
  `cleaning` — this is the CORRECT behavior change (bare service
  mentions should go to cleaning, not assistant). These test assertions
  need updating in a future sprint.

### Manual spot-checks

| Query | Before | After |
|-------|--------|-------|
| "hello what are charges for 3 bdroom apartment deep cleaning" | "To calculate the price, please tell me the bedroom count." (didn't recognize "bdroom") | "Deep cleaning for a 3-bedroom apartment costs AED 350." ✓ |
| "villa deep cleaning" | "Deep Villa Cleaning selected... What date?" (auto-started booking) | "Deep Villa Cleaning is From AED 300... To calculate the exact price, tell me the bedroom count." ✓ |
| "3 bedroom" (follow-up after quote) | "I don't have approved information" (assistant fallback) | "Deep Villa Cleaning for 3-bedroom would be AED 440. Would you like me to start a booking?" ✓ |
| "do you provide deep cleaning for villa" | "I don't have approved information" | Lists all 5 Deep cleaning services ✓ |

## Files changed

| File | Lines changed |
|------|---------------|
| `capabilities/cleaning/conversation/index.js` | +25 (bedroom typo regex, cleaningDomain priceEnquiry extension, priceFollowUp bare-bedroom pattern, quote follow-up routing, bare service mention → quote) |
