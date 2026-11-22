// Reproduce Bug 5 + Bug 6 (Phase 1 items 5 & 6) through the real ExecutionEngine.
//   Bug 5  — "do you have pizza?" on a catalog tenant should emit
//            catalog.unavailable_request ("we don't have pizza; here's the menu"),
//            NOT swallow the phrase into a booking defaultSubject.
//   Bug 6a — "what is the price of biryani?" should answer from the catalog
//            (product price), NOT route to service.quote / pricing.quote_request
//            ("I can prepare a quotation, but I need the service name").
//   Bug 6b — "what time is check in?" on a hotel tenant should answer from the
//            knowledge base ("check-in is at 2 PM"), NOT route to booking.start
//            ("What is your check-in date?").
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildContainer } = require('/home/z/my-project/nova-assistant/apps/api/src/container');

async function q(t, u, text) {
  return container.executionEngine.process({ tenantId: t, channel: 'v42', customerId: u, text });
}

let container;
async function main() {
  process.env.NOVA_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-b56-repro-'));
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-knowledge');
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(process.env.NOVA_LOCAL_DATA_DIR, 'tenant-operational');
  process.env.NOVA_NLU_MODE = 'off';
  process.env.LOG_LEVEL = 'error';
  container = await buildContainer();

  console.log('=== Bug 5: "do you have pizza?" on restaurant (catalog tenant) ===');
  const b5 = await q('restaurant-demo', 'b5-' + Date.now(), 'do you have pizza?');
  console.log('  capabilityId:', b5.capabilityId);
  console.log('  intent:', b5.responseModel?.intent);
  console.log('  reply:', JSON.stringify((b5.reply || '').slice(0, 140)));
  console.log('  EXPECTED: catalog.unavailable_request / CATALOG_UNAVAILABLE + "we don\'t carry pizza"');

  console.log('\n=== Bug 5b: "i want sushi" on restaurant (non-existent product, with a want-cue) ===');
  const b5b = await q('restaurant-demo', 'b5b-' + Date.now(), 'i want sushi');
  console.log('  capabilityId:', b5b.capabilityId, 'intent:', b5b.responseModel?.intent);
  console.log('  reply:', JSON.stringify((b5b.reply || '').slice(0, 140)));

  console.log('\n=== Bug 6a: "what is the price of biryani?" on restaurant ===');
  const b6a = await q('restaurant-demo', 'b6a-' + Date.now(), 'what is the price of biryani?');
  console.log('  capabilityId:', b6a.capabilityId, 'intent:', b6a.responseModel?.intent);
  console.log('  reply:', JSON.stringify((b6a.reply || '').slice(0, 140)));
  console.log('  EXPECTED: catalog product price answer, NOT "I can prepare a quotation, but I need the service name"');

  console.log('\n=== Bug 6b: "what time is check in?" on hotel ===');
  const b6b = await q('hotel-demo', 'b6b-' + Date.now(), 'what time is check in?');
  console.log('  capabilityId:', b6b.capabilityId, 'intent:', b6b.responseModel?.intent);
  console.log('  reply:', JSON.stringify((b6b.reply || '').slice(0, 140)));
  console.log('  EXPECTED: knowledge answer "check-in is at 2 PM", NOT "What is your check-in date?"');

  console.log('\n=== Bug 6b-control: "i want to check in" SHOULD still book ===');
  const b6c = await q('hotel-demo', 'b6c-' + Date.now(), 'i want to check in');
  console.log('  capabilityId:', b6c.capabilityId, 'intent:', b6c.responseModel?.intent);
  console.log('  reply:', JSON.stringify((b6c.reply || '').slice(0, 140)));
  console.log('  EXPECTED: booking.start (must NOT break the real check-in request)');

  await container.registry.shutdownAll().catch(() => {});
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
