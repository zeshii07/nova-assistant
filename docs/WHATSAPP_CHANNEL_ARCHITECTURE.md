# WhatsApp Cloud API Channel

## Boundary

WhatsApp is a channel adapter. It does not contain assistant, catalog, CRM, or commerce logic.

```text
Meta webhook
  -> tenant route /webhooks/whatsapp/:tenantId
  -> verification/signature guard
  -> webhook parser
  -> Nova Execution Engine
  -> capability result
  -> WhatsApp Cloud API client
```

## Multi-tenancy

Each tenant owns `tenants/<tenantId>/channels/whatsapp.json`. The callback URL contains the tenant ID, so Nova can resolve the correct credentials without inspecting message content.

Example callback:

```text
https://YOUR_PUBLIC_HOST/webhooks/whatsapp/default
```

The JSON file stores only environment-variable names. Access tokens and app secrets stay in `.env` or a production secret manager.

## Security

- GET verification checks `hub.verify_token`.
- POST requests are checked using `x-hub-signature-256` and the exact raw bytes.
- Message IDs are deduplicated before execution.
- Unsupported media is ignored in v1 rather than converted into misleading text.
- A failed capability or send operation is isolated to that message.

## Reliability

The HTTP endpoint acknowledges valid webhook POSTs immediately and processes messages afterward. The client retries network failures, rate limits, and server failures with bounded exponential backoff.

The included idempotency store is in-memory. Replace it with Redis before running multiple API instances.
