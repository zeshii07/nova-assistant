/**
 * Sprint 11 — v51.0 Phase 4 Integration Channels Tests
 *
 * Tests:
 *   AA — Channel Gateway (normalization, identity mapping, multi-channel support)
 *   BB — Integration Hub (provider registry, credential manager, webhook verification)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ChannelGateway, ChannelAdapter, NormalizedMessage,
  WebsiteChannelAdapter, WhatsAppChannelAdapter, KioskChannelAdapter, ApiChannelAdapter,
} = require('../packages/channel-gateway/src');
const { IntegrationHub, IntegrationProvider, CredentialManager } = require('../packages/integration-hub/src');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP AA — Channel Gateway
// ─────────────────────────────────────────────────────────────────────────────

test('AA1: ChannelGateway registers built-in channels', () => {
  const gateway = new ChannelGateway();
  const channels = gateway.listChannels();
  assert.ok(channels.some(c => c.id === 'website'));
  assert.ok(channels.some(c => c.id === 'kiosk'));
  assert.ok(channels.some(c => c.id === 'api'));
});

test('AA2: WebsiteChannelAdapter normalizes incoming message', () => {
  const adapter = new WebsiteChannelAdapter();
  const msg = adapter.normalizeIncoming({
    customerId: 'user123',
    tenantId: 't1',
    text: 'i want a haircut',
    customerName: 'Ahmed',
  }, 't1');
  assert.equal(msg.channel, 'website');
  assert.equal(msg.customerId, 'user123');
  assert.equal(msg.tenantId, 't1');
  assert.equal(msg.text, 'i want a haircut');
  assert.equal(msg.customerName, 'Ahmed');
});

test('AA3: WebsiteChannelAdapter handles attachments', () => {
  const adapter = new WebsiteChannelAdapter();
  const msg = adapter.normalizeIncoming({
    customerId: 'user123',
    text: 'see this image',
    attachments: [{ type: 'image', url: 'https://example.com/img.jpg' }],
  }, 't1');
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].type, 'image');
  assert.equal(msg.attachments[0].url, 'https://example.com/img.jpg');
});

test('AA4: WhatsAppChannelAdapter normalizes text message', () => {
  const adapter = new WhatsAppChannelAdapter();
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.test123',
            from: '923001234567',
            type: 'text',
            text: { body: 'i want to book a room' },
            timestamp: '1700000000',
          }],
          contacts: [{ wa_id: '923001234567', profile: { name: 'Bilal' } }],
        },
      }],
    }],
  };
  const msg = adapter.normalizeIncoming(payload, 'hotel-demo');
  assert.ok(msg);
  assert.equal(msg.channel, 'whatsapp');
  assert.equal(msg.text, 'i want to book a room');
  assert.equal(msg.customerPhone, '923001234567');
  assert.equal(msg.customerName, 'Bilal');
  assert.equal(msg.channelMessageId, 'wamid.test123');
});

test('AA5: WhatsAppChannelAdapter normalizes image message', () => {
  const adapter = new WhatsAppChannelAdapter();
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.img1',
            from: '923001234567',
            type: 'image',
            image: { id: 'media123', mime_type: 'image/jpeg', caption: 'Room photo' },
            timestamp: '1700000000',
          }],
          contacts: [{ wa_id: '923001234567', profile: { name: 'Bilal' } }],
        },
      }],
    }],
  };
  const msg = adapter.normalizeIncoming(payload, 'hotel-demo');
  assert.ok(msg);
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].type, 'image');
  assert.equal(msg.attachments[0].caption, 'Room photo');
});

test('AA6: WhatsAppChannelAdapter normalizes location message', () => {
  const adapter = new WhatsAppChannelAdapter();
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.loc1',
            from: '923001234567',
            type: 'location',
            location: { latitude: 31.5, longitude: 74.3, name: 'Home' },
            timestamp: '1700000000',
          }],
          contacts: [{ wa_id: '923001234567', profile: { name: 'Bilal' } }],
        },
      }],
    }],
  };
  const msg = adapter.normalizeIncoming(payload, 'hotel-demo');
  assert.ok(msg);
  assert.equal(msg.attachments[0].type, 'location');
  assert.equal(msg.attachments[0].latitude, 31.5);
  assert.equal(msg.attachments[0].name, 'Home');
});

test('AA7: KioskChannelAdapter strips markdown', () => {
  const adapter = new KioskChannelAdapter();
  const result = adapter.formatOutgoing('*Bold* and _italic_ text');
  assert.doesNotMatch(result.text, /\*|_/);
  assert.match(result.text, /Bold.*italic.*text/);
});

test('AA8: ApiChannelAdapter normalizes programmatic request', () => {
  const adapter = new ApiChannelAdapter();
  const msg = adapter.normalizeIncoming({
    customerId: 'api_user_1',
    tenantId: 't1',
    text: 'check order status',
    apiKey: 'key123',
  }, 't1');
  assert.equal(msg.channel, 'api');
  assert.equal(msg.customerId, 'api_user_1');
  assert.equal(msg.metadata.apiKey, '[redacted]');
});

test('AA9: ChannelGateway.receive auto-detects channel', () => {
  const gateway = new ChannelGateway();
  // Website-style payload
  const r1 = gateway.receive({ customerId: 'c1', text: 'hello', tenantId: 't1' }, 't1');
  assert.ok(r1.ok);
  assert.equal(r1.message.channel, 'website');
  // WhatsApp-style payload
  const waPayload = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '123', type: 'text', text: { body: 'hi' }, timestamp: '1700000000' }], contacts: [{ wa_id: '123', profile: { name: 'Test' } }] } }] }] };
  const r2 = gateway.receive(waPayload, 't1');
  assert.ok(r2.ok);
  assert.equal(r2.message.channel, 'whatsapp');
});

test('AA10: ChannelGateway.formatReply routes to correct adapter', () => {
  const gateway = new ChannelGateway();
  const reply = gateway.formatReply('Booking confirmed!', { channel: 'kiosk' });
  assert.equal(reply.channel, 'kiosk');
  assert.match(reply.text, /Booking confirmed/);
});

test('AA11: ChannelGateway identity mapping persists customer ID', () => {
  const gateway = new ChannelGateway();
  // Use website channel for identity mapping test (simpler payload)
  gateway.receive({ customerId: 'user_abc', text: 'hello', tenantId: 't1' }, 't1', 'website');
  // Second message from same customer
  const r2 = gateway.receive({ customerId: 'user_abc', text: 'book a room', tenantId: 't1' }, 't1', 'website');
  assert.ok(r2.ok);
  assert.equal(r2.message.customerId, 'user_abc');
});

test('AA12: NormalizedMessage.toExecutionMessage produces correct format', () => {
  const msg = new NormalizedMessage({
    channel: 'whatsapp',
    customerId: 'wa_123',
    text: 'hello',
    customerName: 'Ahmed',
    customerPhone: '923001234567',
    attachments: [{ type: 'image' }],
  });
  const exec = msg.toExecutionMessage();
  assert.equal(exec.channel, 'whatsapp');
  assert.equal(exec.customerId, 'wa_123');
  assert.equal(exec.text, 'hello');
  assert.equal(exec.metadata.customerName, 'Ahmed');
  assert.equal(exec.metadata.customerPhone, '923001234567');
  assert.equal(exec.metadata.hasAttachments, true);
  assert.deepEqual(exec.metadata.attachmentTypes, ['image']);
});

test('AA13: ChannelGateway registers custom adapter', () => {
  const gateway = new ChannelGateway();
  class TelegramAdapter extends ChannelAdapter {
    constructor() { super({ id: 'telegram', displayName: 'Telegram' }); }
    normalizeIncoming(payload, tenantId) {
      return new NormalizedMessage({ channel: 'telegram', text: payload.text || '', customerId: String(payload.from?.id || 'unknown'), tenantId });
    }
  }
  gateway.register(new TelegramAdapter());
  const channels = gateway.listChannels();
  assert.ok(channels.some(c => c.id === 'telegram'));
  const r = gateway.receive({ from: { id: 'tg_123' }, text: 'hello' }, 't1', 'telegram');
  assert.ok(r.ok);
  assert.equal(r.message.channel, 'telegram');
  assert.equal(r.message.customerId, 'tg_123');
});

test('AA14: WhatsAppChannelAdapter truncates long replies', () => {
  const adapter = new WhatsAppChannelAdapter();
  const longText = 'A'.repeat(5000);
  const result = adapter.formatOutgoing(longText, {});
  assert.ok(result.text.length <= 4096);
  assert.match(result.text, /…$/);
});

test('AA15: ChannelGateway handles unknown channel gracefully', () => {
  const gateway = new ChannelGateway();
  const r = gateway.receive({ text: 'test' }, 't1', 'unknown_channel');
  assert.ok(!r.ok);
  assert.equal(r.error, 'unknown_channel');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP BB — Integration Hub
// ─────────────────────────────────────────────────────────────────────────────

test('BB1: IntegrationHub registers builtin providers', () => {
  const hub = new IntegrationHub();
  assert.ok(hub.getProvider('google-calendar'));
  assert.ok(hub.getProvider('stripe'));
  assert.ok(hub.getProvider('email-smtp'));
  assert.ok(hub.getProvider('whatsapp-business'));
  assert.ok(hub.getProvider('generic-pos'));
});

test('BB2: IntegrationHub listProviders filters by category', () => {
  const hub = new IntegrationHub();
  const paymentProviders = hub.listProviders('payment');
  assert.ok(paymentProviders.some(p => p.id === 'stripe'));
  assert.ok(!paymentProviders.some(p => p.id === 'google-calendar'));
});

test('BB3: CredentialManager stores and retrieves credentials', () => {
  const cm = new CredentialManager();
  cm.set('t1', 'stripe', { secretKey: 'sk_test_123' });
  const creds = cm.get('t1', 'stripe');
  assert.ok(creds);
  assert.equal(creds.secretKey, 'sk_test_123');
});

test('BB4: CredentialManager returns null for unconfigured provider', () => {
  const cm = new CredentialManager();
  const creds = cm.get('t1', 'nonexistent');
  assert.equal(creds, null);
});

test('BB5: CredentialManager deletes credentials', () => {
  const cm = new CredentialManager();
  cm.set('t1', 'stripe', { secretKey: 'sk_test_123' });
  assert.ok(cm.has('t1', 'stripe'));
  cm.delete('t1', 'stripe');
  assert.ok(!cm.has('t1', 'stripe'));
});

test('BB6: CredentialManager lists configured providers for tenant', () => {
  const cm = new CredentialManager();
  cm.set('t1', 'stripe', {});
  cm.set('t1', 'google-calendar', {});
  cm.set('t2', 'stripe', {});
  const t1Providers = cm.listProviders('t1');
  assert.equal(t1Providers.length, 2);
  assert.ok(t1Providers.includes('stripe'));
  assert.ok(t1Providers.includes('google-calendar'));
});

test('BB7: CredentialManager encrypts credentials', () => {
  const cm = new CredentialManager({ encryptionKey: 'test-key-12345' });
  cm.set('t1', 'stripe', { secretKey: 'sk_test_secret_12345' });
  // The raw store value should be encrypted (base64), not plaintext
  const raw = cm.store.get('t1:stripe');
  assert.ok(!raw.includes('sk_test_secret_12345'), 'credentials should be encrypted');
  // But decrypted should match
  const creds = cm.get('t1', 'stripe');
  assert.equal(creds.secretKey, 'sk_test_secret_12345');
});

test('BB8: IntegrationHub configures integration', () => {
  const hub = new IntegrationHub();
  const result = hub.configureIntegration('t1', 'stripe', { secretKey: 'sk_test_123' });
  assert.ok(result.ok);
  assert.equal(result.tenantId, 't1');
  assert.equal(result.providerId, 'stripe');
});

test('BB9: IntegrationHub tests integration connection', async () => {
  const hub = new IntegrationHub();
  hub.configureIntegration('t1', 'stripe', { secretKey: 'sk_test_123' });
  const result = await hub.testIntegration('t1', 'stripe');
  assert.ok(result.ok);
  assert.equal(result.result.mode, 'test');
});

test('BB10: IntegrationHub returns error for unconfigured integration', async () => {
  const hub = new IntegrationHub();
  const result = await hub.testIntegration('t1', 'stripe');
  assert.ok(!result.ok);
  assert.equal(result.error, 'credentials_not_configured');
});

test('BB11: IntegrationHub returns error for unknown provider', async () => {
  const hub = new IntegrationHub();
  const result = await hub.testIntegration('t1', 'nonexistent');
  assert.ok(!result.ok);
  assert.equal(result.error, 'provider_not_found');
});

test('BB12: IntegrationHub lists tenant integrations', () => {
  const hub = new IntegrationHub();
  hub.configureIntegration('t1', 'stripe', {});
  hub.configureIntegration('t1', 'google-calendar', {});
  const integrations = hub.getTenantIntegrations('t1');
  assert.equal(integrations.length, 2);
  assert.ok(integrations.some(i => i.providerId === 'stripe' && i.category === 'payment'));
  assert.ok(integrations.some(i => i.providerId === 'google-calendar' && i.category === 'calendar'));
});

test('BB13: IntegrationHub registers custom provider', () => {
  const hub = new IntegrationHub();
  class CustomCRM extends IntegrationProvider {
    constructor() { super({ id: 'custom-crm', name: 'Custom CRM', category: 'crm' }); }
    async testConnection(creds) { return { connected: true }; }
  }
  hub.registerProvider(new CustomCRM());
  assert.ok(hub.getProvider('custom-crm'));
  assert.equal(hub.getProvider('custom-crm').category, 'crm');
});

test('BB14: IntegrationHub handles webhook with valid signature', async () => {
  const hub = new IntegrationHub();
  hub.configureIntegration('t1', 'google-calendar', { webhookSecret: 'secret123' });
  const crypto = require('crypto');
  const payload = { events: [] };
  const signature = crypto.createHmac('sha256', 'secret123').update(JSON.stringify(payload)).digest('hex');
  const result = await hub.handleWebhook('t1', 'google-calendar', payload, signature);
  // The provider's handleWebhook throws (not implemented), but signature
  // verification should pass. The result should NOT be 'webhook_signature_invalid'.
  assert.notEqual(result.error, 'webhook_signature_invalid',
    'webhook signature should be valid, got: ' + JSON.stringify(result));
});

test('BB15: IntegrationHub rejects webhook with invalid signature', async () => {
  const hub = new IntegrationHub();
  hub.configureIntegration('t1', 'google-calendar', { webhookSecret: 'secret123' });
  const result = await hub.handleWebhook('t1', 'google-calendar', { events: [] }, 'invalid_signature');
  assert.ok(!result.ok);
  assert.equal(result.error, 'webhook_signature_invalid');
});
