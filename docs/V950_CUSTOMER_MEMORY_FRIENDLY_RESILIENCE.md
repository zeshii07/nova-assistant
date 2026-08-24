# Nova v9.5.0-alpha.1 — Customer Memory and Friendly Workflow Resilience

This release improves returning-customer booking conversations without giving
CRM memory authority to submit or silently change a transaction.

## Customer-detail reuse

- Previous service addresses are shown when Cleaning asks for an address.
- “Use existing,” “use configured,” “use saved,” and common misspellings of
  “previous” resolve tenant-scoped CRM/request values.
- Saved name, phone, email, and the selected service address are shown before
  confirmation. Customers may update any single field explicitly.
- Profile and service-duration questions pause and resume pending collection
  instead of becoming invalid name or phone values.

## Conversation quality

- Multiple date alternatives are clarified instead of silently choosing one.
- Clear relative dates such as “can you do it today?” remain owned by Cleaning.
- Cleaning price answers are friendly and localized for English, Roman Urdu,
  and Urdu.
- Unsupported retail requests explain that the exact item is unavailable, then
  show useful categories and representative products.

## Public references and demo coverage

- New cleaning IDs use `CLN-XXXXXXXX`.
- Generic booking IDs use `BKG_XXXXXXXX`.
- Demo Store now contains at least 30 products across 12 categories.

## Verification

```powershell
npm run benchmark:v9.5.0
```
