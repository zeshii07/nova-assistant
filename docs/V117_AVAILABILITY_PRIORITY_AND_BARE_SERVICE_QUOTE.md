# V11.7 Availability Priority & Bare Service Quote

**Release**: v11.7 (patch over v11.6)
**Date**: 2026-08-29
**Sprint**: v11.7

## Problem

When users combined a service question with a day constraint
("i was looking for deep cleaning service for my villa on monday do you
provide deep cleaning service"), the availability adapter's
`genericDayService` block fired first (because "monday" + "service" was
detected), answering only the hours question and ignoring the "do you
provide deep cleaning" part entirely.

Additionally, bare service mentions like "villa deep cleaning" (no
pricing keyword, no booking action) were still auto-starting a booking
instead of showing a quote.

## Changes

### `capabilities/availability/conversation/index.js`

**New `hasExplicitSupportQuestion` guard** — when the user asks "do you
provide/offer X cleaning" AND mentions a day constraint, the
`genericDayService`, `sameDayQuestion`, `availabilityQuestion`, and
`slot_question` blocks are now SKIPPED so the `serviceQuestion` block
below can handle the full query (list the services AND mention day
availability).

```js
const hasExplicitSupportQuestion = /\b(can you|are you able to|do you provide|do you offer)\b/.test(text)
  && /\b(clean|cleaning|service|deep|sofa|carpet|mattress|furniture)\b/.test(text);

// These blocks now have `&& !hasExplicitSupportQuestion` guards:
if(genericDayService && !hasExplicitSupportQuestion)...
if(availabilityQuestion && !hasExplicitSupportQuestion)...
```

Also added `"i was looking for"` and `"i am looking for"` to the
`transactionalServiceRequest` regex so these phrases are recognized as
transactional intent.

### `capabilities/cleaning/conversation/index.js`

**Bare service mention → quote** — when `!structuredRequest &&
!explicitBookingAction && !step && !hasDateConstraint`, route to
`cleaning.standalone_quote` instead of `cleaning.service_request`.
This means "villa deep cleaning" shows the price and asks whether to
book, rather than auto-starting a booking.

**`hasDateConstraint` guard** — when the user supplied a date ("on
monday"), the quote-only path is skipped so the booking workflow can
fire. Without this, "deep cleaning for my villa on monday" would show
a quote instead of starting the booking the user clearly wants.

**Bedroom typo tolerance** — `bdrooms?|bd|bdrm` added to all 6 bedroom-
count regex locations so "3 bdroom" is recognized.

**`priceFollowUp` bare-bedroom pattern** — when there's an active
`priceEnquiry`, a bare "3 bedroom" reply is detected as a price
follow-up.

**`cleaningDomain` priceEnquiry extension** — when there's an active
`priceEnquiry`, any follow-up mentioning property scope (bedrooms,
apartment, villa) belongs to the cleaning capability, even without the
word "cleaning".

## Verification

| Query | Before | After |
|-------|--------|-------|
| "i was looking for deep cleaning service for my villa on mondy do you provide deep cleaning service" | Listed all services (availability.day_service_question) | Routes to cleaning, asks for bedrooms (booking with date captured) |
| "villa deep cleaning" | Auto-started booking, pushed for date | "From AED 300... tell me the bedroom count" (quote) |
| "3 bedroom" (follow-up) | "I don't have approved information" (assistant fallback) | "AED 440. Would you like me to start a booking?" |
| "hello what are charges for 3 bdroom apartment deep cleaning" | "tell me the bedroom count" (didn't recognize "bdroom") | "AED 350" ✓ |
| "do you provide deep cleaning" | "Deep Home Cleaning is From AED 200..." (only 1 service) | Lists all 5 Deep services ✓ |
| "book deep cleaning for my 3 bedroom apartment" | — | "AED 350. What date?" ✓ (booking with date) |

## Files changed

| File | Changes |
|------|---------|
| `capabilities/availability/conversation/index.js` | `hasExplicitSupportQuestion` guard on day_service/slot blocks; "i was looking for" in transactionalServiceRequest |
| `capabilities/cleaning/conversation/index.js` | Bedroom typo regex (6 locations); `priceFollowUp` bare-bedroom pattern; `cleaningDomain` priceEnquiry extension; bare service mention → quote with `hasDateConstraint` guard |
