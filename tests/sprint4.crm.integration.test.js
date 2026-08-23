const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContainer } = require("../apps/api/src/container");

test("CRM capability updates profile and assistant uses official name", async () => {
  const container = await buildContainer();
  const base = { tenantId: "default", customerId: "crm-user", channel: "http" };
  let result = await container.executionEngine.process({ ...base, text: "my name is Zeeshan Ahmad" });
  assert.equal(result.capabilityId, "crm"); assert.match(result.reply, /Zeeshan Ahmad/);
  result = await container.executionEngine.process({ ...base, text: "add tag vip" });
  assert.equal(result.capabilityId, "crm");
  result = await container.executionEngine.process({ ...base, text: "show my profile" });
  assert.match(result.reply, /vip/); assert.match(result.reply, /Zeeshan Ahmad/);
  result = await container.executionEngine.process({ ...base, text: "hello" });
  assert.equal(result.capabilityId, "assistant"); assert.match(result.reply, /Hello, Zeeshan Ahmad!/);
  const customer = await container.crmService.getCustomer("default", "crm-user");
  assert.equal(customer.name, "Zeeshan Ahmad"); assert.equal(customer.preferredLanguage, "english");
  assert.ok((await container.crmService.listActivities("default", "crm-user")).length >= 4);
});
