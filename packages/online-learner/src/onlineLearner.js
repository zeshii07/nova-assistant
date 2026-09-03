/**
 * Nova Online Learner (v21.0)
 * Retrains the ML classifier using feedback examples collected by FeedbackCollector.
 */
const { INTENT_CATALOG } = require('../../ml-intent-classifier/src/intentCatalog');

const MIN_EXAMPLES_TO_RETRAIN = 10;
const MAX_EXAMPLES_PER_INTENT = 50;
const MIN_POSITIVE_RATIO = 0.3;

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
  constructor({ feedbackCollector, mlIntentClassifier, logger = null }) {
    this.feedbackCollector = feedbackCollector;
    this.mlIntentClassifier = mlIntentClassifier;
    this.logger = logger;
    this.lastRetrainTime = null;
    this.lastRetrainSummary = null;
  }

  async learn(options = {}) {
    const minExamples = options.minExamples ?? MIN_EXAMPLES_TO_RETRAIN;
    if (!this.feedbackCollector || !this.mlIntentClassifier) return { learned: false, reason: 'missing_dependencies' };

    const tenants = this.feedbackCollector.getTenantsWithExamples();
    if (tenants.length === 0) return { learned: false, reason: 'no_tenants_with_examples' };

    let totalPositive = 0, totalNegative = 0;
    const augmentedExamples = new Map();
    for (const intent of INTENT_CATALOG) augmentedExamples.set(intent.canonicalId, new Set(intent.examples));

    for (const tenantId of tenants) {
      const examples = this.feedbackCollector.getExamples(tenantId);
      const positive = examples.filter(e => e.outcome === 'positive');
      const negative = examples.filter(e => e.outcome === 'negative');
      totalPositive += positive.length;
      totalNegative += negative.length;

      for (const example of positive) {
        if (!example.selectedIntent || !example.messageText) continue;
        const mappedIntent = INTENT_MAP[example.selectedIntent] || example.selectedIntent;
        if (!augmentedExamples.has(mappedIntent)) continue;
        if (example.messageText.trim().length < 5) continue;
        const current = augmentedExamples.get(mappedIntent);
        if (current.size >= MAX_EXAMPLES_PER_INTENT) continue;
        current.add(example.messageText.toLowerCase().trim().replace(/\s+/g, ' '));
      }
    }

    const totalExamples = totalPositive + totalNegative;
    if (totalExamples < minExamples) return { learned: false, reason: 'insufficient_examples', totalExamples, minRequired: minExamples };

    const positiveRatio = totalPositive / totalExamples;
    if (positiveRatio < MIN_POSITIVE_RATIO) return { learned: false, reason: 'low_positive_ratio', positiveRatio: Number(positiveRatio.toFixed(4)), minRequired: MIN_POSITIVE_RATIO };

    const augmentedCatalog = INTENT_CATALOG.map(intent => ({ ...intent, examples: [...augmentedExamples.get(intent.canonicalId)] }));
    let newExamplesAdded = 0;
    for (const intent of augmentedCatalog) {
      const seedCount = INTENT_CATALOG.find(i => i.canonicalId === intent.canonicalId)?.examples.length || 0;
      newExamplesAdded += Math.max(0, intent.examples.length - seedCount);
    }

    const trainSummary = this.mlIntentClassifier.train({ catalog: augmentedCatalog });
    this.lastRetrainTime = new Date().toISOString();
    this.lastRetrainSummary = {
      learned: true, tenantsProcessed: tenants.length, totalExamples,
      positiveExamples: totalPositive, negativeExamples: totalNegative,
      newExamplesAdded, positiveRatio: Number(positiveRatio.toFixed(4)),
      trainingMs: trainSummary.trainingMs, intentCount: trainSummary.intentCount,
      documentCount: trainSummary.documentCount, vocabularySize: trainSummary.vocabularySize,
      retrainedAt: this.lastRetrainTime,
    };
    this.logger?.info?.('online_learner.retrained', this.lastRetrainSummary);
    return this.lastRetrainSummary;
  }

  getLastRetrainSummary() { return this.lastRetrainSummary; }
  getStatus() {
    if (!this.lastRetrainSummary) return 'Online learner has not run yet.';
    const s = this.lastRetrainSummary;
    return `Online Learner Status (last run: ${s.retrainedAt})\n  Tenants: ${s.tenantsProcessed}\n  Examples: ${s.totalExamples} (pos: ${s.positiveExamples}, neg: ${s.negativeExamples})\n  New: ${s.newExamplesAdded}\n  Training: ${s.trainingMs}ms`;
  }
}

module.exports = { OnlineLearner, MIN_EXAMPLES_TO_RETRAIN, MAX_EXAMPLES_PER_INTENT, MIN_POSITIVE_RATIO };
