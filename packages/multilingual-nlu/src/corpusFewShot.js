/**
 * v45.0 — Corpus-to-NLU Examples Converter
 *
 * Transforms the 273-case variation corpus into labeled few-shot examples
 * that the Groq NLU model can reference when classifying ambiguous customer
 * messages. Each example maps a customer message to the NLU schema intent
 * it should be classified as.
 *
 * The converter reads the variation corpus's `id` prefix (ORD, RMV, OT, NOTE,
 * BKG, etc.) to determine the expected NLU intent, and uses the `message`
 * field as the example text.
 *
 * Output format: array of { text, intent, domain, notes } objects.
 *
 * Used by: RemoteNluInterpreter (injected as few-shot examples in the prompt)
 */
// Load the variation corpus. The path is relative to this file's location:
// packages/multilingual-nlu/src/corpusFewShot.js → ../../tests/fixtures/variation-corpus.js
// In production, the corpus is loaded once at startup. In tests, the test-env
// sets NOVA_LOCAL_DATA_DIR which doesn't affect this file's location.
let corpus;
try {
  corpus = require('../../../tests/fixtures/variation-corpus.js');
} catch (_e) {
  // Corpus not available (e.g. when this package is used outside nova-assistant)
  // Fall back to an empty corpus — the NLU will work without few-shot examples.
  corpus = [];
}

/**
 * Maps a corpus case ID prefix to the NLU schema intent.
 * The NLU schema intents are defined in nluSchema.js (INTENTS array).
 */
const CORPUS_PREFIX_TO_NLU_INTENT = {
  // Order placement
  'ORD': 'cart.add',           // "i want 1 chicken biryani"
  'ORD-RU': 'cart.add',        // "mujhe 1 chicken biryani chahiye"
  'TYP': 'cart.add',           // "i wnt 1 chicken biryani" (typo)
  'MUL': 'cart.add',           // "i want 2 chicken biryani and 6 beef burgers"
  // Quantity modifications
  'QTY': 'cart.update',        // "change biryani to 5"
  // Item removal / cancellation
  'RMV': 'cart.remove',        // "remove the biryani" / "cancel my order"
  // Order type (delivery / takeaway / dine-in)
  'OT': 'cart.update',         // "change to delivery" (order meta change)
  // Special instructions
  'SP': 'cart.update',         // "make it less spicy" (order meta change)
  // Order notes
  'NOTE': 'cart.update',       // "add a note: deliver after 8pm"
  // Cart view + checkout
  'CV': 'cart.view',           // "show my cart" / "checkout" / "confirm order"
  // Confirmation phrases
  'CONF': 'conversation.confirm', // "ok" / "yes" / "theek hai"
  // Booking trigger (salon)
  'BKG': 'booking.create',     // "book beard grooming tomorrow at 5pm"
  // Booking modifications
  'BM': 'booking.modify',      // "change to haircut" / "swap X for Y"
  // Restaurant reservation
  'RSV': 'booking.create',     // "reserve a table for 4 tomorrow at 7pm"
  // Cleaning service requests
  'CLN': 'service.list',       // "i want deep cleaning" → service browse / create
  // Business questions
  'BIZ': 'business.info',      // "what are your hours"
  // Edge cases
  'EDGE': 'other',             // "hi" / "thanks" / "help"
  // Retail
  'RTL': 'product.info',       // "i want 1 black wireless airbud"
  // Healthcare / Education / Driving School
  'HC': 'service.info',        // "what treatments do you offer"
  'EDU': 'service.info',       // "what classes do you provide"
  'DRV': 'service.info',       // "what packages do you offer"
};

/**
 * Maps corpus tenant IDs to NLU domain labels.
 */
const TENANT_TO_DOMAIN = {
  'restaurant-demo': 'restaurant',
  'salon-demo': 'salon',
  'cleaning-demo': 'cleaning',
  'default': 'retail',
  'healthcare-demo': 'healthcare',
  'education-demo': 'education',
  'driving-school-demo': 'driving_school',
};

/**
 * Convert the variation corpus into labeled NLU few-shot examples.
 *
 * @param {object} options - { maxExamples, domain, intent }
 *   - maxExamples: cap the number of examples returned (default 50)
 *   - domain: filter to a specific domain (e.g. 'restaurant')
 *   - intent: filter to a specific intent (e.g. 'cart.add')
 * @returns {Array<{text, intent, domain, notes}>}
 */
function corpusToNluExamples(options = {}) {
  const { maxExamples = 50, domain = null, intent = null } = options;
  const examples = [];
  for (const tc of corpus) {
    if (tc.skip) continue;
    // Determine the NLU intent from the corpus case ID prefix
    const prefix = tc.id.replace(/-\d+$/, '');
    const nluIntent = CORPUS_PREFIX_TO_NLU_INTENT[prefix] || 'other';
    const nluDomain = TENANT_TO_DOMAIN[tc.tenant] || 'universal';
    // Apply filters
    if (domain && nluDomain !== domain) continue;
    if (intent && nluIntent !== intent) continue;
    examples.push({
      text: tc.message,
      intent: nluIntent,
      domain: nluDomain,
      notes: tc.notes || '',
    });
    if (examples.length >= maxExamples) break;
  }
  return examples;
}

/**
 * Format the examples as a few-shot prompt string for the Groq NLU.
 * Groups examples by intent so the model sees patterns.
 *
 * @param {Array} examples - output of corpusToNluExamples()
 * @param {object} options - { maxPerIntent, maxTotal }
 * @returns {string} - formatted few-shot prompt section
 */
function formatFewShotPrompt(examples, options = {}) {
  const { maxPerIntent = 5, maxTotal = 30 } = options;
  // Group by intent
  const byIntent = {};
  for (const ex of examples) {
    if (!byIntent[ex.intent]) byIntent[ex.intent] = [];
    if (byIntent[ex.intent].length < maxPerIntent) {
      byIntent[ex.intent].push(ex);
    }
  }
  // Build the prompt section
  const lines = ['# Few-shot examples (customer message → NLU intent):'];
  let total = 0;
  for (const [intent, cases] of Object.entries(byIntent)) {
    lines.push(`\n## ${intent}`);
    for (const ex of cases) {
      if (total >= maxTotal) break;
      lines.push(`  "${ex.text}" → ${intent} (${ex.domain})`);
      total++;
    }
    if (total >= maxTotal) break;
  }
  return lines.join('\n');
}

/**
 * Get a balanced sample of examples across all intents for the prompt.
 * Returns at most `maxTotal` examples, with at most `maxPerIntent` per intent.
 */
function getBalancedExamples(options = {}) {
  const { maxPerIntent = 4, maxTotal = 25 } = options;
  const all = corpusToNluExamples({ maxExamples: 999 });
  // Group by intent
  const byIntent = {};
  for (const ex of all) {
    if (!byIntent[ex.intent]) byIntent[ex.intent] = [];
    byIntent[ex.intent].push(ex);
  }
  // Take maxPerIntent from each, up to maxTotal
  const balanced = [];
  for (const [intent, cases] of Object.entries(byIntent)) {
    for (const ex of cases.slice(0, maxPerIntent)) {
      if (balanced.length >= maxTotal) return balanced;
      balanced.push(ex);
    }
  }
  return balanced;
}

/**
 * Get examples specific to a tenant's domain.
 * Used by RemoteNluInterpreter to inject domain-relevant examples.
 */
function getDomainExamples(domain, options = {}) {
  return corpusToNluExamples({ ...options, domain });
}

/**
 * Get the full mapping of corpus prefixes to NLU intents.
 * Useful for debugging and extending.
 */
function getIntentMapping() {
  return { ...CORPUS_PREFIX_TO_NLU_INTENT };
}

module.exports = {
  corpusToNluExamples,
  formatFewShotPrompt,
  getBalancedExamples,
  getDomainExamples,
  getIntentMapping,
  CORPUS_PREFIX_TO_NLU_INTENT,
  TENANT_TO_DOMAIN,
};
