/**
 * Nova Online Learner
 *
 * Retrains the ML intent classifier using feedback examples collected by
 * the FeedbackCollector. The learner:
 *
 *   1. Reads positive + negative examples per tenant
 *   2. Augments the seed INTENT_CATALOG with tenant-specific examples:
 *      - Positive examples → add the message text as a new training utterance
 *        for the confirmed intent
 *      - Negative examples → DON'T add the text (it was misrouted); instead
 *        log it for manual review so the developer can see which queries
 *        the classifier got wrong
 *   3. Calls mlIntentClassifier.train({ catalog: augmentedCatalog }) to
 *      retrain with the augmented data
 *   4. Returns a summary of what was learned
 *
 * Schedule:
 *   The learner is designed to run periodically (e.g., nightly via a cron
 *   job, or triggered manually by an admin API). It's NOT called on every
 *   message — that would be too expensive.
 *
 * Tenant-specific vs global:
 *   The seed catalog is global (shared across all tenants). Tenant-specific
 *   examples are layered on top:
 *     - If a tenant has > 10 positive examples, retrain with seed + tenant examples
 *     - If a tenant has < 10 examples, skip (not enough data to retrain)
 *     - The retrained model is tenant-specific (one model per tenant)
 *
 *   For now, the learner produces a SINGLE augmented catalog (seed + all
 *   tenant examples combined). A future sprint can add per-tenant models.
 */

const { INTENT_CATALOG } = require('../../ml-intent-classifier/src/intentCatalog');

// === Configuration ===
const MIN_EXAMPLES_TO_RETRAIN = 10;
const MAX_EXAMPLES_PER_INTENT = 50; // Cap to prevent any single intent from dominating
const MIN_POSITIVE_RATIO = 0.3; // At least 30% of examples must be positive

// v21.0: Map cleaning conversation adapter intents to ML catalog intents.
// The conversation adapter uses more specific intent names (e.g.,
// 'cleaning.structured_service_request') than the ML catalog (which uses
// 'cleaning.service_request'). This mapping ensures collected examples
// are added to the correct catalog intent.
const INTENT_MAP = {
  'cleaning.structured_service_request': 'cleaning.service_request',
  'cleaning.structured_quote_request': 'cleaning.service_request',
  'cleaning.standalone_quote': 'service.price',
  'cleaning.standalone_service_quote': 'service.price',
  'cleaning.multi_service_quote_request': 'cleaning.multi_service_request',
  'cleaning.active_quote_question': 'service.price',
  'cleaning.booking_type_selected': 'booking.create',
  'cleaning.booking_type_clarification': 'booking.create',
  'cleaning.workflow_input': 'booking.create',
  'cleaning.service_choice': 'cleaning.service_request',
};

class OnlineLearner {
  /**
   * @param {object} options
   * @param {object} options.feedbackCollector - The FeedbackCollector instance
   * @param {object} options.mlIntentClassifier - The MlIntentClassifier instance
   * @param {object} options.logger
   */
  constructor({ feedbackCollector, mlIntentClassifier, logger = null }) {
    this.feedbackCollector = feedbackCollector;
    this.mlIntentClassifier = mlIntentClassifier;
    this.logger = logger;
    this.lastRetrainTime = null;
    this.lastRetrainSummary = null;
  }

  /**
   * Run the online learning cycle:
   *   1. Collect examples from all tenants
   *   2. Augment the seed catalog
   *   3. Retrain the classifier
   *   4. Return a summary
   *
   * @param {object} options - { minExamples: override MIN_EXAMPLES_TO_RETRAIN }
   * @returns {object} Training summary
   */
  async learn(options = {}) {
    const startedAt = performance.now();
    const minExamples = options.minExamples ?? MIN_EXAMPLES_TO_RETRAIN;

    if (!this.feedbackCollector || !this.mlIntentClassifier) {
      return { learned: false, reason: 'missing_dependencies' };
    }

    // Collect all examples across all tenants
    const tenants = this.feedbackCollector.getTenantsWithExamples();
    if (tenants.length === 0) {
      if (this.logger) {
        this.logger.info('online_learner.no_examples', { reason: 'no_tenants_with_examples' });
      }
      return { learned: false, reason: 'no_tenants_with_examples' };
    }

    let totalPositive = 0;
    let totalNegative = 0;
    const augmentedExamples = new Map(); // intentId -> Set of message texts

    // Initialize with seed catalog examples
    for (const intent of INTENT_CATALOG) {
      augmentedExamples.set(intent.canonicalId, new Set(intent.examples));
    }

    // Process each tenant's examples
    for (const tenantId of tenants) {
      const examples = this.feedbackCollector.getExamples(tenantId);
      const positive = examples.filter(e => e.outcome === 'positive');
      const negative = examples.filter(e => e.outcome === 'negative');
      totalPositive += positive.length;
      totalNegative += negative.length;

      // Add positive examples to the augmented catalog
      for (const example of positive) {
        if (!example.selectedIntent || !example.messageText) continue;

        // v21.0: Map conversation adapter intents to ML catalog intents
        const mappedIntent = INTENT_MAP[example.selectedIntent] || example.selectedIntent;

        // Skip if the mapped intent is not in the catalog (e.g., cross-cutting intents)
        if (!augmentedExamples.has(mappedIntent)) continue;

        // Skip very short messages (< 5 chars) — not useful for training
        if (example.messageText.trim().length < 5) continue;

        // Skip if we already have too many examples for this intent
        const currentExamples = augmentedExamples.get(mappedIntent);
        if (currentExamples.size >= MAX_EXAMPLES_PER_INTENT) continue;

        // Normalize the text (lowercase, trim, collapse whitespace)
        const normalizedText = example.messageText.toLowerCase().trim().replace(/\s+/g, ' ');
        currentExamples.add(normalizedText);
      }

      // Log negative examples for manual review (don't add them to the catalog)
      if (negative.length > 0 && this.logger) {
        this.logger.info('online_learner.negative_examples_for_review', {
          tenantId,
          negativeCount: negative.length,
          // Log the first 3 negative examples so the developer can see what went wrong
          samples: negative.slice(0, 3).map(e => ({
            messageText: e.messageText.substring(0, 80),
            selectedIntent: e.selectedIntent,
            mlPredicted: e.mlPrediction?.intentId,
          })),
        });
      }
    }

    const totalExamples = totalPositive + totalNegative;
    if (totalExamples < minExamples) {
      if (this.logger) {
        this.logger.info('online_learner.insufficient_examples', {
          total: totalExamples,
          minRequired: minExamples,
        });
      }
      return {
        learned: false,
        reason: 'insufficient_examples',
        totalExamples,
        minRequired: minExamples,
      };
    }

    // Check positive ratio
    const positiveRatio = totalPositive / totalExamples;
    if (positiveRatio < MIN_POSITIVE_RATIO) {
      if (this.logger) {
        this.logger.info('online_learner.low_positive_ratio', {
          positiveRatio: Number(positiveRatio.toFixed(4)),
          minRequired: MIN_POSITIVE_RATIO,
        });
      }
      return {
        learned: false,
        reason: 'low_positive_ratio',
        positiveRatio: Number(positiveRatio.toFixed(4)),
        minRequired: MIN_POSITIVE_RATIO,
      };
    }

    // Build the augmented catalog
    const augmentedCatalog = INTENT_CATALOG.map(intent => ({
      ...intent,
      examples: [...augmentedExamples.get(intent.canonicalId)],
    }));

    // Count how many new examples were added
    let newExamplesAdded = 0;
    for (const intent of augmentedCatalog) {
      const seedCount = INTENT_CATALOG.find(i => i.canonicalId === intent.canonicalId)?.examples.length || 0;
      newExamplesAdded += Math.max(0, intent.examples.length - seedCount);
    }

    // Retrain the classifier with the augmented catalog
    const trainSummary = this.mlIntentClassifier.train({ catalog: augmentedCatalog });

    this.lastRetrainTime = new Date().toISOString();
    this.lastRetrainSummary = {
      learned: true,
      tenantsProcessed: tenants.length,
      totalExamples,
      positiveExamples: totalPositive,
      negativeExamples: totalNegative,
      newExamplesAdded,
      positiveRatio: Number(positiveRatio.toFixed(4)),
      trainingMs: trainSummary.trainingMs,
      intentCount: trainSummary.intentCount,
      documentCount: trainSummary.documentCount,
      vocabularySize: trainSummary.vocabularySize,
      retrainedAt: this.lastRetrainTime,
    };

    if (this.logger) {
      this.logger.info('online_learner.retrained', this.lastRetrainSummary);
    }

    return this.lastRetrainSummary;
  }

  /**
   * Get the last retrain summary.
   */
  getLastRetrainSummary() {
    return this.lastRetrainSummary;
  }

  /**
   * Get a human-readable status report.
   */
  getStatus() {
    if (!this.lastRetrainSummary) {
      return 'Online learner has not run yet.';
    }
    const s = this.lastRetrainSummary;
    return [
      `Online Learner Status (last run: ${s.retrainedAt})`,
      `  Tenants processed: ${s.tenantsProcessed}`,
      `  Total examples: ${s.totalExamples} (positive: ${s.positiveExamples}, negative: ${s.negativeExamples})`,
      `  New examples added: ${s.newExamplesAdded}`,
      `  Positive ratio: ${(s.positiveRatio * 100).toFixed(1)}%`,
      `  Training time: ${s.trainingMs}ms`,
      `  Model: ${s.intentCount} intents, ${s.documentCount} docs, ${s.vocabularySize} vocab`,
    ].join('\n');
  }
}

module.exports = { OnlineLearner, MIN_EXAMPLES_TO_RETRAIN, MAX_EXAMPLES_PER_INTENT, MIN_POSITIVE_RATIO };
