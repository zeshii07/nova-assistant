# WhatsApp Setup

## 1. Enable the tenant channel

Edit `tenants/default/channels/whatsapp.json`:

```json
{
  "enabled": true,
  "graphVersion": "YOUR_META_GRAPH_VERSION",
  "phoneNumberIdEnv": "WHATSAPP_PHONE_NUMBER_ID_DEFAULT",
  "accessTokenEnv": "WHATSAPP_ACCESS_TOKEN_DEFAULT",
  "verifyTokenEnv": "WHATSAPP_VERIFY_TOKEN_DEFAULT",
  "appSecretEnv": "WHATSAPP_APP_SECRET_DEFAULT",
  "markRead": true,
  "retries": 2,
  "timeoutMs": 15000
}
```

Use the Graph API version shown for your Meta app. Keeping it configurable prevents a platform release from forcing a Nova code change.

## 2. Configure secrets

Copy `.env.example` to `.env` and fill:

```env
WHATSAPP_PHONE_NUMBER_ID_DEFAULT=
WHATSAPP_ACCESS_TOKEN_DEFAULT=
WHATSAPP_VERIFY_TOKEN_DEFAULT=a-long-random-string
WHATSAPP_APP_SECRET_DEFAULT=
```

Use a permanent system-user token for production rather than the temporary test token.

## 3. Expose localhost

Meta requires a public HTTPS callback. During local testing, expose port 3000 with a secure tunnel provider of your choice.

Callback URL:

```text
https://YOUR_PUBLIC_HOST/webhooks/whatsapp/default
```

Verification token: the same value as `WHATSAPP_VERIFY_TOKEN_DEFAULT`.

## 4. Subscribe webhook fields

Subscribe the WhatsApp Business Account to message events in the Meta app dashboard.

## 5. Start Nova

```powershell
npm run check
npm test
npm start
```

Send a WhatsApp message to the connected test/business number. The same Assistant, CRM, Catalog, Memory, and Commerce capabilities used by `/api/chat` will handle it.

## Production checklist

- Redis-backed webhook idempotency
- durable queue for webhook processing
- permanent system-user access token
- secret manager instead of a plaintext `.env`
- delivery-status persistence
- monitoring and alerting
- approved message templates for business-initiated messages outside the customer-service window
