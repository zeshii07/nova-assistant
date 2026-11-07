# Nova v47.0 — Sprint 7: Hotel Management System + Reservation Bug Fix

**Released**: 2026-11-05
**Focus**: Fix the restaurant reservation bug where "reserve a table" was misrouted to catalog, and add a full hotel management system where customers can book rooms via Nova chat.

---

## Summary

| Track | What was done | Tests |
| --- | --- | --- |
| Reservation bug fix | Catalog adapter now detects reservation language ("reserve a table", "book a table", "reserve space for my family") and yields to the booking adapter | 6 tests (P1-P6) |
| Hotel management system | New "hotel" domain with vocabulary, hotel-demo tenant with 5 room types, customer can browse rooms, check prices, and book via Nova chat | 12 tests (Q1-Q12) |
| **Total** | | **18 new tests, 128/128 total pass** |

---

## Track 1: Restaurant Reservation Bug Fix

### The bug

Customer messages like:
- "i want to reserve a table for party of 10 people"
- "i want to book a table for 10 persons"
- "i want to reserve space for my family we are 10 family members we want dinner buffy"

were ALL being misrouted to `catalog.unavailable_request` ("Sorry, that item is not available in our catalog") instead of the booking adapter.

### Root cause

The catalog adapter's `explicit_unmatched_catalog_request` handler at line 254 of `catalog/conversation/index.js` fires when:
1. The message contains a REQUEST_CUE ("i want", "i need", etc.)
2. The catalog search found no matching product

Since "table" is not a food item in the catalog, the search failed, and the catalog adapter returned `catalog.unavailable_request` with priority 180 — which beat the booking adapter's `booking.start` trigger.

The unifiedServiceAdapter's `detectBookingTrigger()` DID detect the reservation (it checks `hasReservation` which matches "table", "reserve", "party", "guests"), but the catalog adapter's candidate priority (180) was higher than the booking adapter's candidate priority.

### The fix

Added a reservation-language guard at the TOP of the catalog adapter's `analyze()` method:

```js
const isReservationRequest = /\b(?:reserve|reservation|book\s+(?:a\s+)?(?:table|room|space|booth|slot|hall)|...)\b/i.test(normalizedText)
  || /\b(?:table\s+for\s+\d|party\s+of\s+\d|guests?\s+for|\d+\s*(?:people|persons|guests|seats))\b/i.test(normalizedText)
  || /\b(?:family\s+(?:dinner|gathering|event|celebration)|dinner\s+(?:buffet|party|reservation))\b/i.test(normalizedText);
if (isReservationRequest && tenant.capabilities?.includes('booking')) {
  return {priority:this.priority,candidates:[],entities:{},vocabularyMatches:[]};
}
```

When the message contains reservation language AND the tenant has the booking capability, the catalog adapter returns empty candidates — letting the booking adapter handle it.

### Verification

All three failing phrases now correctly route to `booking.start`:
- "i want to reserve a table for party of 10 people" → ✅ booking.start (party size: 10)
- "i want to book a table for 10 persons" → ✅ booking.start (party size: 10)
- "i want to reserve space for my family we are 10 family members" → ✅ booking.start

Normal product ordering still works: "i want 1 chicken biryani" → ✅ commerce (not misrouted to booking)

---

## Track 2: Hotel Management System

### New domain: `hotel`

Created `domains/hotel/schema.json` with hotel-specific entities (room_type, check_in_date, check_out_date, number_of_guests, number_of_rooms, number_of_nights, room_amenity) and actions (browse_rooms, check_room_availability, book_room, modify_booking, cancel_booking, check_in, check_out, ask_hotel_info).

### Hotel vocabulary dictionary

Added to `packages/tenant-adapter/src/domainVocabulary.js`:

| Category | Examples |
| --- | --- |
| Typos | `delux → deluxe`, `accomodation → accommodation`, `presedential → presidential`, `gueasts → guests` |
| Abbreviations | `ac → air conditioned`, `wifi → wi-fi`, `b&b → bed and breakfast` |
| Synonyms | `deluxe room → [delux room, premium room, superior room]`, `presidential suite → [vip suite, royal suite]` |
| Quantity units | `room: 1, night: 1, guest: 1, adult: 1, child: 1` |
| Special instructions | `early check in, late check out, high floor, quiet room, sea view, airport transfer` |
| Domain terms | `hotel, motel, resort, inn, lodge, room, suite, lobby, reception, concierge, check in, check out, amenities, pool, gym, spa` |
| Roman Urdu | `kamra → room, room book karna hai → want to book a room, 2 raat → 2 nights` |

### New tenant: `hotel-demo` (Grand Plaza Hotel)

A 4-star hotel with 120 rooms:

| Room Type | Price (PKR/night) | Max Guests | Key Amenities |
| --- | --- | --- | --- |
| Standard Room | 8,000 | 2 | WiFi, AC, TV, Room Service, Minibar |
| Deluxe Room | 12,000 | 3 | WiFi, AC, TV, Sitting Area, City View |
| Executive Room | 18,000 | 3 | Executive Lounge, Breakfast, Workspace |
| Family Room | 22,000 | 5 | Two Queen Beds, Breakfast, Pool View |
| Presidential Suite | 50,000 | 4 | Butler Service, Balcony, Jacuzzi, Panoramic View |

### Customer-facing capabilities

Customers can interact with the hotel via Nova chat:

```
Customer: "what rooms do you have"
Nova: Here are our room types:
• Standard Room — Rs8,000/night
• Deluxe Room — Rs12,000/night
• Executive Room — Rs18,000/night
• Family Room — Rs22,000/night
• Presidential Suite — Rs50,000/night

Customer: "i want to book a deluxe room for tomorrow"
Nova: Subject: Room Reservation
Date: 06/11/2026
How many nights will you be staying?

Customer: "how much is the presidential suite"
Nova: Presidential Suite costs Rs50,000.
Would you like to book it?

Customer: "what time is check in"
Nova: Check-in time is 2:00 PM.
```

### Admin-facing interface (to be built later)

The hotel admin interface will allow hotel staff to:
- Manage room inventory (add/remove room types, update prices)
- View and manage reservations
- Set availability calendars
- Configure amenities and policies
- View analytics (occupancy, revenue, RevPAR)

---

## Files Changed

| File | Change |
| --- | --- |
| `capabilities/catalog/conversation/index.js` | Added reservation-language guard — catalog yields to booking when "reserve a table" / "book a table" is detected |
| `domains/hotel/schema.json` | **New file** — hotel domain schema |
| `packages/tenant-adapter/src/domainVocabulary.js` | Added hotel vocabulary dictionary (typos, abbreviations, synonyms, quantity units, special instructions, domain terms, Roman Urdu) |
| `tenants/hotel-demo/profile.json` | **New file** — Grand Plaza Hotel tenant profile |
| `tenants/hotel-demo/offerings/items.json` | **New file** — 5 room types with prices, amenities, metadata |
| `tenants/hotel-demo/booking/config.json` | **New file** — booking config for room reservations |
| `tenants/hotel-demo/calendar/config.json` | **New file** — calendar config (120 room capacity) |
| `tenants/hotel-demo/knowledge/business.json` | **New file** — hotel business info (address, phone, policies, amenities) |
| `tests/sprint47.v47-hotel-and-reservation-fix.integration.test.js` | **New file** — 18 tests (P1-P6 reservation fix, Q1-Q12 hotel system) |
| `README.md` | Updated to v47.0 with hotel domain |
| `package.json` | Version 46.0.0 → 47.0.0 |

---

## Full Test Suite Results

| Suite | Tests | Pass |
| --- | --- | --- |
| sprint6 commerce | 3 | 3 |
| sprint5 catalog | 6 | 6 |
| sprint42 v42 modifications | 20 | 20 |
| sprint42.1 v42.1 bugfixes | 9 | 9 |
| sprint44 v44 resilience + vocabulary | 26 | 26 |
| sprint45 v45 NLU integration | 27 | 27 |
| sprint46 v46 context intelligence | 19 | 19 |
| sprint46 benchmarks | 8 | 8 |
| sprint47 v47 hotel + reservation fix | 18 | 18 |
| sprint43 variation corpus | 273 | 273 |
| **Total** | **409** | **409 (100%)** |
