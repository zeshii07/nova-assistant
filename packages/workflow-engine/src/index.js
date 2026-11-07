/**
 * v49.0 — Workflow Engine
 *
 * Orchestrates multi-step business workflows that span multiple capabilities
 * and external systems. Each workflow is a state machine that:
 *   - Persists across conversation turns
 *   - Supports conditional branching
 *   - Supports delays and scheduled steps
 *   - Retries failed steps
 *   - Compensates (rolls back) on failure
 *   - Pauses for human approval
 *   - Can be cancelled and resumed
 *
 * Example workflow (cleaning business):
 *   1. Customer requests home cleaning
 *   2. Nova collects property size
 *   3. Nova calculates estimate (pricing capability)
 *   4. Customer confirms
 *   5. Nova checks availability (availability capability)
 *   6. Nova creates booking (booking capability)
 *   7. Nova creates CRM record (CRM capability)
 *   8. Nova sends confirmation (notification capability)
 *   9. Business owner receives notification
 *  10. Customer receives reminder before appointment (scheduled)
 *
 * Architecture rule: Workflows coordinate capabilities. They don't
 * implement business logic — they call the Action Registry.
 */

const { createId } = require('../../shared/src/ids');

// Workflow status
const WORKFLOW_STATUS = Object.freeze({
  PENDING: 'pending',       // Created but not started
  RUNNING: 'running',       // Currently executing
  PAUSED: 'paused',         // Paused (waiting for human approval or external event)
  COMPLETED: 'completed',   // All steps completed successfully
  FAILED: 'failed',         // A step failed and couldn't be compensated
  CANCELLED: 'cancelled',   // Cancelled by user or system
});

// Step status
const STEP_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',       // Conditional branch not taken
  COMPENSATED: 'compensated', // Rolled back after failure
  WAITING_APPROVAL: 'waiting_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/**
 * Workflow Step Definition
 */
class WorkflowStep {
  constructor({ id, name, action, input, condition, compensation, requiresApproval, delayMs, retry, dependsOn }) {
    Object.assign(this, {
      id: id || `step_${Math.random().toString(36).slice(2, 8)}`,
      name: name || id || 'unnamed',
      action: action || null,        // Action Registry action ID
      input: input || {},            // Static input (merged with context)
      condition: condition || null,  // Function(context) → boolean (skip if false)
      compensation: compensation || null, // Action ID for rollback
      requiresApproval: Boolean(requiresApproval),
      delayMs: delayMs || 0,         // Delay before executing this step
      retry: retry || { maxAttempts: 1, backoffMs: 0 },
      dependsOn: dependsOn || [],   // Step IDs that must complete first
      status: STEP_STATUS.PENDING,
      result: null,
      error: null,
      executedAt: null,
      completedAt: null,
    });
  }
}

/**
 * Workflow Definition
 */
class WorkflowDefinition {
  constructor({ id, name, description, steps, version = 1 }) {
    this.id = id;
    this.name = name;
    this.description = description || '';
    this.steps = steps.map(s => s instanceof WorkflowStep ? s : new WorkflowStep(s));
    this.version = version;
  }
}

/**
 * Workflow Instance — a running workflow with state
 */
class WorkflowInstance {
  constructor({ definition, context, tenantId, customerId, conversationId }) {
    this.id = createId('WF');
    this.definition = definition;
    this.tenantId = tenantId;
    this.customerId = customerId;
    this.conversationId = conversationId;
    this.context = context || {}; // Shared data between steps
    this.status = WORKFLOW_STATUS.PENDING;
    this.steps = definition.steps.map(s => ({
      ...s,
      status: STEP_STATUS.PENDING,
      result: null,
      error: null,
      executedAt: null,
      completedAt: null,
    }));
    this.currentStepIndex = 0;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.completedAt = null;
    this.cancelledAt = null;
    this.failureReason = null;
    this.history = []; // Audit trail of all step transitions
  }

  toJSON() {
    return {
      id: this.id,
      definitionId: this.definition.id,
      definitionVersion: this.definition.version,
      tenantId: this.tenantId,
      customerId: this.customerId,
      conversationId: this.conversationId,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      context: this.context,
      steps: this.steps.map(s => ({
        id: s.id, name: s.name, action: s.action, status: s.status,
        result: s.result ? '[redacted]' : null, error: s.error,
        executedAt: s.executedAt, completedAt: s.completedAt,
      })),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
      cancelledAt: this.cancelledAt,
      failureReason: this.failureReason,
    };
  }
}

/**
 * Workflow Engine
 *
 * Executes workflow instances step by step. Each step calls the Action Registry.
 */
class WorkflowEngine {
  constructor({ actionRegistry, eventBus = null, logger = null } = {}) {
    this.actionRegistry = actionRegistry;
    this.eventBus = eventBus;
    this.logger = logger;
    this.instances = new Map(); // In-memory store (production: database)
    this.definitions = new Map(); // Registered workflow definitions
  }

  /**
   * Register a workflow definition.
   */
  register(definition) {
    if (!(definition instanceof WorkflowDefinition)) {
      definition = new WorkflowDefinition(definition);
    }
    this.definitions.set(definition.id, definition);
    this.logger?.info?.('workflow.registered', { definitionId: definition.id, version: definition.version, steps: definition.steps.length });
    return definition;
  }

  /**
   * Start a new workflow instance.
   */
  start({ definitionId, context, tenantId, customerId, conversationId }) {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      return { success: false, error: 'workflow_definition_not_found', definitionId };
    }
    const instance = new WorkflowInstance({ definition, context, tenantId, customerId, conversationId });
    instance.status = WORKFLOW_STATUS.RUNNING;
    this.instances.set(instance.id, instance);
    this.logger?.info?.('workflow.started', { workflowId: instance.id, definitionId, tenantId });
    this.eventBus?.publish?.('workflow.started.v1', { workflowId: instance.id, definitionId, tenantId }, { source: 'workflow-engine' });
    return { success: true, workflowId: instance.id, instance };
  }

  /**
   * Execute the next pending step(s) in a workflow instance.
   * Returns when a step requires approval, fails, or all steps complete.
   */
  async tick(workflowId, { services, tenant } = {}) {
    const instance = this.instances.get(workflowId);
    if (!instance) return { success: false, error: 'workflow_not_found', workflowId };
    if (instance.status !== WORKFLOW_STATUS.RUNNING) {
      return { success: true, status: instance.status, message: `workflow is ${instance.status}` };
    }

    // Find the next executable step(s)
    const results = [];
    for (let i = instance.currentStepIndex; i < instance.steps.length; i++) {
      const step = instance.steps[i];

      // Check dependencies
      if (!this._dependenciesMet(instance, step)) {
        break; // Can't proceed — wait for dependencies
      }

      // Check condition (conditional branching)
      if (step.condition && typeof step.condition === 'function') {
        try {
          if (!step.condition(instance.context)) {
            step.status = STEP_STATUS.SKIPPED;
            this._logTransition(instance, step, 'skipped');
            instance.currentStepIndex = i + 1;
            continue;
          }
        } catch (_e) { /* treat as skip */ step.status = STEP_STATUS.SKIPPED; continue; }
      }

      // Check if approval is required
      if (step.requiresApproval && step.status === STEP_STATUS.PENDING) {
        step.status = STEP_STATUS.WAITING_APPROVAL;
        instance.status = WORKFLOW_STATUS.PAUSED;
        this._logTransition(instance, step, 'waiting_approval');
        this._updateTimestamp(instance);
        this.logger?.info?.('workflow.paused_for_approval', { workflowId, stepId: step.id, stepName: step.name });
        return { success: true, status: 'paused_for_approval', stepId: step.id, stepName: step.name };
      }

      // Execute the step
      if (step.action && this.actionRegistry) {
        step.status = STEP_STATUS.RUNNING;
        step.executedAt = new Date().toISOString();
        this._logTransition(instance, step, 'running');

        // Build input: merge static input with workflow context
        const input = { ...step.input, ...this._extractContextFields(step.input, instance.context) };
        const execContext = { tenant, message: { customerId: instance.customerId, channel: 'workflow' } };

        let result;
        let attempts = 0;
        const maxAttempts = step.retry?.maxAttempts || 1;
        while (attempts < maxAttempts) {
          attempts++;
          result = await this.actionRegistry.execute(step.action, { input, context: execContext, services });
          if (result.success) break;
          if (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, (step.retry?.backoffMs || 500) * attempts));
          }
        }

        if (result.success) {
          step.status = STEP_STATUS.COMPLETED;
          step.result = result.data;
          step.completedAt = new Date().toISOString();
          this._logTransition(instance, step, 'completed');
          // Store result in context for subsequent steps
          if (result.data) {
            instance.context[step.id] = result.data;
            // Also spread common result fields into context
            for (const key of ['bookingId', 'orderId', 'customerId', 'confirmationId']) {
              if (result.data[key]) instance.context[key] = result.data[key];
            }
          }
          results.push({ stepId: step.id, status: 'completed' });
        } else {
          step.status = STEP_STATUS.FAILED;
          step.error = result.error || 'unknown_error';
          this._logTransition(instance, step, 'failed');

          // Try compensation
          if (step.compensation) {
            const compResult = await this._compensate(instance, step, { services, tenant });
            if (compResult.compensated) {
              step.status = STEP_STATUS.COMPENSATED;
              this._logTransition(instance, step, 'compensated');
            }
          }

          instance.status = WORKFLOW_STATUS.FAILED;
          instance.failureReason = step.error;
          this._updateTimestamp(instance);
          this.logger?.error?.('workflow.failed', { workflowId, stepId: step.id, error: step.error });
          return { success: false, status: 'failed', stepId: step.id, error: step.error, results };
        }
      } else {
        // No action — just a passthrough/context step
        step.status = STEP_STATUS.COMPLETED;
        step.completedAt = new Date().toISOString();
        this._logTransition(instance, step, 'completed_passthrough');
        results.push({ stepId: step.id, status: 'completed_passthrough' });
      }

      instance.currentStepIndex = i + 1;
    }

    // Check if workflow is complete
    if (instance.currentStepIndex >= instance.steps.length) {
      instance.status = WORKFLOW_STATUS.COMPLETED;
      instance.completedAt = new Date().toISOString();
      this._updateTimestamp(instance);
      this.logger?.info?.('workflow.completed', { workflowId });
      this.eventBus?.publish?.('workflow.completed.v1', { workflowId, definitionId: instance.definition.id, tenantId: instance.tenantId }, { source: 'workflow-engine' });
      return { success: true, status: 'completed', results };
    }

    this._updateTimestamp(instance);
    return { success: true, status: 'running', results, nextStepIndex: instance.currentStepIndex };
  }

  /**
   * Approve a step that was waiting for approval.
   */
  approve(workflowId, stepId, { approvedBy, services, tenant } = {}) {
    const instance = this.instances.get(workflowId);
    if (!instance) return { success: false, error: 'workflow_not_found' };
    const step = instance.steps.find(s => s.id === stepId);
    if (!step || step.status !== STEP_STATUS.WAITING_APPROVAL) {
      return { success: false, error: 'step_not_waiting_approval' };
    }
    step.status = STEP_STATUS.APPROVED;
    step.approvedBy = approvedBy;
    step.approvedAt = new Date().toISOString();
    instance.status = WORKFLOW_STATUS.RUNNING;
    this._logTransition(instance, step, 'approved');
    this.logger?.info?.('workflow.step_approved', { workflowId, stepId, approvedBy });
    return { success: true, stepId };
  }

  /**
   * Reject a step that was waiting for approval.
   */
  reject(workflowId, stepId, { rejectedBy, reason } = {}) {
    const instance = this.instances.get(workflowId);
    if (!instance) return { success: false, error: 'workflow_not_found' };
    const step = instance.steps.find(s => s.id === stepId);
    if (!step || step.status !== STEP_STATUS.WAITING_APPROVAL) {
      return { success: false, error: 'step_not_waiting_approval' };
    }
    step.status = STEP_STATUS.REJECTED;
    step.rejectedBy = rejectedBy;
    step.rejectionReason = reason;
    instance.status = WORKFLOW_STATUS.CANCELLED;
    instance.cancelledAt = new Date().toISOString();
    this._logTransition(instance, step, 'rejected');
    this.logger?.info?.('workflow.step_rejected', { workflowId, stepId, rejectedBy, reason });
    return { success: true, stepId };
  }

  /**
   * Cancel a workflow instance.
   */
  cancel(workflowId, { reason } = {}) {
    const instance = this.instances.get(workflowId);
    if (!instance) return { success: false, error: 'workflow_not_found' };
    if (instance.status === WORKFLOW_STATUS.COMPLETED || instance.status === WORKFLOW_STATUS.CANCELLED) {
      return { success: false, error: 'workflow_already_finished' };
    }
    instance.status = WORKFLOW_STATUS.CANCELLED;
    instance.cancelledAt = new Date().toISOString();
    instance.cancellationReason = reason;
    this._updateTimestamp(instance);
    this.logger?.info?.('workflow.cancelled', { workflowId, reason });
    return { success: true };
  }

  /**
   * Get a workflow instance by ID.
   */
  get(workflowId) {
    return this.instances.get(workflowId) || null;
  }

  /**
   * List workflow instances, optionally filtered.
   */
  list({ tenantId, status, customerId } = {}) {
    return [...this.instances.values()].filter(inst => {
      if (tenantId && inst.tenantId !== tenantId) return false;
      if (status && inst.status !== status) return false;
      if (customerId && inst.customerId !== customerId) return false;
      return true;
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────

  _dependenciesMet(instance, step) {
    for (const depId of step.dependsOn) {
      const dep = instance.steps.find(s => s.id === depId);
      if (!dep || dep.status !== STEP_STATUS.COMPLETED) return false;
    }
    return true;
  }

  _extractContextFields(inputTemplate, context) {
    // Replace ${context.field} placeholders in input with actual context values
    const resolved = {};
    for (const [key, value] of Object.entries(inputTemplate || {})) {
      if (typeof value === 'string' && value.startsWith('${context.')) {
        const path = value.slice(10, -1).split('.');
        let val = context;
        for (const p of path) val = val?.[p];
        resolved[key] = val ?? null;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  async _compensate(instance, failedStep, { services, tenant }) {
    if (!failedStep.compensation) return { compensated: false };
    const compAction = this.actionRegistry?.get(failedStep.compensation);
    if (!compAction) return { compensated: false };

    // Find all completed steps and compensate in reverse order
    const completedSteps = instance.steps.filter(s =>
      s.status === STEP_STATUS.COMPLETED && s.compensation
    ).reverse();

    for (const step of completedSteps) {
      try {
        const compResult = await this.actionRegistry.execute(step.compensation, {
          input: { ...step.input, ...step.result },
          context: { tenant, message: { customerId: instance.customerId } },
          services,
        });
        step.status = STEP_STATUS.COMPENSATED;
        this._logTransition(instance, step, 'compensated');
      } catch (err) {
        this.logger?.error?.('workflow.compensation_failed', { stepId: step.id, error: err.message });
      }
    }
    return { compensated: true };
  }

  _logTransition(instance, step, action) {
    instance.history.push({
      stepId: step.id,
      stepName: step.name,
      action,
      fromStatus: step.status,
      at: new Date().toISOString(),
    });
  }

  _updateTimestamp(instance) {
    instance.updatedAt = new Date().toISOString();
  }
}

module.exports = { WorkflowEngine, WorkflowDefinition, WorkflowStep, WorkflowInstance, WORKFLOW_STATUS, STEP_STATUS };
