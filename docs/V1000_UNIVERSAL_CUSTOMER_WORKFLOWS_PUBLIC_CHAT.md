# Nova v10.0.0-alpha.1 — Universal Customer Workflows and Public Assistant

Nova v10 moves the conversation improvements in this release into shared
engines and data contracts. No tenant-specific branch is required for a newly
onboarded business to reuse customer details, collect product options, or apply
the booking cancellation policy.

## Public customer chat

- `GET /assistant` serves the customer-facing Nova chat interface.
- `GET /chat` is an alias for the same interface.
- `POST /api/chat` remains the public conversation endpoint.
- `GET /api/public/tenants` returns only safe tenant identity fields used by the
  selector: ID, business name, domain, and assistant name.
- `GET /developer` remains the development and Control Plane interface;
  `GET /developers` is a compatible alias.
- CRM inspection now requires developer authorization; it is not exposed to the
  public chat page.

The browser creates an anonymous customer ID locally. Starting a new chat or
switching businesses creates a new conversation identity without deleting CRM,
orders, bookings, or service history.

## Shared customer memory

The universal engagement contract recognizes explicit saved-detail requests as
well as contextual short replies such as “use,” “use it,” “same one,” and common
misspellings of “previous.” Cleaning, Commerce checkout, and config-driven
Booking reuse tenant-scoped CRM data only after the customer asks to use it.
Available saved values are shown first so the customer can reuse or replace
them knowingly.

## Product option collection

- A color or size with exactly one configured value is selected automatically.
- All remaining color, size, and quantity decisions are requested together.
- Combined answers such as `2 pieces 24 cm` resolve quantity `2` and size
  `24cm`; a numeric dimension cannot overwrite an explicit quantity.
- Commerce remains the transactional owner of the cart and order.

## Services, prices, and cancellation

- Generic furniture is a configured choice group, not a fake custom bundle.
- Sofa, carpet, mattress, curtain, dining chair, office chair, and table options
  are loaded from tenant service data. Office chairs and tables use demo rates
  of AED 35 per chair and AED 45 per table.
- Scope fields needed for a furniture estimate are collected before date,
  address, and contact details.
- Cleaning and generic Booking share the cancellation policy: no active records
  produces an honest “nothing to cancel” response, one record is cancelled
  directly, and multiple records require the customer-facing reference.

## Calendar behavior

The SparkleCare demo previously enabled the local capacity calendar by default.
That is why a slot could be reported unavailable without an external calendar
connection. The demo is now opt-in (`calendar/config.json` has `enabled: false`).
With no enabled calendar Nova records a request and clearly says the team must
confirm availability. Businesses that configure a calendar still receive live
holds, conflicts, rescheduling, and capacity release on cancellation.

## Environment configuration

Runtime secrets and deployment settings belong in the ignored `.env` file.
The legacy `.env.example` template is not part of the v10 workspace. Setup and
required variable names are documented without publishing real secret values.

## Verification

```powershell
npm run benchmark:v10.0.0
```

The release gate runs the v10 regression suite, the complete automated suite,
conversation datasets, static validation, and state-safety audit.
