# Capability SDK

Each capability contains:

```text
capabilities/<id>/
├── manifest.json
├── src/index.js
├── tests/
└── README.md
```

The entry module exports `Capability`, a class extending `BaseCapability`.

## Required methods

- `canHandle(context)` returns `{ confidence, reason }`.
- `execute(context)` returns a normalized capability result.

## Lifecycle

- `initialize()` runs once during registration.
- `health()` reports readiness.
- `shutdown()` runs during unloading.

## Security

The capability receives only services injected through `context.services`. It must not directly import another capability.
