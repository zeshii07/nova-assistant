# Nova v6.2 — State Ownership & Domain Boundaries

## Why this patch exists
The v6.1 stress test exposed a small but dangerous class of state bugs: a side product selection could coexist with checkout and a product attribute such as `black` could be consumed as the delivery city.

v6.2 formalizes ownership rules.

## Checkout vs product draft
- Checkout remains paused while the customer explores/adds another item.
- Explicit product-draft attribute replies belong to Catalog, not delivery slots.
- `add this` may refer to the currently selected product or the single explicitly suggested alternative.
- If all attributes/quantity are present, the item is added and checkout resumes at the exact previously pending field.
- Product attribute values such as configured colors/sizes are rejected as delivery cities.

## Cart inspection
During checkout:
- `show my cart`
- `show my full cart`
- `show my order`

show the current cart and preserve the pending checkout field.
They do not reset checkout or display an unrelated active product draft.

## Pricing interruption
A price/quote question outranks a pending cleaning date/time field.
Non-standard scopes such as a complete office floor containing multiple shops return the configured base price and offer a custom quotation rather than being validated as a date.

## Domain boundaries
Queries that clearly target another business domain no longer return arbitrary current-tenant offerings.

Examples:
- Cleaning tenant + doctor query -> states healthcare/provider data is not configured.
- Cleaning tenant + admissions query -> states education/admission data is not configured.
- Cleaning tenant + retail product query -> states retail catalog data is not configured.
- Healthcare tenant + doctor query -> lists configured clinic services and explicitly states that individual doctor/provider profiles are not configured when absent.

Nova never invents provider names.

## Product aliases remain authoritative
If a tenant explicitly configures `school bag` as an alias of `Urban Backpack`, that is an exact supported identity and is allowed to resolve directly.
