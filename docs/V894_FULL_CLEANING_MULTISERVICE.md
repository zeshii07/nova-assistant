# Nova v8.9.4 — Full cleaning catalog and multi-service composition

v8.9.4 turns `cleaning-demo` into a realistic, standalone Dubai test tenant.
It is not a Justlife tenant, clone or affiliate. Public Justlife UAE pages are
used only as a dated catalog and pricing benchmark.

## Tenant business truth

The cleaning service repository now contains more than 30 active services in
these categories:

- home and recurring cleaning;
- apartment, villa, deep and post-renovation cleaning;
- move-in and move-out cleaning;
- office, commercial and housekeeping services;
- kitchen, bathroom, floor, balcony and interior-window cleaning;
- sofas, sofa beds, L-shaped sofas, dining chairs, mattresses, curtains,
  carpets and furniture packages;
- AC, duct, sanitisation and pest-control services;
- wash/fold, ironing, wash/iron and home-care laundry packages.

Structured data remains authoritative: service names, aliases, categories,
active status and customer-safe prices live in
`tenants/cleaning-demo/cleaning/services.json`; formulas and matrices live in
`tenants/cleaning-demo/pricing/services.json`; availability membership lives in
`tenants/cleaning-demo/availability/services.json`; policies and explanatory
facts live in tenant knowledge.

## Pricing rule and provenance

Every stored amount tied to a public benchmark is exactly 10% lower than that
captured public amount. The transformed value is the configured tenant price,
so the discount engine must not subtract another 10%.

Examples include AED 31.50 per cleaner-hour from AED 35, AED 170.10 for the
published 3-seat sofa benchmark of AED 189, AED 31.50 per dining chair from AED
35, and AED 94.50 for the published small-curtain benchmark of AED 105. The
move-in/out and laundry tables use the same calculation.

Many services expose scope publicly but not a stable public checkout amount.
Those records intentionally use `priceType: custom_quote`; Nova records the
scope and creates a quotation handoff instead of inventing a fixed price.
`tenants/cleaning-demo/pricing/sources.json` records the source URL, capture date
and transformation policy.

## Conversation behavior

The shared cleaning matcher normalizes common inflections such as `clean`,
`cleaning` and `cleaned`, prefers longer specific service identities, and
prevents generic home requests from becoming deep or move services.

Multi-service language is additive. During any collection step, `also`, `add`,
`both`, `plus`, or two distinct conjoined service identities produce separate
service lines. Repeating an already selected service is idempotent. Schedule,
address and customer fields remain shared until the customer explicitly changes
them, and confirmation writes one durable request record per service.

Composite service names are not decomposed. A post-renovation villa request is
one scoped custom-quote service even if its description contains `deep clean`,
`villa`, floors, windows and construction dust.

Broad collection questions remain broad. A domain collection noun such as
`fruits` lists that tenant's matching products, while an exact product or service
still opens its normal detail or transaction flow.

## Release gate

```bash
npm run benchmark:v8.9.4
```

The gate runs the focused cleaning/catalog regressions, the full Node test
suite, every shipped conversation case, structural validation and the state-
safety audit.
