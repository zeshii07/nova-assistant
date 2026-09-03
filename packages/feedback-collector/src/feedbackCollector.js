/**
 * Nova Feedback Collector (v21.0)
 * Observes conversation outcomes to generate labeled training examples
 * for the ML intent classifier. Passive, failure-isolated.
 */
const fs = require('fs');
const path = require('path');

const POSITIVE_INTENTS = new Set([
  'CLEANING_REQUEST_CREATED', 'CLEANING_REQUESTS_CREATED',
  'COMMERCE_ORDER_CREATED', 'BOOKING_CONFIRMED', 'CLEANING_READY_TO_CONFIRM',
]);
const NEGATIVE_INTENTS = new Set([
  'CONVERSATION_CANCELLED', 'CLEANING_REQUEST_CANCELLED',
  'CONVERSATION_RESET', 'CLEANING_CUSTOM_QUOTE_UNLINKED',
]);
const ACCEPTANCE_PHRASES = /\b(?:confirm|yes|yeah|yep|ok|okay|sure|go ahead|proceed|book it|book this|book these|book the service|start booking|keep all details the same|theek hai|haan|bilkul)\b/i;
const REJECTION_PHRASES = /\b(?:no|nahi|nahin|na|mat|cancel|stop|wrong|incorrect|not this|that'?s not what i meant|actually i meant|change that|doosra)\b/i;

class FeedbackCollector {
  constructor({ logger = null, storageDir = null, maxExamplesPerTenant = 10000 } = {}) {
    this.logger = logger;
    this.storageDir = storageDir || path.join(process.cwd(), '.nova-feedback');
    this.maxExamplesPerTenant = maxExamplesPerTenant;
    this.examples = new Map();
    this._loadedTenants = new Set();
    this._ensureStorageDir();
  }

  _ensureStorageDir() {
    try { if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true }); }
    catch (error) { this.logger?.warn?.('feedback_collector.storage_dir_failed', { error: error.message }); }
  }

  _loadTenant(tenantId) {
    if (this._loadedTenants.has(tenantId)) return;
    this._loadedTenants.add(tenantId);
    const filePath = path.join(this.storageDir, `${tenantId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data)) this.examples.set(tenantId, data);
      }
    } catch (error) { this.logger?.warn?.('feedback_collector.load_failed', { tenantId, error: error.message }); }
    if (!this.examples.has(tenantId)) this.examples.set(tenantId, []);
  }

  _saveTenant(tenantId) {
    const filePath = path.join(this.storageDir, `${tenantId}.json`);
    try { fs.writeFileSync(filePath, JSON.stringify(this.examples.get(tenantId) || [], null, 2), 'utf8'); }
    catch (error) { this.logger?.warn?.('feedback_collector.save_failed', { tenantId, error: error.message }); }
  }

  observe({ tenantId, conversationId, customerId, message, intelligence, result, stateBefore, stateAfter, capabilityId }) {
    try {
      this._loadTenant(tenantId);
      const outcome = this._classifyOutcome({ message, intelligence, result, stateBefore, stateAfter });
      if (outcome === 'neutral') return;
      const labelTarget = this._determineLabelTarget({ outcome, stateBefore, stateAfter, message });
      if (!labelTarget) return;
      const mlPrediction = intelligence?.mlPrediction || null;
      const example = {
        id: `${tenantId}:${conversationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        tenantId, conversationId, customerId,
        messageText: String(labelTarget.text || '').slice(0, 500),
        selectedIntent: labelTarget.intent || intelligence?.selected?.intent || null,
        selectedCapabilityId: labelTarget.capabilityId || capabilityId || null,
        mlPrediction: mlPrediction ? { intentId: mlPrediction.topIntent?.intentId || null, confidence: mlPrediction.topIntent?.confidence || 0 } : null,
        outcome, confidence: labelTarget.confidence || intelligence?.selected?.confidence || 0,
        responseIntent: result?.responseModel?.intent || null,
        timestamp: new Date().toISOString(),
      };
      const tenantExamples = this.examples.get(tenantId) || [];
      tenantExamples.push(example);
      if (tenantExamples.length > this.maxExamplesPerTenant) tenantExamples.splice(0, tenantExamples.length - this.maxExamplesPerTenant);
      this.examples.set(tenantId, tenantExamples);
      this._saveTenant(tenantId);
      this.logger?.info?.('feedback_collector.example_recorded', { tenantId, outcome, selectedIntent: example.selectedIntent });
    } catch (error) { this.logger?.error?.('feedback_collector.observe_failed', { tenantId, error: error.message }); }
  }

  _classifyOutcome({ message, intelligence, result, stateBefore, stateAfter }) {
    const responseIntent = result?.responseModel?.intent || null;
    const messageText = String(message?.text || '');
    const correction = intelligence?.correction || null;
    if (POSITIVE_INTENTS.has(responseIntent)) return 'positive';
    if (NEGATIVE_INTENTS.has(responseIntent)) return 'negative';
    if (ACCEPTANCE_PHRASES.test(messageText)) {
      const previousStep = stateBefore?.capabilityState?.cleaning?.step;
      const previousPriceEnquiry = stateBefore?.capabilityState?.cleaning?.priceEnquiry;
      if (previousStep === 'confirm' || previousPriceEnquiry?.quote || stateBefore?.capabilityState?.cleaning?.quotedServices) return 'positive';
    }
    if (REJECTION_PHRASES.test(messageText)) {
      if (stateBefore?.capabilityState?.cleaning?.step || stateBefore?.capabilityState?.cleaning?.priceEnquiry) return 'negative';
    }
    if (correction && correction.type === 'replace') return 'negative';
    return 'neutral';
  }

  _determineLabelTarget({ outcome, stateBefore, stateAfter, message }) {
    if (outcome === 'positive') {
      const recentTurns = stateAfter?.context?.recentTurns || [];
      for (const turn of recentTurns) {
        if (turn.capabilityId && !['assistant', 'system', null].includes(turn.capabilityId)) {
          return { text: turn.text, intent: turn.intent, capabilityId: turn.capabilityId, confidence: 1.0 };
        }
      }
      return { text: message?.text, intent: null, capabilityId: null, confidence: 0.8 };
    }
    if (outcome === 'negative') {
      const recentTurns = stateBefore?.context?.recentTurns || [];
      if (recentTurns.length > 0) {
        const lastTurn = recentTurns[recentTurns.length - 1];
        return { text: lastTurn.text, intent: lastTurn.intent, capabilityId: lastTurn.capabilityId, confidence: 0.9 };
      }
    }
    return null;
  }

  getExamples(tenantId) { this._loadTenant(tenantId); return this.examples.get(tenantId) || []; }
  getExamplesByOutcome(tenantId, outcome) { return this.getExamples(tenantId).filter(e => e.outcome === outcome); }
  getExampleCount(tenantId) { const e = this.getExamples(tenantId); return { total: e.length, positive: e.filter(x => x.outcome === 'positive').length, negative: e.filter(x => x.outcome === 'negative').length }; }
  clearTenant(tenantId) { this.examples.set(tenantId, []); this._saveTenant(tenantId); }
  getTenantsWithExamples() { return [...this.examples.keys()].filter(t => (this.examples.get(t) || []).length > 0); }
}

module.exports = { FeedbackCollector, POSITIVE_INTENTS, NEGATIVE_INTENTS };
