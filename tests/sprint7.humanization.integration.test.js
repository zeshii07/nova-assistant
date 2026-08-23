const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContainer } = require('../apps/api/src/container');

const msg = (customerId, text, channel = 'http') => ({ tenantId: 'default', customerId, channel, text });

test('humanizes product lists through tenant templates', async () => {
  const c = await buildContainer();
  const r = await c.executionEngine.process(msg('hx-list', 'ap k pass kon sy products hain'));
  assert.equal(r.capabilityId, 'catalog');
  assert.equal(r.experience.intent, 'CATALOG_LIST_VIEWED');
  assert.equal(r.experience.language, 'roman_urdu');
  assert.match(r.reply, /Ji bilkul!/);
  assert.match(r.reply, /Wireless Earbuds/);
});

test('CRM name update uses structured response and personalized greeting', async () => {
  const c = await buildContainer();
  const updated = await c.executionEngine.process(msg('hx-crm', 'my name is Zeeshan Ahmad'));
  assert.equal(updated.experience.intent, 'CRM_NAME_UPDATED');
  assert.match(updated.reply, /remember your name/i);
  const greeting = await c.executionEngine.process(msg('hx-crm', 'hello'));
  assert.match(greeting.reply, /Hello, Zeeshan Ahmad!/);
});

test('unavailable catalog response preserves facts while humanizing wording', async () => {
  const c = await buildContainer();
  const r = await c.executionEngine.process(msg('hx-no', 'do you have milk'));
  assert.equal(r.experience.intent, 'CATALOG_UNAVAILABLE');
  assert.match(r.reply, /milk/i);
  assert.match(r.reply, /not available/i);
  assert.doesNotMatch(r.reply, /milk.*Rs/i);
});

test('WhatsApp renderer normalizes excessive spacing', async () => {
  const c = await buildContainer();
  const r = await c.executionEngine.process(msg('hx-wa', 'what products do you have', 'whatsapp'));
  assert.doesNotMatch(r.reply, /\n{3,}/);
  assert.match(r.reply, /^Certainly!/);
});
