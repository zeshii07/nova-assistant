/**
 * v48.0 — Action Registry
 *
 * Standardized contracts for executable business actions. Every consequential
 * operation (create booking, create order, process refund, send email) must
 * register through this registry with:
 *   - Input/output schema
 *   - Required permissions
 *   - Validation rules
 *   - Risk level (low/medium/high)
 *   - Idempotency requirements
 *   - Timeout and retry policy
 *   - Audit requirements
 *
 * Architecture rule: NLU never executes business operations directly.
 * It suggests an action; the Action Registry validates and the Execution
 * Engine invokes it.
 *
 * Example:
 *   const action = registry.get('booking.create');
 *   const validation = action.validate(input);
 *   if (validation.valid) {
 *     const result = await action.execute({ input, context, services });
 *   }
 */

/**
 * Action Definition
 *
 * Each action is registered with a standardized contract.
 */
class ActionDefinition {
  constructor({
    id,             // 'booking.create' — unique action ID
    category,       // 'booking' | 'commerce' | 'crm' | 'communication'
    description,    // human-readable description
    inputSchema,    // { required: [...], optional: [...], types: {...} }
    outputSchema,   // { types: {...} }
    permissions,    // ['booking.write:booking'] — required permissions
    riskLevel,      // 'low' | 'medium' | 'high'
    idempotent,     // boolean — can this action be safely retried?
    timeout,        // ms — how long before the action times out
    retry,          // { maxAttempts, backoffMs } — retry policy
    audit,          // boolean — should this action be logged for audit?
    handler,        // async function({ input, context, services }) → result
    validator,      // optional custom validator function(input) → { valid, errors }
  }) {
    Object.assign(this, {
      id, category, description,
      inputSchema: inputSchema || {},
      outputSchema: outputSchema || {},
      permissions: permissions || [],
      riskLevel: riskLevel || 'medium',
      idempotent: Boolean(idempotent),
      timeout: timeout || 10000,
      retry: retry || { maxAttempts: 1, backoffMs: 0 },
      audit: audit !== false, // default to true
      handler: handler || null,
      validator: validator || null,
    });
  }

  /**
   * Validate input against the action's schema.
   */
  validate(input) {
    const errors = [];
    const schema = this.inputSchema;

    // Check required fields
    for (const field of (schema.required || [])) {
      if (input?.[field] == null || input?.[field] === '') {
        errors.push({ field, rule: 'required', message: `${field} is required` });
      }
    }

    // Check types
    for (const [field, type] of Object.entries(schema.types || {})) {
      const value = input?.[field];
      if (value == null) continue;
      if (type === 'string' && typeof value !== 'string') {
        errors.push({ field, rule: 'type', expected: 'string', actual: typeof value });
      } else if (type === 'number' && typeof value !== 'number') {
        errors.push({ field, rule: 'type', expected: 'number', actual: typeof value });
      } else if (type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ field, rule: 'type', expected: 'boolean', actual: typeof value });
      } else if (type === 'date' && !this._isValidDate(value)) {
        errors.push({ field, rule: 'type', expected: 'date' });
      } else if (type === 'email' && !this._isValidEmail(value)) {
        errors.push({ field, rule: 'type', expected: 'email' });
      } else if (type === 'phone' && !this._isValidPhone(value)) {
        errors.push({ field, rule: 'type', expected: 'phone' });
      }
    }

    // Check custom validator
    if (this.validator) {
      const customResult = this.validator(input);
      if (customResult?.errors) errors.push(...customResult.errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute the action with timeout and retry.
   */
  async execute({ input, context, services }) {
    const validation = this.validate(input);
    if (!validation.valid) {
      return { success: false, error: 'validation_failed', validationErrors: validation.errors };
    }

    if (!this.handler) {
      return { success: false, error: 'no_handler_registered' };
    }

    let lastError = null;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const result = await this._executeWithTimeout({ input, context, services });
        return { success: true, data: result, attempt };
      } catch (error) {
        lastError = error;
        if (attempt < this.retry.maxAttempts) {
          await new Promise(r => setTimeout(r, this.retry.backoffMs * attempt));
        }
      }
    }
    return { success: false, error: lastError?.message || 'execution_failed', attempt: this.retry.maxAttempts };
  }

  async _executeWithTimeout({ input, context, services }) {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('action_timeout')), this.timeout);
      try {
        const result = await this.handler({ input, context, services });
        clearTimeout(timer);
        resolve(result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _isValidDate(value) {
    if (!value) return false;
    return !isNaN(new Date(value).getTime());
  }
  _isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
  }
  _isValidPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }
}

/**
 * Action Registry
 *
 * Central registry for all executable business actions. New capabilities
 * register their actions here instead of executing directly.
 */
class ActionRegistry {
  constructor({ logger = null } = {}) {
    this.actions = new Map();
    this.logger = logger;
    this._registerBuiltins();
  }

  /**
   * Register a new action.
   */
  register(definition) {
    if (!(definition instanceof ActionDefinition)) {
      definition = new ActionDefinition(definition);
    }
    this.actions.set(definition.id, definition);
    this.logger?.info?.('action.registered', { actionId: definition.id, category: definition.category, riskLevel: definition.riskLevel });
    return definition;
  }

  /**
   * Get an action by ID.
   */
  get(actionId) {
    return this.actions.get(actionId) || null;
  }

  /**
   * List all registered actions, optionally filtered by category.
   */
  list(category = null) {
    const all = [...this.actions.values()];
    if (category) return all.filter(a => a.category === category);
    return all;
  }

  /**
   * Check if an action exists.
   */
  has(actionId) {
    return this.actions.has(actionId);
  }

  /**
   * Execute an action by ID with validation and permission checks.
   */
  async execute(actionId, { input, context, services }) {
    const action = this.get(actionId);
    if (!action) {
      return { success: false, error: 'action_not_found', actionId };
    }

    // Permission check
    if (action.permissions.length && context?.tenant) {
      const granted = context.tenant.permissions || [];
      const hasPermission = action.permissions.every(p => granted.includes(p) || granted.includes('*'));
      if (!hasPermission) {
        return { success: false, error: 'permission_denied', requiredPermissions: action.permissions };
      }
    }

    // Execute
    const result = await action.execute({ input, context, services });

    // Audit log
    if (action.audit) {
      this.logger?.info?.('action.executed', {
        actionId,
        riskLevel: action.riskLevel,
        success: result.success,
        attempt: result.attempt,
        tenantId: context?.tenant?.id,
        customerId: context?.message?.customerId,
      });
    }

    return result;
  }

  _registerBuiltins() {
    // Booking actions
    this.register({
      id: 'booking.create',
      category: 'booking',
      description: 'Create a new booking/reservation',
      inputSchema: {
        required: ['subject', 'date', 'time', 'name', 'phone'],
        types: { subject: 'string', date: 'date', time: 'string', name: 'string', phone: 'phone' },
      },
      permissions: ['booking.write:booking'],
      riskLevel: 'medium',
      idempotent: true,
      timeout: 5000,
      retry: { maxAttempts: 2, backoffMs: 500 },
      audit: true,
    });

    this.register({
      id: 'booking.cancel',
      category: 'booking',
      description: 'Cancel an existing booking',
      inputSchema: {
        required: ['bookingId'],
        types: { bookingId: 'string' },
      },
      permissions: ['booking.write:booking'],
      riskLevel: 'medium',
      idempotent: true,
      timeout: 5000,
      retry: { maxAttempts: 2, backoffMs: 500 },
      audit: true,
    });

    this.register({
      id: 'booking.reschedule',
      category: 'booking',
      description: 'Reschedule an existing booking',
      inputSchema: {
        required: ['bookingId'],
        optional: ['newDate', 'newTime'],
        types: { bookingId: 'string', newDate: 'date', newTime: 'string' },
      },
      permissions: ['booking.write:booking'],
      riskLevel: 'medium',
      idempotent: true,
      timeout: 5000,
      retry: { maxAttempts: 2, backoffMs: 500 },
      audit: true,
    });

    // Commerce actions
    this.register({
      id: 'commerce.create_order',
      category: 'commerce',
      description: 'Create a new order from cart',
      inputSchema: {
        required: ['name', 'phone', 'city', 'address', 'paymentMethod'],
        types: { name: 'string', phone: 'phone', city: 'string', address: 'string', paymentMethod: 'string' },
      },
      permissions: ['commerce.write:commerce'],
      riskLevel: 'high',
      idempotent: true,
      timeout: 10000,
      retry: { maxAttempts: 1, backoffMs: 0 },
      audit: true,
    });

    this.register({
      id: 'commerce.process_refund',
      category: 'commerce',
      description: 'Process a refund for an order',
      inputSchema: {
        required: ['orderId', 'reason'],
        types: { orderId: 'string', reason: 'string' },
      },
      permissions: ['commerce.write:commerce'],
      riskLevel: 'high',
      idempotent: false,
      timeout: 15000,
      retry: { maxAttempts: 1, backoffMs: 0 },
      audit: true,
    });

    // CRM actions
    this.register({
      id: 'crm.create_customer',
      category: 'crm',
      description: 'Create or update a customer record',
      inputSchema: {
        required: ['customerId'],
        optional: ['name', 'phone', 'email'],
        types: { customerId: 'string', name: 'string', phone: 'phone', email: 'email' },
      },
      permissions: ['crm.customer.write:crm'],
      riskLevel: 'low',
      idempotent: true,
      timeout: 3000,
      retry: { maxAttempts: 2, backoffMs: 200 },
      audit: false,
    });

    // Communication actions
    this.register({
      id: 'communication.send_email',
      category: 'communication',
      description: 'Send an email notification',
      inputSchema: {
        required: ['to', 'subject', 'body'],
        types: { to: 'email', subject: 'string', body: 'string' },
      },
      permissions: ['notification.write:notification'],
      riskLevel: 'low',
      idempotent: false,
      timeout: 10000,
      retry: { maxAttempts: 2, backoffMs: 1000 },
      audit: true,
    });

    this.register({
      id: 'communication.notify_owner',
      category: 'communication',
      description: 'Notify the business owner of an event',
      inputSchema: {
        required: ['event'],
        types: { event: 'string' },
      },
      permissions: ['notification.write:notification'],
      riskLevel: 'low',
      idempotent: true,
      timeout: 5000,
      retry: { maxAttempts: 3, backoffMs: 500 },
      audit: true,
    });
  }
}

module.exports = { ActionRegistry, ActionDefinition };
