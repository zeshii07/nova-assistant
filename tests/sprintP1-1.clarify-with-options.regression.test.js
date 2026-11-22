// H2a regression (Phase 1 item 1): the generic fallback must NOT claim
// "I've kept your current request safely paused" when nothing is pending,
// and must instead offer 2-3 concrete options (clarify-with-options). When a
// workflow IS pending, it must honestly re-prompt the pending slot.
//
// Two fallback sites are covered:
//   - assistantService.friendlyFallback (the LLM-fallback / tenant assistant path)
//   - executionEngine noMatchFallback (the main pipeline !match path)
const test = require('node:test');
const assert = require('node:assert/strict');
const { AssistantService } = require('../packages/assistant/src/assistantService');
const { noMatchFallback } = require('../packages/execution-engine/src/executionEngine');

const PAUSED_RE = /safely paused|kept your current request paused|request yahin paused/i;
const OPTIONS_RE = /[12]️⃣|1️⃣/;  // the numbered options marker

function makeAssistant() {
  // friendlyFallback + #pendingSlotLabel + #domainOptions only use context
  // (tenant, state) and language — constructor deps are unused here.
  return new AssistantService({ languageEngine: null, intentEngine: null, knowledgeService: null, responseEngine: null, llmRouter: null, logger: null });
}

const noPendingState = { language: 'english', workflow: { current: null } };
const pendingState = { language: 'english', workflow: { current: { capabilityId: 'booking', intent: 'booking.start', pendingField: 'date' } } };

const tenants = {
  restaurant: { business: { name: 'Nova Bistro' }, domain: 'restaurant' },
  salon: { business: { name: 'Glow Salon' }, domain: 'salon' },
  cleaning: { business: { name: 'BYT Cleaners' }, domain: 'cleaning' },
  retail: { business: { name: 'City Mart' }, domain: 'retail' },
};

// ── assistantService.friendlyFallback ──────────────────────────────────────

test('H2a: friendlyFallback with NO pending request does NOT claim it is paused (english)', () => {
  const svc = makeAssistant();
  const reply = svc.friendlyFallback({ tenant: tenants.restaurant, state: noPendingState }, 'english');
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(OPTIONS_RE.test(reply), `must offer numbered options; got: ${reply}`);
  assert.match(reply, /Nova Bistro/, 'mentions the business name');
});

test('H2a: friendlyFallback with NO pending request does NOT claim it is paused (roman_urdu)', () => {
  const svc = makeAssistant();
  const reply = svc.friendlyFallback({ tenant: tenants.salon, state: { ...noPendingState, language: 'roman_urdu' } }, 'roman_urdu');
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(/chunein|Menu|Appointment|Services|quote/i.test(reply), 'offers concrete options in roman_urdu');
});

test('H2a: friendlyFallback with NO pending request does NOT claim it is paused (urdu script)', () => {
  const svc = makeAssistant();
  const reply = svc.friendlyFallback({ tenant: tenants.cleaning, state: { ...noPendingState, language: 'urdu' } }, 'urdu');
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(/منتخب/.test(reply), 'offers options in urdu script');
});

test('H2a: friendlyFallback with NO pending request does NOT claim it is paused (arabic)', () => {
  const svc = makeAssistant();
  const reply = svc.friendlyFallback({ tenant: tenants.retail, state: { ...noPendingState, language: 'arabic' } }, 'arabic');
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(/اختيار|عرض|المنتجات/.test(reply), 'offers options in arabic');
});

test('H2a: friendlyFallback WITH a pending booking honestly re-prompts the slot', () => {
  const svc = makeAssistant();
  const reply = svc.friendlyFallback({ tenant: tenants.salon, state: pendingState }, 'english');
  // Must NOT claim "paused" falsely, MUST mention the pending flow + slot.
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.match(reply, /continue your booking/i, 'references the pending booking flow');
  assert.match(reply, /date/i, 'references the pending slot (date)');
});

test('H2a: options are domain-specific (restaurant shows menu/order, salon shows appointment)', () => {
  const svc = makeAssistant();
  const restaurantReply = svc.friendlyFallback({ tenant: tenants.restaurant, state: noPendingState }, 'english');
  const salonReply = svc.friendlyFallback({ tenant: tenants.salon, state: noPendingState }, 'english');
  assert.match(restaurantReply, /menu|order/i, 'restaurant options mention menu/order');
  assert.doesNotMatch(restaurantReply, /appointment/i, 'restaurant options must not mention appointments');
  assert.match(salonReply, /appointment/i, 'salon options mention appointment');
  assert.doesNotMatch(salonReply, /menu/i, 'salon options must not mention menu');
});

// ── executionEngine noMatchFallback ───────────────────────────────────────

test('H2a: noMatchFallback with NO pending request does NOT claim it is paused', () => {
  const reply = noMatchFallback({ tenant: tenants.restaurant, state: noPendingState, language: 'english', workflow: null });
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(OPTIONS_RE.test(reply), `must offer numbered options; got: ${reply}`);
});

test('H2a: noMatchFallback WITH a pending booking honestly re-prompts the slot', () => {
  const wf = { capabilityId: 'booking', pendingField: 'time' };
  const reply = noMatchFallback({ tenant: tenants.salon, state: { ...pendingState, workflow: { current: wf } }, language: 'english', workflow: wf });
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.match(reply, /time/i, 'references the pending slot (time)');
  assert.match(reply, /draft is still safe|safe/i, 'honestly says the draft is safe (since one IS pending)');
});

test('H2a: noMatchFallback honours the language (roman_urdu, no pending)', () => {
  const reply = noMatchFallback({ tenant: tenants.cleaning, state: { ...noPendingState, language: 'roman_urdu' }, language: 'roman_urdu', workflow: null });
  assert.equal(PAUSED_RE.test(reply), false, `must not claim paused; got: ${reply}`);
  assert.ok(/chunein|Menu|quote|Cleaning/i.test(reply), 'offers concrete options in roman_urdu');
});

// ── the inputs from the bug report ─────────────────────────────────────────

test('H2a: report inputs (lol / ok / good morning / 👍 / ...) hit the no-pending fallback cleanly', () => {
  // These are the exact inputs the report listed as triggering the false
  // "kept your current request safely paused" reply. They have no pending
  // workflow, so the reply must offer options, not claim a pause.
  const inputs = ['lol', 'ok', 'good morning', '👍', '...', 'help', 'manager', 'complaint'];
  for (const text of inputs) {
    const reply = noMatchFallback({ tenant: tenants.restaurant, state: noPendingState, language: 'english', workflow: null });
    assert.equal(PAUSED_RE.test(reply), false, `input "${text}" must not produce a false pause claim`);
    assert.ok(OPTIONS_RE.test(reply), `input "${text}" must still produce options`);
  }
});
