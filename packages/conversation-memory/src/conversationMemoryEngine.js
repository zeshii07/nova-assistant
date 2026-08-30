/**
 * Nova Conversation Memory Engine
 *
 * Provides three layers of conversation memory for the deterministic core:
 *
 * 1. SHORT-TERM (Working Memory): Last N turns with text, capability,
 *    intent, and entity snapshot. Used for pronoun resolution and
 *    context continuity within a single conversation session.
 *
 * 2. MEDIUM-TERM (Session Summary): A compressed summary of turns 7-30
 *    generated when the short-term window overflows. Stored as a single
 *    string in state.context.sessionSummary.
 *
 * 3. LONG-TERM (CRM-Linked): Past orders, bookings, and customer
 *    preferences from the CRM. Already exists in CRM but now made
 *    accessible to the routing layer via this engine.
 *
 * The deterministic core can query this memory to resolve references like:
 * - "book it again" → looks up last booking in short-term memory
 * - "the same time as last week" → looks up last booking time in CRM
 * - "change that to deep cleaning" → looks up last discussed service
 * - "use the same address" → looks up last address in CRM
 *
 * PII (name, phone, email, address) is NEVER stored in short-term memory.
 * Only the customer's message text (already shown to the user) and the
 * capability/intent/entity labels are stored.
 */

const { normalizeText } = require('../../conversation-intelligence/src/text');

const MAX_SHORT_TERM_TURNS = 6;
const SUMMARIZE_THRESHOLD = 8;

class ConversationMemoryEngine {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Add a turn to conversation memory.
   * Called by the execution engine after each message is processed.
   *
   * @param {object} params - { state, message, capabilityId, intent, entities, customer }
   * @returns {object} Updated memory { recentTurns, sessionSummary }
   */
  addTurn({ state, message, capabilityId, intent, entities = null, customer = null }) {
    const existingTurns = Array.isArray(state?.context?.recentTurns)
      ? state.context.recentTurns
      : [];

    // Create the turn record (PII-excluded)
    const turn = Object.freeze({
      text: String(message?.text || '').slice(0, 500), // Truncate for storage
      capabilityId: capabilityId || null,
      intent: intent || null,
      // Store entity snapshot (no PII — identity is excluded)
      entities: entities ? this._sanitizeEntities(entities) : null,
      at: new Date().toISOString(),
    });

    let recentTurns = [...existingTurns, turn];

    // If we exceed the summarize threshold, compress older turns into a summary
    let sessionSummary = state?.context?.sessionSummary || null;
    if (recentTurns.length > SUMMARIZE_THRESHOLD) {
      const toSummarize = recentTurns.slice(0, recentTurns.length - MAX_SHORT_TERM_TURNS + 1);
      sessionSummary = this._summarizeTurns(toSummarize, sessionSummary);
      recentTurns = recentTurns.slice(-(MAX_SHORT_TERM_TURNS - 1));
    }

    return { recentTurns, sessionSummary };
  }

  /**
   * Query conversation memory for context resolution.
   *
   * @param {string} text - The current message text
   * @param {object} memory - { recentTurns, sessionSummary, customer }
   * @returns {object} Resolved context { lastService, lastBooking, lastAddress, referencedItem }
   */
  resolve(text, memory = {}) {
    const n = normalizeText(text);
    const result = {
      wantsRepeat: false,
      wantsSameTime: false,
      wantsSameAddress: false,
      wantsChange: false,
      referencedCapability: null,
      referencedService: null,
      lastBookingCapability: null,
      lastBookingTime: null,
      lastAddress: null,
    };

    // Detect repeat/same references
    if (/\b(?:book (?:it|that|this) again|same (?:time|day|service|address)|do (?:it|that) again|repeat|again)\b/i.test(n)) {
      result.wantsRepeat = true;
    }
    if (/\b(?:same time|same day|last week|pichli baar|پچھلی بار)\b/i.test(n)) {
      result.wantsSameTime = true;
    }
    if (/\b(?:same address|same location|pichla address|پچھلا پتہ)\b/i.test(n)) {
      result.wantsSameAddress = true;
    }
    if (/\b(?:change (?:that|it|this)|update (?:that|it)|switch (?:to|from))\b/i.test(n)) {
      result.wantsChange = true;
    }

    // Look up last booking in recent turns
    const turns = memory.recentTurns || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn.capabilityId && turn.capabilityId !== 'assistant' && turn.capabilityId !== 'system') {
        result.lastBookingCapability = turn.capabilityId;
        if (turn.entities?.property?.cleaningType) {
          result.referencedService = turn.entities.property.cleaningType;
        }
        if (turn.entities?.temporal?.time) {
          result.lastBookingTime = turn.entities.temporal.time;
        }
        break;
      }
    }

    // Look up address from CRM
    if (memory.customer) {
      result.lastAddress = memory.customer.customFields?.primaryAddress
        || memory.customer.address
        || null;
    }

    // Detect referenced items from entity model
    if (memory.entities?.temporal?.date) {
      result.referencedDate = memory.entities.temporal.date;
    }

    return result;
  }

  /**
   * Get a human-readable context summary for debugging.
   */
  getContextSummary(memory = {}) {
    const turns = memory.recentTurns || [];
    const lines = turns.map((t, i) => {
      const cap = t.capabilityId || '?';
      const intent = t.intent || '?';
      const text = t.text.length > 60 ? t.text.substring(0, 60) + '...' : t.text;
      return `[${i + 1}] ${cap}/${intent}: "${text}"`;
    });
    if (memory.sessionSummary) {
      lines.unshift(`[SUMMARY] ${memory.sessionSummary}`);
    }
    return lines.join('\n');
  }

  /**
   * Sanitize entities to remove PII before storing in memory.
   */
  _sanitizeEntities(entities) {
    if (!entities) return null;
    return Object.freeze({
      temporal: entities.temporal || null,
      property: entities.property || null,
      acquisition: entities.acquisition || null,
      serviceSupport: entities.serviceSupport || null,
      businessIdentity: entities.businessIdentity || null,
      isPricingQuestion: entities.isPricingQuestion || false,
      isBookingAction: entities.isBookingAction || false,
      // Explicitly EXCLUDE identity (name, phone, email, address)
    });
  }

  /**
   * Compress older turns into a summary string.
   * This is a deterministic summary (no LLM) that captures the key facts.
   */
  _summarizeTurns(turns, existingSummary = null) {
    const parts = [];
    if (existingSummary) parts.push(existingSummary);

    for (const turn of turns) {
      const cap = turn.capabilityId || 'unknown';
      const intent = turn.intent || 'unknown';
      const text = turn.text.length > 80 ? turn.text.substring(0, 80) + '...' : turn.text;
      parts.push(`${cap}/${intent}: "${text}"`);
    }

    // Keep summary under 1000 chars
    let summary = parts.join(' | ');
    if (summary.length > 1000) {
      summary = summary.substring(0, 997) + '...';
    }
    return summary;
  }

  /**
   * Clear memory (used on conversation reset).
   */
  static emptyMemory() {
    return { recentTurns: [], sessionSummary: null };
  }
}

module.exports = { ConversationMemoryEngine, MAX_SHORT_TERM_TURNS, SUMMARIZE_THRESHOLD };
