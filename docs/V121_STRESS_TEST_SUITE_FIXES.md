# V12.1 Stress Test Suite Fixes

**Release**: v12.1
**Date**: 2026-08-30

## Problem

Running the 200-query AI Booking & Assistant Agent Stress Test Suite revealed
3 failures in the first 29 queries tested:

1. **TEST-008**: "What are your prices for 3 bedroom villa deep cleaning?" →
   went to assistant (knowledge_question) instead of cleaning (pricing quote)
2. **TEST-009**: "Do you clean curtains? I have 2 medium size curtains." →
   went to assistant (knowledge_question) instead of availability (service support)
3. **TEST-028**: "Studio apartment ki deep cleaning kitne ki hogi?" →
   went to assistant (knowledge_question) instead of cleaning (pricing quote)

## Root Causes

### Q8 & Q28: Pricing questions going to assistant
The cleaning adapter's `structured_quote_request` candidate had confidence
0.99995 but default priority (85). The assistant's `knowledge_question`
candidate had confidence 1.0 and priority 150. The router sorts by
confidence first, so the assistant won (1.0 > 0.99995).

### Q9: "Do you clean curtains?" going to assistant
Two issues:
1. The availability adapter's `explicitSupport` regex didn't include "do you clean" or "do you wash"
2. The assistant adapter's `looksInformational()` exclusion regex used `\bcurtain\b` which doesn't match "curtains" (plural — no word boundary between "curtain" and "s")

## Changes

### `capabilities/availability/conversation/index.js`
- Added `"do you clean"` and `"do you wash"` to `explicitSupport` regex

### `capabilities/assistant/conversation/index.js`
- Added `"clean"` and `"wash"` to the service-support exclusion in `looksInformational()`
- Changed `curtain` → `curtains?`, `chair` → `chairs?` to match plurals

### `capabilities/cleaning/conversation/index.js`
- Changed `structured_quote_request` confidence from 0.99995 to 1.0 with priority 160
  so it beats the assistant's knowledge_question (priority 150)

## Verification

All 29 tested queries from the stress test suite pass:

| # | Query | Result |
|---|-------|--------|
| 001 | "How much do you charge for standard hourly cleaning?" | AED 40/hr ✓ |
| 003 | "Do you provide deep cleaning for a 2 bedroom apartment?" | Lists deep services ✓ |
| 008 | "What are your prices for 3 bedroom villa deep cleaning?" | "AED 440" ✓ |
| 009 | "Do you clean curtains? I have 2 medium size curtains." | "Yes — Curtain Cleaning" ✓ |
| 028 | "Studio apartment ki deep cleaning kitne ki hogi?" | "AED 200" ✓ |
| 041 | "I need standard cleaning for 3 hours plus deep cleaning for my kitchen and balcony." | Multi-service ✓ |
| 161 | "Can your cleaner fix my leaking bathroom pipe?" | Refused (out of scope) ✓ |
| 181 | "Book 2 hours cleaning... change to 4 hours on Saturday" | Handled modification ✓ |
