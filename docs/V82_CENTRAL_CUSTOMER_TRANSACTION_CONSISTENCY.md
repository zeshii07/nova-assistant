# Nova v8.2 — Central Customer & Transaction Consistency

## Central customer-data bridge

CRM synchronization is no longer a responsibility of Commerce, Cleaning, Salon, Clinic, Driving School, or any other individual business capability.

After every successful capability execution, the Execution Engine runs `CustomerDataBridge`.

The bridge reads only validated, standard capability-state containers:

- top-level capability state identity/contact fields
- `fields`
- `slots`
- `customer`
- `checkout`
- `contact`
- `profile`

Supported customer fields include name/fullName/customerName/patientName/parentName, phone/contactNumber/phoneNumber, email, city, address/serviceAddress/deliveryAddress, and landmark.

This allows a future capability to inherit CRM persistence automatically when it follows Nova's standard engagement-state contract.

CRM sync failure is non-blocking and cannot break the customer workflow.

## Tenant isolation

Every bridge update is scoped by:
- tenantId
- customerId

One tenant can never update another tenant's customer profile.

## Transaction visibility

The Developer Data Inspector now separates and aggregates:
- Commerce orders
- Generic bookings
- Service requests

Cleaning requests are no longer hidden merely because they live in the service-request repository instead of the generic booking repository.

The API also exposes a `transactions` aggregate containing orders, bookings, and serviceRequests.

## Service identity integrity

The shared pricing engine now enforces:

> Pricing may refine a selected service, but it may not silently replace an explicitly requested operational service.

An explicit Deep Home Cleaning request cannot be finalized as Standard Home Cleaning because a property-size pricing matrix points to a different operational service.

If the pricing table conflicts with the requested service identity, Nova preserves the actual service and uses that service's configured price/workflow instead of applying the unrelated table.

## Mixed social + task messages

Social intents such as gratitude, greeting, small talk, or goodbye are lowered when the same message also contains a real operational request.

Example:

`ok thanks but i want a pair of shoes in black color`

routes to Catalog while still allowing humanization to acknowledge the social tone.

## Domain-neutral workflow resume

Booking/Cleaning/Offering workflows now resume with service/request language instead of retail-only wording such as "delivery name".

## Repository compatibility fix

In-memory service-request listing no longer uses `.map(structuredClone)`, which is unsafe on current Node versions because Array.map passes the item index as `structuredClone`'s second argument.

## Benchmark

- v8.2 central consistency contracts: 6/6
- complete automated suite: 323/323
- conversation corpus: 156/156
- JavaScript syntax: 252 files
- state-safety audit: pass
