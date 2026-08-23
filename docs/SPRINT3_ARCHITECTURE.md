# Sprint 3 Capability Framework

Sprint 3 changes Nova from a fixed assistant pipeline into a capability-driven execution platform.

## Request flow

1. A channel adapter normalizes the incoming message.
2. The Execution Engine resolves the tenant and loads conversation state.
3. It builds one immutable Capability Context.
4. The Capability Router evaluates enabled and permitted capabilities.
5. One capability wins based on confidence, then priority.
6. The capability returns a normalized Capability Result.
7. The Execution Engine applies namespaced state updates, publishes events, and persists state.
8. The channel sends the single returned reply.

## Frozen Sprint 3 decisions

- One winning capability per message. Chaining is deferred.
- Capabilities are local and trusted. Remote/marketplace execution is deferred.
- Capabilities never import one another.
- Cross-capability communication uses versioned events.
- Capability state is stored under `state.capabilityState[capabilityId]`.
- Tenants must both enable a capability and grant its permissions.
- Capability failures are isolated and return a safe response.
