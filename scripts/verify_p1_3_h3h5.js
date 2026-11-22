// Verify H3 + H5 end-to-end through the real PublicAssistantService:
//   Turn 1: visitor message that yields suggested_actions (lastShown persisted).
//   Turn 2: visitor replies "first one" / "option 2" / "wo" / "dusra" — must
//           resolve against the persisted lastShown and route to that option,
//           NOT classify as `unknown` and fall through to knowledge retrieval.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildContainer } = require('/home/z/my-project/nova-assistant/apps/api/src/container');

async function main() {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-h3h5-'));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-knowledge');
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-operational');
  process.env.NOVA_NLU_MODE = 'off';
  process.env.LOG_LEVEL = 'error';
  const container = await buildContainer();
  const svc = container.publicAssistantService;
  const sessionId = 'h3h5-test-' + Date.now();

  // Turn 1: an industry use-case message yields suggested_actions (demo CTA +
  // an "explore <industry>" follow-up). These become state.context.lastShown.
  const r1 = await svc.handleMessage({ conversation_id: sessionId, message: 'I run a salon and want to automate bookings', locale: 'en' });
  console.log('=== Turn 1: industry use-case → suggested actions ===');
  console.log('  intent=' + r1.intent + ' outcome=' + r1.outcome);
  console.log('  suggested_actions:', (r1.suggested_actions || []).map((a) => a.label));

  // Inspect the persisted state to confirm H5 (lastShown + pending written).
  const stateKey = svc._conversationKey(sessionId);
  const state = await container.stateRepository.get(stateKey);
  console.log('  state.context.lastShown:', (state.context.lastShown || []).map((o) => o.label || o.value));
  console.log('  state.context.pending:', state.context.pending);

  // Turn 2: visitor picks an option by ordinal / demonstrative.
  console.log('\n=== Turn 2: visitor replies "first one" — must resolve to option[0] ===');
  const r2 = await svc.handleMessage({ conversation_id: sessionId, message: 'first one', locale: 'en' });
  console.log('  reply:', JSON.stringify((r2.reply || '').slice(0, 90)));
  console.log('  intent=' + r2.intent + ' outcome=' + r2.outcome + ' (must NOT be unknown→knowledge)');

  // Turn 2b (fresh session): "option 2" / "wo" / "dusra" resolution.
  for (const t of ['option 2', 'wo', 'dusra', '2']) {
    const sid = 'h3h5-pick-' + t.replace(/\s+/g, '_') + '-' + Date.now();
    await svc.handleMessage({ conversation_id: sid, message: 'I run a salon and want to automate bookings', locale: 'en' });
    const rp = await svc.handleMessage({ conversation_id: sid, message: t, locale: 'en' });
    console.log('  [' + t + '] intent=' + rp.intent + ' outcome=' + rp.outcome);
  }
  await container.registry.shutdownAll().catch(() => {});
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
