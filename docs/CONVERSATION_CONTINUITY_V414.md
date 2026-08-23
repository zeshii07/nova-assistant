# Nova v4.14 — Conversation Continuity Patch

## Fixed
- Commerce add-item flow preserves explicit unit quantities such as `2kg daal`, `4 packs oil`, and similar quantity+unit forms.
- Cleaning workflows treat a new property comparison/change as a new service/quotation intent instead of consuming it as a pending date/time field.
- Unpriced property combinations no longer silently fall back to Standard Home Cleaning pricing; they request a custom quotation.
- Roman Urdu booking/service collection remains Roman Urdu across short answers such as `kal`, numeric times, addresses, names, and phone numbers.
- Universal date parsing now accepts `kal` as tomorrow and `aaj` as today in future-oriented booking flows.
- Cleaning name, phone, date, time and address prompts/validation have Roman Urdu and Urdu variants.
- Experience language continuity now prioritizes the active conversation language over an older CRM language value.

## Pricing integrity
The cleaning-demo pricing table currently contains property matrix prices through 3 bedrooms. A 4-bedroom villa therefore correctly returns a custom-quotation response instead of inventing a price. Add a `villa|4` entry to the tenant pricing JSON when the business supplies that price.

## Verification
- 211/211 automated tests passed.
- 156/156 conversation corpus cases passed.
- Syntax check passed for 209 JavaScript files.
- Manual regression verified Roman-Urdu cleaning detail collection and 4-bedroom property interruption behavior.
