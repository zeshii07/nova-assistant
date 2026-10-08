/**
 * Nova Message Plan (v24.0)
 *
 * Replaces the "single winning capability" model with a structured plan
 * that can handle multiple intents, interruptions, and corrections in
 * a single message.
 *
 * Architecture:
 *   Message → Understanding Pipeline → MessagePlan → Workflow Orchestrator → Actions
 *
 * A MessagePlan contains:
 *   - primaryGoal: The main intent + capability + entities
 *   - interruptions: Side questions that can be answered without disrupting the primary workflow
 *   - correction: If the user is correcting a previous turn
 *   - workflowAction: What the execution engine should do (continue, replace, interrupt, reset)
 *   - requiresClarification: If the intent is ambiguous
 *
 * The Execution Engine processes the plan in order:
 *   1. Answer interruptions (read-only, no state mutation)
 *   2. Process correction (if any)
 *   3. Execute primary goal (state-mutating)
 *   4. Resume active workflow (if interrupted)
 *
 * Design principle: "No probabilistic component may directly select or execute
 * a state-changing business operation." The MessagePlan is produced by the
 * deterministic conversation intelligence, NOT by the ML classifier or LLM.
 */

/**
 * @typedef {Object} PlanItem
 * @property {string} capabilityId - Which capability handles this (cleaning, commerce, etc.)
 * @property {string} intent - The specific intent (booking.create, payment.methods, etc.)
 * @property {object} entities - Extracted entities for this intent
 * @property {number} confidence - 0-1 confidence score
 * @property {string} reason - Why this was selected
 * @property {boolean} isReadonly - If true, this action doesn't mutate state (e.g., answering a question)
 */

/**
 * @typedef {Object} MessagePlan
 * @property {string} planId - Unique ID for this plan
 * @property {PlanItem|null} primaryGoal - The main intent to execute
 * @property {PlanItem[]} interruptions - Side questions to answer first (read-only)
 * @property {object|null} correction - Correction to apply to previous turn
 * @property {string} workflowAction - 'continue' | 'replace' | 'interrupt' | 'reset' | 'clarify'
 * @property {boolean} requiresClarification - If true, ask user to clarify
 * @property {string|null} clarificationReason - Why clarification is needed
 * @property {object} entities - Merged entities from all plan items
 * @property {object} metadata - Debug info (mlPrediction, nluDecision, etc.)
 */

class MessagePlanBuilder {
  /**
   * Build a MessagePlan from the conversation intelligence analysis.
   *
   * @param {object} analysis - The full analysis from ConversationIntelligenceEngine.analyze()
   * @param {object} options - { state, tenant, message }
   * @returns {MessagePlan} The structured plan
   */
  static build(analysis, { state, tenant, message } = {}) {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const selected = analysis?.selected || null;
    const correction = analysis?.correction || null;
    const interruption = analysis?.interruption || null;
    const globalCommand = analysis?.globalCommand || null;
    const requiresClarification = analysis?.requiresClarification || false;
    const clarificationReason = analysis?.clarificationReason || null;
    const messageFrame = analysis?.messageFrame || null;
    const entities = analysis?.entities || {};

    // === Global commands short-circuit everything ===
    if (globalCommand) {
      return {
        planId,
        primaryGoal: {
          capabilityId: 'system',
          intent: `global.${globalCommand.type}`,
          entities: {},
          confidence: 1,
          reason: 'global_command',
          isReadonly: false,
        },
        interruptions: [],
        correction: null,
        workflowAction: globalCommand.type, // cancel, reset, undo_cancel, human_handoff
        requiresClarification: false,
        clarificationReason: null,
        entities,
        metadata: { source: 'global_command' },
      };
    }

    // === Clarification needed ===
    if (requiresClarification) {
      return {
        planId,
        primaryGoal: null,
        interruptions: [],
        correction: null,
        workflowAction: 'clarify',
        requiresClarification: true,
        clarificationReason,
        entities,
        metadata: { source: 'clarification' },
      };
    }

    // === Build interruptions from clause analysis ===
    const interruptions = [];
    if (messageFrame?.hasMultipleIntents && messageFrame?.clauses) {
      // Each secondary clause is a potential interruption
      for (const clause of messageFrame.clauses.slice(1)) {
        if (clause?.intent && clause?.capabilityId) {
          // Only treat as interruption if it's a different capability than primary
          // and it's a read-only question (not a booking/order action)
          const isReadOnly = isReadOnlyIntent(clause.intent);
          const isDifferentCapability = !selected || clause.capabilityId !== selected.capabilityId;
          if (isReadOnly && isDifferentCapability) {
            interruptions.push({
              capabilityId: clause.capabilityId,
              intent: clause.intent,
              entities: clause.entities || {},
              confidence: clause.confidence || 0.8,
              reason: 'secondary_clause_interruption',
              isReadonly: true,
            });
          }
        }
      }
    }

    // Also check the interruption engine result
    if (interruption && interruption.type && selected) {
      const activeWorkflow = analysis?.workflow?.current;
      if (activeWorkflow && activeWorkflow.capabilityId !== selected.capabilityId) {
        // There's an active workflow and the current message belongs to a different capability
        // This is an interruption to the active workflow
        interruptions.push({
          capabilityId: selected.capabilityId,
          intent: selected.intent,
          entities: selected.entities || {},
          confidence: selected.confidence || 0.9,
          reason: 'interruption_to_active_workflow',
          isReadonly: isReadOnlyIntent(selected.intent),
        });

        // The primary goal becomes "resume the workflow"
        return {
          planId,
          primaryGoal: {
            capabilityId: activeWorkflow.capabilityId,
            intent: 'workflow.resume',
            entities: {},
            confidence: 1,
            reason: 'resume_active_workflow',
            isReadonly: false,
          },
          interruptions,
          correction: correction ? {
            field: correction.target,
            oldValue: null, // Would need state to get old value
            newValue: correction.value,
            source: 'user_correction',
          } : null,
          workflowAction: 'interrupt',
          requiresClarification: false,
          clarificationReason: null,
          entities,
          metadata: {
            source: 'interruption',
            interruptionType: interruption.type,
            mlPrediction: analysis?.nlu ? {
              intentId: analysis.nlu.interpretation?.intent || null,
              confidence: analysis.nlu.confidence || 0,
            } : null,
          },
        };
      }
    }

    // === Standard single-intent case ===
    if (selected) {
      return {
        planId,
        primaryGoal: {
          capabilityId: selected.capabilityId,
          intent: selected.intent,
          entities: selected.entities || {},
          confidence: selected.confidence || 0.9,
          reason: selected.reason || 'conversation_intelligence',
          isReadonly: isReadOnlyIntent(selected.intent),
        },
        interruptions,
        correction: correction ? {
          field: correction.target,
          oldValue: null,
          newValue: correction.value,
          source: 'user_correction',
        } : null,
        workflowAction: correction ? 'replace' : 'continue',
        requiresClarification: false,
        clarificationReason: null,
        entities,
        metadata: {
          source: 'deterministic_selection',
          mlPrediction: analysis?.nlu ? {
            intentId: analysis.nlu.interpretation?.intent || null,
            confidence: analysis.nlu.confidence || 0,
          } : null,
          mlTopIntent: analysis?.mlPrediction?.topIntent?.intentId || null,
          mlConfidence: analysis?.mlPrediction?.topIntent?.confidence || 0,
        },
      };
    }

    // === No selection — fallback ===
    return {
      planId,
      primaryGoal: null,
      interruptions,
      correction: null,
      workflowAction: 'continue',
      requiresClarification: false,
      clarificationReason: null,
      entities,
      metadata: { source: 'no_selection' },
    };
  }

  /**
   * Check if an intent is read-only (doesn't mutate state).
   * Used to determine if a secondary clause should be treated as an interruption.
   */
  static isReadOnly(intent) {
    return isReadOnlyIntent(intent);
  }

  /**
   * Get a human-readable summary of the plan for debugging.
   */
  static summarize(plan) {
    if (!plan) return 'No plan';
    const lines = [`Plan ${plan.planId}:`];
    if (plan.primaryGoal) {
      lines.push(`  Primary: ${plan.primaryGoal.capabilityId}/${plan.primaryGoal.intent} (conf=${plan.primaryGoal.confidence.toFixed(2)})`);
    } else {
      lines.push('  Primary: (none)');
    }
    if (plan.interruptions.length > 0) {
      lines.push(`  Interruptions (${plan.interruptions.length}):`);
      for (const i of plan.interruptions) {
        lines.push(`    → ${i.capabilityId}/${i.intent} (readonly=${i.isReadonly})`);
      }
    }
    if (plan.correction) {
      lines.push(`  Correction: ${plan.correction.field} → ${plan.correction.newValue}`);
    }
    lines.push(`  Action: ${plan.workflowAction}`);
    if (plan.requiresClarification) {
      lines.push(`  Clarification needed: ${plan.clarificationReason}`);
    }
    return lines.join('\n');
  }
}

/**
 * Check if an intent is read-only (informational, not state-changing).
 *
 * Read-only intents answer questions without mutating business state:
 *   - availability.hours, availability.slot_question
 *   - business.info, business.hours, business.contact
 *   - service.price, service.duration, service.list
 *   - product.info, product.list, product.price
 *   - knowledge.question
 *
 * State-changing intents DO mutate business state:
 *   - booking.create, booking.cancel, booking.modify
 *   - cart.add, cart.remove, cart.clear
 *   - order.create, order.cancel
 *   - cleaning.service_request, cleaning.multi_service_request
 */
function isReadOnlyIntent(intent) {
  if (!intent) return false;
  const readOnlyPatterns = [
    /^(?:availability|business|service|product|knowledge)\./,
    /\.info$/, /\.list$/, /\.price$/, /\.hours$/, /\.duration$/,
    /\.status$/, /\.question$/, /\.support$/,
    /^conversation\.(greeting|thanks|small_talk)$/,
  ];
  return readOnlyPatterns.some(pattern => pattern.test(intent));
}

module.exports = { MessagePlanBuilder, isReadOnlyIntent };
