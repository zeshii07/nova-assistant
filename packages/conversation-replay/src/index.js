/**
 * v53.0 — Conversation Replay Engine
 *
 * Reproduces production conversations in a test environment to identify
 * regressions whenever the NLU or execution engine is updated.
 *
 * Features:
 *   - Records production conversations with full state snapshots
 *   - Redacts PII (name, phone, email, address) before replay
 *   - Replays conversations against the current engine
 *   - Compares original vs replayed outputs (reply text, capability, intent)
 *   - Generates diff reports highlighting regressions
 *
 * Architecture rule: Every important production conversation should be
 * reproducible in a test environment, with sensitive data redacted.
 */

/**
 * Conversation Replay Engine
 */
class ConversationReplayEngine {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.recordings = new Map(); // conversationId → recording
  }

  /**
   * Record a conversation turn for later replay.
   * Called by the execution engine after each message.
   */
  record(conversationId, turn) {
    if (!this.recordings.has(conversationId)) {
      this.recordings.set(conversationId, []);
    }
    this.recordings.get(conversationId).push({
      message: this._redact(turn.message),
      reply: turn.reply,
      capabilityId: turn.capabilityId,
      intent: turn.intent,
      stateBefore: this._redactState(turn.stateBefore),
      stateAfter: this._redactState(turn.stateAfter),
      timestamp: turn.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Get a recorded conversation.
   */
  getRecording(conversationId) {
    return this.recordings.get(conversationId) || [];
  }

  /**
   * List all recorded conversations.
   */
  listRecordings() {
    return [...this.recordings.entries()].map(([id, turns]) => ({
      conversationId: id,
      turnCount: turns.length,
      firstTurn: turns[0]?.timestamp || null,
      lastTurn: turns[turns.length - 1]?.timestamp || null,
    }));
  }

  /**
   * Replay a recorded conversation against a new execution function.
   * Compares original vs new outputs.
   *
   * @param {string} conversationId
   * @param {function} executeFn — async (message, state) → { reply, capabilityId, intent, state }
   * @returns {object} { matches, diffs, summary }
   */
  async replay(conversationId, executeFn) {
    const recording = this.recordings.get(conversationId);
    if (!recording || !recording.length) {
      return { matches: 0, diffs: 0, summary: 'no_recording_found' };
    }

    let matches = 0;
    let diffs = 0;
    const diffDetails = [];
    let state = recording[0].stateBefore;

    for (const turn of recording) {
      try {
        const result = await executeFn(turn.message, state);
        const diff = this._compare(turn, result);

        if (diff.identical) {
          matches++;
        } else {
          diffs++;
          diffDetails.push({
            turnIndex: recording.indexOf(turn),
            message: turn.message.text?.slice(0, 80),
            original: { reply: turn.reply?.slice(0, 100), capabilityId: turn.capabilityId, intent: turn.intent },
            replayed: { reply: result.reply?.slice(0, 100), capabilityId: result.capabilityId, intent: result.intent },
            differences: diff.differences,
          });
        }

        state = result.state || turn.stateAfter;
      } catch (err) {
        diffs++;
        diffDetails.push({
          turnIndex: recording.indexOf(turn),
          error: err.message,
          message: turn.message.text?.slice(0, 80),
        });
      }
    }

    return {
      conversationId,
      totalTurns: recording.length,
      matches,
      diffs,
      matchRate: recording.length > 0 ? Math.round((matches / recording.length) * 100) : 0,
      diffDetails,
    };
  }

  /**
   * Replay ALL recorded conversations and generate a regression report.
   */
  async replayAll(executeFn) {
    const results = [];
    for (const [conversationId] of this.recordings) {
      const result = await this.replay(conversationId, executeFn);
      results.push(result);
    }

    const totalMatches = results.reduce((sum, r) => sum + r.matches, 0);
    const totalDiffs = results.reduce((sum, r) => sum + r.diffs, 0);
    const totalTurns = totalMatches + totalDiffs;

    return {
      conversations: results.length,
      totalTurns,
      totalMatches,
      totalDiffs,
      overallMatchRate: totalTurns > 0 ? Math.round((totalMatches / totalTurns) * 100) : 0,
      regressions: results.filter(r => r.diffs > 0),
      results,
    };
  }

  /**
   * Export a recording as a portable JSON (for sharing between environments).
   */
  exportRecording(conversationId) {
    const recording = this.recordings.get(conversationId);
    if (!recording) return null;
    return {
      conversationId,
      version: 1,
      exportedAt: new Date().toISOString(),
      turns: recording,
    };
  }

  /**
   * Import a recording from JSON.
   */
  importRecording(data) {
    if (!data?.conversationId || !Array.isArray(data.turns)) return false;
    this.recordings.set(data.conversationId, data.turns);
    return true;
  }

  /**
   * Clear all recordings (or just one conversation).
   */
  clear(conversationId = null) {
    if (conversationId) this.recordings.delete(conversationId);
    else this.recordings.clear();
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Redact PII from a message before storing.
   */
  _redact(message) {
    if (!message) return message;
    const redacted = { ...message };
    if (redacted.text) {
      redacted.text = redacted.text
        .replace(/\b\d{10,15}\b/g, '[PHONE_REDACTED]')          // phone numbers
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]') // emails
        .replace(/\b(?:my name is|i am|i'm)\s+[\p{L}\s]{2,40}/giu, '$1 [NAME_REDACTED]'); // names
    }
    if (redacted.metadata) {
      redacted.metadata = {
        ...redacted.metadata,
        customerName: redacted.metadata.customerName ? '[REDACTED]' : null,
        customerPhone: redacted.metadata.customerPhone ? '[REDACTED]' : null,
      };
    }
    return redacted;
  }

  /**
   * Redact PII from state before storing.
   */
  _redactState(state) {
    if (!state) return state;
    const redacted = structuredClone(state);
    // Redact CRM customer data
    if (redacted.customer) {
      redacted.customer = {
        id: redacted.customer.id,
        name: '[REDACTED]',
        phone: '[REDACTED]',
        email: '[REDACTED]',
      };
    }
    // Redact checkout fields
    const cs = redacted.capabilityState;
    if (cs?.commerce?.checkout) {
      cs.commerce.checkout = {
        ...cs.commerce.checkout,
        name: cs.commerce.checkout.name ? '[REDACTED]' : null,
        phone: cs.commerce.checkout.phone ? '[REDACTED]' : null,
        email: cs.commerce.checkout.email ? '[REDACTED]' : null,
        address: cs.commerce.checkout.address ? '[REDACTED]' : null,
      };
    }
    if (cs?.booking?.slots) {
      cs.booking.slots = {
        ...cs.booking.slots,
        name: cs.booking.slots.name ? '[REDACTED]' : null,
        phone: cs.booking.slots.phone ? '[REDACTED]' : null,
      };
    }
    return redacted;
  }

  /**
   * Compare an original turn with a replayed result.
   */
  _compare(original, replayed) {
    const differences = [];

    // Compare capabilityId
    if (original.capabilityId !== replayed.capabilityId) {
      differences.push({
        field: 'capabilityId',
        original: original.capabilityId,
        replayed: replayed.capabilityId,
      });
    }

    // Compare intent
    if (original.intent !== replayed.intent) {
      differences.push({
        field: 'intent',
        original: original.intent,
        replayed: replayed.intent,
      });
    }

    // Compare reply (fuzzy — ignore whitespace differences)
    const origReply = String(original.reply || '').trim().replace(/\s+/g, ' ');
    const newReply = String(replayed.reply || '').trim().replace(/\s+/g, ' ');
    if (origReply !== newReply) {
      differences.push({
        field: 'reply',
        original: origReply.slice(0, 100),
        replayed: newReply.slice(0, 100),
      });
    }

    return { identical: differences.length === 0, differences };
  }
}

module.exports = { ConversationReplayEngine };
