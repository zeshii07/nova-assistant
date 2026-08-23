/** Creates a normalized official CRM customer record. */
function createCustomerRecord(input) {
  if (!input?.tenantId || !input?.customerId) throw new TypeError("tenantId and customerId are required.");
  const now = input.updatedAt || new Date().toISOString();
  return {
    tenantId: String(input.tenantId),
    customerId: String(input.customerId),
    name: cleanNullable(input.name),
    phone: cleanNullable(input.phone),
    email: cleanNullable(input.email),
    preferredLanguage: cleanNullable(input.preferredLanguage),
    status: input.status || "contact",
    leadStage: input.leadStage || "new",
    source: input.source || "unknown",
    tags: uniqueStrings(input.tags),
    notes: Array.isArray(input.notes) ? input.notes.map(normalizeNote) : [],
    customFields: input.customFields && typeof input.customFields === "object" ? { ...input.customFields } : {},
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}
function normalizeNote(note) {
  return {
    id: note.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: String(note.text || "").trim(),
    author: note.author || "system",
    createdAt: note.createdAt || new Date().toISOString()
  };
}
function cleanNullable(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function uniqueStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v).trim().toLowerCase()).filter(Boolean))]; }
module.exports = { createCustomerRecord, normalizeNote };
