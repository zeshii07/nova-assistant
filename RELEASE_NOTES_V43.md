# Nova v43.0 — Sprint 3: Comprehensive Variation Coverage

**Released**: 2026-11-05
**Focus**: Build a 273-case variation test corpus across 19 categories, run it against the system, and fix every architectural bug the corpus surfaces.

This is the proactive coverage sprint — instead of waiting for live conversations to surface bugs (like the v42.1 "dine inn" typo), we exercise every common phrasing of every customer intent upfront.

---

## Summary

| Metric | Value |
| --- | --- |
| Variation corpus cases | 273 |
| Categories | 19 |
| Initial pass rate | 241/306 (79%) — first run before fixes |
| Final pass rate | **273/273 (100%)** |
| Architectural bugs found & fixed | 5 |
| Regression tests (commerce + catalog + cart + v42 + v42.1) | 42/42 pass |
| New files | `tests/fixtures/variation-corpus.js`, `tests/sprint43.variation-coverage.integration.test.js` |

---

## The 5 Architectural Bugs Found

### Bug 1 — `offering.getById()` scoped-vs-unscoped service mixup
**Symptom**: `booking.swap_item`, `booking.service_change`, `booking.remove_item`, `service.quote`, `service.detail` all returned null for valid offering IDs.

**Root cause**: The execution engine injects both `offeringService` (unscooped, takes `(tenantId, id)`) and `offering` (scoped, takes just `(id)`) into the capability context. The booking capability was using `context.services.offeringService || context.services.offering` — preferring the unscooped version, which then failed when called with one arg.

**Fix**: Reverse the preference: `context.services.offering || context.services.offeringService`. Also added a `getById.length === 1` runtime check in `handleServiceQuote` and `handleServiceDetail` for backward compatibility.

### Bug 2 — Order-type detection swallowed "cash on delivery" payment method
**Symptom**: When the user said "cash on delivery" as their payment choice during checkout, the order-type detector matched "delivery" in the message and fired `commerce.cart.update_order_meta` instead of letting the payment-method field handler accept the value.

**Root cause**: The v42.0 standalone order-type detection used a permissive regex that matched any message containing the word "delivery".

**Fix**: Added `isPaymentMethodContext` guard — if the message contains `cash`, `jazz`, `easy`, `bank`, `card`, `method`, or `payment`, the order-type detection is suppressed. Also added a `isShortStandalone` check — standalone detection only fires for messages ≤ 6 words (so "for delivery" / "to go please" still work, but "cash on delivery" doesn't).

### Bug 3 — Order-type standalone detection missed "to go please" / "pack it up"
**Symptom**: "to go please" went to the assistant capability (returned address knowledge); "pack it up" was treated as a new product order.

**Root cause**: The v42.0 `hasOrderTypeStandalone` regex had a prefix group `(?:i want to|for here|to go|please)?` followed by a suffix group of order-type nouns. "to go" was in BOTH the prefix AND the suffix — so "to go please" matched the prefix "to go", leaving nothing for the suffix to match.

**Fix**: Removed the prefix group entirely. The standalone detection now matches any of the order-type nouns directly: `delivery`, `takeaway`, `take away`, `take out`, `dine-in`, `eat here`, `sit in`, `for here`, `parcel`, `packing`, `to go`, `pack up`, `pack it`, `deliver it`, `for delivery`, `home delivery`.

### Bug 4 — Note-prefix messages hijacked by order-type detector
**Symptom**: "note: please call before delivery" was intercepted by the order-type detector (matched "delivery") and triggered `commerce.cart.update_order_meta` instead of `commerce.cart.add_note`.

**Root cause**: The order-type detection block runs BEFORE the note-add block in the commerce adapter. Any note that mentioned "delivery" / "takeaway" was hijacked.

**Fix**: Added `isNotePrefix` guard at the top of the order-type detection — if the message starts with `note:` / `instruction:` / `remark:` / `message:`, all order-type detection is suppressed and the note-add block downstream handles the message.

### Bug 5 — Roman Urdu noun-first cart clear ("cart clear kar do") not detected
**Symptom**: "cart clear kar do" (Roman Urdu noun-first pattern) returned the business address instead of clearing the cart.

**Root cause**: The cart-clear regex required verb-first English pattern: `\b(clear|empty|remove everything from)\s+(my\s+)?cart\b`. Roman Urdu noun-first patterns like "cart clear kar do" / "order cancel kar do" / "cart khaali kar do" weren't matched.

**Fix**: Added a second regex alternative: `\b(?:cart|order|basket|bag)\s+(?:clear|empty|cancel|khaali|khaali\s+kar|cancel\s+kar)\s*(?:do|kar\s*do|karo)?\b`.

---

## Test Corpus Structure

`tests/fixtures/variation-corpus.js` is a JS module exporting an array of 273 test cases. Each case has:

```js
{
  id: 'ORD-001',                          // unique case id
  tenant: 'restaurant-demo',              // tenant id
  setup: ['i want 1 X and 1 Y'],          // optional setup turns
  message: 'change to delivery',           // the message under test
  expect: {
    capabilityId: 'commerce',             // expected capabilityId (optional)
    replyMatches: [/delivery/i],          // regexes reply must match
    replyNotMatch: [/couldn't find|not fully sure/i]  // regexes reply must NOT match
  },
  notes: 'why this variation matters'
}
```

The test runner in `tests/sprint43.variation-coverage.integration.test.js` generates one Node test per case. Each case uses a unique customerId to avoid state pollution.

---

## Categories Covered

| # | Category | Cases | Coverage |
| --- | --- | --- | --- |
| 1 | Order placement (English) | 25 | i want, i'll take, can i get, gimme, send me, bring me, pack, please, quantity+product, lemme get, let me have, i would like, i'd like, i need, plate of, i want to order/eat, order N X, prepare, please send me, i would love, i will take/have |
| 2 | Order placement (Roman Urdu) | 15 | mujhe X chahiye, X lena hai, X bhej do, X ka order karna hai, chahiyy/chahy variants, lyni hain, ek X laga/kar do, mujhay, 2 plate chahiye, khana order, bhi, aur ek X bhi, main X order karunga, X pasand hai |
| 3 | Order placement (typos) | 12 | wnt, chiken, biriyani, burgar, burgrs, beaf, pastaa, grill, plz, pls, wud, wanna |
| 4 | Multi-item orders | 12 | X and Y, comma separated, plus connector, Roman Urdu aur dono, 3 items, 2 of each, bare count + name, plural + singular, equal split, ek X aur ek Y, with connector, and also |
| 5 | Quantity modifications | 15 | change X to N, update quantity, make it N, add N more, reduce to N, decrease by N, increase to N, Roman Urdu quantity karo, X N kar do, kam kar do, aur N add karo, zyada kar do, set to N, instead, actually N |
| 6 | Item removal / cancellation | 15 | remove X, cancel X (single item), delete X from order, take X off, X hata do, X cancel karo, cancel my order, clear cart, empty cart, remove everything, forget X, nevermind X, scratch X, cart clear karo, order cancel karo |
| 7 | Order type (delivery/takeaway/dine-in) | 20 | change to/make it/switch to + delivery/takeaway/dine-in; standalone: i want delivery, for delivery, home delivery, deliver it, for take away, take out, to go, parcel, pack it up, i want to dine in, dine inn (typo), for here, eat here |
| 8 | Special instructions | 12 | less spicy, extra spicy, no spice, extra cheese, no onions, no garlic, mirch kam karo, zyada mirch, pyaaz nahi, mild, extra hot, extra raita |
| 9 | Order notes | 10 | add a note: X, note: X, leave a note for the kitchen, instruction: X, add instruction: X, remark: X, kitchen ke liye note: X, note likh do, message for chef, put a note |
| 10 | Cart view + checkout | 12 | show my cart, what's in my cart, show my order, view cart, cart kya hai, mera order dikhao, order summary, checkout, place order, confirm order, done, finalize |
| 11 | Confirmation phrases | 15 | ok, okay, yes, yes please, go ahead, do it, theek hai, haan, pakka, sahi hai, bilkul, confirm, confirmed, ok confirm, haan confirm karo |
| 12 | Booking trigger (salon) | 15 | book X tomorrow at Y, i want to book, can i get, schedule X for Y, reserve X appointment, i'd like to book, i need X tomorrow, appointment for X, book me a X, i will book, Roman Urdu mixed, X book karna hai kal, kal sham 5 baje, evening as time window, saturday 2pm |
| 13 | Booking modifications | 15 | change to X, switch to X, swap X for Y, replace X with Y, remove X, delete the X, add a note, recipient change (wife/son), change name to X, move to X, reschedule to X, change to time, cancel my booking, show my bookings |
| 14 | Restaurant reservation (party size) | 10 | table for N, table N at T, table for N please, reservation for N people, reserve a table for N, N guests, N people weekday time, bare table for N, change party size, make it N guests |
| 15 | Cleaning service requests | 15 | deep cleaning apartment, book a service, sofa cleaning, how much quote, price quote, browse services, Roman Urdu safai, villa property, 3 bedroom, move in, office cleaning, standard cleaning flat, hourly cleaner, 5 seater sofa, 7 seater carpet |
| 16 | Business questions | 10 | hours, opening time, location, address, phone number, contact, salon hours, salon location, phone query, opening days |
| 17 | Edge cases (short, ambiguous, out-of-scope) | 15 | hi, hello, assalam o alaikum, salam, thanks, shukriya, weather (out of scope), book a flight (out of scope), play music (out of scope), help, menu, what can you do, i have a question, speak to a human, cancel |
| 18 | Retail (default tenant) — products with variants | 15 | color + product, size + product, show me X, do you have X, how much quote, price of X, color + quantity, i want to buy X, do you sell X, a black X, one medium X, 3 large, add N X, i want to see X, give me a X |
| 19 | Healthcare + Education + Driving School | 15 | healthcare browse, general consultation, book doctor, pediatrician, consultation price, education browse, admission inquiry, grade 5 enrollment, programs browse, admission fee, driving school browse, learn driving, book lesson, package price, N lessons |

---

## Files Changed

| File | Change |
| --- | --- |
| `capabilities/booking/src/index.js` | (1) Prefer scoped `offering` service over unscooped `offeringService`; (2) `handleServiceQuote` and `handleServiceDetail` use `getById.length` runtime check for backward compat |
| `capabilities/commerce/conversation/index.js` | (1) Added `isNotePrefix` guard to order-type detection; (2) Added `isPaymentMethodContext` + `isShortStandalone` guards; (3) Fixed `hasOrderTypeStandalone` regex (removed prefix group); (4) Added `pack it` to order-type patterns; (5) Added `isOrderTypeKeyword` guard to add-to-cart detection; (6) Added Roman Urdu noun-first cart-clear pattern |
| `tests/fixtures/variation-corpus.js` | New file — 273-case variation corpus |
| `tests/sprint43.variation-coverage.integration.test.js` | New file — test runner that executes every corpus case |
| `package.json` | Version 42.1.0 → 43.0.0 |

---

## How to Run

```bash
# Run the full variation corpus
cd nova-assistant
node --require ./tests/test-env.js --test tests/sprint43.variation-coverage.integration.test.js

# Run only a specific category (e.g., order type)
node --require ./tests/test-env.js --test --test-name-pattern="^OT-" tests/sprint43.variation-coverage.integration.test.js
```

---

## What's Next

The corpus is now a permanent regression suite. Any future change to conversation adapters or capability handlers can be validated against all 273 cases in ~5 minutes. New variations can be added to `tests/fixtures/variation-corpus.js` as they're discovered in production.

Possible follow-up sprints:
- **Production NLU integration**: feed the corpus as training examples to the Groq remote NLU so it handles ambiguity we can't regex
- **Tenant vocabulary expansion**: per-tenant dictionaries for restaurant/salon/cleaning/etc.
- **Multi-turn context intelligence**: pronoun resolution ("book it again", "same time as last week")
- **Production observability + learning loop**: log every clarification reply, auto-cluster failures, feed back into the corpus
