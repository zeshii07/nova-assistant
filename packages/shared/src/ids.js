const crypto = require("crypto");
function createId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}
function createConversationId(tenantId, channel, customerId) {
  if (!tenantId || !channel || !customerId) throw new Error("tenantId, channel, and customerId are required");
  return `${tenantId}:${channel}:${customerId}`;
}
module.exports = { createId, createConversationId };
