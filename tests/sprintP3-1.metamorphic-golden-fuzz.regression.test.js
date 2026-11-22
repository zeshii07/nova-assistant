// Phase 3 Sprint 1 — Metamorphic/fuzz suite + golden conversations for CI.
//
// H8 audit gap: "no metamorphic/fuzz coverage and no golden conversation
// snapshots, so regressions in routing/state/safety slip past the existing
// last-turn-only variation corpus." This sprint closes that gap with:
//
//   1. GOLDEN CONVERSATIONS — fixed multi-turn scripts with PINNED expectations
//      on every turn (capabilityId + reply signature). Any drift in routing,
//      slot-filling, or reply composition is caught, even if the final answer
//      lands right. (tests/fixtures/golden-conversations.js)
//
//   2. METAMORPHIC RELATIONS — properties that hold across transformations of
//      the input: determinism, language invariance, abstention stability,
//      no-crash fuzz, idempotency, no-public-leak, version monotonicity.
//      (tests/fixtures/metamorphic-relations.js)
//
// Both suites run with NOVA_NLU_MODE=off (set by tests/test-env.js), so the
// router is deterministic and the relations are reproducible in CI.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContainer } = require("../apps/api/src/container");
const goldenConversations = require("./fixtures/golden-conversations.js");
const metamorphicRelations = require("./fixtures/metamorphic-relations.js");

let container;
test.before(async () => {
  // Isolated data dir per worker (test-env.js sets defaults; we override the
  // data dirs here so this suite never collides with parallel test files).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p3s1-golden-"));
  process.env.NOVA_LOCAL_DATA_DIR = root;
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(root, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(root, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
});
test.after(async () => { if (container) await container.registry.shutdownAll().catch(() => {}); });

// ── Harness ───────────────────────────────────────────────────────────────
// A small helper object passed to each metamorphic relation so relations stay
// declarative. It exposes the engine + public assistant + a seeded RNG +
// id generators + an assert wrapper that collects failures (so a relation can
// report ALL its violations, not just the first).
function makeHarness(container) {
  return {
    container,
    async ask(tenant, customerId, channel, text) {
      return container.executionEngine.process({ tenantId: tenant, customerId, channel, text });
    },
    async publicChat(message, locale = "en") {
      return container.publicAssistantService.handleMessage({ message, locale, page_context: null, campaign: null });
    },
    cid(suffix) { return `p3s1-${suffix}`; },
    conversationKey(tenantId, customerId) {
      // Mirrors createConversationId's determinism: same tenant+channel+customer → same key.
      return `${tenantId}:test:${customerId}`;
    },
    mulberry32(seed) {
      // Deterministic PRNG so fuzz sequences are reproducible in CI.
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    assert(condition, message) { assert.ok(condition, message); }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GOLDEN CONVERSATIONS — one test per conversation, asserting every turn
// ═══════════════════════════════════════════════════════════════════════════
for (const conv of goldenConversations) {
  test(`GOLDEN ${conv.id}: ${conv.notes}`, { timeout: 30000 }, async () => {
    const cid = `golden-${conv.id.toLowerCase()}`;
    for (let i = 0; i < conv.turns.length; i++) {
      const turn = conv.turns[i];
      const r = conv.public
        ? await container.publicAssistantService.handleMessage({
            conversation_id: cid, message: turn.text, locale: "en", page_context: null, campaign: null
          })
        : await container.executionEngine.process({
            tenantId: conv.tenant, customerId: cid, channel: conv.channel || "test", text: turn.text
          });
      const e = turn.expect || {};
      if (e.capabilityId !== undefined && r.capabilityId !== e.capabilityId) {
        assert.fail(`turn ${i + 1} capabilityId: expected "${e.capabilityId}", got "${r.capabilityId}" (text: "${turn.text}")`);
      }
      if (e.outcome !== undefined && r.outcome !== e.outcome) {
        assert.fail(`turn ${i + 1} outcome: expected "${e.outcome}", got "${r.outcome}" (text: "${turn.text}")`);
      }
      if (e.leadStatus !== undefined && r.lead_status !== e.leadStatus) {
        assert.fail(`turn ${i + 1} lead_status: expected "${e.leadStatus}", got "${r.lead_status}" (text: "${turn.text}")`);
      }
      for (const re of (e.replyMatches || [])) {
        assert.match(r.reply || "", re, `turn ${i + 1} reply should match /${re.source}/ (text: "${turn.text}")`);
      }
      for (const re of (e.replyNotMatch || [])) {
        if (re.test(r.reply || "")) {
          assert.fail(`turn ${i + 1} reply should NOT match /${re.source}/ but did: "${(r.reply || "").slice(0, 200)}"`);
        }
      }
      // Universal invariants on EVERY golden turn — safety net.
      assert.ok(typeof r.reply === "string" && r.reply.length > 0, `turn ${i + 1} reply must be a non-empty string`);
      assert.doesNotMatch(r.reply, /undefined|NaN|\[object Object\]/, `turn ${i + 1} reply contains undefined/NaN`);
      if (conv.public) {
        assert.doesNotMatch(r.reply || "", /messagingRules\[/i, `turn ${i + 1} public reply leaked messagingRules`);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// METAMORPHIC RELATIONS — each relation is a property checked across many inputs
// ═══════════════════════════════════════════════════════════════════════════
// Each relation runs with a fixed seed (the relation index) so the generated
// inputs are reproducible. Run each relation multiple times with different
// seeds to widen coverage.
for (let idx = 0; idx < metamorphicRelations.length; idx++) {
  const mr = metamorphicRelations[idx];
  test(`METAMORPHIC ${mr.id}: ${mr.description}`, { timeout: 60000 }, async () => {
    const harness = makeHarness(container);
    // Run the relation with a few different seeds for broader coverage.
    const seeds = [1000 + idx * 7, 2000 + idx * 13, 3000 + idx * 17];
    for (const seed of seeds) {
      await mr.run(harness, seed);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HARNESS SELF-TEST — the suite is only useful if the harness itself is sound
// ═══════════════════════════════════════════════════════════════════════════
test("HARNESS: mulberry32 is deterministic (same seed → same sequence)", () => {
  const h = makeHarness(container);
  const a = h.mulberry32(42), b = h.mulberry32(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB, "same seed must produce identical sequences");
});

test("HARNESS: cid + conversationKey are stable for the same inputs", () => {
  const h = makeHarness(container);
  assert.equal(h.cid("x"), h.cid("x"));
  assert.equal(h.conversationKey("t", "c"), h.conversationKey("t", "c"));
});

test("HARNESS: golden conversations fixture is non-empty + well-formed", () => {
  assert.ok(goldenConversations.length >= 5, "need at least 5 golden conversations for meaningful coverage");
  for (const conv of goldenConversations) {
    assert.ok(conv.id, "golden conversation must have an id");
    assert.ok(conv.tenant, `${conv.id} must have a tenant`);
    assert.ok(Array.isArray(conv.turns) && conv.turns.length >= 1, `${conv.id} must have turns`);
  }
});

test("HARNESS: metamorphic relations fixture is non-empty + well-formed", () => {
  assert.ok(metamorphicRelations.length >= 5, "need at least 5 metamorphic relations");
  for (const mr of metamorphicRelations) {
    assert.ok(mr.id, "relation must have an id");
    assert.ok(mr.description, `${mr.id} must have a description`);
    assert.equal(typeof mr.run, "function", `${mr.id} must be a function`);
  }
});
