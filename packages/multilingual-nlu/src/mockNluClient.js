/**
 * v45.0 — Mock NLU Client for Testing
 *
 * Simulates the Groq NLU API for local testing. Uses the variation corpus
 * to classify messages — if the message matches a known corpus case, it
 * returns the expected intent. Otherwise, it falls back to a simple
 * keyword-based classifier.
 *
 * This lets us test the NLU integration (few-shot prompt injection,
 * decision policy, entity enrichment) without a real Groq API key.
 */
const { corpusToNluExamples, CORPUS_PREFIX_TO_NLU_INTENT } = require('./corpusFewShot');

// Build a lookup table from the corpus: message → intent
const corpusLookup = new Map();
for (const ex of corpusToNluExamples({ maxExamples: 999 })) {
  // Use lowercased message as the key for fuzzy matching
  corpusLookup.set(ex.text.toLowerCase().trim(), ex.intent);
}

class MockNluClient {
  constructor({ latencyMs = 10, failureRate = 0, logger = null } = {}) {
    this.model = 'mock-nlu-v1';
    this.latencyMs = latencyMs;
    this.failureRate = failureRate;  // 0 = never fails, 1 = always fails
    this.logger = logger;
    this.callCount = 0;
  }

  async complete(messages) {
    this.callCount++;
    // Simulate latency
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    // Simulate failures
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      return { success: false, error: 'mock_failure', model: this.model, latencyMs: this.latencyMs };
    }

    // Extract the user message from the messages array
    const userMessage = messages.find(m => m.role === 'user');
    const customerText = String(userMessage?.content || '').toLowerCase().trim();

    // Try exact match from corpus first
    let intent = corpusLookup.get(customerText);

    // If no exact match, try keyword-based classification
    if (!intent) {
      intent = classifyByKeywords(customerText);
    }

    // Build a mock NLU response matching the NOVA_NLU_SCHEMA
    const data = {
      language: detectLanguage(customerText),
      message_type: detectMessageType(customerText, intent),
      intent: intent || 'other',
      intents: [intent].filter(Boolean),
      confidence: 0.92,
      certainty: 'explicit',
      action_semantics: detectActionSemantics(intent),
      workflow_relationship: 'unrelated',
      requested_information: detectRequestedInformation(intent),
      corrections: [],
      entities: extractEntities(customerText, intent),
      customer: { name: null, phone: null, email: null },
      missing_information: [],
      service_items: [],
      product_items: [],
      notes: null,
      contract: { entities: {}, language: detectLanguage(customerText) },
    };

    return {
      success: true,
      data,
      model: this.model,
      latencyMs: this.latencyMs,
    };
  }

  circuitState() {
    return Object.freeze({ open: false, retryAfterMs: 0 });
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Keyword-based classifier for messages not in the corpus.
 */
function classifyByKeywords(text) {
  const t = String(text || '').toLowerCase();
  // Booking triggers
  if (/\b(?:book|schedule|reserve|appointment)\b/.test(t) && /\b(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) return 'booking.create';
  if (/\b(?:book|schedule|reserve)\b/.test(t) && /\b(?:haircut|beard|facial|consultation|cleaning|lesson)\b/.test(t)) return 'booking.create';
  // Cart operations
  if (/\b(?:i want|i'll take|can i get|send me|bring me|gimme|pack|order)\b/.test(t) && /\b(?:biryani|burger|pasta|chicken|beef|airbud|tshirt|t-shirt|watch|wallet|shoes)\b/.test(t)) return 'cart.add';
  if (/\b(?:change|update|make it|switch)\b/.test(t) && /\b(?:to|quantity)\b/.test(t)) return 'cart.update';
  if (/\b(?:remove|delete|cancel)\b/.test(t)) return 'cart.remove';
  if (/\b(?:show|view|what's in)\b/.test(t) && /\b(?:cart|order)\b/.test(t)) return 'cart.view';
  // Confirmation
  if (/^(?:ok|okay|yes|yeah|theek hai|haan|pakka|confirm|confirmed)\b/.test(t)) return 'conversation.confirm';
  // Business info
  if (/\b(?:hours|open|close|location|address|phone|contact)\b/.test(t)) return 'business.info';
  // Service browse
  if (/\b(?:what|which|show|list)\b/.test(t) && /\b(?:services?|treatments?|programs?|classes?|packages?)\b/.test(t)) return 'service.list';
  // Product info
  if (/\b(?:how much|price|cost)\b/.test(t)) return 'product.price';
  // Greetings
  if (/^(?:hi|hello|hey|salam|salaam|assalam)\b/.test(t)) return 'other';
  return 'other';
}

function detectLanguage(text) {
  const t = String(text || '');
  if (/[\u0600-\u06ff]/.test(t)) return 'ur';
  if (/\b(?:mujhe|mujhy|chahiye|karna|karo|bhej|haan|theek|nahi|aur|bhi|ek|do|teen)\b/i.test(t)) return 'roman_ur';
  return 'en';
}

function detectMessageType(text, intent) {
  const t = String(text || '').toLowerCase();
  if (intent === 'conversation.confirm') return 'confirmation';
  if (/\b(?:change|update|remove|cancel|modify)\b/.test(t)) return 'correction';
  if (/\b(?:i want|i'll take|can i get|send me|book|order)\b/.test(t)) return 'request';
  if (/\b(?:what|how|where|when|why|who|which)\b/.test(t)) return 'question';
  if (/^(?:hi|hello|hey|salam|salaam)\b/.test(t)) return 'greeting';
  return 'other';
}

function detectActionSemantics(intent) {
  if (intent === 'conversation.confirm') return 'confirmation';
  if (['cart.add', 'booking.create', 'order.create'].includes(intent)) return 'draft_request';
  if (['cart.update', 'cart.remove', 'booking.modify', 'booking.cancel', 'order.modify', 'order.cancel'].includes(intent)) return 'change_request';
  if (['service.list', 'product.list', 'product.price', 'business.info', 'cart.view'].includes(intent)) return 'information_only';
  return 'none';
}

function detectRequestedInformation(intent) {
  const map = {
    'service.list': 'service_list',
    'product.list': 'product_list',
    'product.price': 'product_price',
    'business.info': 'business_info',
    'cart.view': 'cart_contents',
    'other': 'other',
  };
  return map[intent] || 'other';
}

function extractEntities(text, intent) {
  const t = String(text || '');
  const entities = {};
  // Extract date
  if (/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)) {
    entities.date_text = t.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[0] || null;
  }
  // Extract time
  const timeMatch = t.match(/\b(\d{1,2})\s*(am|pm|:\d{2})\b/i);
  if (timeMatch) entities.time_text = timeMatch[0];
  // Extract quantity
  const qtyMatch = t.match(/\b(\d+)\s*(?:plates?|pieces?|servings?|boxes?|sets?)\b/i);
  if (qtyMatch) entities.quantity = Number(qtyMatch[1]);
  else {
    const bareQty = t.match(/\b(\d+)\s+/);
    if (bareQty && ['cart.add', 'cart.update'].includes(intent)) entities.quantity = Number(bareQty[1]);
  }
  return entities;
}

module.exports = { MockNluClient, classifyByKeywords, corpusLookup };
