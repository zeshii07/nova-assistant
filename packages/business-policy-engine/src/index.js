/**
 * v48.0 — Business Policy Engine
 *
 * Centralizes business-specific rules that vary per tenant. Replaces scattered
 * if/else logic in capability handlers with a declarative, configurable policy
 * layer that business owners can manage via their dashboard.
 *
 * Policies supported:
 *   - Cancellation: how many hours before appointment cancellation is free
 *   - Operating hours: when the business is open/closed
 *   - Booking restrictions: max party size, advance booking window, min lead time
 *   - Payment requirements: minimum order value, accepted payment methods
 *   - Service eligibility: which services require staff approval
 *   - Refund policies: refund window and percentage
 *   - Escalation conditions: when to escalate to human
 *
 * Architecture rule: NLU never decides business rules. This engine does.
 */

/**
 * Business Policy Engine
 *
 * Loads policies from tenant config (tenants/{id}/policies.json) and
 * provides deterministic rule evaluation for capability handlers.
 */
class BusinessPolicyEngine {
  constructor({ tenantsDir, logger = null } = {}) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.cache = new Map();
  }

  /**
   * Get all policies for a tenant.
   * Falls back to domain defaults if no tenant-specific policies exist.
   */
  getPolicies(tenant) {
    const tenantId = tenant?.id;
    if (!tenantId) return getDefaultPolicies('universal');

    if (this.cache.has(tenantId)) return this.cache.get(tenantId);

    // Try loading tenant-specific policies
    let policies = this._loadTenantPolicies(tenantId);
    if (!policies) {
      // Fall back to domain defaults
      policies = getDefaultPolicies(tenant?.domain || 'universal');
    } else {
      // Merge with domain defaults (tenant overrides take precedence)
      const defaults = getDefaultPolicies(tenant?.domain || 'universal');
      policies = deepMerge(defaults, policies);
    }

    this.cache.set(tenantId, Object.freeze(policies));
    return policies;
  }

  /**
   * Evaluate a cancellation policy.
   * @param {object} params - { tenant, bookingDate, bookingTime, now }
   * @returns {object} { allowed, chargePercentage, reason }
   */
  evaluateCancellation({ tenant, bookingDate, bookingTime, now = new Date() }) {
    const policies = this.getPolicies(tenant);
    const cancellation = policies.cancellation || {};
    const windowHours = cancellation.windowHours || 24;
    const chargePercentage = cancellation.chargePercentage || 0;

    // Calculate hours until booking
    const bookingDateTime = this._parseBookingDateTime(bookingDate, bookingTime);
    if (!bookingDateTime) {
      return { allowed: true, chargePercentage: 0, reason: 'no_booking_date' };
    }

    const hoursUntilBooking = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntilBooking < 0) {
      return { allowed: false, chargePercentage: 100, reason: 'past_booking' };
    }

    if (hoursUntilBooking < windowHours) {
      return {
        allowed: true,
        chargePercentage,
        reason: `within_${windowHours}h_window`,
        hoursRemaining: Math.round(hoursUntilBooking),
      };
    }

    return { allowed: true, chargePercentage: 0, reason: 'outside_window' };
  }

  /**
   * Evaluate booking restrictions.
   * @param {object} params - { tenant, partySize, date, serviceId }
   * @returns {object} { valid, violations: [] }
   */
  evaluateBookingRestrictions({ tenant, partySize = null, date = null, serviceId = null }) {
    const policies = this.getPolicies(tenant);
    const booking = policies.booking || {};
    const violations = [];

    // Max party size
    if (partySize != null && booking.maxPartySize && partySize > booking.maxPartySize) {
      violations.push({
        rule: 'max_party_size',
        max: booking.maxPartySize,
        requested: partySize,
        message: `Party size ${partySize} exceeds maximum of ${booking.maxPartySize}`,
      });
    }

    // Min party size
    if (partySize != null && booking.minPartySize && partySize < booking.minPartySize) {
      violations.push({
        rule: 'min_party_size',
        min: booking.minPartySize,
        requested: partySize,
        message: `Party size ${partySize} is below minimum of ${booking.minPartySize}`,
      });
    }

    // Advance booking window
    if (date && booking.maxAdvanceDays) {
      const bookingDate = new Date(date);
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + booking.maxAdvanceDays);
      if (bookingDate > maxDate) {
        violations.push({
          rule: 'max_advance_days',
          max: booking.maxAdvanceDays,
          message: `Cannot book more than ${booking.maxAdvanceDays} days in advance`,
        });
      }
    }

    // Service requires staff approval
    if (serviceId && booking.requiresStaffApproval?.includes?.(serviceId)) {
      violations.push({
        rule: 'requires_staff_approval',
        serviceId,
        message: 'This service requires staff approval before confirmation',
      });
    }

    return { valid: violations.length === 0, violations };
  }

  /**
   * Evaluate payment requirements.
   * @param {object} params - { tenant, total, paymentMethod }
   * @returns {object} { valid, violations: [] }
   */
  evaluatePaymentRequirements({ tenant, total = 0, paymentMethod = null }) {
    const policies = this.getPolicies(tenant);
    const payment = policies.payment || {};
    const violations = [];

    // Minimum order value
    if (payment.minOrderValue && total < payment.minOrderValue) {
      violations.push({
        rule: 'min_order_value',
        min: payment.minOrderValue,
        actual: total,
        message: `Order total ${total} is below minimum of ${payment.minOrderValue}`,
      });
    }

    // Accepted payment methods
    if (paymentMethod && payment.acceptedMethods?.length) {
      if (!payment.acceptedMethods.includes(paymentMethod)) {
        violations.push({
          rule: 'payment_method_not_accepted',
          requested: paymentMethod,
          accepted: payment.acceptedMethods,
          message: `Payment method "${paymentMethod}" is not accepted. Accepted: ${payment.acceptedMethods.join(', ')}`,
        });
      }
    }

    return { valid: violations.length === 0, violations };
  }

  /**
   * Evaluate refund policy.
   * @param {object} params - { tenant, orderDate, now }
   * @returns {object} { eligible, refundPercentage, reason }
   */
  evaluateRefund({ tenant, orderDate, now = new Date() }) {
    const policies = this.getPolicies(tenant);
    const refund = policies.refund || {};
    const windowDays = refund.windowDays || 0;
    const refundPercentage = refund.percentage || 0;

    if (!orderDate) return { eligible: false, refundPercentage: 0, reason: 'no_order_date' };

    const order = new Date(orderDate);
    const daysSinceOrder = (now - order) / (1000 * 60 * 60 * 24);

    if (daysSinceOrder > windowDays) {
      return { eligible: false, refundPercentage: 0, reason: 'outside_window' };
    }

    return {
      eligible: true,
      refundPercentage,
      reason: 'within_window',
      daysRemaining: Math.round(windowDays - daysSinceOrder),
    };
  }

  /**
   * Check if a service requires staff approval.
   */
  requiresStaffApproval(tenant, serviceId) {
    const policies = this.getPolicies(tenant);
    return Boolean(policies.booking?.requiresStaffApproval?.includes?.(serviceId));
  }

  /**
   * Check if escalation to human is needed.
   */
  shouldEscalateToHuman(tenant, context = {}) {
    const policies = this.getPolicies(tenant);
    const escalation = policies.escalation || {};
    const reasons = [];

    // Customer requested human
    if (context.customerRequested) reasons.push('customer_requested');

    // Repeated failures
    if (context.failureCount >= (escalation.maxFailures || 3)) {
      reasons.push('repeated_failures');
    }

    // High-value transaction
    if (context.orderTotal >= (escalation.highValueThreshold || 100000)) {
      reasons.push('high_value_transaction');
    }

    // Explicit escalation keywords in the message
    if (context.messageText && /human|agent|manager|insan|banda/i.test(context.messageText)) {
      reasons.push('escalation_keyword');
    }

    return { escalate: reasons.length > 0, reasons };
  }

  _loadTenantPolicies(tenantId) {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(this.tenantsDir, tenantId, 'policies.json');
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_e) {
      return null;
    }
  }

  _parseBookingDateTime(date, time) {
    if (!date) return null;
    try {
      // Assume date is DD/MM/YYYY or ISO
      let dt;
      if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
        dt = new Date(date);
      } else if (/^\d{2}\/\d{2}\/\d{4}/.test(date)) {
        const [dd, mm, yyyy] = date.split('/');
        dt = new Date(`${yyyy}-${mm}-${dd}`);
      } else {
        return null;
      }
      if (time) {
        const [h, m] = String(time).split(':');
        dt.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
      }
      return dt;
    } catch {
      return null;
    }
  }

  clearCache(tenantId) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}

/**
 * Default policies per domain. These provide sensible defaults that
 * individual tenants can override via their policies.json file.
 */
function getDefaultPolicies(domain) {
  const defaults = {
    universal: {
      cancellation: { windowHours: 24, chargePercentage: 0 },
      booking: { maxPartySize: 100, minPartySize: 1, maxAdvanceDays: 365 },
      payment: { acceptedMethods: ['Cash on Delivery', 'JazzCash', 'EasyPaisa', 'Bank Transfer'] },
      refund: { windowDays: 7, percentage: 100 },
      escalation: { maxFailures: 3, highValueThreshold: 100000 },
    },
    restaurant: {
      cancellation: { windowHours: 2, chargePercentage: 0 },
      booking: { maxPartySize: 20, minPartySize: 1, maxAdvanceDays: 30 },
      payment: { acceptedMethods: ['Cash on Delivery', 'JazzCash', 'EasyPaisa', 'Bank Transfer'] },
      refund: { windowDays: 1, percentage: 50 },
      escalation: { maxFailures: 3, highValueThreshold: 50000 },
    },
    hotel: {
      cancellation: { windowHours: 48, chargePercentage: 100 },
      booking: { maxPartySize: 10, minPartySize: 1, maxAdvanceDays: 365 },
      payment: { acceptedMethods: ['Bank Transfer', 'Cash on Delivery'] },
      refund: { windowDays: 3, percentage: 80 },
      escalation: { maxFailures: 2, highValueThreshold: 200000 },
    },
    salon: {
      cancellation: { windowHours: 4, chargePercentage: 50 },
      booking: { maxPartySize: 1, minPartySize: 1, maxAdvanceDays: 60 },
      payment: { acceptedMethods: ['Cash on Delivery', 'JazzCash', 'EasyPaisa'] },
      refund: { windowDays: 1, percentage: 0 },
      escalation: { maxFailures: 3, highValueThreshold: 30000 },
    },
    cleaning: {
      cancellation: { windowHours: 12, chargePercentage: 0 },
      booking: { maxPartySize: 1, minPartySize: 1, maxAdvanceDays: 90 },
      payment: { acceptedMethods: ['Cash on Delivery', 'Bank Transfer'] },
      refund: { windowDays: 2, percentage: 100 },
      escalation: { maxFailures: 3, highValueThreshold: 100000 },
    },
    retail: {
      cancellation: { windowHours: 1, chargePercentage: 0 },
      booking: {},
      payment: { minOrderValue: 0, acceptedMethods: ['Cash on Delivery', 'JazzCash', 'EasyPaisa', 'Bank Transfer'] },
      refund: { windowDays: 14, percentage: 100 },
      escalation: { maxFailures: 3, highValueThreshold: 50000 },
    },
    healthcare: {
      cancellation: { windowHours: 24, chargePercentage: 0 },
      booking: { maxPartySize: 1, minPartySize: 1, maxAdvanceDays: 90, requiresStaffApproval: [] },
      payment: { acceptedMethods: ['Cash on Delivery', 'Bank Transfer'] },
      refund: { windowDays: 1, percentage: 100 },
      escalation: { maxFailures: 2, highValueThreshold: 20000 },
    },
    education: {
      cancellation: { windowHours: 48, chargePercentage: 0 },
      booking: { maxPartySize: 1, minPartySize: 1, maxAdvanceDays: 180 },
      payment: { acceptedMethods: ['Bank Transfer', 'Cash on Delivery'] },
      refund: { windowDays: 7, percentage: 80 },
      escalation: { maxFailures: 3, highValueThreshold: 100000 },
    },
    driving_school: {
      cancellation: { windowHours: 12, chargePercentage: 50 },
      booking: { maxPartySize: 1, minPartySize: 1, maxAdvanceDays: 60 },
      payment: { acceptedMethods: ['Cash on Delivery', 'JazzCash', 'EasyPaisa'] },
      refund: { windowDays: 3, percentage: 70 },
      escalation: { maxFailures: 3, highValueThreshold: 30000 },
    },
  };
  return defaults[domain] || defaults.universal;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(target[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { BusinessPolicyEngine, getDefaultPolicies };
