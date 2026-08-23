# Capability Manifest

```json
{
  "id": "assistant",
  "name": "Assistant",
  "version": "1.0.0",
  "entry": "./src/index.js",
  "priority": 10,
  "permissions": ["knowledge.read"],
  "events": ["assistant.responded.v1"]
}
```

`id`, `name`, `version`, and `entry` are required. Manifests are validated before executable code is loaded.
