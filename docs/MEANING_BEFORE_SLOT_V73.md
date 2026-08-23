# Nova v7.3 — Meaning Before Slot

## Core invariant
A pending field never owns a message until Nova first determines that the message is actually an answer to that field.

This applies to Commerce, Booking, Cleaning, CRM and other engagement workflows.

## Fixed classes

### Active product continuity
If Urban Backpack is already selected, `black color 5 bags` updates the active backpack to Black × 5 instead of reopening the Bags category. A true new product/family request still switches subject normally.

### Checkout interruptions
Roman Urdu product requests such as `mujhy aik bottle bhi lyni hai` and `aik sunglasses bhi chahiyy` pause checkout before customer-detail validation. The previously pending field is stored in `resumeCheckout` and restored after the side item is completed.

### Customer detail safety
Name/address/city/phone fields reject messages that are actually questions, product/service requests, shopping actions, cancellations, or commands.

### Product morphology
Simple singular/plural equivalence is recognized for catalog identity (`sunglass` → configured `Sunglasses`) while strict identity modifiers remain protected (`fountain pen` does not become `Gel Pen Pack`).

### Roman Urdu footwear
Common forms (`jota`, `joota`, `jotay`, `joty`, etc.) canonicalize to `shoes` before product matching.

### Cleaning parameter updates
While Hourly Cleaner Hire is waiting for a date, `actually i want 3 cleaners` updates `cleanerCount`, recalculates the quote, and keeps the date pending.

### Arrival questions
`When will the cleaner arrive?` is treated as an availability question, not a service-list request. Exact arrival remains dependent on confirmed date/time and scheduling.

## Benchmark
Run:

```bash
npm run benchmark:v73
npm test
npm run test:conversations
npm run check
node scripts/audit-state-safety.js
```
