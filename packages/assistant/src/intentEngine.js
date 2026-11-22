const { canonicalize, hasConcept } = require('../../universal-vocabulary/src');

/**
 * @deprecated Phase 3 Sprint 3 — legacy regex-based intent detection.
 *
 * This file is the legacy "regex brain" that pre-dates the deterministic
 * T0/T1/T2 routing engine (T0/T1 in packages/conversation-intelligence, T2 in
 * packages/dialogue-manager/src/taskFrameEngine.js). The T0 fast-path now
 * short-circuits greetings / gratitude / goodbye / emoji-only / bare yes-no /
 * back / help / quick-reply / bare-number turns BEFORE this engine is reached
 * (see assistantService.handle → `t0_fast_path`), and the T1/T2 adapter +
 * task-frame pipeline handles every transactional and informational intent
 * this regex ladder used to own (order, booking, cleaning, ask_hours,
 * ask_payment, ask_services, ask_contact, ask_location, ask_returns, …).
 *
 * Coverage parity with the deterministic engine has been reached, so this
 * module is RETIRED from the default active path. It is kept on disk only for
 * comparison and regression testing — it is NOT loaded by the active path
 * unless a caller explicitly opts in via the env flag below.
 *
 * Env gate: NOVA_LEGACY_REGEX_NLU
 *   • unset / falsy ("", "0", "false", "no", "off")  →  legacy regex path is
 *     NOT used; assistantService.handle() skips `intentEngine.detect()` and
 *     falls through to knowledge retrieval / LLM-safe fallback, exactly as
 *     the T0/T1/T2 path expects.
 *   • truthy ("1", "true", "yes", "on")  →  legacy regex path is available
 *     for comparison/regression (the pre-Sprint-3 behavior).
 *
 * Default: OFF. To re-enable for A/B comparison:
 *   NOVA_LEGACY_REGEX_NLU=1 node --test ...
 *
 * Do NOT add new intent rules here. New intent coverage belongs in the T0/T1
 * deterministic tiers or the T2 task-frame catalog.
 */
const LEGACY_REGEX_FLAG = 'NOVA_LEGACY_REGEX_NLU';
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * Whether the legacy regex intent path is enabled for this process. Reads the
 * env flag directly (module-level gate) so no edits to container.js / server.js
 * are required to wire it.
 * @returns {boolean}
 */
function isLegacyRegexEnabled() {
  const v = process.env[LEGACY_REGEX_FLAG];
  if (v === undefined || v === null || v === '') return false;
  return TRUTHY.has(String(v).trim().toLowerCase());
}

/**
 * Rule-first intent detection for common assistant conversations.
 * Business facts are never inferred here; only the requested topic is detected.
 *
 * @deprecated See module docstring — superseded by the T0/T1/T2 engine.
 * Retired in Phase 3 Sprint 3; gated behind NOVA_LEGACY_REGEX_NLU (default OFF).
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
module.exports = { IntentEngine, isLegacyRegexEnabled, LEGACY_REGEX_FLAG };
