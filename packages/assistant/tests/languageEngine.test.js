const test = require("node:test");
const assert = require("node:assert/strict");
const { LanguageEngine } = require("../src/languageEngine");
const engine = new LanguageEngine();
test("detects English", () => assert.equal(engine.detect("hello there"), "english"));
test("detects Roman Urdu", () => assert.equal(engine.detect("aap kaise ho"), "roman_urdu"));
test("detects Urdu script", () => assert.equal(engine.detect("آپ کیسے ہیں"), "urdu"));
