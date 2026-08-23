# Nova v9.2.1-alpha.1 — Unified catalog and pricing sources

## The rule

Nova exposes exactly two commercial editors:

| Business data | Authoritative editor | Runtime consumers |
|---|---|---|
| Products, variants, base prices, variant prices | Control Plane → Products & Prices | Catalog, cart, checkout, orders |
| Services, service variants, service price rules, add-ons, discounts | Control Plane → Services & Pricing | Offerings, cleaning, pricing, booking |

Knowledge Manager owns policies, FAQs, instructions and descriptive documents.
It cannot publish a price, product, service, inventory level, business hour or
calendar event.

## Services document

One published Services revision contains both service metadata and executable
rules. A service item has one or more `pricingRuleIds`; it does not repeat the
numeric price.

```json
{
  "kind": "cleaning",
  "currency": "AED",
  "items": [
    {
      "id": "CLN001",
      "name": "Standard Home Cleaning",
      "description": "Routine cleaning for apartments, villas and houses.",
      "aliases": ["standard cleaning", "home cleaning"],
      "active": true,
      "pricingRuleIds": ["hourly-cleaner"]
    }
  ],
  "pricingRules": [
    {
      "id": "hourly-cleaner",
      "name": "Hourly Cleaner Hire",
      "model": "hourly",
      "rate": 40,
      "currency": "AED",
      "operationalServiceId": "CLN-HOURLY"
    }
  ],
  "addOns": [],
  "discounts": []
}
```

Supported pricing models are `flat`, `hourly`, `unit`, `linear`, `matrix`,
`starting_from`, and `custom_quote`. `starting_from` and `custom_quote` rules
never produce an invented exact total.

Validation rejects direct service fields such as `price`, `currency`,
`priceType`, `pricingServiceId`, `pricePrefix`, `packages`, or a numeric price
claim in a service description. It also rejects missing/duplicate rule IDs,
unknown rule references, negative amounts and malformed model inputs.

## Products document

Products remain an array. The product row owns its base `price`; a variant may
own an optional `price` override. Inventory quantities are definitions used to
seed the separate live inventory ledger.

```json
[
  {
    "id": "P001",
    "sku": "POLO",
    "name": "Polo Shirt",
    "category": "clothing",
    "price": 2200,
    "currency": "PKR",
    "colors": ["Black"],
    "sizes": ["S"],
    "variants": [
      {
        "id": "POLO-BLK-S",
        "sku": "POLO-BLK-S",
        "attributes": { "color": "Black", "size": "S" },
        "price": 2300,
        "inventory": 5,
        "active": true
      }
    ]
  }
]
```

Product `pricingRuleId`, `pricingRuleIds`, `pricingServiceId`, and `priceType`
fields are rejected. There is no product-price editor in Knowledge Manager.

## Migration and compatibility

Existing installations may still contain shipped `pricing/services.json` files
or an older durable operational pricing override. Before a unified Services
revision exists, the Control Plane joins that legacy data with the service
catalog to produce a migration-ready document. The owner reviews and publishes
it once through Services & Pricing.

After publication, runtime pricing reads only the active Services revision.
Legacy values cannot override it. Cleaning and generic offering repositories
derive temporary compatibility fields from the active rule so older capability
code continues to operate without restoring a second editable source.

The old `GET|PUT /api/dev/operations/:tenant/pricing` boundary returns HTTP 410.

## Operator workflow

1. Select the tenant in `/developer`.
2. Open **Control Plane**.
3. Choose **Products & prices** or **Services & pricing**.
4. Load the effective resource and create a draft.
5. Edit one authoritative JSON document.
6. Save, validate and preview the diff.
7. Publish. Customer runtime changes only after this step.
8. Use revision history to roll back if required.

Run the complete acceptance gate:

```powershell
npm run benchmark:v9.2.1
```
