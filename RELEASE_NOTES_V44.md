# Nova v44.0 — Sprint 4: Tenant Vocabulary Expansion + Network Resilience

**Released**: 2026-11-05
**Focus**: Two parallel tracks — (1) comprehensive per-domain vocabulary dictionaries so Nova understands domain-specific language variations, (2) network resilience so booking/order flows survive transient failures without losing the customer's place.

---

## Summary

| Track | What was done | Tests |
| --- | --- | --- |
| Tenant vocabulary | New `domainVocabulary.js` with 7 domain dictionaries (restaurant, salon, cleaning, retail, healthcare, education, driving_school) + universal fallback. Each dictionary has typos, abbreviations, synonyms, quantity units, order-type verbs, special instructions, domain terms, and Roman Urdu mappings. | 10 new tests (H1–H10) |
| Network resilience | Transient error classifier, retry-ready reply that preserves workflow state, stale-state retry, intelligence engine failure preservation. | 16 new tests (F1–F11, G1–G5) |
| **Total** | | **26 new tests, 337/337 total pass** |

---

## Track 1: Tenant Vocabulary Expansion

### New file: `packages/tenant-adapter/src/domainVocabulary.js`

A single module exporting 7 domain dictionaries + a universal fallback. Each dictionary contains:

| Field | Purpose | Example |
| --- | --- | --- |
| `typos` | Common misspellings → correct spelling | `chiken → chicken`, `biriyani → biryani` |
| `abbreviations` | Short forms → expanded forms | `pls → please`, `bhk → bedroom hall kitchen` |
| `synonyms` | Canonical name → known aliases | `biryani → [briyani, biriyani, biriani]` |
| `quantityUnits` | Domain-specific unit nouns → quantity | `plate: 1, serving: 1, dozen: 12` |
| `orderTypeVerbs` | Order-type declaration phrases | `['dine in', 'takeaway', 'to go', 'parcel']` |
| `specialInstructions` | Domain-specific modifiers | `['less spicy', 'extra cheese', 'eco friendly']` |
| `domainTerms` | Domain-only nouns for routing | `['menu', 'dish', 'chef', 'kitchen']` |
| `bookingTerms` | Booking trigger words | `['reserve', 'table', 'appointment']` |
| `romanUrdu` | Roman Urdu → English mappings | `chahiye → want`, `safai → cleaning` |

### Domain coverage

| Domain | Typos | Abbreviations | Synonyms | Roman Urdu |
| --- | --- | --- | --- | --- |
| restaurant | 23 | 12 | 5 | 18 |
| salon | 8 | 6 | 5 | 5 |
| cleaning | 14 | 6 | 7 | 7 |
| retail | 12 | 8 | 7 | 4 |
| healthcare | 8 | 6 | 4 | 3 |
| education | 4 | 5 | 5 | 3 |
| driving_school | 4 | 3 | 4 | 3 |
| universal | 7 | 4 | — | 7 |

### Updated: `packages/tenant-adapter/src/tenantAdapterRegistry.js`

The registry now auto-generates domain adapter classes from the vocabulary module. Adding a new domain or new terms is a one-file change to `domainVocabulary.js` — no need to write a new adapter class. Unknown domains get the universal fallback adapter automatically.

### Helper functions exported

- `getDomainVocabulary(domain)` — returns the vocabulary for a domain (falls back to universal)
- `enrichText(text, domain)` — applies typo + abbreviation + Roman Urdu corrections
- `hasOrderTypeVerb(text, domain)` — checks if text contains a domain-specific order-type phrase
- `hasSpecialInstruction(text, domain)` — checks if text contains a domain-specific special instruction

---

## Track 2: Network Resilience

### The problem

When a network issue occurs mid-flow (calendar service timeout, database connection drop, NLU provider 503), the previous behavior was:

1. The capability's `execute()` method throws
2. The catch block returns "Sorry, I could not complete that request right now."
3. The state is NOT saved (because `result.statePatch` is empty)
4. On the customer's next message, the workflow state may or may not still be there — depending on whether the failure happened before or after state changes were applied

The customer loses their place in the conversation and has to start over.

### The fix

Three layers of resilience, all in `packages/execution-engine/src/executionEngine.js`:

#### Layer 1: Transient error classifier (`isTransientError`)

Classifies errors as transient (worth retrying) or permanent (won't succeed on retry):

**Transient** (customer gets "please retry" reply):
- Network errors: `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ECONNABORTED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`
- HTTP 5xx: 502, 503, 504
- "timeout" / "network" in error message
- `STALE_STATE` (optimistic-lock conflict — customer can retry)
- Calendar service timeouts
- Database/repository failures

**Permanent** (customer gets "sorry" reply without retry promise):
- HTTP 4xx: 404, 400
- Validation failures
- Unknown errors (default — don't promise a retry that won't work)

#### Layer 2: Retry-ready reply preserves workflow state

When `match.capability.execute()` throws:

1. The pre-failure `state` (which still has the active workflow — `booking.collecting`, `commerce.checkout`, `cleaning.sofa_cleaning` etc.) is preserved
2. The customer's failed message is logged in `state.context.lastFailure` with the capability, intent, error, and timestamp
3. The reply says: "⚠️ A network issue stopped that request from completing. Your order/booking is still saved — please send your message again." (translated to Roman Urdu / Urdu based on conversation language)
4. On the NEXT message, the customer's retry finds the workflow still active and resumes normally

#### Layer 3: Stale-state retry

When `stateRepository.save()` throws `STALE_STATE` (a concurrent request updated the conversation between our read and write):

1. Re-read the current state from the repository
2. Re-apply our patch on top of the fresh state
3. Retry the save once
4. If the retry also fails, log the error but don't crash — the reply is still valid

#### Layer 4: Intelligence engine failure preservation

When `conversationIntelligenceEngine.analyze()` itself throws (NLU provider timeout):

1. Don't fall through to a generic "I'm not sure" reply
2. Check if there's an active workflow (`booking.collecting`, `commerce.checkout`, `cleaning.*`)
3. If yes → return "⚠️ A network issue stopped me from understanding your message. Your order/booking is still saved — please send your message again."
4. If no → return "⚠️ A network issue stopped me from understanding your message. Please try again."
5. Either way, preserve the workflow state

---

## Test Coverage

New test file: `tests/sprint44.v44-network-resilience.integration.test.js` with 26 tests:

### Group F — Error classifier unit tests (11 tests)
- F1: ETIMEDOUT is transient
- F2: ECONNRESET is transient
- F3: HTTP 503 is transient
- F4: HTTP 502 is transient
- F5: STALE_STATE is transient
- F6: "timeout" in message is transient
- F7: "network" in message is transient
- F8: HTTP 404 is NOT transient (permanent)
- F9: HTTP 400 is NOT transient (permanent)
- F10: Generic validation error is NOT transient
- F11: null error is NOT transient

### Group G — Workflow preservation integration tests (5 tests)
- G1: Booking flow survives a transient calendar service failure
- G2: Commerce checkout flow survives a transient catalog validation failure
- G3: Customer can retry after a transient failure and complete the flow
- G4: Permanent error gets a different reply than transient error
- G5: Intelligence engine failure preserves active workflow

### Group H — Domain vocabulary tests (10 tests)
- H1: Restaurant vocabulary enriches common typos (`chiken → chicken`, `biriyani → biryani`)
- H2: Salon vocabulary enriches "hair cut" to "haircut"
- H3: Cleaning vocabulary enriches "safai" to "cleaning"
- H4: Retail vocabulary enriches "tshirt" to "t-shirt"
- H5: Unknown domain falls back to universal vocabulary
- H6: Restaurant `hasSpecialInstruction` detects "less spicy"
- H7: Cleaning `hasSpecialInstruction` detects "eco friendly"
- H8: Restaurant `hasOrderTypeVerb` includes "dine in" and "takeaway"
- H9: Tenant adapter registry returns adapter for all 7 known domains
- H10: Unknown domain gets universal fallback adapter

---

## Files Changed

| File | Change |
| --- | --- |
| `packages/tenant-adapter/src/domainVocabulary.js` | **New file** — 7 domain dictionaries + universal fallback + helper functions |
| `packages/tenant-adapter/src/tenantAdapterRegistry.js` | Auto-generates domain adapter classes from vocabulary module; universal fallback for unknown domains |
| `packages/execution-engine/src/executionEngine.js` | (1) Transient error classifier `isTransientError()`; (2) retry-ready reply in capability execute catch block; (3) stale-state retry in `#finalize`; (4) intelligence engine failure preservation |
| `tests/sprint44.v44-network-resilience.integration.test.js` | **New file** — 26 tests across 3 groups |
| `package.json` | Version 43.0.0 → 44.0.0 |

---

## Full Test Suite Results

| Suite | Tests | Pass |
| --- | --- | --- |
| sprint43.variation-coverage | 273 | 273 |
| sprint6.commerce | 3 | 3 |
| sprint5.catalog | 6 | 6 |
| sprint12.commerce-orchestration | (not run in this batch) | — |
| sprint42.v42-modification-operations | 20 | 20 |
| sprint42.1.v42-1-bugfixes | 9 | 9 |
| sprint44.v44-network-resilience | 26 | 26 |
| **Total** | **337** | **337** |

---

## How Network Resilience Works in Practice

**Before v44.0** (customer loses place):
```
Customer: book beard grooming tomorrow at 5pm
Nova: What time would you prefer?
Customer: 5pm
Nova: What is your full name?
Customer: Ahmed
Nova: What is your phone number?
Customer: 03009999999
[NETWORK ERROR — calendar service timeout]
Nova: Sorry, I could not complete that request right now.
Customer: (confused — what do I do now?)
```

**After v44.0** (customer retries and completes):
```
Customer: book beard grooming tomorrow at 5pm
Nova: What time would you prefer?
Customer: 5pm
Nova: What is your full name?
Customer: Ahmed
Nova: What is your phone number?
Customer: 03009999999
[NETWORK ERROR — calendar service timeout]
Nova: ⚠️ A network issue stopped that request from completing. Your order/booking is still saved — please send your message again.
Customer: 03009999999  ← retries the same message
Nova: ✅ Booking request received — Reference: BKG-XXXX
```

The workflow state (booking.collecting + pendingField='phone') was preserved across the failure, so the customer's retry resumes exactly where they left off.

---

## What's Next

Possible follow-up sprints:
- **Production NLU integration** — feed the 273-case variation corpus as training examples to the Groq remote NLU
- **Multi-turn context intelligence** — pronoun resolution ("book it again", "same time as last week")
- **Production observability** — log every transient failure, auto-cluster, alert on patterns
- **Tenant-specific vocabulary overrides** — let tenants add their own typos/synonyms via a config file (currently all domains use the shared dictionary)
