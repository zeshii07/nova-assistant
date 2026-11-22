// Reproduce Bug 7 + Bug 8 (Phase 1 items 7 & 8) through the real ExecutionEngine.
//   Bug 7 — language should track the CURRENT message, not prior state.
//           Visitor switches English → Roman Urdu: reply should come in Roman
//           Urdu (current). Visitor switches Roman Urdu → English: reply should
//           come in English (current). Today the prior turn's language wins.
//   Bug 8 — "book deep cleaning tomorrow at 3pm for Ahmed, 0300-1234567" should
//           extract date+time+name+phone in one shot, like salon. Today NEITHER
//           salon nor cleaning extracts the name "Ahmed" (the name regex
//           requires "my name is"/"call me" cues, so "for Ahmed" is missed).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildContainer } = require('/home/z/my-project/nova-assistant/apps/api/src/container');

let container;
async function q(t, u, text) {
  return container.executionEngine.process({ tenantId: t, channel: 'v42', customerId: u, text });
}

async function main() {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-b78-repro-'));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-knowledge');
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-operational');
  process.env.NOVA_NLU_MODE = 'off';
  process.env.LOG_LEVEL = 'error';
  container = await buildContainer();

  const sid = 'b7-' + Date.now();

  console.log('=== Bug 7: language switch Roman Urdu → English ===');
  await q('salon-demo', sid, 'mujhe haircut book karna hai kal'); // Roman Urdu turn 1
  const b7a = await q('salon-demo', sid, 'yes book it'); // English turn 2
  console.log('  turn 2 (English "yes book it"):');
  console.log('    state.language:', b7a.state?.language);
  console.log('    reply:', JSON.stringify((b7a.reply || '').slice(0, 120)));
  console.log('    EXPECTED: English reply (current message is English)');

  const sid2 = 'b7b-' + Date.now();
  console.log('\n=== Bug 7: language switch English → Roman Urdu ===');
  await q('salon-demo', sid2, 'i want to book a haircut'); // English turn 1
  const b7b = await q('salon-demo', sid2, 'haan kal karwani hai'); // Roman Urdu turn 2
  console.log('  turn 2 (Roman Urdu "haan kal karwani hai"):');
  console.log('    state.language:', b7b.state?.language);
  console.log('    reply:', JSON.stringify((b7b.reply || '').slice(0, 120)));
  console.log('    EXPECTED: Roman Urdu reply (current message is Roman Urdu)');

  console.log('\n=== Bug 8: one-shot extraction "for Ahmed" name + phone ===');
  console.log('--- salon ---');
  const b8s = await q('salon-demo', 'b8s-' + Date.now(), 'book a haircut tomorrow at 3pm for Ahmed, 0300-1234567');
  const sFields = b8s.state?.capabilityState?.booking?.slots || {};
  console.log('    salon slots:', JSON.stringify({ date: sFields.date, time: sFields.time, name: sFields.name, phone: sFields.phone }));
  console.log('    salon reply:', JSON.stringify((b8s.reply || '').slice(0, 110)));
  console.log('--- cleaning ---');
  const b8c = await q('cleaning-demo', 'b8c-' + Date.now(), 'book deep cleaning tomorrow at 3pm for Ahmed, 0300-1234567');
  const cStep = b8c.state?.capabilityState?.cleaning?.step;
  const cState = b8c.state?.capabilityState?.cleaning || {};
  console.log('    cleaning step:', cStep);
  console.log('    cleaning captured:', JSON.stringify({ preferredDate: cState.preferredDate, preferredTime: cState.preferredTime, name: cState.name, phone: cState.phone }));
  console.log('    cleaning reply:', JSON.stringify((b8c.reply || '').slice(0, 110)));
  console.log('    EXPECTED: name "Ahmed" + phone captured in one shot (currently both miss the name)');

  await container.registry.shutdownAll().catch(() => {});
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
