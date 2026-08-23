const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelRegistry } = require("../src/channelRegistry");
const { HttpChatAdapter } = require("../src/httpChatAdapter");

test("normalizes HTTP chat messages", () => {
  const registry = new ChannelRegistry().register(new HttpChatAdapter());
  const message = registry.get("http").normalizeIncoming({ customerId: 123, text: "hello" });
  assert.equal(message.customerId, "123");
  assert.equal(message.channel, "http");
});
