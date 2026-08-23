const { verifyWhatsAppSignature } = require("./whatsappSignature");
const { parseWhatsAppWebhook } = require("./whatsappMessageParser");

/** Coordinates verification, idempotency, execution and outbound replies. */
class WhatsAppWebhookService {
  constructor({ configRepository, processedStore, cloudClient, executionEngine, logger }) {
    this.configRepository = configRepository;
    this.processedStore = processedStore;
    this.cloudClient = cloudClient;
    this.executionEngine = executionEngine;
    this.logger = logger;
  }

  verifySubscription({ tenantId, mode, token, challenge }) {
    const config = this.configRepository.load(tenantId);
    if (!config.enabled || mode !== "subscribe" || token !== config.verifyToken) return { ok: false, statusCode: 403 };
    return { ok: true, statusCode: 200, challenge: String(challenge || "") };
  }

  authenticate({ tenantId, rawBody, signatureHeader }) {
    const config = this.configRepository.load(tenantId);
    return verifyWhatsAppSignature({ rawBody, signatureHeader, appSecret: config.appSecret });
  }

  async processPayload({ tenantId, payload }) {
    const config = this.configRepository.load(tenantId);
    const messages = parseWhatsAppWebhook(payload, tenantId);
    const results = [];
    for (const message of messages) {
      if (this.processedStore.has(message.messageId)) {
        this.logger?.info("whatsapp.duplicate_ignored", { tenantId, messageId: message.messageId });
        continue;
      }
      this.processedStore.add(message.messageId);
      try {
        if (config.markRead) await this.cloudClient.markRead(config, message.messageId);
        const result = await this.executionEngine.process(message);
        if (result?.reply) await this.cloudClient.sendText(config, message.customerId, result.reply);
        results.push({ messageId: message.messageId, ok: true, capabilityId: result?.capabilityId || null });
      } catch (error) {
        this.logger?.error("whatsapp.message_failed", { tenantId, messageId: message.messageId, error: error.message });
        results.push({ messageId: message.messageId, ok: false, error: error.message });
      }
    }
    return results;
  }
}
module.exports = { WhatsAppWebhookService };
