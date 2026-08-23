# Public Testing Guide

## Why this milestone exists

Before adding more SaaS features, stress-test the current platform across customers, businesses, capabilities, languages and channels.

## Retail tenant

Tenant ID: `default`

The demo catalog now has 18 products across seven categories: Clothing, Electronics, Accessories, Footwear, Home & Office, Bags, and Stationery.

### Three-user API test

Use a different `customerId` for each simulated customer. Conversation state, memory, CRM and commerce records are isolated by tenant + channel + customer.

```powershell
$base = "https://YOUR-HOST/api/chat"

Invoke-RestMethod -Method Post -Uri $base -ContentType "application/json" -Body '{"tenantId":"default","customerId":"customer-a","text":"i want silver sunglasses"}'
Invoke-RestMethod -Method Post -Uri $base -ContentType "application/json" -Body '{"tenantId":"default","customerId":"customer-b","text":"i want 2 black wireless earbuds"}'
Invoke-RestMethod -Method Post -Uri $base -ContentType "application/json" -Body '{"tenantId":"default","customerId":"customer-c","text":"i want black running shoes size 42"}'
```

For local automated transcripts run:

```powershell
node scripts/demo-multi-user.js
```

## Cleaning business tenant

Tenant ID: `cleaning-demo`

It enables Assistant + CRM + Cleaning, has its own knowledge, persona, templates and service data, and does not depend on the retail catalog.

```powershell
node scripts/demo-cleaning-business.js
```

Or use `/api/chat` with `tenantId: cleaning-demo`.

In v9.2, the local calendar provider checks tenant capacity when an exact date
and time are supplied. Final confirmation creates a durable calendar event; an
unavailable slot keeps the request unconfirmed and offers configured-time
alternatives. Flexible-time requests remain service requests until a team assigns
an exact slot.

## WhatsApp multi-user testing

With the `default` retail tenant, simply message the configured WhatsApp number from three different real phone numbers. WhatsApp's sender number becomes the customer identity, so each user gets isolated state automatically.

For the `cleaning-demo` tenant, test through HTTP until you configure a separate WhatsApp app/number or add production phone-number-to-tenant resolution. One Meta app callback is not a good long-term tenant resolver.

## What to evaluate

Test natural language, corrections, interruptions, English/Roman Urdu/Urdu, returning customers, catalog search, checkout, memory, CRM personalization, tenant personality isolation and failed/ambiguous requests.

## v9.2.1 commercial-source test

Open `/developer`, select a tenant, then open **Control Plane**.

- For `default`, load **Products & prices**, create a draft, change one product
  or variant price, validate, preview and publish. The new value must be used by
  product detail, cart subtotal and checkout.
- For `cleaning-demo`, load **Services & pricing**, change one pricing rule such
  as `hourly-cleaner.rate`, validate, preview and publish. The new value must be
  used by both service discovery and quotation calculations.
- Knowledge Manager must contain no pricing editor. A policy document may
  explain when a fee applies, but cannot replace the structured amount.
- Try adding `price`, `priceType`, or `pricingServiceId` directly to a service
  item. Validation must reject it as `duplicate_price_source`.
- Try referencing a nonexistent pricing rule or duplicating a product SKU.
  Validation must fail and the active customer-facing revision must remain
  unchanged.
