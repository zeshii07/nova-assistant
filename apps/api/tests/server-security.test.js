const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeDeveloperRequest } = require("../src/server");

function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("developer API fails closed in production when its token is missing", () => {
  withEnvironment({ NODE_ENV: "production", NOVA_DEV_TOKEN: undefined }, () => {
    assert.equal(authorizeDeveloperRequest({ headers: {} }), false);
  });
});

test("developer API remains zero-config locally and validates configured tokens", () => {
  withEnvironment({ NODE_ENV: "development", NOVA_DEV_TOKEN: undefined }, () => {
    assert.equal(authorizeDeveloperRequest({ headers: {} }), true);
  });
  withEnvironment({ NODE_ENV: "production", NOVA_DEV_TOKEN: "correct-secret" }, () => {
    assert.equal(authorizeDeveloperRequest({ headers: { "x-nova-dev-token": "wrong-secret" } }), false);
    assert.equal(authorizeDeveloperRequest({ headers: { "x-nova-dev-token": "correct-secret" } }), true);
  });
});
