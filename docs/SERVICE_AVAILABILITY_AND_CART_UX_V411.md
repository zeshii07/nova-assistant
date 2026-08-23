# Nova v4.11 — Service Availability & Multi-Item Cart UX

## Multi-item retail UX
If one customer message contains multiple products, Nova now treats the response as a cart operation rather than rendering one product card.

Example:
`I want 2 kg rice and 4 packs of cooking oil`

Result:
- Rice × 2
- Cooking Oil × 4
- authoritative cart total
- prompt to add more or continue checkout

The multi-product extractor accepts unit constructions such as:
- `4 packs of cooking oil`
- `2 kg rice`
- `3 pieces of ...`
- `4 litres of ...`

Catalog explicitly yields multi-product messages to Commerce so a single product cannot hide the other items.

## Universal service availability
Every newly onboarded service tenant receives the `availability` capability and an `availability/services.json`.

The system separates three different questions:

1. Business opening hours
   - `Are you open Sunday?`
   - Direct yes/no from configured business hours.

2. Service support
   - `Can you clean my 1 bedroom apartment?`
   - `Do you provide physiotherapy?`
   - Direct yes/no from configured service/availability rules.
   - It does not dump the entire service list.

3. Live slot availability
   - `Are you available Monday for cleaning?`
   - Business-hours availability is checked first.
   - If the business is closed, Nova says no.
   - If open, Nova does NOT claim a real staff/provider slot is free unless a live availability provider confirms it.

## Provider architecture
`ServiceAvailabilityEngine` accepts `slotProviders`.

Current provider:
- StaticBusinessHoursProvider: determines whether the business operates that day.

Future providers can plug into the same interface:
- Google Calendar
- Microsoft/Outlook Calendar
- internal booking database
- staff/provider schedules
- CRM appointment inventory
- external scheduling APIs

A live provider can return:
- `available`
- `unavailable`
- `unknown`

Without one, Nova returns `requires_live_check` rather than inventing availability.

## Availability rules
Tenant-specific service applicability lives in:

`tenants/<tenant>/availability/services.json`

Example:

```json
{
  "rules": [
    {
      "serviceId": "home-cleaning",
      "label": "Standard Home Cleaning",
      "supported": true,
      "aliases": ["clean my apartment", "studio apartment cleaned"],
      "propertyTypes": ["studio apartment", "apartment", "flat", "house", "villa"]
    }
  ]
}
```

This is business knowledge/configuration, not hardcoded central conversation logic.

Generic service tenants automatically get rules from their configured offering aliases during onboarding.
