# Nova Developer Playground

Start Nova:

```powershell
npm start
```

Open:

```text
http://localhost:3000/developer
```

The Playground uses the same `ExecutionEngine.process()` path as WhatsApp. It is not a mock chat system.

## Panels

The chat panel lets you test any tenant/customer combination. The inspection panel displays:

- selected capability and intent
- extracted entities
- active workflow stack
- vocabulary matches
- all candidate intents and confidence values
- current conversation state
- replay records
- dataset-run results

## Public hosting security

If the Developer Console is reachable from a public host, set:

```env
NOVA_DEV_TOKEN=use-a-long-random-secret
```

Enter the same value into the Developer Console token field. All `/api/dev/*` endpoints return HTTP 401 without the correct token when this variable is configured.

Do not expose an unprotected Developer Console containing real customer replays in production.
