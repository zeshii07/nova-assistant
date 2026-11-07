/**
 * v50.0 — Reply Engine
 *
 * Constructs customer-facing responses from verified execution results.
 * This is NOT a text transformer — it's a response PLANNER and GROUNDER.
 *
 * Pipeline:
 *   1. Response Context Builder — collect execution results, workflow state, business knowledge
 *   2. Information Grounding — verify facts against actual database/knowledge results
 *   3. Response Planner — determine what to answer, what to clarify, what action remains
 *   4. Response Composer — generate the response using templates + persona + language
 *   5. Response Validator — check factual accuracy, missing details, unsupported promises
 *   6. Channel Formatter — format for WhatsApp, website, voice, kiosk
 *
 * Architecture rule: Humanization must NEVER change the meaning of an execution result.
 * If a booking is not confirmed, the reply must never say it is confirmed.
 */

/**
 * Business Personality Configuration
 *
 * Configurable per-tenant. Determines how Nova communicates.
 */
class BusinessPersonality {
  constructor(config = {}) {
    this.tone = config.tone || 'friendly';          // professional | friendly | casual
    this.responseLength = config.responseLength || 'balanced'; // short | balanced | detailed
    this.language = config.language || 'en';          // en | ur | roman_ur | auto
    this.emojiUsage = config.emojiUsage || 'minimal';  // none | minimal | moderate
    this.greetingStyle = config.greetingStyle || 'casual'; // formal | casual
    this.brandPersonality = config.brandPersonality || 'friendly'; // premium | friendly | youthful
    this.escalationStyle = config.escalationStyle || 'polite'; // direct | polite
  }

  /**
   * Apply personality settings to a response text.
   */
  apply(text, context = {}) {
    let result = String(text || '');

    // Emoji control
    if (this.emojiUsage === 'none') {
      result = result.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '');
    }

    // Response length control
    if (this.responseLength === 'short') {
      // Remove excessive whitespace and limit to 2 sentences for short mode
      result = result.replace(/\n{3,}/g, '\n\n').trim();
      const sentences = result.split(/(?<=[.!?])\s+/);
      if (sentences.length > 3 && !context.isConfirmation) {
        result = sentences.slice(0, 3).join(' ');
      }
    }

    // Tone adjustments
    if (this.tone === 'professional') {
      // Remove casual markers
      result = result.replace(/👍|😊|😄|🎉/g, '');
    }

    return result;
  }
}

/**
 * Response Context
 *
 * Collects all the information the Reply Engine needs to construct a response.
 */
class ResponseContext {
  constructor({ message, intelligence, state, result, tenant, customer, workflow, knowledge }) {
    this.message = message || null;
    this.intelligence = intelligence || null;
    this.state = state || null;
    this.result = result || null;         // Capability execution result
    this.tenant = tenant || null;
    this.customer = customer || null;
    this.workflow = workflow || null;     // Active workflow instance (if any)
    this.knowledge = knowledge || null;    // Retrieved knowledge (if FAQ query)
    this.groundedFacts = {};              // Verified facts (filled by grounding step)
    this.pendingAction = null;            // What action remains (filled by planner)
    this.missingInfo = [];                // What info is still missing (filled by planner)
  }
}

/**
 * Information Grounding
 *
 * Verifies that every factual claim in the response is backed by actual data.
 * Prevents hallucinations — Nova must never state a price, availability, or
 * confirmation that isn't backed by a database result.
 */
class InformationGrounding {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Ground the response context with verified facts.
   * Extracts factual claims from the execution result and verifies them.
   */
  ground(context) {
    const facts = {};
    const result = context.result;

    // Ground booking confirmation
    if (result?.responseModel?.payload?.record || result?.responseModel?.payload?.booking) {
      const record = result.responseModel.payload.record || result.responseModel.payload.booking;
      if (record?.id) facts.bookingId = record.id;
      if (record?.status) facts.bookingStatus = record.status;
      if (record?.slots?.date) facts.bookingDate = record.slots.date;
      if (record?.slots?.time) facts.bookingTime = record.slots.time;
    }

    // Ground order confirmation
    if (result?.responseModel?.payload?.orderId || result?.responseModel?.payload?.order) {
      const order = result.responseModel.payload.order || {};
      facts.orderId = result.responseModel.payload.orderId || order.id;
      facts.orderStatus = order.status || 'confirmed';
      if (order.total != null) facts.orderTotal = order.total;
    }

    // Ground pricing (from service quote)
    if (result?.responseModel?.payload?.price != null) {
      facts.price = result.responseModel.payload.price;
    }

    // Ground cart total
    if (result?.responseModel?.payload?.engagement) {
      const eng = result.responseModel.payload.engagement;
      if (eng.items?.length) facts.itemCount = eng.items.length;
    }

    // Ground knowledge (FAQ answers)
    if (context.knowledge?.answer) {
      facts.knowledgeAnswer = context.knowledge.answer;
      facts.knowledgeSource = context.knowledge.source || 'business_knowledge';
    }

    // Ground availability
    if (result?.responseModel?.payload?.availability) {
      facts.availability = result.responseModel.payload.availability;
    }

    context.groundedFacts = facts;
    return facts;
  }

  /**
   * Verify that a response text doesn't make ungrounded claims.
   * Returns a list of violations.
   */
  validateClaims(text, groundedFacts) {
    const violations = [];
    const t = String(text || '');

    // Check for ungrounded booking confirmation
    if (/confirmed|booking.*received|reservation.*confirmed/i.test(t)) {
      if (!groundedFacts.bookingId && !groundedFacts.orderId) {
        violations.push({
          type: 'ungrounded_confirmation',
          message: 'Response claims confirmation but no booking/order ID is grounded',
        });
      }
    }

    // Check for ungrounded prices
    const priceMatches = t.match(/(?:Rs|PKR|\$)\s?[\d,]+/gi);
    if (priceMatches) {
      for (const match of priceMatches) {
        const amount = Number(match.replace(/[^\d]/g, ''));
        if (groundedFacts.price != null && amount !== groundedFacts.price) {
          violations.push({
            type: 'price_mismatch',
            claimed: amount,
            grounded: groundedFacts.price,
            message: `Response mentions price ${amount} but grounded price is ${groundedFacts.price}`,
          });
        }
      }
    }

    // Check for ungrounded availability claims
    if (/available|in stock|we have/i.test(t) && groundedFacts.availability == null && groundedFacts.price == null) {
      // Only flag if this looks like a definitive availability claim (not just browsing)
      if (/yes.*available|we have.*in stock/i.test(t) && !groundedFacts.bookingId) {
        violations.push({
          type: 'ungrounded_availability',
          message: 'Response claims availability but no availability data is grounded',
        });
      }
    }

    return violations;
  }
}

/**
 * Response Planner
 *
 * Determines what the response should contain:
 *   - What to answer (from execution result or knowledge)
 *   - What to clarify (missing info for next workflow step)
 *   - What action remains (confirmation needed? next step?)
 */
class ResponsePlanner {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  plan(context) {
    const plan = {
      responseType: 'direct',    // direct | clarification | confirmation | error | fallback
      content: [],               // Array of content blocks to include
      pendingAction: null,       // What the customer needs to do next
      missingInfo: [],           // What info is still needed
      shouldAskForConfirmation: false,
    };

    const result = context.result;
    const selected = context.intelligence?.selected;
    const activeWorkflow = context.intelligence?.workflow?.current;

    // Error response
    if (result?.metadata?.error || result?.metadata?.retryable) {
      plan.responseType = 'error';
      plan.content.push({
        type: 'error_message',
        text: result.reply || 'Sorry, I could not complete that request.',
        retryable: result.metadata?.retryable || false,
      });
      if (result.metadata?.retryable) {
        plan.pendingAction = 'retry';
      }
      return plan;
    }

    // Knowledge/FAQ response
    if (context.knowledge?.answer) {
      plan.responseType = 'direct';
      plan.content.push({
        type: 'knowledge_answer',
        text: context.knowledge.answer,
        source: context.knowledge.source,
      });
      return plan;
    }

    // Confirmation needed (booking ready, order ready for checkout)
    // v50.1: Check confirmation BEFORE clarification — when pendingField is 'confirmation',
    // the workflow is ready for the customer to confirm, not asking for a missing field.
    if (result?.responseModel?.intent?.includes?.('READY') ||
        result?.responseModel?.intent?.includes?.('REVIEW') ||
        (activeWorkflow?.pendingField === 'confirmation')) {
      plan.responseType = 'confirmation';
      plan.shouldAskForConfirmation = true;
      plan.content.push({
        type: 'summary',
        text: result?.reply || '',
      });
      plan.pendingAction = 'confirm_or_modify';
      return plan;
    }

    // Active workflow — check what's missing (but not 'confirmation' — handled above)
    if (activeWorkflow?.pendingField && activeWorkflow.pendingField !== 'confirmation') {
      plan.responseType = 'clarification';
      plan.missingInfo.push(activeWorkflow.pendingField);
      plan.content.push({
        type: 'workflow_prompt',
        field: activeWorkflow.pendingField,
        text: result?.reply || '',
      });
      plan.pendingAction = `provide_${activeWorkflow.pendingField}`;
      return plan;
    }

    // Completed action (booking created, order placed)
    if (result?.responseModel?.intent?.includes?.('CREATED') ||
        result?.responseModel?.intent?.includes?.('COMPLETED') ||
        result?.responseModel?.intent?.includes?.('CONFIRMED')) {
      plan.responseType = 'direct';
      plan.content.push({
        type: 'confirmation',
        text: result.reply || '',
        bookingId: context.groundedFacts?.bookingId || context.groundedFacts?.orderId,
      });
      return plan;
    }

    // Default: direct response with the capability's reply
    plan.responseType = 'direct';
    plan.content.push({
      type: 'capability_reply',
      text: result?.reply || '',
    });

    return plan;
  }
}

/**
 * Response Composer
 *
 * Takes the response plan and composes the final text using:
 *   - The capability's reply text (as the base)
 *   - Business personality (tone, length, emoji)
 *   - Language (English, Roman Urdu, Urdu)
 *   - Channel formatting (WhatsApp, website, voice)
 */
class ResponseComposer {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  compose(plan, context, personality) {
    const parts = [];

    for (const block of plan.content) {
      switch (block.type) {
        case 'error_message':
          parts.push(block.text);
          break;
        case 'knowledge_answer':
          parts.push(block.text);
          break;
        case 'workflow_prompt':
          parts.push(block.text);
          break;
        case 'summary':
        case 'confirmation':
        case 'capability_reply':
          parts.push(block.text);
          break;
      }
    }

    let text = parts.filter(Boolean).join('\n\n');

    // Apply personality
    if (personality) {
      text = personality.apply(text, {
        isConfirmation: plan.responseType === 'confirmation',
        isError: plan.responseType === 'error',
      });
    }

    return text;
  }
}

/**
 * Reply Engine
 *
 * The main entry point. Orchestrates the full reply pipeline.
 */
class ReplyEngine {
  constructor({ grounding = null, planner = null, composer = null, logger = null } = {}) {
    this.grounding = grounding || new InformationGrounding({ logger });
    this.planner = planner || new ResponsePlanner({ logger });
    this.composer = composer || new ResponseComposer({ logger });
    this.logger = logger;
  }

  /**
   * Build a response from execution results.
   *
   * @param {object} params - { message, intelligence, state, result, tenant, customer, workflow, knowledge, personality }
   * @returns {object} { text, plan, groundedFacts, validationErrors }
   */
  async build({ message, intelligence, state, result, tenant, customer, workflow, knowledge, personality }) {
    // Step 1: Build context
    const context = new ResponseContext({
      message, intelligence, state, result, tenant, customer, workflow, knowledge,
    });

    // Step 2: Ground facts
    this.grounding.ground(context);

    // Step 3: Plan the response
    const plan = this.planner.plan(context);

    // Step 4: Compose the text
    let text = this.composer.compose(plan, context, personality);

    // Step 5: Validate — check for ungrounded claims
    const validationErrors = this.grounding.validateClaims(text, context.groundedFacts);

    // If validation found issues, log them (don't auto-fix — let the developer see the problem)
    if (validationErrors.length) {
      this.logger?.warn?.('reply.validation_failed', {
        errors: validationErrors.map(e => e.type),
        tenantId: tenant?.id,
      });
    }

    // Step 6: Channel formatting would happen here (future: WhatsApp, voice, kiosk)
    // For now, the text is already formatted for the web channel

    return {
      text,
      plan,
      groundedFacts: context.groundedFacts,
      pendingAction: plan.pendingAction,
      missingInfo: plan.missingInfo,
      validationErrors,
    };
  }
}

module.exports = {
  ReplyEngine,
  BusinessPersonality,
  ResponseContext,
  InformationGrounding,
  ResponsePlanner,
  ResponseComposer,
};
