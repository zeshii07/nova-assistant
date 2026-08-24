const crypto = require("crypto");
function createId(prefix = "id") {
  const token=crypto.randomBytes(5).readUIntBE(0,5).toString(36).toUpperCase().padStart(8,'0');
  return `${String(prefix).toUpperCase()}_${token}`;
}
function createConversationId(tenantId, channel, customerId) {
  if (!tenantId || !channel || !customerId) throw new Error("tenantId, channel, and customerId are required");
  return `${tenantId}:${channel}:${customerId}`;
}
module.exports = { createId, createConversationId };
