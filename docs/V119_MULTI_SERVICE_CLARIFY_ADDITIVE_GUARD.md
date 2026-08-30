# V11.9 Multi-Service Clarify Additive Guard

**Release**: v11.9 (patch over v11.8)
**Date**: 2026-08-29

## Problem

When the user was in the `multi_service_clarify` step and replied with
answers containing "and" (e.g. "for apartment i need deep cleaning and
my sofa is 3 seater"), the `additiveServiceLanguage` block at line 337
fired BEFORE the `multi_service_clarify` handler at line 801. This
caused Nova to call `findServices` on the full text, find Deep Apartment
+ Deep Home + Sofa as separate services, and add them as "additional
services" — losing the original multi-service context and pricing wrong.

The result was:
```
Added as additional service(s) to this cleaning request:
• Deep Apartment Cleaning — AED 350
• Deep Home Cleaning — AED 200
```
instead of correctly resolving the scope and showing:
```
Deep Apartment Cleaning — AED 350
• Sofa Cleaning — AED 110
Configured estimate total: AED 460
```

## Fix

Added `step!=='multi_service_clarify'` guard to the `additiveServiceLanguage`
block so it does NOT fire during a multi-service clarification turn:

```js
// Before:
if(step && additiveServiceLanguage && !pricingRequested){
// After:
if(step && step!=='multi_service_clarify' && additiveServiceLanguage && !pricingRequested){
```

This ensures the `multi_service_clarify` handler at line 801 gets the turn
instead, correctly resolving cleaningType='deep' for the apartment and
units=3 for the sofa, then asking for the missing bedrooms before pricing.

## Verification

| Turn | Input | Before | After |
|------|-------|--------|-------|
| msg1 | "i want cleaning service for my apartment and for my sofa" | Asks Std/Deep + sofa size ✓ | Same ✓ |
| msg2 | "for apartment i need deep cleaning and my sofa is 3 seater" | "Added as additional: Deep Apartment AED 350, Deep Home AED 200" ✗ | "Thanks. Still need: Deep Apartment Cleaning: How many bedrooms?" ✓ |
| msg3 | "3 bedroom" | (broken) | "Deep Apartment AED 350 + Sofa AED 110 = Total AED 460" ✓ |
| msg4 | "do you provide deep cleaning service" (mid-workflow) | Listed all services via assistant ✗ | Lists 5 deep services via availability ✓ |
