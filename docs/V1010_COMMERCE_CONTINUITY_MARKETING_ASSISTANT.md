# Nova v10.1.0 — Commerce Continuity and Public Marketing Assistant

## Release outcome

Nova v10.1.0 separates the public Nova product conversation from tenant customer
workflows and makes checkout continuity match what customers naturally expect.
The release is configuration-independent: commerce behavior is implemented in
the shared capability and engagement layers, so it applies to current and newly
onboarded retail tenants.

## Commerce behavior

### Fresh tenant tests use a fresh cart

Changing the selected tenant in the developer console now clears that
tenant/customer's active cart together with conversation state. CRM profiles,
confirmed orders, bookings, and service history remain intact. This prevents an
unfinished cart from an earlier test appearing as lines in a new order.

The regular reset control can still be used for conversation-state-only testing.
The explicit **Fresh test** control continues to clear both state and active cart.

### Saved checkout details are one profile

When Nova displays a saved checkout profile, it treats those values as the
baseline for the current checkout:

- `use my details`, `use previous details`, and equivalent phrases reuse the
  complete available profile.
- Editing one field, such as `update my name to Aryan`, retains saved phone,
  email, city, address, landmark, and payment method values.
- `confirm`, `ok`, or `done` accepts a complete displayed profile and places the
  current cart without restarting the sequential contact form.
- If a required value is genuinely missing, Nova asks only for that value.

Only the active cart is submitted. Confirmed order history is never copied into
a new cart.

### Proactive returning-customer review for cleaning

Cleaning workflows no longer wait for a returning customer to type `use my old
address`. As soon as the requested service, pricing scope, date, and time are
complete, Nova checks the current tenant's saved customer profile. If a saved
service address exists, it displays the complete available name, phone, optional
email, and address together with the request summary.

The customer can say `keep all details the same`, `confirm`, or identify one
field to change. Nova asks a detail question only for a new customer or when a
required value is genuinely absent from the saved profile.

### Adding products during checkout

Phrases such as `add some shoes in this order` are treated as new product
requests. The word `this` in `this order` is no longer interpreted as a request
to add the previously selected product again. Missing color, size, and quantity
are requested together, while sole options are selected automatically.

## Public Nova marketing assistant

`GET /assistant` and `GET /chat` serve the public marketing interface. It has no
tenant selector and does not read tenant customer data. The interface calls:

```text
POST /api/assistant/chat
```

Request body:

```json
{
  "conversationId": "public-generated-id",
  "text": "What can Nova do for my business?"
}
```

The public assistant supports friendly greetings and questions about Nova's
purpose, capabilities, business problems, use cases, pricing context, and
creator. For creator questions it explains that Zeeshan made Nova with love to
solve customer-related automations for businesses. Each answer invites a useful
follow-up conversation.

The modern responsive interface presents Nova as a technology product rather
than a tenant storefront. Its adaptive suggestion chips change after each
answer, and short replies such as `yes please` can continue the previous topic.
The expanded deterministic product guide also covers supported industries,
channels, onboarding, languages, privacy and tenant isolation, human handoff,
chatbot comparisons, customization, architecture, integrations, Render/cloud
deployment, analytics, bookings, commerce, and CRM memory.

Tenant-specific chat continues through tenant channels and the authenticated
developer playground. The existing tenant chat API is not used by the public
marketing page.

## Verification

Run the focused regression suite:

```powershell
node --require ./tests/test-env.js --test tests/sprint78.v101-commerce-marketing-assistant.integration.test.js
```

Run the complete release gate:

```powershell
npm run benchmark:v10.1.0
```
