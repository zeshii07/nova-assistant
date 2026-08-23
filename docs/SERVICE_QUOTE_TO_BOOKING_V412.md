# Nova v4.12 — Multi-Item Segmentation & Quote-to-Booking Bridge

## Product requests
Multi-product parsing is now segment based. Nova separates constructions such as:

`I want 1 kg rice and 2 liter cooking oil`

and creates an authoritative cart response containing both items.

The parser derives useful terms from both product names and aliases, so it is not dependent on one perfect alias.

Generic ambiguous requests are not guessed. Example:

`add 5 kg rice and 5 kg daal`

If the tenant has Dal Chana and Dal Moong:
- Rice is added.
- Nova asks which Daal the customer means.
- It does not silently choose one.

## Service quote → actionable workflow
A successful service quotation is now persisted as `quotedService` state containing:
- pricing service ID/name
- operational/bookable service ID
- dimensions used for the quote
- currency
- quoted amount
- pricing model

Therefore:

`quote for 2 bedroom villa`
→ `$500`

`add this service`
→ selects the quoted service
→ keeps the $500 quote
→ starts date/time/customer-detail collection

## Direct structured service requests
A request such as:

`I want 2 bedroom villa cleaning`

does not reopen the entire cleaning menu. Nova:
- resolves the pricing/service model
- calculates the configured estimate
- links it to the operational service
- starts the service-request workflow

## Supported vs unsupported booking requests
Availability and service booking cooperate:

`can I book deep cleaning`
- service exists
- Availability yields to Cleaning/Booking.

`can I book curtain cleaning`
- service does not exist
- Availability answers directly that it is not configured.

This prevents both false availability claims and unnecessary service-list responses.
