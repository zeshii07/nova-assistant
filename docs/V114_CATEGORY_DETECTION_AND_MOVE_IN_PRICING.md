# V11.4 Category Detection & Move-in/Move-out Pricing

**Release**: v11.4 (patch over v11.3)
**Date**: 2026-08-29
**Sprint**: v11.4

## Problem

1. "do you provide deep cleaning" → Nova returned "I don't have approved
   information" instead of listing Deep cleaning services.
2. "do you provide furniture cleaning service" → matched only
   "Furniture Cleaning Package" (CLN023) instead of ALL furniture
   services (Sofa, Carpet, Mattress, etc.).
3. "what type of cleaning you do" → returned a vague knowledge abstention
   instead of the grouped service list.
4. Move-in/Move-out cleaning used `starting_from` pricing (AED 701.10 flat)
   instead of the same scope-based matrix as Deep cleaning.

## Changes

### `capabilities/availability/conversation/index.js`

**New `detectCategoryServices()` async helper** — detects category
questions ("do you provide furniture/deep/laundry cleaning") and returns
ALL services in that category instead of a single best match. Maps
category keywords to service category names:
- "furniture cleaning" → Furniture cleaning category (8 services)
- "deep cleaning" → Deep cleaning category (5 services)
- "home cleaning" / "standard cleaning" → Home cleaning (5 services)
- "laundry" → Laundry (4 services)
- "business/office/commercial" → Business cleaning (2 services)
- "kitchen/bathroom/floor/window/balcony" → Specialised cleaning (6 services)
- "ac/duct/pest" → Home maintenance cleaning (3 services)

### `capabilities/assistant/conversation/index.js`

**`looksInformational()` exclusion** — now returns `false` for
"what type/kind of cleaning" so the cleaning adapter's `service_list`
wins over the assistant's `knowledge_question`.

### `capabilities/cleaning/conversation/index.js`

**Extended `cleaning.service_list` regex** — now matches:
- "what type of cleaning"
- "what kind of cleaning"
- "what cleaning do you"
- "which cleaning"
- "kis kis qisam ki safai" (Roman Urdu)

**Added `priority:230`** so it beats the assistant's knowledge_question
(priority 150, confidence 1.0).

### `capabilities/cleaning/src/index.js`

**Added CLN006 (Move-in/Move-out) to `isDeepProperty` array** and
`bookingRequirementState` so it's treated as a Deep-cleaning-style
service (bedrooms-based pricing).

### `tenants/cleaning-demo/cleaning/services.json`

**Updated CLN006** from:
```json
"priceType": "starting_from", "price": 701.1
```
to:
```json
"priceType": "scope_based",
"pricingServiceId": "move-in-out-cleaning",
"requiredPricingFields": ["propertyType", "bedrooms"]
```

This makes Move-in/Move-out use the same matrix pricing model as Deep
cleaning — the only difference is the name and the price values.

## Verification

| Query | Before | After |
|-------|--------|-------|
| "do you provide deep cleaning" | "I don't have approved information" | Lists 5 Deep services |
| "do you provide furniture cleaning service" | "Furniture Cleaning Package" only | Lists 8 Furniture services |
| "what type of cleaning you do" | Vague knowledge abstention | Full grouped service list with prices |
| "book move in cleaning for 3 bedroom apartment" | AED 701.10 (starting_from) | AED 2,609.10 (matrix: apartment\|3) |
