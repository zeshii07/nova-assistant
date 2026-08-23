/** Convert Meta webhook payloads into Nova's channel-neutral message model. */
function parseWhatsAppWebhook(payload, tenantId) {
  const parsed = [];
  if (!payload || payload.object !== "whatsapp_business_account") return parsed;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        const text = extractText(message);
        if (!text) continue;
        parsed.push({
          channel: "whatsapp",
          tenantId,
          customerId: String(message.from),
          messageId: String(message.id),
          text,
          metadata: {
            whatsapp: {
              messageType: message.type,
              timestamp: message.timestamp || null,
              phoneNumberId: value.metadata?.phone_number_id || null,
              displayPhoneNumber: value.metadata?.display_phone_number || null,
              contactName: value.contacts?.[0]?.profile?.name || null
            }
          }
        });
      }
    }
  }
  return parsed;
}

function extractText(message) {
  if (message.type === "text") return message.text?.body || null;
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
  }
  if (message.type === "button") return message.button?.text || null;
  return null;
}

module.exports = { parseWhatsAppWebhook, extractText };
