/**
 * Sprint 12 — v52.0 Phase 5 Business Intelligence Tests
 *
 * Tests:
 *   CC — Business Config Profile (capabilities, channels, policies, validation)
 *   DD — Customer Memory (preferences, interactions, consent, insights, erasure)
 *   EE — Analytics Engine (metrics, dashboard, latency, breakdowns)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { BusinessConfigProfile, BusinessConfigRegistry, DOMAIN_DEFAULTS } = require('../packages/business-config/src');
const { CustomerMemoryService, CustomerMemoryRecord } = require('../packages/customer-memory/src');
const { AnalyticsEngine } = require('../packages/analytics-engine/src');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP CC — Business Config Profile
// ─────────────────────────────────────────────────────────────────────────────

test('CC1: BusinessConfigProfile creates with defaults', () => {
  const profile = new BusinessConfigProfile({ tenantId: 't1', businessName: 'Test' });
  assert.equal(profile.tenantId, 't1');
  assert.equal(profile.businessName, 'Test');
  assert.equal(profile.assistant.tone, 'friendly');
  assert.equal(profile.assistant.responseLength, 'balanced');
  assert.equal(profile.assistant.emojiUsage, 'minimal');
});

test('CC2: BusinessConfigProfile validates required fields', () => {
  const profile = new BusinessConfigProfile({ businessName: '' }); // empty name, no tenantId
  // Override the default 'Unknown Business'
  profile.businessName = '';
  const validation = profile.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.field === 'tenantId'));
  assert.ok(validation.errors.some(e => e.field === 'businessName'));
  assert.ok(validation.errors.some(e => e.field === 'enabledCapabilities'));
});

test('CC3: BusinessConfigProfile hasCapability checks', () => {
  const profile = new BusinessConfigProfile({
    tenantId: 't1', businessName: 'Test',
    enabledCapabilities: ['booking', 'crm', 'commerce'],
  });
  assert.ok(profile.hasCapability('booking'));
  assert.ok(profile.hasCapability('crm'));
  assert.ok(!profile.hasCapability('cleaning'));
});

test('CC4: BusinessConfigProfile hasChannel checks', () => {
  const profile = new BusinessConfigProfile({
    tenantId: 't1', businessName: 'Test',
    enabledCapabilities: ['assistant'],
    channels: ['website', 'whatsapp'],
  });
  assert.ok(profile.hasChannel('website'));
  assert.ok(profile.hasChannel('whatsapp'));
  assert.ok(!profile.hasChannel('telegram'));
});

test('CC5: BusinessConfigProfile getPolicy navigates nested paths', () => {
  const profile = new BusinessConfigProfile({
    tenantId: 't1', businessName: 'Test',
    enabledCapabilities: ['assistant'],
    policies: { cancellation: { windowHours: 4, chargePercentage: 50 } },
  });
  assert.equal(profile.getPolicy('cancellation.windowHours'), 4);
  assert.equal(profile.getPolicy('cancellation.chargePercentage'), 50);
  assert.equal(profile.getPolicy('nonexistent.path', 'default'), 'default');
});

test('CC6: BusinessConfigProfile hasIntegration checks', () => {
  const profile = new BusinessConfigProfile({
    tenantId: 't1', businessName: 'Test',
    enabledCapabilities: ['assistant'],
    integrations: { calendar: true, payment: false },
  });
  assert.ok(profile.hasIntegration('calendar'));
  assert.ok(!profile.hasIntegration('payment'));
});

test('CC7: BusinessConfigRegistry loads from tenant object', () => {
  const registry = new BusinessConfigRegistry({ tenantsDir: './tenants' });
  const tenant = {
    id: 'salon-demo',
    domain: 'salon',
    name: 'Nova Style Salon',
    capabilities: ['assistant', 'crm', 'offering', 'booking', 'service'],
    defaultLanguage: 'english',
  };
  const profile = registry.getProfile(tenant);
  assert.ok(profile);
  assert.equal(profile.tenantId, 'salon-demo');
  assert.equal(profile.businessType, 'salon');
  assert.ok(profile.hasCapability('booking'));
});

test('CC8: DOMAIN_DEFAULTS has all 8 domains', () => {
  const domains = Object.keys(DOMAIN_DEFAULTS);
  assert.ok(domains.includes('restaurant'));
  assert.ok(domains.includes('hotel'));
  assert.ok(domains.includes('salon'));
  assert.ok(domains.includes('cleaning'));
  assert.ok(domains.includes('retail'));
  assert.ok(domains.includes('healthcare'));
  assert.ok(domains.includes('education'));
  assert.ok(domains.includes('driving_school'));
});

test('CC9: BusinessConfigProfile supports custom business type (pet grooming)', () => {
  // Pet grooming is NOT a hardcoded domain — it reuses existing capabilities
  const profile = new BusinessConfigProfile({
    tenantId: 'pet-grooming-demo',
    businessName: 'Pawsome Pet Grooming',
    businessType: 'pet_grooming', // custom type, not in DOMAIN_DEFAULTS
    enabledCapabilities: ['assistant', 'crm', 'offering', 'booking', 'pricing', 'availability'],
    channels: ['website', 'whatsapp'],
    assistant: { tone: 'friendly', emojiUsage: 'moderate', brandPersonality: 'youthful' },
    policies: { cancellation: { windowHours: 6, chargePercentage: 30 } },
  });
  const validation = profile.validate();
  assert.equal(validation.valid, true);
  assert.ok(profile.hasCapability('booking'));
  assert.ok(profile.hasCapability('pricing'));
  assert.equal(profile.getPolicy('cancellation.windowHours'), 6);
});

test('CC10: BusinessConfigProfile toJSON serializes correctly', () => {
  const profile = new BusinessConfigProfile({
    tenantId: 't1', businessName: 'Test',
    enabledCapabilities: ['assistant', 'booking'],
    channels: ['website'],
  });
  const json = profile.toJSON();
  assert.equal(json.tenantId, 't1');
  assert.deepEqual(json.enabledCapabilities, ['assistant', 'booking']);
  assert.ok(json.assistant);
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DD — Customer Memory
// ─────────────────────────────────────────────────────────────────────────────

test('DD1: CustomerMemoryService creates record on first access', () => {
  const service = new CustomerMemoryService();
  const record = service.get('t1', 'c1');
  assert.ok(record);
  assert.equal(record.tenantId, 't1');
  assert.equal(record.customerId, 'c1');
});

test('DD2: CustomerMemoryService records interaction', () => {
  const service = new CustomerMemoryService();
  service.recordInteraction('t1', 'c1', {
    type: 'booking',
    capabilityId: 'booking',
    intent: 'booking.start',
    summary: 'Booked haircut for tomorrow',
    outcome: 'success',
  });
  const history = service.getHistory('t1', 'c1');
  assert.equal(history.length, 1);
  assert.equal(history[0].type, 'booking');
  assert.equal(history[0].outcome, 'success');
});

test('DD3: CustomerMemoryService sets and gets preferences', () => {
  const service = new CustomerMemoryService();
  service.setPreference('t1', 'c1', 'preferredTime', '5pm');
  service.setPreference('t1', 'c1', 'language', 'roman_urdu');
  assert.equal(service.getPreference('t1', 'c1', 'preferredTime'), '5pm');
  assert.equal(service.getPreference('t1', 'c1', 'language'), 'roman_urdu');
  assert.equal(service.getPreference('t1', 'c1', 'nonexistent', 'default'), 'default');
});

test('DD4: CustomerMemoryService respects consent', () => {
  const service = new CustomerMemoryService();
  // Revoke data collection consent
  service.updateConsent('t1', 'c1', { dataCollection: false });
  // setPreference should return false (consent denied)
  const result = service.setPreference('t1', 'c1', 'test', 'value');
  assert.equal(result, false);
  // recordInteraction should return false
  const ir = service.recordInteraction('t1', 'c1', { type: 'test' });
  assert.equal(ir, false);
  // Re-grant consent
  service.updateConsent('t1', 'c1', { dataCollection: true });
  const result2 = service.setPreference('t1', 'c1', 'test', 'value');
  assert.equal(result2, true);
});

test('DD5: CustomerMemoryService adds tags', () => {
  const service = new CustomerMemoryService();
  service.addTag('t1', 'c1', 'vip');
  service.addTag('t1', 'c1', 'vip'); // duplicate should be ignored
  service.addTag('t1', 'c1', 'frequent_buyer');
  const tags = service.getTags('t1', 'c1');
  assert.equal(tags.length, 2);
  assert.ok(tags.includes('vip'));
  assert.ok(tags.includes('frequent_buyer'));
});

test('DD6: CustomerMemoryService adds notes', () => {
  const service = new CustomerMemoryService();
  service.addNote('t1', 'c1', 'Customer prefers morning appointments', 'owner');
  const record = service.get('t1', 'c1');
  assert.equal(record.notes.length, 1);
  assert.equal(record.notes[0].text, 'Customer prefers morning appointments');
  assert.equal(record.notes[0].addedBy, 'owner');
});

test('DD7: CustomerMemoryService getInsights derives analytics', () => {
  const service = new CustomerMemoryService();
  // Record several interactions
  service.recordInteraction('t1', 'c1', { type: 'booking', outcome: 'success' });
  service.recordInteraction('t1', 'c1', { type: 'order', outcome: 'success' });
  service.recordInteraction('t1', 'c1', { type: 'booking', outcome: 'cancelled' });
  service.setPreference('t1', 'c1', 'preferredTime', '5pm');
  service.setPreference('t1', 'c1', 'paymentMethod', 'JazzCash');
  service.addTag('t1', 'c1', 'vip');

  const insights = service.getInsights('t1', 'c1');
  assert.equal(insights.totalInteractions, 3);
  assert.equal(insights.preferredTime, '5pm');
  assert.equal(insights.preferredPaymentMethod, 'JazzCash');
  assert.ok(insights.isVip);
  assert.equal(insights.successRate, 67); // 2 out of 3
  assert.ok(insights.interactionBreakdown.booking > 0);
});

test('DD8: CustomerMemoryService is tenant-isolated', () => {
  const service = new CustomerMemoryService();
  service.setPreference('t1', 'c1', 'test', 'value_t1');
  service.setPreference('t2', 'c1', 'test', 'value_t2');
  assert.equal(service.getPreference('t1', 'c1', 'test'), 'value_t1');
  assert.equal(service.getPreference('t2', 'c1', 'test'), 'value_t2');
});

test('DD9: CustomerMemoryService delete (GDPR erasure)', () => {
  const service = new CustomerMemoryService();
  service.setPreference('t1', 'c1', 'test', 'value');
  service.addTag('t1', 'c1', 'vip');
  const deleted = service.delete('t1', 'c1');
  assert.ok(deleted);
  // After deletion, a new record is created with defaults
  const record = service.get('t1', 'c1');
  assert.equal(record.tags.length, 0);
  assert.equal(record.getPreference('test'), null);
});

test('DD10: CustomerMemoryService listCustomers for admin', () => {
  const service = new CustomerMemoryService();
  service.recordInteraction('t1', 'c1', { type: 'booking' });
  service.recordInteraction('t1', 'c2', { type: 'order' });
  service.recordInteraction('t2', 'c3', { type: 'booking' });
  const t1Customers = service.listCustomers('t1');
  assert.equal(t1Customers.length, 2);
  assert.ok(t1Customers.some(c => c.customerId === 'c1'));
  assert.ok(t1Customers.some(c => c.customerId === 'c2'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP EE — Analytics Engine
// ─────────────────────────────────────────────────────────────────────────────

test('EE1: AnalyticsEngine records message events', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', {
    type: 'message',
    customerId: 'c1',
    channel: 'website',
    capabilityId: 'booking',
    intent: 'booking.start',
    latencyMs: 150,
  });
  const metrics = engine.getMetrics('t1');
  assert.equal(metrics.totalMessages, 1);
  assert.ok(metrics.uniqueCustomers.has('c1'));
  assert.equal(metrics.byChannel.get('website'), 1);
  assert.equal(metrics.byCapability.get('booking'), 1);
});

test('EE2: AnalyticsEngine tracks booking success rate', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'booking_attempt' });
  engine.record('t1', { type: 'booking_attempt' });
  engine.record('t1', { type: 'booking_confirmed' });
  const metrics = engine.getMetrics('t1');
  assert.equal(metrics.bookingAttempts, 2);
  assert.equal(metrics.bookingsConfirmed, 1);
});

test('EE3: AnalyticsEngine tracks order success rate', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'checkout_attempt' });
  engine.record('t1', { type: 'checkout_attempt' });
  engine.record('t1', { type: 'checkout_attempt' });
  engine.record('t1', { type: 'order_confirmed' });
  engine.record('t1', { type: 'order_confirmed' });
  const metrics = engine.getMetrics('t1');
  assert.equal(metrics.checkoutAttempts, 3);
  assert.equal(metrics.ordersConfirmed, 2);
});

test('EE4: AnalyticsEngine tracks fallback and escalation rates', () => {
  const engine = new AnalyticsEngine();
  for (let i = 0; i < 10; i++) {
    engine.record('t1', { type: 'message', customerId: `c${i}`, channel: 'website' });
  }
  engine.record('t1', { type: 'fallback' });
  engine.record('t1', { type: 'fallback' });
  engine.record('t1', { type: 'escalation' });
  const dashboard = engine.getDashboard('t1');
  assert.equal(dashboard.summary.totalMessages, 10);
  assert.equal(dashboard.summary.fallbackRate, 20); // 2/10
  assert.equal(dashboard.summary.escalationRate, 10); // 1/10
});

test('EE5: AnalyticsEngine tracks latency percentiles', () => {
  const engine = new AnalyticsEngine();
  const latencies = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
  for (const ms of latencies) {
    engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', latencyMs: ms });
  }
  const dashboard = engine.getDashboard('t1');
  assert.ok(dashboard.latency.p50 > 0);
  assert.ok(dashboard.latency.p95 >= dashboard.latency.p50);
  assert.ok(dashboard.latency.p99 >= dashboard.latency.p95);
});

test('EE6: AnalyticsEngine getDashboard returns complete summary', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'conversation_started' });
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', capabilityId: 'booking', intent: 'booking.start', latencyMs: 200 });
  engine.record('t1', { type: 'booking_attempt' });
  engine.record('t1', { type: 'booking_confirmed' });
  engine.record('t1', { type: 'escalation' });
  const dashboard = engine.getDashboard('t1');
  assert.ok(dashboard.summary);
  assert.ok(dashboard.breakdown);
  assert.ok(dashboard.latency);
  assert.ok(dashboard.recentEvents);
  assert.equal(dashboard.summary.bookingSuccessRate, 100);
});

test('EE7: AnalyticsEngine getCustomerInsights for specific customer', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', capabilityId: 'booking', intent: 'booking.start', latencyMs: 150 });
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', capabilityId: 'commerce', intent: 'commerce.confirm', latencyMs: 200 });
  engine.record('t1', { type: 'booking_confirmed', customerId: 'c1' });
  engine.record('t1', { type: 'order_confirmed', customerId: 'c1' });
  const insights = engine.getCustomerInsights('t1', 'c1');
  assert.ok(insights);
  assert.equal(insights.totalMessages, 2); // only 'message' type events
  assert.equal(insights.bookings, 1);
  assert.equal(insights.orders, 1);
  assert.ok(insights.topCapabilities.length > 0);
  assert.equal(insights.topCapabilities[0][0], 'booking'); // most frequent capability
});

test('EE8: AnalyticsEngine is tenant-isolated', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website' });
  engine.record('t2', { type: 'message', customerId: 'c2', channel: 'whatsapp' });
  const m1 = engine.getMetrics('t1');
  const m2 = engine.getMetrics('t2');
  assert.equal(m1.totalMessages, 1);
  assert.equal(m2.totalMessages, 1);
  assert.equal(m1.byChannel.get('website'), 1);
  assert.equal(m2.byChannel.get('whatsapp'), 1);
  assert.ok(!m1.byChannel.has('whatsapp'));
});

test('EE9: AnalyticsEngine tracks duplicate actions', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'action_executed', actionId: 'booking.create', duplicate: false });
  engine.record('t1', { type: 'action_executed', actionId: 'booking.create', duplicate: true });
  engine.record('t1', { type: 'action_executed', actionId: 'booking.create', duplicate: false });
  const metrics = engine.getMetrics('t1');
  assert.equal(metrics.totalActions, 3);
  assert.equal(metrics.duplicateActions, 1);
});

test('EE10: AnalyticsEngine getEvents filters by type and capability', () => {
  const engine = new AnalyticsEngine();
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', capabilityId: 'booking', intent: 'booking.start' });
  engine.record('t1', { type: 'message', customerId: 'c1', channel: 'website', capabilityId: 'commerce', intent: 'commerce.confirm' });
  engine.record('t1', { type: 'booking_confirmed' });
  const bookingEvents = engine.getEvents('t1', { capabilityId: 'booking' });
  assert.equal(bookingEvents.length, 1);
  assert.equal(bookingEvents[0].capabilityId, 'booking');
  const confirmedEvents = engine.getEvents('t1', { type: 'booking_confirmed' });
  assert.equal(confirmedEvents.length, 1);
});
