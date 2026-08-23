# CRM SDK

```js
const customer = await context.services.crm.getCustomer();
await context.services.crm.updateCustomer({ name: "Zeeshan Ahmad" });
await context.services.crm.addTag("vip");
await context.services.crm.addNote("Prefers evening contact");
await context.services.crm.recordActivity("catalog.viewed", { productId: "P001" });
```

Each operation requires a tenant permission scoped to the calling capability.
