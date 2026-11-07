/**
 * v48.0 — Dialogue Manager
 *
 * Separates conversation/dialogue management from NLU. The NLU pipeline
 * identifies what the customer wants; the Dialogue Manager decides what
 * happens next in the conversation.
 *
 * Responsibilities:
 *   - Track the active dialogue state (which workflow, which step)
 *   - Decide whether to continue, interrupt, or start a new dialogue
 *   - Manage the conversation stack (nested workflows)
 *   - Decide when to prompt for the next field
 *   - Decide when to confirm vs. execute
 *   - Handle corrections mid-flow ("actually, make it Friday")
 *   - Handle interruptions mid-flow ("also, do you have WiFi?")
 *
 * This replaces the workflow ownership logic that was embedded in the
 * ConversationIntelligenceEngine, making it a standalone, testable component.
 *
 * Architecture rule: NLU identifies intent; Dialogue Manager decides flow.
 */

/**
 * Dialogue State
 *
 * Represents the current state of a conversation.
 */
class DialogueState {
  constructor({ capabilityId, intent, status, pendingField, items, fields, metadata } = {}) {
    this.capabilityId = capabilityId || null;
    this.intent = intent || null;
    this.status = status || 'idle'; // idle | collecting | ready | completed | cancelled
    this.pendingField = pendingField || null;
    this.items = items || [];
    this.fields = fields || {};
    this.metadata = metadata || {};
  }

  isCollecting() { return this.status === 'collecting'; }
  isReady() { return this.status === 'ready'; }
  isCompleted() { return this.status === 'completed'; }
  isCancelled() { return this.status === 'cancelled'; }
  isActive() { return this.isCollecting() || this.isReady(); }
}

/**
 * Dialogue Manager
 *
 * Manages the conversation flow independently of NLU.
 */
class DialogueManager {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Determine the dialogue action for this turn.
   *
   * @param {object} params - { intelligence, state, tenant }
   * @returns {object} dialogue action:
   *   {
   *     action: 'continue' | 'start' | 'interrupt' | 'correct' | 'confirm' | 'cancel' | 'reset',
   *     targetCapability: string,
   *     targetIntent: string,
   *     pendingField: string | null,
   *     correction: { field, value } | null,
   *     interruption: { type, answered } | null,
   *     shouldResume: boolean,
   *   }
   */
  decide({ intelligence, state, tenant }) {
    const selected = intelligence?.selected;
    const activeWorkflow = intelligence?.workflow?.current;
    const correction = intelligence?.correction;
    const interruption = intelligence?.interruption || intelligence?.deterministicInterruption;
    const globalCommand = intelligence?.globalCommand;

    // Global commands override everything
    if (globalCommand) {
      return {
        action: globalCommand.type, // 'cancel' | 'reset' | 'undo_cancel' | 'human_handoff'
        targetCapability: 'system',
        targetIntent: null,
        pendingField: null,
        correction: null,
        interruption: null,
        shouldResume: false,
        reason: 'global_command',
      };
    }

    // If there's an active workflow and the message is a correction
    if (activeWorkflow && correction?.target) {
      return {
        action: 'correct',
        targetCapability: activeWorkflow.capabilityId,
        targetIntent: activeWorkflow.intent || 'workflow_correction',
        pendingField: activeWorkflow.pendingField,
        correction: { field: correction.target, value: correction.value },
        interruption: null,
        shouldResume: true,
        reason: 'correction_to_active_workflow',
      };
    }

    // If there's an active workflow and the message is an interruption
    // (e.g., a business question while collecting checkout fields)
    if (activeWorkflow && interruption && selected?.capabilityId !== activeWorkflow.capabilityId) {
      return {
        action: 'interrupt',
        targetCapability: selected?.capabilityId || 'assistant',
        targetIntent: selected?.intent || 'business.info',
        pendingField: activeWorkflow.pendingField,
        correction: null,
        interruption: { type: interruption.type || 'business_question', answered: false },
        shouldResume: true,
        reason: 'interruption_during_workflow',
      };
    }

    // If there's an active workflow and the selected intent belongs to the same capability
    if (activeWorkflow && selected?.capabilityId === activeWorkflow.capabilityId) {
      // Is this a confirmation?
      if (selected.intent === 'booking.confirm' || selected.intent === 'commerce.confirm' || selected.intent === 'commerce.review.confirm') {
        return {
          action: 'confirm',
          targetCapability: activeWorkflow.capabilityId,
          targetIntent: selected.intent,
          pendingField: null,
          correction: null,
          interruption: null,
          shouldResume: false,
          reason: 'workflow_confirmation',
        };
      }

      // Is this a workflow continuation (providing the next field value)?
      if (this._isWorkflowContinuation(selected.intent)) {
        return {
          action: 'continue',
          targetCapability: activeWorkflow.capabilityId,
          targetIntent: selected.intent,
          pendingField: activeWorkflow.pendingField,
          correction: null,
          interruption: null,
          shouldResume: false,
          reason: 'workflow_continuation',
        };
      }

      // Is this a modification of the active workflow?
      if (this._isWorkflowModification(selected.intent)) {
        return {
          action: 'modify',
          targetCapability: activeWorkflow.capabilityId,
          targetIntent: selected.intent,
          pendingField: activeWorkflow.pendingField,
          correction: null,
          interruption: null,
          shouldResume: true,
          reason: 'workflow_modification',
        };
      }
    }

    // If there's no active workflow (or the selected intent is for a different capability),
    // start a new dialogue
    if (selected) {
      return {
        action: 'start',
        targetCapability: selected.capabilityId,
        targetIntent: selected.intent,
        pendingField: null,
        correction: null,
        interruption: null,
        shouldResume: false,
        reason: selected.reason || 'new_dialogue',
      };
    }

    // No intent detected — fall through to assistant
    return {
      action: 'fallback',
      targetCapability: 'assistant',
      targetIntent: null,
      pendingField: null,
      correction: null,
      interruption: null,
      shouldResume: false,
      reason: 'no_intent_detected',
    };
  }

  /**
   * Check if an intent is a workflow continuation (e.g., booking.continue,
   * commerce.checkout_input, cleaning.workflow_input).
   */
  _isWorkflowContinuation(intent) {
    if (!intent) return false;
    return /\b(?:continue|workflow_input|checkout_input|cart_view)\b/.test(intent);
  }

  /**
   * Check if an intent is a workflow modification (e.g., booking.service_change,
   * commerce.cart.update_quantity, cleaning.schedule_edit).
   */
  _isWorkflowModification(intent) {
    if (!intent) return false;
    return /\b(?:change|update|modify|swap|remove|cancel|reschedule|clear|edit)\b/.test(intent);
  }

  /**
   * Get the dialogue state from the conversation state.
   */
  getDialogueState(state, capabilityId) {
    const cap = state?.capabilityState?.[capabilityId];
    if (!cap) return new DialogueState({ status: 'idle' });
    return new DialogueState({
      capabilityId,
      intent: cap.lastIntent,
      status: cap.status || cap.mode || 'idle',
      pendingField: cap.pendingField,
      items: cap.items || [],
      fields: cap.slots || cap.fields || {},
      metadata: cap.metadata || {},
    });
  }

  /**
   * Determine if a field should be prompted next.
   * Returns the field name or null if no field is needed.
   */
  nextPendingField(dialogueState, requiredFields) {
    if (!dialogueState.isActive()) return null;
    for (const field of requiredFields) {
      if (dialogueState.fields[field] == null || dialogueState.fields[field] === '') {
        return field;
      }
    }
    return null; // all fields collected → ready for confirmation
  }
}

module.exports = { DialogueManager, DialogueState };
