# Nova v4.15 — Review Field Editing

## Problem fixed
After checkout review, changing one customer field previously re-entered normal sequential checkout. For example:

`name change kr do` → new name → phone → city → address → landmark → payment again.

The existing checkout data was still stored, but workflow navigation incorrectly advanced through every field.

## New behavior
A review edit now creates an isolated edit state:

- `editingField`: the requested field
- `returnToReview: true`
- the rest of the checkout record remains untouched

After a valid replacement value is saved, Nova immediately returns to the complete review screen.

This applies to:
- name
- phone
- city
- address
- landmark
- payment method

Example:

`name change kr do`
→ ask only for name

`Zeeshan Ahmad`
→ update only name
→ return to review
→ preserve phone, city, address, landmark and payment method

## Name parsing
Roman-Urdu declarations such as:

`mera name zeeshan hai`

now store only `Zeeshan`, not the whole sentence.

## Regression protection
`sprint34.review-field-edit.integration.test.js` verifies the full review/edit flow and the preserved checkout record.
