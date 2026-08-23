const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryCrmRepository } = require("../src/inMemoryCrmRepository");
const { CrmPermissionService } = require("../src/crmPermissionService");
const { CrmService } = require("../src/crmService");
const { EventBus } = require("../../event-engine/src/eventBus");

test("CRM isolates tenants and supports official profile operations", async () => {
  const repository = new InMemoryCrmRepository();
  const service = new CrmService({ repository, permissionService: new CrmPermissionService(), eventBus: new EventBus() });
  const tenant = { id: "a", permissions: ["crm.customer.read:crm","crm.customer.write:crm","crm.note.write:crm","crm.tag.write:crm","crm.activity.read:crm","crm.activity.write:crm"] };
  await service.ensureCustomer({ tenantId: "a", customerId: "1", channel: "http" });
  await service.ensureCustomer({ tenantId: "b", customerId: "1", channel: "http" });
  const crm = service.scope({ tenant, capabilityId: "crm", customerId: "1" });
  await crm.updateCustomer({ name: "Zeeshan Ahmad", email: "z@example.com" });
  await crm.addTag("VIP"); await crm.addNote("Prefers evening contact"); await crm.recordActivity("test.event", {});
  const customer = await crm.getCustomer();
  assert.equal(customer.name, "Zeeshan Ahmad"); assert.deepEqual(customer.tags, ["vip"]); assert.equal(customer.notes.length, 1);
  assert.equal((await service.getCustomer("b", "1")).name, null);
  assert.equal((await crm.listActivities()).length, 1);
});

test("CRM rejects unapproved capability access", async () => {
  const service = new CrmService({ repository: new InMemoryCrmRepository(), permissionService: new CrmPermissionService(), eventBus: new EventBus() });
  const crm = service.scope({ tenant: { id: "a", permissions: [] }, capabilityId: "assistant", customerId: "1" });
  await assert.rejects(() => crm.getCustomer(), /lacks crm.customer.read/);
});
