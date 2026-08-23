const test = require("node:test"); const assert = require("node:assert/strict");
const { validateManifest } = require("../src/manifestValidator");
test("valid capability manifest passes", () => { assert.equal(validateManifest({ id: "assistant", name: "Assistant", version: "1.0.0", entry: "./src/index.js", permissions: [] }).valid, true); });
test("invalid manifest is rejected", () => { const result = validateManifest({ id: "Bad ID", name: "", version: "x" }); assert.equal(result.valid, false); assert.ok(result.errors.length >= 3); });
