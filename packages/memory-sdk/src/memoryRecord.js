const VALID_SCOPES = new Set(["conversation", "customer", "tenant"]);

/**
 * Creates a validated platform-memory record.
 * Memory is tenant-isolated and namespaced by the owning capability.
 */
function createMemoryRecord(input) {
  if (!input || !input.tenantId || !input.namespace || !input.key) {
    throw new TypeError("Memory record requires tenantId, namespace, and key.");
  }
  const scope = input.scope || "customer";
  if (!VALID_SCOPES.has(scope)) throw new TypeError(`Unsupported memory scope: ${scope}`);
  if (scope === "customer" && !input.customerId) throw new TypeError("Customer memory requires customerId.");
  if (scope === "conversation" && !input.conversationId) throw new TypeError("Conversation memory requires conversationId.");
  const now = new Date().toISOString();
  return Object.freeze({
    id: input.id || `${input.tenantId}:${scope}:${input.namespace}:${input.key}:${input.customerId || input.conversationId || "tenant"}`,
    tenantId: input.tenantId,
    customerId: input.customerId || null,
    conversationId: input.conversationId || null,
    scope,
    namespace: input.namespace,
    key: input.key,
    value: structuredClone(input.value),
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(String))] : [],
    sensitivity: input.sensitivity || "standard",
    expiresAt: input.expiresAt || null,
    createdAt: input.createdAt || now,
    updatedAt: now,
    metadata: structuredClone(input.metadata || {})
  });
}

function isExpired(record, now = Date.now()) {
  return Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= now);
}

module.exports = { createMemoryRecord, isExpired, VALID_SCOPES };
