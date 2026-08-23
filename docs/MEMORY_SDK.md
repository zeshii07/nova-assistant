# Memory SDK

A capability receives memory through:

```js
context.services.memory
```

## Public API

```js
await memory.put("favoriteColor", "Black");
await memory.value("favoriteColor");
await memory.get("favoriteColor");
await memory.list({ tags: ["history"] });
await memory.remove("favoriteColor");

await memory.setPreference("language", "roman_urdu");
await memory.getPreference("language");
await memory.appendHistory("assistant.message", { intent: "greet" });
```

## Options

`put()` accepts:

- `scope`: `conversation`, `customer`, or `tenant`
- `tags`: searchable string tags
- `expiresAt`: ISO timestamp
- `sensitivity`: classification label
- `metadata`: non-business metadata

Do not store secrets, payment credentials, authentication tokens, or unnecessary sensitive personal data.
