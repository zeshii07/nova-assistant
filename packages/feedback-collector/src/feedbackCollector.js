/**
 * Nova Feedback Collector
 *
 * Observes conversation outcomes to generate labeled training examples
 * for the ML intent classifier. The collector runs passively in the
 * ExecutionEngine's #finalize() method — it never blocks the reply or
 * throws on failure.
 *
 * Outcome signals:
 *
 *   POSITIVE (label = the selected intent was correct):
 *     - responseIntent === 'CLEANING_REQUEST_CREATED' (cleaning booking completed)
 *     - responseIntent === 'CLEANING_REQUESTS_CREATED' (multi-service booking)
 *     - responseIntent === 'COMMERCE_ORDER_CREATED' (retail order completed)
 *     - responseIntent === 'BOOKING_CONFIRMED' (generic booking)
 *     - User explicitly confirms: "yes", "confirm", "keep all details the same"
 *     - User accepts a quote: "book it", "book these services", "start booking"
 *
 *   NEGATIVE (label = the selected intent was wrong):
 *     - responseIntent === 'CONVERSATION_CANCELLED' (global cancel)
 *     - responseIntent === 'CLEANING_REQUEST_CANCELLED'
 *     - User says "no" / "that's not what I meant" / "actually I meant..."
 *     - correction.type === 'replace' (user corrected the previous turn)
 *     - User resets conversation mid-workflow
 *
 *   NEUTRAL (no example generated):
 *     - No outcome signal detected (most turns — questions, info, small talk)
 *     - responseIntent is null or informational
 *
 * What gets stored:
 *   { tenantId, messageText, selectedIntent, selectedCapabilityId,
 *     mlPrediction, outcome: 'positive'|'negative', confidence,
 *     timestamp, conversationId, customerId }
 *
 * The collector does NOT store PII (name, phone, email, address) — only the
 * message text, the routing decision, and the outcome label.
 */

const fs = require('fs');
const path = require('path');

// === Outcome signals ===
const POSITIVE_INTENTS = new Set([
  'CLEANING_REQUEST_CREATED',
  'CLEANING_REQUESTS_CREATED',
  'COMMERCE_ORDER_CREATED',
  'BOOKING_CONFIRMED',
  'CLEANING_READY_TO_CONFIRM', // user reached the confirm step
]);

const NEGATIVE_INTENTS = new Set([
  'CONVERSATION_CANCELLED',
  'CLEANING_REQUEST_CANCELLED',
  'CONVERSATION_RESET',
  'CLEANING_CUSTOM_QUOTE_UNLINKED',
]);

// Phrases that indicate the user accepted the previous quote/intent
const ACCEPTANCE_PHRASES = /\b(?:confirm|yes|yeah|yep|ok|okay|sure|go ahead|proceed|book it|book this|book these|book the service|start booking|keep all details the same|theek hai|haan|bilkul|جی|ٹھیک ہے|نعم)\b/i;

// Phrases that indicate the user rejected/corrected the previous turn
const REJECTION_PHRASES = /\b(?:no|nahi|nahin|na|mat|cancel|stop|wrong|incorrect|not this|that'?s not what i meant|actually i meant|i meant something else|change that|doosra|نہیں|نہیں|لا|توقف)\b/i;

class FeedbackCollector {
  /**
   * @param {object} options
   * @param {object} options.logger
   * @param {string} options.storageDir - Directory to store feedback JSON files
   *   (defaults to .nova-feedback/ in the current working directory)
   * @param {number} options.maxExamplesPerTenant - Cap to prevent unbounded growth
   *   (default: 10000; the online learner will sample from these)
   */
  constructor({ logger = null, storageDir = null, maxExamplesPerTenant = 10000 } = {}) {
    this.logger = logger;
    this.storageDir = storageDir || path.join(process.cwd(), '.nova-feedback');
    this.maxExamplesPerTenant = maxExamplesPerTenant;
    this.examples = new Map(); // tenantId -> Array<example>
    this._loadedTenants = new Set();
    this._ensureStorageDir();
  }

  /**
   * Ensure the storage directory exists.
   */
  _ensureStorageDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (error) {
      if (this.logger) {
        this.logger.warn('feedback_collector.storage_dir_failed', { storageDir: this.storageDir, error: error.message });
      }
    }
  }

  /**
   * Load examples for a tenant from disk (lazy — loaded on first observe).
   */
  _loadTenant(tenantId) {
    if (this._loadedTenants.has(tenantId)) return;
    this._loadedTenants.add(tenantId);
    const filePath = path.join(this.storageDir, `${tenantId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data)) {
          this.examples.set(tenantId, data);
          if (this.logger) {
            this.logger.debug('feedback_collector.loaded', { tenantId, exampleCount: data.length });
          }
        }
      }
    } catch (error) {
      if (this.logger) {
        this.logger.warn('feedback_collector.load_failed', { tenantId, error: error.message });
      }
    }
    if (!this.examples.has(tenantId)) {
      this.examples.set(tenantId, []);
    }
  }

  /**
   * Save examples for a tenant to disk.
   */
  _saveTenant(tenantId) {
    const filePath = path.join(this.storageDir, `${tenantId}.json`);
    try {
      const data = this.examples.get(tenantId) || [];
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      if (this.logger) {
        this.logger.warn('feedback_collector.save_failed', { tenantId, error: error.message });
      }
    }
  }

  /**
   * Observe a conversation turn and determine if it's a positive or negative
   * outcome for the ML classifier.
   *
   * Called by the ExecutionEngine after each message is processed.
   *
   * @param {object} params
   * @param {string} params.tenantId
   * @param {string} params.conversationId
   * @param {string} params.customerId
   * @param {object} params.message - The user's message
   * @param {object} params.intelligence - The conversation intelligence result
   * @param {object} params.result - The capability execution result
   * @param {object} params.stateBefore - State before this message
   * @param {object} params.stateAfter - State after this message
   * @param {string} params.capabilityId - The winning capability
   */
  observe({ tenantId, conversationId, customerId, message, intelligence, result, stateBefore, stateAfter, capabilityId }) {
    try {
      this._loadTenant(tenantId);

      // Determine the outcome
      const outcome = this._classifyOutcome({ message, intelligence, result, stateBefore, stateAfter });

      // Only store positive or negative examples (skip neutral)
      if (outcome === 'neutral') return;

      // Determine which message this example labels.
      // For positive outcomes (booking created), the example labels the
      // FIRST message of the conversation (the user's original request).
      // For negative outcomes (cancelled), the example labels the message
      // that was cancelled (the previous turn).
      const labelTarget = this._determineLabelTarget({ outcome, stateBefore, stateAfter, message });

      if (!labelTarget) return;

      // Extract the ML prediction (if available)
      const mlPrediction = intelligence?.mlPrediction || null;

      // Build the example
      const example = {
        id: `${tenantId}:${conversationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        conversationId,
        customerId,
        messageText: String(labelTarget.text || '').slice(0, 500), // Truncate for storage
        selectedIntent: labelTarget.intent || intelligence?.selected?.intent || null,
        selectedCapabilityId: labelTarget.capabilityId || capabilityId || null,
        mlPrediction: mlPrediction ? {
          intentId: mlPrediction.topIntent?.intentId || null,
          confidence: mlPrediction.topIntent?.confidence || 0,
        } : null,
        outcome, // 'positive' or 'negative'
        confidence: labelTarget.confidence || intelligence?.selected?.confidence || 0,
        responseIntent: result?.responseModel?.intent || null,
        timestamp: new Date().toISOString(),
      };

      // Store
      const tenantExamples = this.examples.get(tenantId) || [];
      tenantExamples.push(example);

      // Cap to prevent unbounded growth
      if (tenantExamples.length > this.maxExamplesPerTenant) {
        // Remove oldest examples (keep the most recent)
        tenantExamples.splice(0, tenantExamples.length - this.maxExamplesPerTenant);
      }

      this.examples.set(tenantId, tenantExamples);
      this._saveTenant(tenantId);

      if (this.logger) {
        this.logger.info('feedback_collector.example_recorded', {
          tenantId,
          outcome,
          selectedIntent: example.selectedIntent,
          mlPredicted: example.mlPrediction?.intentId || null,
          messageText: example.messageText.substring(0, 60),
        });
      }
    } catch (error) {
      // Never let the feedback collector crash the conversation
      if (this.logger) {
        this.logger.error('feedback_collector.observe_failed', { tenantId, error: error.message });
      }
    }
  }

  /**
   * Classify the outcome of this conversation turn.
   */
  _classifyOutcome({ message, intelligence, result, stateBefore, stateAfter }) {
    const responseIntent = result?.responseModel?.intent || null;
    const messageText = String(message?.text || '');
    const correction = intelligence?.correction || null;

    // Positive: booking/order created
    if (POSITIVE_INTENTS.has(responseIntent)) {
      return 'positive';
    }

    // Negative: cancelled/reset
    if (NEGATIVE_INTENTS.has(responseIntent)) {
      return 'negative';
    }

    // Positive: user explicitly confirms/accepts
    if (ACCEPTANCE_PHRASES.test(messageText)) {
      // Check if this is a confirmation of a previous quote/booking
      const previousStep = stateBefore?.capabilityState?.cleaning?.step;
      const previousPriceEnquiry = stateBefore?.capabilityState?.cleaning?.priceEnquiry;
      if (previousStep === 'confirm' || previousPriceEnquiry?.quote || stateBefore?.capabilityState?.cleaning?.quotedServices) {
        return 'positive';
      }
    }

    // Negative: user rejects/corrects
    if (REJECTION_PHRASES.test(messageText)) {
      // Only count as negative if there was an active workflow being rejected
      if (stateBefore?.capabilityState?.cleaning?.step || stateBefore?.capabilityState?.cleaning?.priceEnquiry) {
        return 'negative';
      }
    }

    // Negative: correction detected ("actually I meant...")
    if (correction && correction.type === 'replace') {
      return 'negative';
    }

    return 'neutral';
  }

  /**
   * Determine which message this example labels.
   *
   * For POSITIVE outcomes: label the first message of the conversation
   *   (the original request that led to the booking).
   * For NEGATIVE outcomes: label the message that was cancelled/corrected
   *   (the previous turn, stored in recentTurns).
   */
  _determineLabelTarget({ outcome, stateBefore, stateAfter, message }) {
    if (outcome === 'positive') {
      // For positive outcomes, we want to label the ORIGINAL request that
      // started this conversation. We look at recentTurns to find the first
      // message that had a cleaning/commerce/booking intent.
      const recentTurns = stateAfter?.context?.recentTurns || [];
      // Find the first turn that belongs to a business capability
      // (not assistant/system/social)
      for (const turn of recentTurns) {
        if (turn.capabilityId && !['assistant', 'system', null].includes(turn.capabilityId)) {
          return {
            text: turn.text,
            intent: turn.intent,
            capabilityId: turn.capabilityId,
            confidence: 1.0, // Positive outcome = high confidence the label is correct
          };
        }
      }
      // Fallback: label the current message
      return {
        text: message?.text,
        intent: null,
        capabilityId: null,
        confidence: 0.8,
      };
    }

    if (outcome === 'negative') {
      // For negative outcomes, label the PREVIOUS turn (the one being corrected)
      const recentTurns = stateBefore?.context?.recentTurns || [];
      if (recentTurns.length > 0) {
        const lastTurn = recentTurns[recentTurns.length - 1];
        return {
          text: lastTurn.text,
          intent: lastTurn.intent,
          capabilityId: lastTurn.capabilityId,
          confidence: 0.9, // Negative outcome = high confidence the label is wrong
        };
      }
    }

    return null;
  }

  /**
   * Get all collected examples for a tenant.
   */
  getExamples(tenantId) {
    this._loadTenant(tenantId);
    return this.examples.get(tenantId) || [];
  }

  /**
   * Get examples for a tenant filtered by outcome.
   */
  getExamplesByOutcome(tenantId, outcome) {
    return this.getExamples(tenantId).filter(e => e.outcome === outcome);
  }

  /**
   * Get example counts for a tenant.
   */
  getExampleCount(tenantId) {
    const examples = this.getExamples(tenantId);
    return {
      total: examples.length,
      positive: examples.filter(e => e.outcome === 'positive').length,
      negative: examples.filter(e => e.outcome === 'negative').length,
    };
  }

  /**
   * Clear examples for a tenant (after the online learner has consumed them).
   */
  clearTenant(tenantId) {
    this.examples.set(tenantId, []);
    this._saveTenant(tenantId);
  }

  /**
   * Get all tenants that have collected examples.
   */
  getTenantsWithExamples() {
    return [...this.examples.keys()].filter(tenantId => (this.examples.get(tenantId) || []).length > 0);
  }
}

module.exports = { FeedbackCollector, POSITIVE_INTENTS, NEGATIVE_INTENTS };
