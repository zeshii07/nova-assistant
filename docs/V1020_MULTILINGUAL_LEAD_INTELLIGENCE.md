# Nova v10.2.0 — Multilingual Acquisition and Lead Intelligence

## Outcome

Nova v10.2.0 makes Urdu and Roman Urdu structural language a shared platform
feature and adds a tenant-independent inbound lead lifecycle. New tenants gain
these behaviors from their ordinary business profile, services, products,
prices, and policies; no tenant-specific code is required.

## Multilingual understanding

The shared lexicon is intentionally bounded to conversational structure. It
normalizes weekdays, relative days, time windows, Urdu/Arabic numerals, common
acquisition verbs, confirmations, corrections, and frequent Roman Urdu spelling
variants. Tenant nouns still come only from the active tenant's product,
service, offering, and knowledge data.

Supported temporal examples include:

- `hafta waly din` → the next Saturday
- `jumma waly din` or `جمعہ والے دن` → the next Friday
- `kal subha 10 baje` → tomorrow at 10:00
- `parson shaam 6 baje` or `پرسوں شام ۶ بجے` → day after tomorrow at 18:00
- `raat 8 baje`, `8 baje raat`, or `رات ۸ بجے` → 20:00

`kal` is interpreted as tomorrow inside a future booking field. Past-history
questions remain separate intents. A phrase that is genuinely ambiguous is
eligible for adaptive Groq interpretation when that provider is enabled, but
model output cannot write customer data or execute a transaction.

## Offering and universal engine behavior

The Universal Engine recognizes broader English, Urdu, and Roman Urdu ways of
wanting, buying, booking, or arranging something. The Offering Engine compares
configured tenant names and aliases with the meaningful noun tokens in a full
request, ignoring grammar such as `mujhe ... karwana hai`. Bounded edit distance
handles small noun typos without fuzzy-matching arbitrary customer fields.

This is deliberately not an unrestricted translation table. For an unfamiliar
business-specific Urdu term, the active tenant should provide that service or
product alias during onboarding; adaptive Groq can arbitrate uncertain wording
when configured.

## Roman Urdu confirmation and saved-profile safety

Checkout acceptance uses the same shared confirmation layer as the other Nova
workflows. Common Roman Urdu phrases and bounded typing variants such as
`confirm kr do`, `conirm kr do`, `ok thik hai`, and `theek hai bhej do` confirm
the current review instead of being parsed as a customer name or contact field.
Confirmation language is also rejected by the universal name, phone, address,
and city validators as a second safety boundary.

When Commerce has already displayed a complete saved customer and delivery
profile, accepting that review reuses every displayed value and places the
current cart. Nova asks for identity or delivery fields only when a required
value is actually missing or the customer explicitly asks to change it.

The tenant-neutral public `/chat` page now has English, Roman Urdu, and automatic
language modes. Its layout uses the available browser width on large displays
and remains scrollable and compact on smaller screens. The public page continues
to discuss Nova itself; tenant shopping and booking tests remain in the
developer interface.

## Lead lifecycle

The lead engine runs once in the central execution path after the business
capability has produced a validated result. It therefore applies to catalog,
commerce, cleaning, generic offerings, bookings, pricing, and availability.

Each active tenant/customer pair has one progressively enriched lead:

- `new`: first meaningful business signal
- `engaged`: multiple intent or requirement signals
- `qualified`: a configured interest plus a real phone number or email
- `converted`: Nova created a booking, service request, or order
- `lost`: reserved for an explicit operator lifecycle decision

The record includes a short `LD-XXXXXX` reference, tenant/customer/conversation
identity, source channel, validated CRM contact and location, deduplicated
interests, structured requirements, recent messages, intent signals, revision,
score, grade, missing qualification fields, and next best qualification
question. Scores are deterministic and explainable:

- interest: 20 points
- customer name: 10 points
- phone or email: 25 points
- structured requirement/schedule: 15 points
- service/delivery location: 10 points
- repeat engagement signals: up to 10 points
- completed transaction: 100 points

Grades are cold below 40, warm from 40, and hot from 75. The engine never
guesses a contact field. It observes the existing CRM and does not force extra
questions into an in-progress checkout or booking.

“Lead generation” here means converting inbound conversations into usable,
qualified business opportunities and next actions. Nova does not scrape,
purchase, or fabricate external prospect lists.

## Operator API

Both routes require the same Developer Console token as other `/api/dev/*`
operations and are tenant-scoped.

```http
GET /api/dev/leads?tenantId=cleaning-demo&status=qualified&grade=hot&limit=100
GET /api/dev/leads/LD-ABC123?tenantId=cleaning-demo
```

The list response returns both `summary` counters and `leads`. Tenant identity
is checked before any lead data is returned, and repository keys include both
tenant ID and lead ID.

## Persistence and events

Local deployments store leads in the configured operational data directory as
`leads.json`, using atomic file replacement. On Render, mount the same durable
volume used by `NOVA_OPERATIONAL_DATA_DIR`. The service emits:

- `lead.created.v1`
- `lead.updated.v1`
- `lead.converted.v1`

Lead observation is failure-isolated: storage or analytics failures are logged
but never replace the customer's response or break a transaction.

## Validation

Focused coverage:

```powershell
node --require ./tests/test-env.js --test tests/sprint80.v1020-multilingual-leads.integration.test.js
```

Complete release gate:

```powershell
npm run benchmark:v10.2.0
```

The release gate runs focused multilingual/lead tests, the complete Node test
suite, conversation datasets, static checks, and state-safety auditing.
