# Sprint 1 Architecture

## Dependency direction

`apps/api` composes the system. Packages do not import the API application.

```text
API composition root
  -> channel registry
  -> conversation orchestrator
      -> tenant repository
      -> plugin manager
      -> state repository
```

## Package responsibilities

### config
Loads `.env`, validates process configuration, and returns immutable config.

### logger
Writes structured JSON logs and supports child context.

### tenant
Loads and validates tenant profiles. Future storage implementations can replace the file repository.

### plugin
Registers capabilities and selects an enabled plugin using `canHandle(context)`.

### state
Defines the shared conversation state and repository contract. Sprint 1 uses memory storage.

### channel
Normalizes channel-specific inputs and formats outputs. The core never imports WhatsApp or HTTP code.

### conversation
Coordinates tenant, state, and plugins. It does not implement business capabilities.

### shared
Contains common errors and identifiers.

## Stable interfaces

### Plugin

```js
{
  id: "assistant",
  async canHandle(context) {},
  async execute(context) {
    return { reply: "...", statePatch: {} };
  }
}
```

### Channel adapter

```js
{
  id: "http",
  normalizeIncoming(payload) {},
  formatOutgoing(result) {}
}
```

### State repository

```js
{
  async get(conversationId) {},
  async save(state) {},
  async delete(conversationId) {}
}
```

## Multi-tenancy

Conversation IDs use:

```text
tenantId:channel:customerId
```

Tenant capabilities determine which plugins are eligible. Core code does not change when onboarding a tenant.
