const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  WhatsAppTenantConfigRepository,
  verifyWhatsAppSignature,
  ProcessedMessageStore,
  parseWhatsAppWebhook,
  WhatsAppCloudClient,
  WhatsAppWebhookService
} = require("../src/whatsapp");

function enabledConfig() {
  return {
    tenantId: "default",
    enabled: true,
    graphVersion: "v23.0",
    phoneNumberId: "12345",
    accessToken: "token",
    verifyToken: "verify-me",
    appSecret: "app-secret",
    markRead: true,
    retries: 0,
    timeoutMs: 1000
  };
}

function payload({ id = "wamid.1", text = "hello", type = "text" } = {}) {
  const message = type === "text"
    ? { id, from: "923001234567", timestamp: "1", type, text: { body: text } }
    : { id, from: "923001234567", timestamp: "1", type: "interactive", interactive: { button_reply: { id: "yes", title: text } } };
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "12345" }, messages: [message] } }] }]
  };
}

test("signature verification uses exact raw bytes", () => {
  const rawBody = Buffer.from('{"hello":"world"}');
  const signatureHeader = `sha256=${crypto.createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
  assert.equal(verifyWhatsAppSignature({ rawBody, signatureHeader, appSecret: "secret" }), true);
  assert.equal(verifyWhatsAppSignature({ rawBody: Buffer.from("changed"), signatureHeader, appSecret: "secret" }), false);
});

test("parser normalizes text and interactive replies", () => {
  const textMessages = parseWhatsAppWebhook(payload(), "default");
  assert.equal(textMessages[0].channel, "whatsapp");
  assert.equal(textMessages[0].text, "hello");
  const buttonMessages = parseWhatsAppWebhook(payload({ id: "wamid.2", text: "Confirm", type: "interactive" }), "default");
  assert.equal(buttonMessages[0].text, "Confirm");
});

test("processed message store prevents duplicates and expires records", () => {
  let now = 1000;
  const store = new ProcessedMessageStore({ ttlMs: 10, now: () => now });
  store.add("a");
  assert.equal(store.has("a"), true);
  now = 1011;
  assert.equal(store.has("a"), false);
});

test("cloud client sends Meta-compatible text payload", async () => {
  let request;
  const client = new WhatsAppCloudClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.out" }] }) };
    }
  });
  await client.sendText(enabledConfig(), "923001234567", "Hello");
  assert.equal(request.url, "https://graph.facebook.com/v23.0/12345/messages");
  const body = JSON.parse(request.options.body);
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.type, "text");
  assert.equal(body.text.body, "Hello");
});

test("webhook service verifies subscription", () => {
  const service = new WhatsAppWebhookService({
    configRepository: { load: () => enabledConfig() },
    processedStore: new ProcessedMessageStore(),
    cloudClient: {}, executionEngine: {}
  });
  assert.deepEqual(service.verifySubscription({ tenantId: "default", mode: "subscribe", token: "verify-me", challenge: "42" }), { ok: true, statusCode: 200, challenge: "42" });
  assert.equal(service.verifySubscription({ tenantId: "default", mode: "subscribe", token: "wrong", challenge: "42" }).statusCode, 403);
});

test("webhook service executes and replies exactly once", async () => {
  const sent = [];
  const read = [];
  const processedStore = new ProcessedMessageStore();
  const service = new WhatsAppWebhookService({
    configRepository: { load: () => enabledConfig() },
    processedStore,
    cloudClient: {
      markRead: async (_config, id) => read.push(id),
      sendText: async (_config, to, text) => sent.push({ to, text })
    },
    executionEngine: {
      process: async (message) => ({ reply: `Reply: ${message.text}`, capabilityId: "assistant" })
    },
    logger: { info() {}, error() {} }
  });
  const first = await service.processPayload({ tenantId: "default", payload: payload() });
  const duplicate = await service.processPayload({ tenantId: "default", payload: payload() });
  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 0);
  assert.deepEqual(read, ["wamid.1"]);
  assert.deepEqual(sent, [{ to: "923001234567", text: "Reply: hello" }]);
});

test("tenant config keeps secrets in environment variables", () => {
  const path = require("path");
  const repo = new WhatsAppTenantConfigRepository({
    tenantsDir: path.resolve(__dirname, "../../../tenants"),
    env: {
      WHATSAPP_PHONE_NUMBER_ID_DEFAULT: "123",
      WHATSAPP_ACCESS_TOKEN_DEFAULT: "access",
      WHATSAPP_VERIFY_TOKEN_DEFAULT: "verify",
      WHATSAPP_APP_SECRET_DEFAULT: "secret"
    }
  });
  // The checked-in default is intentionally disabled until the operator enables it.
  assert.equal(repo.load("default").enabled, false);
});
