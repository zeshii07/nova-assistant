# Universal Semantic Disambiguation v2.7

This release strengthens Nova's domain-neutral semantic layer so meaning is resolved from context rather than the closest keyword.

## Core rules

- A number plus a duration unit (for example, `two hours`) is represented as a duration semantic role and is not treated as quantity.
- `business hours` requires schedule/open/close language; a bare `hours` token is not enough.
- Generic product-family/category questions (`what types of shoes`, `konsy shoes`) browse options rather than silently selecting the catalog's best product match.
- Specific product evidence (`Running Shoes`, `white t-shirt`, `Polo Shirt`) still routes to product details/selection.
- Service price questions containing duration are routed to service pricing semantics.
- The capability is not allowed to invent an hourly rate. If tenant data has no hourly pricing model, Nova asks which priced service is required.

## Semantic role example

```json
{
  "duration": {
    "value": 2,
    "unit": "hours",
    "role": "duration"
  }
}
```

The same role can later be mapped by Cleaning, Healthcare, Education, Legal, Beauty, Consulting, or other domain schemas.
