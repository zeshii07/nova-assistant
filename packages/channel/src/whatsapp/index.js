module.exports = {
  ...require("./whatsappTenantConfigRepository"),
  ...require("./whatsappSignature"),
  ...require("./processedMessageStore"),
  ...require("./redisProcessedMessageStore"),
  ...require("./whatsappMessageParser"),
  ...require("./whatsappCloudClient"),
  ...require("./whatsappWebhookService")
};
