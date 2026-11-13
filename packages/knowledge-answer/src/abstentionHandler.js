/**
 * v57.0 — Abstention Handler
 *
 * Wraps the existing missingKnowledge() pattern. Adds clarification generation
 * ("Are you looking for standard cleaning or deep cleaning?") when the
 * IntentRouter reports missingFields. Distinguishes abstention (evidence
 * insufficient) from clarification (customer detail missing).
 *
 * Spec reference: §2.3.6, §2.3.7, §4 Step 8
 *
 * Architecture rule (spec §2.3.6): "Abstention is a feature." (spec §2.3.7):
 * "Clarification is different from abstention."
 */

const CLARIFICATION_TEMPLATES = {
  service: {
    cleaning: 'Are you looking for standard cleaning or deep cleaning?',
    default: 'Which service would you like to know about?',
  },
  date: {
    default: 'What date works best for you?',
  },
  time: {
    default: 'What time of day suits you?',
  },
  orderId: {
    default: 'Could you share your order or booking ID?',
  },
  propertyType: {
    default: 'Is this for an apartment, villa, or office?',
  },
};

const ABSTENTION_REPLIES = {
  en: {
    missing: "I don't have that information in our approved business knowledge. Let me check with the team and get back to you.",
    escalate: "I'm not able to resolve this safely from our knowledge base. I'm escalating this to the team — someone will follow up shortly.",
    refuse: "I'm not able to help with that request.",
  },
  ur: {
    missing: 'ہماری منظور شدہ کاروباری معلومات میں یہ معلومات موجود نہیں ہیں۔ میں ٹیم سے تصدیق کرتا ہوں۔',
    escalate: 'میں اسے محفوظ طریقے سے حل نہیں کر سکتا۔ میں اسے ٹیم کے حوالے کر رہا ہوں۔',
    refuse: 'میں اس درخواست میں مدد نہیں کر سکتا۔',
  },
  'roman-urdu': {
    missing: 'Is ki information hamare approved business knowledge mein nahi hai. Main team se confirm karta hoon.',
    escalate: 'Main isay safely resolve nahi kar sakta. Team ko escalate kar raha hoon.',
    refuse: 'Main is request mein help nahi kar sakta.',
  },
};

class AbstentionHandler {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Build a clarification question for a missing field.
   *
   * @param {string} field — the missing field name (service, date, orderId, ...)
   * @param {object} context — optional { intent, tenant } for domain-specific wording
   * @returns {string|null}
   */
  clarify(field, context = {}) {
    const templates = CLARIFICATION_TEMPLATES[field];
    if (!templates) return null;
    const domain = context.tenant?.domain || context.domain || 'default';
    return templates[domain] || templates.default;
  }

  /**
   * Build an abstention reply (evidence insufficient / escalated / refused).
   *
   * @param {string} kind — 'missing' | 'escalate' | 'refuse'
   * @param {string} language — 'en' | 'ur' | 'roman-urdu'
   * @returns {string}
   */
  abstain(kind = 'missing', language = 'en') {
    const lang = ABSTENTION_REPLIES[language] ? language : 'en';
    return ABSTENTION_REPLIES[lang][kind] || ABSTENTION_REPLIES[lang].missing;
  }

  /**
   * Build the missing-knowledge reply (the existing missingKnowledge() contract).
   */
  missingKnowledge(language = 'en') {
    return this.abstain('missing', language);
  }
}

module.exports = { AbstentionHandler, CLARIFICATION_TEMPLATES, ABSTENTION_REPLIES };
