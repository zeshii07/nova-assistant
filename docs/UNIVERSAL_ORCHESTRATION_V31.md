# Nova v3.1 — Universal Interruption & Strict Resolution

## Contract
Nova's core must not be modified per client. Tenant onboarding supplies business profile, approved knowledge, offerings, and booking configuration.

## Universal rules
1. Global commands and new-subject requests are interpreted before pending booking/checkout slots.
2. Pending fields accept only values that validate for that field.
3. Exact entity matches may execute. Fuzzy/partial matches may only be suggested. Unknown offerings are explicitly unavailable.
4. A paused booking/checkout remains recoverable after an informational interruption.
5. Tenant/domain context is isolated; Playground tenant changes reset conversation state.
6. Capabilities execute only against tenant-configured offerings and booking rules; they do not invent business facts.

## Client-specific data
- `tenants/<id>/profile.json`
- `tenants/<id>/knowledge/*`
- `tenants/<id>/offerings/*`
- `tenants/<id>/booking/config.json`

The universal engines remain shared across clients.
