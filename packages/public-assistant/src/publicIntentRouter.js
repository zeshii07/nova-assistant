/**
 * PublicIntentRouter — §6 of the spec.
 *
 * Detects the visitor's intent from a public product-assistant message. This is
 * a lightweight, deterministic router (no LLM by default) because the public
 * endpoint must stay fast, cheap, and safe. It recognises the 15 intent
 * categories from §6 and applies the §6 priority ordering when multiple intents
 * match.
 *
 * The router never executes a business action — it only produces a routing
 * decision that the orchestrator uses to choose the response path.
 */

// §6 — intent priority (higher wins when multiple match).
const PRIORITY = [
  "security_privacy",
  "existing_customer_support",
  "demo_intent",
  "purchase_intent",
  "pricing",
  "comparison",
  "integration",
  "channel",
  "language",
  "workflow_demo",
  "industry_use_case",
  "feature_discovery",
  "technical",
  "product_overview",
  "unknown"
];

// Rule list. Each rule: { intent, patterns[], example }. patterns are lowercase regex.
const RULES = [
  {
    intent: "security_privacy",
    example: "Is my data private?",
    patterns: [
      /\b(is|are)\s+(my|the)\s+(business\s+)?data\s+(private|secure|safe)\b/,
      /\bdata\s+(privacy|security|protection)\b/,
      /\bcan\s+one\s+business\s+see\s+another\b/,
      /\b(encrypt|encryption|certif|gdpr|compliance)\b/,
      /\bdoes\s+nova\s+store\s+(conversations?|my\s+data)\b/,
      /\bcan\s+i\s+delete\s+my\s+data\b/
    ]
  },
  {
    intent: "existing_customer_support",
    example: "My account is not working",
    patterns: [
      /\bmy\s+account\b/, /\bmy\s+tenant\b/, /\bi\s+am\s+(an?\s+)?existing\s+customer\b/,
      /\blogin\s+(issue|problem|not\s+working)\b/, /\bcannot\s+(log\s+in|access\s+my)\b/,
      /\bmy\s+subscription\b/, /\bmy\s+invoice\b/
    ]
  },
  {
    intent: "demo_intent",
    example: "I want a demo",
    patterns: [
      /\bi\s+want\s+(a|an?)\s+demo\b/, /\bbook\s+(a|an?)\s+demo\b/, /\brequest\s+(a|an?)\s+demo\b/,
      /\bcan\s+i\s+(see|get)\s+(a|an?)\s+demo\b/, /\bshow\s+me\s+(a|an?)\s+demo\b/,
      /\bdemo\s+(please|request)\b/, /\barrange\s+(a|an?)\s+demo\b/,
      // Roman Urdu / Urdu transliteration.
      /\bmujhe\s+demo\s+chahiye\b/, /\bdemo\s+chahiye\b/, /\bdemo\s+dikhao\b/,
      /\bdemo\s+mangta\s+hoon\b/, /\bdemo\s+dikhaye\b/
    ]
  },
  {
    intent: "purchase_intent",
    example: "I want to use Nova",
    patterns: [
      /\bi\s+want\s+to\s+(use|buy|purchase)\s+nova\b/, /\bhow\s+do\s+i\s+(buy|purchase|sign\s+up)\b/,
      /\bstart\s+using\s+nova\b/, /\bsign\s+up\b/, /\bi'?m\s+ready\s+to\s+(start|buy)\b/,
      /\bcan\s+i\s+speak\s+to\s+(someone|the\s+team)\b/,
      // Roman Urdu / Urdu transliteration.
      /\bmujhe\s+nova\s+chahiye\b/, /\bnova\s+khareedna\s+hai\b/, /\bnova\s+use\s+karna\s+hai\b/
    ]
  },
  {
    intent: "pricing",
    example: "What does it cost?",
    patterns: [
      /\b(how\s+much|what\s+(does|do).*cost|price|pricing|cost|costs|fee|fees|trial|free)\b/,
      /\bsetup\s+fee\b/, /\bmonthly\s+(cost|price|fee)\b/
    ]
  },
  {
    intent: "comparison",
    example: "How is Nova different?",
    patterns: [
      /\bhow\s+is\s+nova\s+(different|better)\b/, /\bnova\s+vs\b/, /\bcompare\b/,
      /\bwhat\s+makes\s+nova\s+different\b/, /\balternative\s+to\b/
    ]
  },
  {
    intent: "integration",
    example: "Can it connect to my CRM?",
    patterns: [
      /\b(integrate|integration|connect\s+to)\b/, /\b(my|existing)\s+(crm|booking|ecommerce|software|system)\b/,
      /\bdoes\s+nova\s+(have|provide)\s+an?\s+api\b/, /\bdevelopers?\s+customize\b/
    ]
  },
  {
    intent: "channel",
    example: "Can it work on my website?",
    patterns: [
      /\b(website|web\s+site|widget|embed)\b/, /\b(whatsapp|whats\s+app)\b/,
      /\b(mobile|tablet|kiosk)\b/, /\badd\s+nova\s+to\s+my\b/
    ]
  },
  {
    intent: "language",
    example: "Does it support Urdu?",
    patterns: [
      /\b(urdu|roman\s+urdu|english\s+language|multilingual)\b/, /\bdoes\s+nova\s+support\s+\w+\b/,
      /\bmatch\s+my\s+brand\b/
    ]
  },
  {
    intent: "workflow_demo",
    example: "Show a booking example",
    patterns: [
      /\b(show|give)\s+(me\s+)?(a|an?)\s+(booking|example|demo|workflow)\b/,
      /\bexample\s+(booking|conversation|workflow)\b/, /\bhow\s+would\s+(it|nova)\s+work\b/
    ]
  },
  {
    intent: "industry_use_case",
    example: "Can it help a clinic?",
    patterns: [
      /\b(salon|clinic|cleaning|restaurant|retail|ecommerce|e-commerce|real\s+estate|consultancy|training)\b/,
      /\bcan\s+nova\s+help\s+(my|a)\b/, /\bi\s+(run|manage|own|operate)\b/
    ]
  },
  {
    intent: "feature_discovery",
    example: "What can it do?",
    patterns: [
      /\bwhat\s+(can|does)\s+(it|nova)\s+do\b/, /\b(features?|capabilities|modules)\b/,
      /\bcan\s+nova\s+(answer|manage|collect|support|handle|automate)\b/,
      /\bproduct\s+catalogue\b/, /\bservice\s+catalogue\b/, /\bbooking\s+workflow\b/,
      /\bcrm\b/, /\bcommerce\b/, /\bknowledge\s+based?\b/
    ]
  },
  {
    intent: "technical",
    example: "How does it work?",
    patterns: [
      /\bhow\s+(does|do)\s+(it|nova)\s+work\b/, /\b(architecture|infrastructure|hosting|deploy|on-?prem)\b/,
      /\bretriev(e|al)\s+answer\b/, /\bembedding\b/, /\bvector\b/
    ]
  },
  {
    intent: "product_overview",
    example: "What is Nova?",
    patterns: [
      /\bwhat\s+is\s+nova\b/, /\bwho\s+is\s+nova\s+for\b/, /\bwhat\s+problem\b/,
      /\btell\s+me\s+about\s+nova\b/, /\bget\s+started\b/, /\boverview\b/
    ]
  }
];

// Industry extraction for the recommendation mapping (§14).
const INDUSTRY_KEYWORDS = [
  { key: "salon", patterns: [/\bsalon\b/, /\bhair\s+studio\b/, /\bbarber\b/, /\bbeauty\b/] },
  { key: "clinic", patterns: [/\bclinic\b/, /\bmedical\b/, /\bdoctor\b/, /\bdental\b/, /\bhospital\b/] },
  { key: "cleaning", patterns: [/\bcleaning\b/, /\bcleaner\b/, /\bmaid\b/] },
  { key: "restaurant", patterns: [/\brestaurant\b/, /\bcafe\b/, /\bfood\b/, /\bcatering\b/] },
  { key: "retail", patterns: [/\bretail\b/, /\bshop\b/, /\bstore\b/] },
  { key: "ecommerce", patterns: [/\becommerce\b/, /\be-commerce\b/, /\bonline\s+store\b/] },
  { key: "real_estate", patterns: [/\breal\s+estate\b/, /\bproperty\b/, /\brealtor\b/] },
  { key: "consultancy", patterns: [/\bconsultancy\b/, /\bconsultant\b/, /\bagency\b/] },
  { key: "training", patterns: [/\btraining\b/, /\binstitute\b/, /\bacademy\b/, /\bcourse\b/] }
];

class PublicIntentRouter {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /** Classify a visitor message. Returns { intent, confidence, industry, matched_rule }. */
  classify(text) {
    const q = String(text || "").toLowerCase();
    if (!q.trim()) return { intent: "unknown", confidence: 0.3, industry: null, matched_rule: null };
    const matched = [];
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(q)) {
          matched.push({ intent: rule.intent, example: rule.example, pattern: pattern.source });
          break;
        }
      }
    }
    // Sort matched intents by the §6 priority order.
    matched.sort((a, b) => PRIORITY.indexOf(a.intent) - PRIORITY.indexOf(b.intent));
    const top = matched[0];
    const industry = this.extractIndustry(q);
    if (!top) {
      return { intent: "unknown", confidence: 0.3, industry, matched_rule: null };
    }
    return { intent: top.intent, confidence: 0.9, industry, matched_rule: top };
  }

  extractIndustry(text) {
    for (const ind of INDUSTRY_KEYWORDS) {
      for (const p of ind.patterns) {
        if (p.test(text)) return ind.key;
      }
    }
    return null;
  }

  /**
   * §6 priority check: given multiple intents, return the one that wins.
   * Used when an LLM classifier returns multiple candidates.
   */
  pickHighest(intents) {
    if (!intents || intents.length === 0) return "unknown";
    const sorted = [...intents].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
    return sorted[0];
  }
}

module.exports = { PublicIntentRouter, RULES, PRIORITY, INDUSTRY_KEYWORDS };
