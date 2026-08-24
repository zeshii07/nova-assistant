const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

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

test("configuration rejects a misspelled storage mode instead of silently using local files", () => {
  withEnvironment({ NOVA_STORAGE_MODE: "persisent" }, () => {
    assert.throws(() => loadConfig(), /NOVA_STORAGE_MODE must be memory or persistent/);
  });
});

test("configuration rejects malformed integer and timezone values", () => {
  withEnvironment({ PORT: "3000oops" }, () => assert.throws(() => loadConfig(), /PORT must be an integer/));
  withEnvironment({ NOVA_DB_POOL_MAX: "2.5" }, () => assert.throws(() => loadConfig(), /NOVA_DB_POOL_MAX must be an integer/));
  withEnvironment({ NOVA_DEFAULT_TIMEZONE: "Mars\/Olympus" }, () => assert.throws(() => loadConfig(), /valid IANA timezone/));
});
