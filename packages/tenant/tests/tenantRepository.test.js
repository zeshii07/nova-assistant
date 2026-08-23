const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { FileTenantRepository } = require("../src/tenantRepository");

test("loads and validates a tenant profile", () => {
  const repository = new FileTenantRepository({ tenantsDir: path.resolve(__dirname, "../../../tenants") });
  const tenant = repository.getById("default");
  assert.equal(tenant.id, "default");
  assert.deepEqual(tenant.capabilities, ["assistant", "crm", "catalog", "commerce"]);
});
