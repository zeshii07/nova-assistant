/**
 * Sprint 8 — v48.0 Phase 1 Architecture Foundation Tests
 *
 * Tests the four new Phase 1 components:
 *   R — Business Policy Engine (cancellation, booking restrictions, payment, refund, escalation)
 *   S — Action Registry (action definitions, validation, execution, permission checks)
 *   T — Multi-Intent Router (multi-intent detection, execution plan, dependencies)
 *   U — Dialogue Manager (dialogue state, action decisions, workflow management)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP R — Business Policy Engine
// ─────────────────────────────────────────────────────────────────────────────

const { BusinessPolicyEngine, getDefaultPolicies } = require('../packages/business-policy-engine/src');

test('R1: getDefaultPolicies returns domain-specific defaults for restaurant', () => {
  const policies = getDefaultPolicies('restaurant');
  assert.equal(policies.cancellation.windowHours, 2);
  assert.equal(policies.booking.maxPartySize, 20);
});

test('R2: getDefaultPolicies returns domain-specific defaults for hotel', () => {
  const policies = getDefaultPolicies('hotel');
  assert.equal(policies.cancellation.windowHours, 48);
  assert.equal(policies.cancellation.chargePercentage, 100);
});

test('R3: getDefaultPolicies falls back to universal for unknown domain', () => {
  const policies = getDefaultPolicies('unknown_domain');
  assert.equal(policies.cancellation.windowHours, 24);
});

test('R4: evaluateCancellation allows free cancellation outside window', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.evaluateCancellation({
    tenant: { id: 'test', domain: 'restaurant' },
    bookingDate: '2099-01-01',
    bookingTime: '14:00',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.chargePercentage, 0);
  assert.equal(result.reason, 'outside_window');
});

test('R5: evaluateCancellation charges within window', () => {
  const engine = new BusinessPolicyEngine({});
  // Create a date 1 hour from now
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const result = engine.evaluateCancellation({
    tenant: { id: 'test', domain: 'restaurant' },
    bookingDate: future.toISOString().split('T')[0],
    bookingTime: `${future.getHours()}:${String(future.getMinutes()).padStart(2, '0')}`,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.chargePercentage >= 0, 'should have a charge percentage');
  assert.match(result.reason, /window/);
});

test('R6: evaluateCancellation blocks past bookings', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.evaluateCancellation({
    tenant: { id: 'test', domain: 'restaurant' },
    bookingDate: '2020-01-01',
    bookingTime: '14:00',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.chargePercentage, 100);
  assert.equal(result.reason, 'past_booking');
});

test('R7: evaluateBookingRestrictions detects max party size violation', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.evaluateBookingRestrictions({
    tenant: { id: 'test', domain: 'restaurant' },
    partySize: 25, // restaurant max is 20
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.rule === 'max_party_size'));
});

test('R8: evaluateBookingRestrictions allows valid party size', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.evaluateBookingRestrictions({
    tenant: { id: 'test', domain: 'restaurant' },
    partySize: 4,
  });
  assert.equal(result.valid, true);
  assert.equal(result.violations.length, 0);
});

test('R9: evaluatePaymentRequirements detects unaccepted payment method', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.evaluatePaymentRequirements({
    tenant: { id: 'test', domain: 'restaurant' },
    paymentMethod: 'Bitcoin',
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.rule === 'payment_method_not_accepted'));
});

test('R10: evaluateRefund allows refund within window', () => {
  const engine = new BusinessPolicyEngine({});
  // Use hotel domain which has 3-day refund window
  const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const result = engine.evaluateRefund({
    tenant: { id: 'test', domain: 'hotel' },
    orderDate: recentDate,
  });
  assert.equal(result.eligible, true);
  assert.ok(result.refundPercentage > 0);
});

test('R11: evaluateRefund blocks refund outside window', () => {
  const engine = new BusinessPolicyEngine({});
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = engine.evaluateRefund({
    tenant: { id: 'test', domain: 'restaurant' },
    orderDate: oldDate,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'outside_window');
});

test('R12: shouldEscalateToHuman detects customer request', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.shouldEscalateToHuman(
    { id: 'test', domain: 'restaurant' },
    { customerRequested: true }
  );
  assert.equal(result.escalate, true);
  assert.ok(result.reasons.includes('customer_requested'));
});

test('R13: shouldEscalateToHuman detects escalation keywords', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.shouldEscalateToHuman(
    { id: 'test', domain: 'restaurant' },
    { messageText: 'I want to speak to a human' }
  );
  assert.equal(result.escalate, true);
  assert.ok(result.reasons.includes('escalation_keyword'));
});

test('R14: shouldEscalateToHuman detects high-value transactions', () => {
  const engine = new BusinessPolicyEngine({});
  const result = engine.shouldEscalateToHuman(
    { id: 'test', domain: 'hotel' },
    { orderTotal: 250000 }
  );
  assert.equal(result.escalate, true);
  assert.ok(result.reasons.includes('high_value_transaction'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP S — Action Registry
// ─────────────────────────────────────────────────────────────────────────────

const { ActionRegistry, ActionDefinition } = require('../packages/action-registry/src');

test('S1: ActionRegistry registers builtin actions', () => {
  const registry = new ActionRegistry();
  assert.ok(registry.has('booking.create'));
  assert.ok(registry.has('booking.cancel'));
  assert.ok(registry.has('commerce.create_order'));
  assert.ok(registry.has('crm.create_customer'));
  assert.ok(registry.has('communication.send_email'));
});

test('S2: ActionRegistry get returns action definition', () => {
  const registry = new ActionRegistry();
  const action = registry.get('booking.create');
  assert.ok(action);
  assert.equal(action.id, 'booking.create');
  assert.equal(action.category, 'booking');
  assert.equal(action.riskLevel, 'medium');
  assert.equal(action.idempotent, true);
});

test('S3: ActionDefinition validates required fields', () => {
  const registry = new ActionRegistry();
  const action = registry.get('booking.create');
  const result = action.validate({ name: 'Ahmed' }); // missing date, time, phone
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.field === 'date'));
  assert.ok(result.errors.some(e => e.field === 'time'));
  assert.ok(result.errors.some(e => e.field === 'phone'));
});

test('S4: ActionDefinition validates types (email)', () => {
  const registry = new ActionRegistry();
  const action = registry.get('communication.send_email');
  const result = action.validate({ to: 'not-an-email', subject: 'test', body: 'hello' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.field === 'to' && e.rule === 'type'));
});

test('S5: ActionDefinition validates types (phone)', () => {
  const registry = new ActionRegistry();
  const action = registry.get('crm.create_customer');
  const result = action.validate({ customerId: 'c1', phone: '123' }); // too short
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.field === 'phone' && e.rule === 'type'));
});

test('S6: ActionDefinition accepts valid input', () => {
  const registry = new ActionRegistry();
  const action = registry.get('booking.create');
  const result = action.validate({
    subject: 'Haircut',
    date: '2026-12-01',
    time: '14:00',
    name: 'Ahmed Ali',
    phone: '03001234567',
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('S7: ActionRegistry execute returns error for missing action', async () => {
  const registry = new ActionRegistry();
  const result = await registry.execute('nonexistent.action', { input: {}, context: {}, services: {} });
  assert.equal(result.success, false);
  assert.equal(result.error, 'action_not_found');
});

test('S8: ActionRegistry execute returns error for permission denied', async () => {
  const registry = new ActionRegistry();
  const result = await registry.execute('booking.create', {
    input: { subject: 'test', date: '2026-12-01', time: '14:00', name: 'test', phone: '03001234567' },
    context: { tenant: { id: 'test', permissions: [] } }, // no permissions
    services: {},
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'permission_denied');
});

test('S9: ActionRegistry registers custom action', () => {
  const registry = new ActionRegistry();
  registry.register({
    id: 'custom.test',
    category: 'test',
    description: 'Test action',
    inputSchema: { required: ['value'], types: { value: 'string' } },
    permissions: [],
    riskLevel: 'low',
    handler: async ({ input }) => ({ doubled: input.value + input.value }),
  });
  assert.ok(registry.has('custom.test'));
});

test('S10: ActionRegistry list filters by category', () => {
  const registry = new ActionRegistry();
  const bookingActions = registry.list('booking');
  assert.ok(bookingActions.every(a => a.category === 'booking'));
  assert.ok(bookingActions.length >= 3); // create, cancel, reschedule
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP T — Multi-Intent Router
// ─────────────────────────────────────────────────────────────────────────────

const { MultiIntentRouter } = require('../packages/multi-intent-router/src');

test('T1: MultiIntentRouter returns single mode for one intent', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.start', confidence: 0.99, entities: {} },
      candidates: [{ capabilityId: 'booking', intent: 'booking.start', confidence: 0.99 }],
    },
    state: {},
    tenant: {},
  });
  assert.equal(plan.executionMode, 'single');
  assert.equal(plan.hasMultipleIntents, false);
  assert.equal(plan.secondaryIntents.length, 0);
});

test('T2: MultiIntentRouter detects secondary intents from different capabilities', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({
    intelligence: {
      selected: { capabilityId: 'commerce', intent: 'commerce.cart.add_request', confidence: 0.95, entities: {} },
      candidates: [
        { capabilityId: 'commerce', intent: 'commerce.cart.add_request', confidence: 0.95 },
        { capabilityId: 'availability', intent: 'availability.check', confidence: 0.85 },
        { capabilityId: 'assistant', intent: 'business.info', confidence: 0.80 },
      ],
    },
    state: {},
    tenant: {},
  });
  assert.equal(plan.hasMultipleIntents, true);
  assert.equal(plan.secondaryIntents.length, 1); // availability, not assistant
  assert.equal(plan.secondaryIntents[0].capabilityId, 'availability');
});

test('T3: MultiIntentRouter skips supporting candidates', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.start', confidence: 0.95, entities: {} },
      candidates: [
        { capabilityId: 'booking', intent: 'booking.start', confidence: 0.95 },
        { capabilityId: 'offering', intent: 'offering.details', confidence: 0.90 },
      ],
    },
    state: {},
    tenant: {},
  });
  // offering.details is a supporting candidate — should not be a secondary intent
  assert.equal(plan.secondaryIntents.length, 0);
});

test('T4: MultiIntentRouter identifies consequential intents requiring confirmation', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.confirm', confidence: 0.99, entities: {} },
      candidates: [{ capabilityId: 'booking', intent: 'booking.confirm', confidence: 0.99 }],
    },
    state: {},
    tenant: {},
  });
  assert.equal(plan.plan[0].requiresConfirmation, true);
  assert.equal(plan.plan[0].isConsequential, true);
});

test('T5: MultiIntentRouter returns empty plan for no intent', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({ intelligence: { candidates: [] }, state: {}, tenant: {} });
  assert.equal(plan.executionMode, 'single');
  assert.equal(plan.primaryIntent, null);
  assert.equal(plan.plan.length, 0);
});

test('T6: MultiIntentRouter maps intents to action IDs', () => {
  const router = new MultiIntentRouter();
  const plan = router.plan({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.start', confidence: 0.99, entities: {} },
      candidates: [{ capabilityId: 'booking', intent: 'booking.start', confidence: 0.99 }],
    },
    state: {},
    tenant: {},
  });
  assert.equal(plan.plan[0].action, 'booking.create');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP U — Dialogue Manager
// ─────────────────────────────────────────────────────────────────────────────

const { DialogueManager, DialogueState } = require('../packages/dialogue-manager/src');

test('U1: DialogueManager decides "start" for new dialogue', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.start', confidence: 0.99, reason: 'new' },
      workflow: { current: null },
    },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'start');
  assert.equal(decision.targetCapability, 'booking');
});

test('U2: DialogueManager decides "continue" for active workflow', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.continue', confidence: 0.99 },
      workflow: { current: { capabilityId: 'booking', intent: 'booking.start', pendingField: 'name' } },
    },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.pendingField, 'name');
});

test('U3: DialogueManager decides "confirm" for confirmation', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.confirm', confidence: 0.99 },
      workflow: { current: { capabilityId: 'booking', pendingField: 'confirmation' } },
    },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'confirm');
});

test('U4: DialogueManager decides "interrupt" for side questions', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: {
      selected: { capabilityId: 'assistant', intent: 'business.info', confidence: 0.90 },
      interruption: { type: 'business_question' },
      workflow: { current: { capabilityId: 'commerce', pendingField: 'name' } },
    },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'interrupt');
  assert.equal(decision.shouldResume, true);
  assert.ok(decision.interruption);
});

test('U5: DialogueManager decides "correct" for corrections', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: {
      selected: { capabilityId: 'booking', intent: 'booking.continue', confidence: 0.90 },
      correction: { target: 'date', value: '2026-12-15' },
      workflow: { current: { capabilityId: 'booking', pendingField: 'time' } },
    },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'correct');
  assert.equal(decision.correction.field, 'date');
  assert.equal(decision.correction.value, '2026-12-15');
  assert.equal(decision.shouldResume, true);
});

test('U6: DialogueManager decides "cancel" for global cancel command', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: { globalCommand: { type: 'cancel' } },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'cancel');
  assert.equal(decision.targetCapability, 'system');
});

test('U7: DialogueState tracks status correctly', () => {
  const ds = new DialogueState({ status: 'collecting', pendingField: 'name' });
  assert.equal(ds.isCollecting(), true);
  assert.equal(ds.isActive(), true);
  assert.equal(ds.isReady(), false);
});

test('U8: DialogueManager nextPendingField finds first missing field', () => {
  const dm = new DialogueManager();
  const ds = new DialogueState({ status: 'collecting', fields: { subject: 'Haircut' } });
  const next = dm.nextPendingField(ds, ['subject', 'date', 'time', 'name', 'phone']);
  assert.equal(next, 'date'); // subject is filled, date is next
});

test('U9: DialogueManager nextPendingField returns null when all filled', () => {
  const dm = new DialogueManager();
  const ds = new DialogueState({
    status: 'collecting',
    fields: { subject: 'Haircut', date: '2026-12-01', time: '14:00', name: 'Ahmed', phone: '03001234567' },
  });
  const next = dm.nextPendingField(ds, ['subject', 'date', 'time', 'name', 'phone']);
  assert.equal(next, null); // all fields filled → ready for confirmation
});

test('U10: DialogueManager decides "fallback" for no intent', () => {
  const dm = new DialogueManager();
  const decision = dm.decide({
    intelligence: { selected: null, candidates: [] },
    state: {},
    tenant: {},
  });
  assert.equal(decision.action, 'fallback');
  assert.equal(decision.targetCapability, 'assistant');
});
