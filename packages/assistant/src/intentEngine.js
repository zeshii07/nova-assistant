const { canonicalize, hasConcept } = require('../../universal-vocabulary/src');
/**
 * Rule-first intent detection for common assistant conversations.
 * Business facts are never inferred here; only the requested topic is detected.
 */
class IntentEngine {
  detect(text) {
    const value = canonicalize(String(text || ""));
    const compact = value.replace(/[؟?!.،,]/g, " ").replace(/\s+/g, " ").trim();

    if (/\b(who are you|what are you|what is your name|what's your name|your name|aap kon|ap kon|aap ka naam|ap ka naam|آپ کون)\b/.test(compact)) return this.result("assistant_identity", 0.94);
    // A greeting may contain another social act ("hello how are you").
    // Prefer the more informative act instead of stopping at the first word.
    if (hasConcept(compact,'social.how_are_you')) return this.result("small_talk", 0.99);
    // A greeting is a social prefix, not ownership of the whole message.
    // Business questions embedded after hello/salam must still win.
    if (/\b(business hours|working hours|opening hours|closing hours|store hours|office hours|your hours|our hours|timings?|when.*open|when.*close|what time.*open|what time.*close|are you open|open today|close today|kab khul|kab band|اوقات|کب کھل)\b/.test(compact)) return this.result("ask_hours", 0.97);
    if (/^(hi|hello|hey|salam|salaam|assalam|aoa|السلام|السلام علیکم)\b/.test(compact)) return this.result("greet", 0.98);
    if (/\b(thanks|thank you|thx|shukriya|شکریہ|جزاک اللہ)\b/.test(compact)) return this.result("thanks", 0.98);
    if (/\b(bye|goodbye|allah hafiz|khuda hafiz|اللہ حافظ)\b/.test(compact)) return this.result("goodbye", 0.96);
    const businessDetails = /\b(?:business|company)\b/.test(compact) && /\b(?:information|info|details?|name|contact|phone|email)\b/.test(compact);
    const nameAndContact = /\b(?:name|called)\b/.test(compact) && /\b(?:contact|phone|email|reach)\b/.test(compact);
    if (businessDetails || nameAndContact) return this.result("ask_business_info", 0.99);
    if (/\b(about|business|company|organization|who is|tell me about|bare mein|بارے میں)\b/.test(compact)) return this.result("ask_about", 0.9);
    if (/\b(payment|pay|cash|card|jazzcash|easypaisa|ادائیگی)\b/.test(compact)) return this.result("ask_payment", 0.9);
    if (/\b(service|services|offer|what do you do|kya karte|کیا خدمات|خدمات)\b/.test(compact)) return this.result("ask_services", 0.92);
    if (/\b(contact|phone|email|whatsapp|call|reach|rabta|رابطہ|فون)\b/.test(compact)) return this.result("ask_contact", 0.91);
    if (/\b(location|address|where are you|where located|where to|where can i visit|visit.*campus|kahan)\b/.test(compact) || /(پتہ|کہاں|واقع)/.test(compact)) return this.result("ask_location", 0.91);
    if (/\b(takeaway|take away|pickup|pick up)\b/.test(compact)) return this.result("ask_takeaway", 0.93);
    if (/\b(delivery|shipping|deliver|ڈیلیوری|ترسیل)\b/.test(compact)) return this.result("ask_delivery", 0.9);
    if (/\b(return|refund|exchange|warranty|واپسی|ریفنڈ)\b/.test(compact)) return this.result("ask_returns", 0.9);
    if (/\b(faq|question|questions|common question|سوالات)\b/.test(compact)) return this.result("ask_faq", 0.86);

    return this.result("other", 0.25);
  }

  result(intent, confidence) {
    return { intent, confidence, source: "rules" };
  }
}
module.exports = { IntentEngine };
