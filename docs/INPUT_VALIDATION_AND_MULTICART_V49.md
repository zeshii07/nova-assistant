# Nova v4.9 — Input Validation & Multi-Product Hardening

## Central customer-detail validation
Universal Engagement now validates not only field shape, but whether the message is semantically appropriate for the requested field.

While waiting for name/address/city/phone/etc., messages such as:
- `do you have milk?`
- `what payment methods do you offer?`
- `cancel my order`
- `show my cart`

are never stored as customer details.

The active workflow remains paused until a valid field value arrives.

Name parsing also understands common typo declarations such as `my nme is Zeeshan`.

## Multi-product commerce
One sentence can contain several products:
`can i get 1 kg rice and 1 kg cooking oil`

Nova extracts the separate product mentions and quantities and syncs both into the authoritative cart.

A new product add request such as:
`add 2 pack of cooking oil`
is resolved against the catalog and cannot mutate the currently selected Rice quantity.

## Business facts vs catalog
Payment/policy language such as JazzCash, EasyPaisa, payment method, refund, warranty and bank transfer is excluded from Catalog routing.

Configured FAQs can directly answer payment questions instead of returning raw indexed JSON.

## Cleaning quote language
Requests such as `can i get free quote for a 2 bedroom apartment` are recognized by a cleaning tenant. If hours/cleaner count are missing, Nova explains the configured $40/hour/cleaner pricing and asks for the missing dimensions instead of falling back.
