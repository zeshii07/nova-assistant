# Nova v4.10 — Universal Service Pricing, Discounts & Human Handoff

## Central pricing engine
All service businesses can configure `pricing/services.json`. The engine supports:
- `hourly`: rate × hours × professionals
- `unit`: rate × units/seats/chairs/items
- `matrix`: combinations such as property type × bedrooms
- `flat`: fixed service price

Pricing is tenant data, not hardcoded conversation logic.

## Cleaning example
The demo includes examples:
- 2-bedroom apartment = $300
- 2-bedroom villa = $500
- hourly cleaner = $40/hour/professional
- sofa = $35/seat
- chair = $12/chair

These are demo tenant values and can be replaced entirely through `pricing/services.json`.

## Discounts
Discounts are configured in the same file. Supported types are `percent` and `fixed`, with optional `serviceIds` restrictions. Nova only offers a discount when the tenant configuration allows it.

## Universal onboarding
For a new service business, each offering may contain:
`pricing: { model: "hourly", rate: 150 }`
and the tenant can contain:
`discounts: [{ type: "percent", value: 5, enabled: true }]`.

The onboarding service generates the pricing JSON automatically.

## Human handoff
Human handoff is now implemented as a real central queue, not only a conversational acknowledgement.
A request such as `I want to talk to a human agent` creates a handoff record with:
- handoff reference
- tenant/customer/conversation IDs
- current workflow/capability state
- pending question
- goal/context
- original request
- status `open`

It emits `handoff.requested.v1`, ready for a future agent dashboard, CRM integration, WhatsApp assignment, webhook, or support platform connector.

Custom/unpriced combinations can also be surfaced as candidates for human quotation.
