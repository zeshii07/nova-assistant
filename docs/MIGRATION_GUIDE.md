# Capability Migration Guide

Migration is incremental:

1. Keep the existing `reply` for backward compatibility.
2. Add `responseModel` with a stable intent and factual payload.
3. Add tenant templates for the intent.
4. Add regression tests for the legacy facts and new wording.
5. Remove legacy wording only after all tenants have compatible templates.

Migrated in this milestone:

- Assistant greetings through legacy semantic normalization.
- CRM name updates.
- Catalog product lists and unavailable-product responses.
- Catalog product details through semantic payload with legacy fallback.
- Commerce checkout start and order confirmation.
