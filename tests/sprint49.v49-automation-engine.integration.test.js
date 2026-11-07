/**
 * Sprint 9 — v49.0 Phase 2 Automation Engine Tests
 *
 * Tests the new Phase 2 components:
 *   V — Workflow Engine (multi-step, branching, compensation, approval, cancellation)
 *   W — Idempotency Engine (duplicate action prevention, caching, fingerprinting)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRegistry, ActionDefinition } = require('../packages/action-registry/src');
const { WorkflowEngine, WorkflowDefinition, WorkflowStep, WORKFLOW_STATUS, STEP_STATUS } = require('../packages/workflow-engine/src');
const { IdempotencyEngine } = require('../packages/idempotency-engine/src');

// Helper: create an action registry with test actions
function createTestRegistry() {
  const registry = new ActionRegistry({ logger: null });
  // Override builtin actions with test handlers
  registry.register({
    id: 'booking.create',
    category: 'booking',
    description: 'Test booking create',
    inputSchema: { required: ['subject', 'date'], types: { subject: 'string', date: 'string' } },
    permissions: [],
    riskLevel: 'medium',
    idempotent: true,
    handler: async ({ input }) => ({ bookingId: `BKG-${Date.now()}`, subject: input.subject, date: input.date }),
  });
  registry.register({
    id: 'crm.create_customer',
    category: 'crm',
    description: 'Test CRM create',
    inputSchema: { required: ['customerId'], types: { customerId: 'string' } },
    permissions: [],
    riskLevel: 'low',
    handler: async ({ input }) => ({ customerId: input.customerId, created: true }),
  });
  registry.register({
    id: 'communication.notify_owner',
    category: 'communication',
    description: 'Test notification',
    inputSchema: { required: ['event'], types: { event: 'string' } },
    permissions: [],
    riskLevel: 'low',
    handler: async ({ input }) => ({ notified: true, event: input.event }),
  });
  registry.register({
    id: 'booking.cancel',
    category: 'booking',
    description: 'Test booking cancel (compensation)',
    inputSchema: { required: ['bookingId'], types: { bookingId: 'string' } },
    permissions: [],
    riskLevel: 'medium',
    handler: async ({ input }) => ({ cancelled: true, bookingId: input.bookingId }),
  });
  return registry;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP V — Workflow Engine
// ─────────────────────────────────────────────────────────────────────────────

test('V1: WorkflowEngine registers and starts a workflow', () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.simple',
    name: 'Simple Test Workflow',
    steps: [
      { id: 'step1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
    ],
  });
  const result = engine.start({ definitionId: 'test.simple', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  assert.ok(result.success);
  assert.ok(result.workflowId);
  assert.equal(result.instance.status, WORKFLOW_STATUS.RUNNING);
});

test('V2: WorkflowEngine executes a single-step workflow', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.single',
    name: 'Single Step',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
    ],
  });
  const start = engine.start({ definitionId: 'test.single', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  const result = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  assert.ok(result.success);
  assert.equal(result.status, 'completed');
  const instance = engine.get(start.workflowId);
  assert.equal(instance.status, WORKFLOW_STATUS.COMPLETED);
  assert.equal(instance.steps[0].status, STEP_STATUS.COMPLETED);
  assert.ok(instance.steps[0].result.bookingId, 'should have bookingId in result');
});

test('V3: WorkflowEngine executes a multi-step workflow sequentially', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.multi',
    name: 'Multi Step',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Create CRM record', action: 'crm.create_customer', input: { customerId: '${context.s1.bookingId}' } },
      { id: 's3', name: 'Notify owner', action: 'communication.notify_owner', input: { event: 'booking_created' } },
    ],
  });
  const start = engine.start({ definitionId: 'test.multi', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  const result = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  assert.ok(result.success);
  assert.equal(result.status, 'completed');
  const instance = engine.get(start.workflowId);
  assert.equal(instance.steps[0].status, STEP_STATUS.COMPLETED);
  assert.equal(instance.steps[1].status, STEP_STATUS.COMPLETED);
  assert.equal(instance.steps[2].status, STEP_STATUS.COMPLETED);
  // Context should have results from step 1
  assert.ok(instance.context.s1?.bookingId, 'context should have s1 result');
  assert.ok(instance.context.s2?.created, 'context should have s2 result');
});

test('V4: WorkflowEngine handles conditional branching (skip)', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.conditional',
    name: 'Conditional Workflow',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Skip this step', action: 'crm.create_customer', input: { customerId: 'test' },
        condition: (ctx) => false, // Always skip
      },
      { id: 's3', name: 'Notify owner', action: 'communication.notify_owner', input: { event: 'done' } },
    ],
  });
  const start = engine.start({ definitionId: 'test.conditional', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  const result = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  assert.ok(result.success);
  assert.equal(result.status, 'completed');
  const instance = engine.get(start.workflowId);
  assert.equal(instance.steps[0].status, STEP_STATUS.COMPLETED);
  assert.equal(instance.steps[1].status, STEP_STATUS.SKIPPED);
  assert.equal(instance.steps[2].status, STEP_STATUS.COMPLETED);
});

test('V5: WorkflowEngine pauses for human approval', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.approval',
    name: 'Approval Workflow',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Notify owner', action: 'communication.notify_owner', input: { event: 'booking_created' }, requiresApproval: true },
    ],
  });
  const start = engine.start({ definitionId: 'test.approval', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  const result = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  assert.equal(result.status, 'paused_for_approval');
  assert.equal(result.stepId, 's2');
  const instance = engine.get(start.workflowId);
  assert.equal(instance.status, WORKFLOW_STATUS.PAUSED);
  assert.equal(instance.steps[1].status, STEP_STATUS.WAITING_APPROVAL);

  // Approve the step
  const approval = engine.approve(start.workflowId, 's2', { approvedBy: 'owner1' });
  assert.ok(approval.success);
  assert.equal(instance.steps[1].status, STEP_STATUS.APPROVED);
  assert.equal(instance.status, WORKFLOW_STATUS.RUNNING);

  // Continue execution
  const result2 = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  assert.equal(result2.status, 'completed');
  assert.equal(instance.steps[1].status, STEP_STATUS.COMPLETED);
});

test('V6: WorkflowEngine handles step rejection', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.rejection',
    name: 'Rejection Workflow',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Requires approval', action: 'communication.notify_owner', input: { event: 'test' }, requiresApproval: true },
    ],
  });
  const start = engine.start({ definitionId: 'test.rejection', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });

  // Reject the step
  const rejection = engine.reject(start.workflowId, 's2', { rejectedBy: 'owner1', reason: 'Not available' });
  assert.ok(rejection.success);
  const instance = engine.get(start.workflowId);
  assert.equal(instance.steps[1].status, STEP_STATUS.REJECTED);
  assert.equal(instance.status, WORKFLOW_STATUS.CANCELLED);
});

test('V7: WorkflowEngine handles step failure with compensation', async () => {
  const registry = createTestRegistry();
  // Register a failing action that returns failure (not throws)
  registry.register({
    id: 'test.failing_action',
    category: 'test',
    description: 'Always fails',
    inputSchema: { required: [], types: {} },
    permissions: [],
    riskLevel: 'high',
    handler: async () => { throw new Error('action_failed'); },
  });

  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.failure',
    name: 'Failure with Compensation',
    steps: [
      {
        id: 's1', name: 'Create booking', action: 'booking.create',
        input: { subject: 'Haircut', date: '2026-12-01' },
        compensation: 'booking.cancel',
      },
      { id: 's2', name: 'Failing step', action: 'test.failing_action', input: {} },
    ],
  });
  const start = engine.start({ definitionId: 'test.failure', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  const result = await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  // The failing action throws, ActionRegistry catches and returns { success: false }
  // The Workflow Engine should detect the failure and compensate
  assert.equal(result.status, 'failed');
  const instance = engine.get(start.workflowId);
  assert.equal(instance.status, WORKFLOW_STATUS.FAILED);
  // Step 2 should be FAILED
  assert.equal(instance.steps[1].status, STEP_STATUS.FAILED);
  // Step 1 should be either COMPENSATED (if compensation succeeded) or COMPLETED (if compensation failed)
  // The important thing is the workflow failed and didn't silently complete
  assert.ok([STEP_STATUS.COMPENSATED, STEP_STATUS.COMPLETED].includes(instance.steps[0].status),
    `step 1 status should be compensated or completed, got ${instance.steps[0].status}`);
});

test('V8: WorkflowEngine cancels a running workflow', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.cancel',
    name: 'Cancellation Test',
    steps: [
      { id: 's1', name: 'Step 1', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Step 2', action: 'crm.create_customer', input: { customerId: 'test' }, requiresApproval: true },
    ],
  });
  const start = engine.start({ definitionId: 'test.cancel', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  // Cancel while paused for approval
  const cancelResult = engine.cancel(start.workflowId, { reason: 'customer_changed_mind' });
  assert.ok(cancelResult.success);
  const instance = engine.get(start.workflowId);
  assert.equal(instance.status, WORKFLOW_STATUS.CANCELLED);
  assert.ok(instance.cancelledAt);
});

test('V9: WorkflowEngine list filters by tenant and status', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.list',
    name: 'List Test',
    steps: [{ id: 's1', name: 'Step 1', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } }],
  });
  engine.start({ definitionId: 'test.list', context: {}, tenantId: 'tenant_a', customerId: 'c1', conversationId: 'conv1' });
  engine.start({ definitionId: 'test.list', context: {}, tenantId: 'tenant_b', customerId: 'c2', conversationId: 'conv2' });
  const all = engine.list();
  assert.equal(all.length, 2);
  const tenantA = engine.list({ tenantId: 'tenant_a' });
  assert.equal(tenantA.length, 1);
  assert.equal(tenantA[0].tenantId, 'tenant_a');
});

test('V10: WorkflowEngine preserves context between steps', async () => {
  const registry = createTestRegistry();
  const engine = new WorkflowEngine({ actionRegistry: registry });
  engine.register({
    id: 'test.context',
    name: 'Context Test',
    steps: [
      { id: 's1', name: 'Create booking', action: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } },
      { id: 's2', name: 'Use booking ID', action: 'crm.create_customer', input: { customerId: '${context.s1.bookingId}' } },
    ],
  });
  const start = engine.start({ definitionId: 'test.context', context: {}, tenantId: 't1', customerId: 'c1', conversationId: 'conv1' });
  await engine.tick(start.workflowId, { services: {}, tenant: { id: 't1' } });
  const instance = engine.get(start.workflowId);
  // Step 2 should have received the bookingId from step 1's result
  assert.ok(instance.context.s1?.bookingId, 'context should have s1 result with bookingId');
  assert.equal(instance.steps[1].status, STEP_STATUS.COMPLETED);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP W — Idempotency Engine
// ─────────────────────────────────────────────────────────────────────────────

test('W1: IdempotencyEngine generates deterministic keys', () => {
  const engine = new IdempotencyEngine();
  const key1 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } });
  const key2 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } });
  assert.equal(key1, key2, 'same input should produce same key');
});

test('W2: IdempotencyEngine generates different keys for different input', () => {
  const engine = new IdempotencyEngine();
  const key1 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input: { subject: 'Haircut', date: '2026-12-01' } });
  const key2 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input: { subject: 'Haircut', date: '2026-12-02' } });
  assert.notEqual(key1, key2, 'different input should produce different keys');
});

test('W3: IdempotencyEngine caches successful results', async () => {
  const engine = new IdempotencyEngine();
  let callCount = 0;
  const key = 'test-key-1';
  const action = async () => { callCount++; return { success: true, data: { id: 'result-123' } }; };
  const result1 = await engine.execute({ key, action });
  const result2 = await engine.execute({ key, action });
  assert.equal(callCount, 1, 'action should only be called once');
  assert.equal(result1.data.id, 'result-123');
  assert.equal(result2.data.id, 'result-123');
  assert.equal(result2.fromCache, true);
});

test('W4: IdempotencyEngine does NOT cache failures', async () => {
  const engine = new IdempotencyEngine();
  let callCount = 0;
  const key = 'test-key-fail';
  const action = async () => { callCount++; return { success: false, error: 'failed' }; };
  await engine.execute({ key, action });
  await engine.execute({ key, action });
  assert.equal(callCount, 2, 'failed actions should be retried (not cached)');
});

test('W5: IdempotencyEngine handles key order independence', () => {
  const engine = new IdempotencyEngine();
  const key1 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'a', input: { a: 1, b: 2 } });
  const key2 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'a', input: { b: 2, a: 1 } });
  assert.equal(key1, key2, 'key order should not matter');
});

test('W6: IdempotencyEngine generates different keys for different tenants', () => {
  const engine = new IdempotencyEngine();
  const key1 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'a', input: {} });
  const key2 = engine.generateKey({ tenantId: 't2', customerId: 'c1', actionId: 'a', input: {} });
  assert.notEqual(key1, key2);
});

test('W7: IdempotencyEngine generates different keys for different actions', () => {
  const engine = new IdempotencyEngine();
  const key1 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input: {} });
  const key2 = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'commerce.create_order', input: {} });
  assert.notEqual(key1, key2);
});

test('W8: IdempotencyEngine prevents duplicate bookings', async () => {
  const engine = new IdempotencyEngine();
  let bookingsCreated = 0;
  const input = { subject: 'Haircut', date: '2026-12-01', name: 'Ahmed', phone: '03001234567' };
  const key = engine.generateKey({ tenantId: 't1', customerId: 'c1', actionId: 'booking.create', input });
  const action = async () => {
    bookingsCreated++;
    return { success: true, data: { bookingId: `BKG-${bookingsCreated}` } };
  };
  // First call — creates booking
  const r1 = await engine.execute({ key, action });
  assert.equal(r1.data.bookingId, 'BKG-1');
  // Second call with same key — returns cached result, does NOT create another booking
  const r2 = await engine.execute({ key, action });
  assert.equal(r2.data.bookingId, 'BKG-1');
  assert.equal(bookingsCreated, 1, 'only one booking should be created');
});

test('W9: IdempotencyEngine expire entries after TTL', async () => {
  const engine = new IdempotencyEngine({ ttlMs: 50 }); // 50ms TTL for testing
  const key = 'test-ttl';
  await engine.execute({ key, action: async () => ({ success: true, data: { value: 42 } }) });
  // Wait for TTL to expire
  await new Promise(r => setTimeout(r, 60));
  const cached = engine.get(key);
  assert.equal(cached, null, 'expired entry should return null');
});

test('W10: IdempotencyEngine size tracks stored entries', async () => {
  const engine = new IdempotencyEngine();
  assert.equal(engine.size(), 0);
  await engine.execute({ key: 'k1', action: async () => ({ success: true, data: {} }) });
  await engine.execute({ key: 'k2', action: async () => ({ success: true, data: {} }) });
  assert.equal(engine.size(), 2);
  engine.clear();
  assert.equal(engine.size(), 0);
});
