# Universal Response Model

Capabilities should return structured meaning through `responseModel`:

```js
createCapabilityResult({
  responseModel: {
    intent: 'CATALOG_LIST_VIEWED',
    payload: {
      products,
      productLines
    }
  },
  statePatch,
  events
});
```

Fields:

- `intent`: stable uppercase semantic identifier.
- `payload`: business facts produced by the capability.
- `actions`: optional future channel actions.
- `suggestions`: optional follow-up suggestions.
- `metadata`: non-customer-facing diagnostic information.
- `flags`: rendering hints that do not change business truth.

Legacy string replies remain supported during migration.
