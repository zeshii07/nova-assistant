module.exports = {
  ...require("./whatsappTenantConfigRepository"),
  ...require("./whatsappSignature"),
  ...require("./processedMessageStore"),
  ...require("./whatsappMessageParser"),
  ...require("./whatsappCloudClient"),
  ...require("./whatsappWebhookService")
};
