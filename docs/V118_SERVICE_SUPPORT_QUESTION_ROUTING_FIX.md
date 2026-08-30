# V11.8 Service Support Question Routing Fix

**Release**: v11.8 (patch over v11.7)
**Date**: 2026-08-29

## Problem

Three critical routing issues remained after v11.7:

1. **"do you provide furniture cleaning service"** → Nova quoted
   "Furniture Cleaning" (a single choice-group service) instead of
   listing ALL furniture services.

2. **"do you provide deep cleaning services"** (mid-workflow, while
   waiting for furniture type selection) → Nova auto-changed the
   service to "Deep Home Cleaning" and pushed for a date.

3. **"i was looking for someone to clean my office chairs"** (while
   step=date from a previous Deep Home Cleaning workflow) → Nova
   treated it as a date input and said "Please enter a date".

## Root Causes

### Issue 1: Bare service mention → quote hijacking
The v11.7 bare-service-mention → `cleaning.standalone_quote` fix was
catching "do you provide furniture cleaning service" because it found
"Furniture Cleaning" (CLN023) via `findService()` and routed to quote
BEFORE the availability adapter could handle the "do you provide" question.

### Issue 2: Service change hijacking service support questions
The `cleaning.service_change` handler matched "deep cleaning" in
"do you provide deep cleaning services" and auto-changed the service,
even though the user was asking a question, not requesting a change.

### Issue 3: Mid-workflow topic change not detected
When the user changed topics mid-workflow ("i was looking for someone
to clean my office chairs" while step=date), the generic
`cleaning.workflow_input` handler treated the message as a date value.

## Changes

### `capabilities/cleaning/conversation/index.js`

**New `isServiceSupportQuestion` guard** (2 locations):

1. **Before the bare-service-mention → quote block** (line ~840): when
   the message contains "do you provide/offer/have/do/give", skip the
   standalone_quote path so the availability adapter can handle it.

2. **Before the service_change block** (line ~486): when the message
   contains "do you provide/offer/have", skip the service_change handler
   so the question isn't treated as a service change request.

```js
const isServiceSupportQuestion = /\b(?:do you|can you|are you able to)\b[\s\S]{0,20}\b(?:provide|offer|have)\b/.test(message.text);

// Quote path guard:
if(!structuredRequest && !explicitBookingAction && !isServiceSupportQuestion && ...) {

// Service change guard:
if(step && !isServiceSupportQuestion && /deep\s*cleaning|.../.test(normalizedText)) {
```

## Verification

### Fresh conversation queries

| Query | Before | After |
|-------|--------|-------|
| "do you provide furniture cleaning service" | "Furniture Cleaning needs a scope review" (single service) | Lists all 8 furniture services ✓ |
| "do you provide deep cleaning services" | Lists 5 deep services ✓ (already working) | Lists 5 deep services ✓ |
| "i was looking for someone to clean my office chairs" | "Office Chair Cleaning selected... How many chairs?" ✓ | Same ✓ |
| "hello what are charges for 3 bdroom apartment deep cleaning" | "AED 350" ✓ | Same ✓ |
| "villa deep cleaning" → "3 bedroom" | "AED 440" ✓ | Same ✓ |

### Multi-turn flow

| Turn | Before | After |
|------|--------|-------|
| "can i get cleners here for my furniture cleaning" | Shows furniture types ✓ | Same ✓ |
| "do you provide deep cleaning services" (mid-workflow) | "changed the request to Deep Home Cleaning" (auto-change) | Lists 5 deep services ✓ |
| "i was looking for someone to clean my office chairs" | "Please enter a date" (stuck in old workflow) | "Office Chair Cleaning selected... How many chairs?" ✓ |

## Files changed

| File | Changes |
|------|---------|
| `capabilities/cleaning/conversation/index.js` | `isServiceSupportQuestion` guard on bare-service-mention → quote path and service_change handler |
