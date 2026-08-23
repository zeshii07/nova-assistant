# Tenant Knowledge Setup

Each tenant owns its approved assistant facts:

```text
tenants/<tenantId>/
├── profile.json
└── knowledge/
    ├── business.json
    └── faqs.json
```

To onboard a tenant, copy the default folder and change only tenant files. Do not edit assistant source code for normal onboarding.

`business.json` may include description, services, hours, contact, location, delivery, paymentMethods, and returns.

`faqs.json` is an array of `{ "question": "...", "answer": "..." }` objects.
