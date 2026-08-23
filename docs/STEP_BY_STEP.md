# Sprint 1 Step-by-Step Guide

## Step 1 — Configuration
Edit `.env` and tenant profile files. Do not place tenant business data in core packages.

## Step 2 — Tenant onboarding
Copy `tenants/default` to a new folder and change `profile.json`. The folder name and profile `id` must match.

## Step 3 — Add a plugin
Create a class with `id`, `canHandle`, and `execute`. Register it only in the API composition root. Add the plugin ID to the tenant's capabilities.

## Step 4 — Add a channel
Implement `normalizeIncoming` and `formatOutgoing`, then register the adapter in `apps/api/src/container.js`.

## Step 5 — Replace state storage
Implement `get`, `save`, and `delete`. Inject the repository in the composition root. The orchestrator remains unchanged.

## Step 6 — Validate
Run:

```bash
npm run check
npm test
```

Sprint 2 should not begin until both commands pass.
