/** Chooses a stable communication language from CRM, memory, message, and tenant. */
const { detectLanguage } = require("../../conversation-intelligence/src/text");

class ExperienceLanguageEngine {
  async resolve({ context }) {
    // Bug 7 fix (Phase 1 item 7): the reply language must track the CURRENT
    // message, not the prior turn's stored language. Previously this function
    // returned `previous || crmLanguage || memoryLanguage || explicit || ...`
    // whenever the current message detected as English — so a visitor who
    // switched Roman Urdu → English kept getting Roman-Urdu replies, and a
    // visitor who switched English → Roman Urdu (on a short message) got
    // English. The current message's detected language is now the PRIMARY
    // signal; prior/CRM/memory preferences are demoted to fallbacks used ONLY
    // when the current message is empty (genuinely uncertain).
    const currentText = String(context.message?.text || "");
    const explicit = detectLanguage(currentText);
    const crmLanguage = context.customer?.preferredLanguage;
    let memoryLanguage = null;
    try { memoryLanguage = await context.services.memory?.getPreference("language"); }
    catch (error) { if (!/permission denied/i.test(error?.message || "")) throw error; }
    const previous = context.state?.language;
    const tenantDefault = context.tenant?.defaultLanguage || "english";

    // No current message to classify → fall back to the stable preferences.
    if (!currentText.trim()) {
      return previous || crmLanguage || memoryLanguage || tenantDefault;
    }

    // The current message has a definitive language (urdu / roman_urdu /
    // english). The English-location guard inside detectLanguage already
    // prevents "Main Street" from being misclassified as Roman Urdu, so we
    // trust the result. This makes language-switching reply in the visitor's
    // CURRENT language.
    return explicit;
  }
}
module.exports = { ExperienceLanguageEngine, detect: detectLanguage };
