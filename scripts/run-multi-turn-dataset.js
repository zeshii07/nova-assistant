#!/usr/bin/env node
/**
 * Nova Multi-Turn Conversation Test Runner
 *
 * Replays full conversation scripts from tests/datasets/multi-turn/conversations.json
 * and verifies that each turn produces the expected reply.
 *
 * Usage:
 *   node scripts/run-multi-turn-dataset.js              # Run all conversations
 *   node scripts/run-multi-turn-dataset.js --verbose     # Show full replies
 *   node scripts/run-multi-turn-dataset.js --filter=cleaning  # Run only cleaning tests
 *
 * Output:
 *   ✓ Conversation passed (7 turns) — cleaning-deep-villa-success
 *   ✗ Conversation failed at turn 3 — cleaning-deep-apartment-success
 *     Expected reply to contain "400", got: "For your apartment..."
 *
 *   === Results ===
 *   Pass: 12/15 (80%)
 *   Fail: 3/15
 *   Total turns: 89
 *   Turn pass rate: 82/89 (92%)
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const verbose = process.argv.includes('--verbose');
  const filterArg = process.argv.find(a => a.startsWith('--filter='));
  const filter = filterArg ? filterArg.split('=')[1] : null;

  const datasetPath = path.resolve(__dirname, '../tests/datasets/multi-turn/conversations.json');
  const conversations = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const filtered = filter
    ? conversations.filter(c => c.id.includes(filter) || c.tenantId.includes(filter))
    : conversations;

  console.log(`\n=== Nova Multi-Turn Conversation Tests ===`);
  console.log(`Running ${filtered.length} conversation(s)${filter ? ` (filtered: ${filter})` : ''}...\n`);

  const { buildContainer } = require('../apps/api/src/container');
  const container = await buildContainer();
  container.llmRouter.providers = [];

  let passCount = 0, failCount = 0;
  let totalTurns = 0, turnPassCount = 0;
  const failures = [];

  for (const conv of filtered) {
    const cid = `multi-turn-${conv.id}-${Date.now()}`;
    let convPassed = true;
    let turnPassedCount = 0;

    for (let i = 0; i < conv.turns.length; i++) {
      const turn = conv.turns[i];
      totalTurns++;

      try {
        const result = await container.executionEngine.process({
          tenantId: conv.tenantId,
          channel: 'multi-turn-test',
          customerId: cid,
          text: turn.text,
          messageId: null,
        });

        const exp = turn.expect || {};
        let turnOk = true;
        const errors = [];

        // Check capabilityId
        if (exp.capabilityId && result.capabilityId !== exp.capabilityId) {
          turnOk = false;
          errors.push(`expected capabilityId=${exp.capabilityId}, got=${result.capabilityId}`);
        }

        // Check replyContains
        if (exp.replyContains) {
          const reply = (result.reply || '').toLowerCase();
          for (const expected of exp.replyContains) {
            if (!reply.includes(expected.toLowerCase())) {
              turnOk = false;
              errors.push(`reply should contain "${expected}"`);
            }
          }
        }

        if (turnOk) {
          turnPassCount++;
          if (verbose) console.log(`  Turn ${i+1}: ✓ "${turn.text.substring(0, 50)}"`);
        } else {
          convPassed = false;
          if (verbose) {
            console.log(`  Turn ${i+1}: ✗ "${turn.text.substring(0, 50)}"`);
            for (const e of errors) console.log(`    ${e}`);
            console.log(`    Reply: ${(result.reply||'').substring(0, 200)}`);
          }
          failures.push({ conv: conv.id, turn: i+1, text: turn.text, errors, reply: (result.reply||'').substring(0, 200) });
        }
      } catch (error) {
        convPassed = false;
        totalTurns--;
        failures.push({ conv: conv.id, turn: i+1, text: turn.text, errors: [error.message], reply: '' });
        if (verbose) console.log(`  Turn ${i+1}: ✗ ERROR: ${error.message}`);
      }
    }

    if (convPassed) {
      passCount++;
      console.log(`✓ ${conv.name} (${conv.turns.length} turns) — ${conv.id}`);
    } else {
      failCount++;
      console.log(`✗ ${conv.name} (failed at turn ${failures.find(f=>f.conv===conv.id)?.turn}) — ${conv.id}`);
    }

    // Clean up state
    try { await container.stateRepository.delete(`${conv.tenantId}:multi-turn-test:${cid}`); } catch {}
  }

  await container.storage?.close?.();

  console.log(`\n=== Results ===`);
  console.log(`Conversations: ${passCount}/${filtered.length} passed (${Math.round(passCount/filtered.length*100)}%)`);
  if (failCount > 0) {
    console.log(`Failures: ${failCount}/${filtered.length}`);
    console.log(`\nFailed conversations:`);
    for (const f of failures) {
      console.log(`  ${f.conv} turn ${f.turn}: "${f.text.substring(0, 50)}"`);
      for (const e of f.errors) console.log(`    → ${e}`);
      if (f.reply) console.log(`    Reply: ${f.reply}`);
    }
  }
  console.log(`\nTurns: ${turnPassCount}/${totalTurns} passed (${totalTurns > 0 ? Math.round(turnPassCount/totalTurns*100) : 0}%)`);
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exitCode = 1;
});
