/**
 * v52.0 — Analytics Engine
 *
 * Tracks conversation metrics and business performance indicators.
 * Provides actionable insights for business owners.
 *
 * Metrics tracked:
 *   - Conversation metrics: total messages, unique customers, avg turns
 *   - Intent accuracy: how often Nova correctly understood the customer
 *   - Workflow completion rate: % of started workflows that completed
 *   - Booking success rate: % of booking attempts that resulted in confirmed bookings
 *   - Order success rate: % of checkout attempts that resulted in confirmed orders
 *   - Duplicate action rate: % of actions blocked by idempotency
 *   - Fallback rate: % of messages that fell through to the assistant
 *   - Human escalation rate: % of conversations escalated to staff
 *   - Response latency: p50, p95, p99 message processing time
 *   - Channel breakdown: messages per channel
 *   - Capability breakdown: messages per capability
 *   - Customer satisfaction: feedback scores
 */

/**
 * Analytics Engine
 */
class AnalyticsEngine {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.events = []; // Raw event log
    this.metrics = new Map(); // tenantId → aggregated metrics
    this.maxEvents = 10000; // Keep last 10k events in memory
  }

  /**
   * Record a conversation event.
   */
  record(tenantId, event) {
    const record = {
      tenantId,
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    this.events.push(record);

    // Trim if over limit
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Update aggregated metrics
    this._updateMetrics(record);
  }

  /**
   * Get aggregated metrics for a tenant.
   */
  getMetrics(tenantId, options = {}) {
    const metrics = this.metrics.get(tenantId) || this._emptyMetrics();

    // If a time range is specified, recalculate from events
    if (options.since || options.until) {
      return this._recalculate(tenantId, options);
    }

    return { ...metrics, generatedAt: new Date().toISOString() };
  }

  /**
   * Get raw events for a tenant (for detailed analysis).
   */
  getEvents(tenantId, options = {}) {
    let events = this.events.filter(e => e.tenantId === tenantId);
    if (options.since) events = events.filter(e => e.timestamp >= options.since);
    if (options.type) events = events.filter(e => e.type === options.type);
    if (options.capabilityId) events = events.filter(e => e.capabilityId === options.capabilityId);
    if (options.limit) events = events.slice(-options.limit);
    return events;
  }

  /**
   * Get a summary dashboard for a tenant.
   */
  getDashboard(tenantId) {
    const m = this.getMetrics(tenantId);
    const recentEvents = this.getEvents(tenantId, { limit: 10 });

    return {
      summary: {
        totalMessages: m.totalMessages,
        uniqueCustomers: m.uniqueCustomers.size,
        avgTurnsPerConversation: m.conversations > 0 ? (m.totalMessages / m.conversations).toFixed(1) : 0,
        bookingSuccessRate: m.bookingAttempts > 0 ? Math.round((m.bookingsConfirmed / m.bookingAttempts) * 100) : 0,
        orderSuccessRate: m.checkoutAttempts > 0 ? Math.round((m.ordersConfirmed / m.checkoutAttempts) * 100) : 0,
        fallbackRate: m.totalMessages > 0 ? Math.round((m.fallbackCount / m.totalMessages) * 100) : 0,
        escalationRate: m.totalMessages > 0 ? Math.round((m.escalations / m.totalMessages) * 100) : 0,
        avgResponseMs: m.latencies.length > 0 ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : 0,
        duplicateActionRate: m.totalActions > 0 ? Math.round((m.duplicateActions / m.totalActions) * 100) : 0,
      },
      breakdown: {
        byChannel: Object.fromEntries(m.byChannel),
        byCapability: Object.fromEntries(m.byCapability),
        byIntent: Object.fromEntries(m.byIntent),
      },
      latency: {
        p50: this._percentile(m.latencies, 50),
        p95: this._percentile(m.latencies, 95),
        p99: this._percentile(m.latencies, 99),
      },
      recentEvents,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get conversation insights for a specific customer.
   */
  getCustomerInsights(tenantId, customerId) {
    const events = this.events.filter(e =>
      e.tenantId === tenantId && e.customerId === customerId
    );
    if (!events.length) return null;

    const capabilities = {};
    const intents = {};
    let totalLatency = 0;
    let latencyCount = 0;
    let messageCount = 0;
    let fallbacks = 0;
    let bookings = 0;
    let orders = 0;

    for (const e of events) {
      if (e.type === 'message') {
        messageCount++;
        if (e.capabilityId) capabilities[e.capabilityId] = (capabilities[e.capabilityId] || 0) + 1;
        if (e.intent) intents[e.intent] = (intents[e.intent] || 0) + 1;
      }
      if (e.latencyMs) { totalLatency += e.latencyMs; latencyCount++; }
      if (e.type === 'fallback') fallbacks++;
      if (e.type === 'booking_confirmed') bookings++;
      if (e.type === 'order_confirmed') orders++;
    }

    return {
      totalMessages: messageCount,
      totalEvents: events.length,
      lastActivity: events[events.length - 1]?.timestamp,
      avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      bookings,
      orders,
      fallbacks,
      topCapabilities: Object.entries(capabilities).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topIntents: Object.entries(intents).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }

  // ─── Private ──────────────────────────────────────────────

  _emptyMetrics() {
    return {
      totalMessages: 0,
      conversations: 0,
      uniqueCustomers: new Set(),
      bookingAttempts: 0,
      bookingsConfirmed: 0,
      checkoutAttempts: 0,
      ordersConfirmed: 0,
      fallbackCount: 0,
      escalations: 0,
      duplicateActions: 0,
      totalActions: 0,
      latencies: [],
      byChannel: new Map(),
      byCapability: new Map(),
      byIntent: new Map(),
    };
  }

  _updateMetrics(event) {
    const tenantId = event.tenantId;
    if (!this.metrics.has(tenantId)) {
      this.metrics.set(tenantId, this._emptyMetrics());
    }
    const m = this.metrics.get(tenantId);

    // Message-level metrics
    if (event.type === 'message') {
      m.totalMessages++;
      if (event.customerId) m.uniqueCustomers.add(event.customerId);
      if (event.channel) m.byChannel.set(event.channel, (m.byChannel.get(event.channel) || 0) + 1);
      if (event.capabilityId) m.byCapability.set(event.capabilityId, (m.byCapability.get(event.capabilityId) || 0) + 1);
      if (event.intent) m.byIntent.set(event.intent, (m.byIntent.get(event.intent) || 0) + 1);
      if (event.latencyMs) m.latencies.push(event.latencyMs);
      if (m.latencies.length > 1000) m.latencies = m.latencies.slice(-1000);
    }

    // Conversation start
    if (event.type === 'conversation_started') m.conversations++;

    // Booking metrics
    if (event.type === 'booking_attempt') m.bookingAttempts++;
    if (event.type === 'booking_confirmed') m.bookingsConfirmed++;

    // Order metrics
    if (event.type === 'checkout_attempt') m.checkoutAttempts++;
    if (event.type === 'order_confirmed') m.ordersConfirmed++;

    // Fallback
    if (event.type === 'fallback') m.fallbackCount++;

    // Escalation
    if (event.type === 'escalation') m.escalations++;

    // Action metrics
    if (event.type === 'action_executed') {
      m.totalActions++;
      if (event.duplicate) m.duplicateActions++;
    }
  }

  _recalculate(tenantId, options) {
    const events = this.getEvents(tenantId, options);
    const m = this._emptyMetrics();
    for (const e of events) this._updateMetrics({ ...e, tenantId });
    return { ...m, uniqueCustomers: m.uniqueCustomers.size, generatedAt: new Date().toISOString() };
  }

  _percentile(arr, p) {
    if (!arr || !arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] || 0;
  }
}

module.exports = { AnalyticsEngine };
