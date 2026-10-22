/** Chooses a stable communication language from CRM, memory, message, and tenant. */
class ExperienceLanguageEngine {
  async resolve({ context }) {
    const explicit = detect(context.message.text);
    const crmLanguage = context.customer?.preferredLanguage;
    let memoryLanguage = null;
    try { memoryLanguage = await context.services.memory?.getPreference("language"); }
    catch (error) { if (!/permission denied/i.test(error?.message || "")) throw error; }
    const previous = context.state.language;
    const tenantDefault = context.tenant.defaultLanguage || "english";
    // Current strong language evidence can update an old preference. Short messages
    // inherit the stable preference instead of being reclassified every time.
    // v34.0 Bugfix: Don't let English addresses with "Main Street" trigger Roman Urdu.
    if (explicit && explicit !== "english") {
      // Check if the text contains English location/address words — if so,
      // the "main" match is from "Main Street", not Roman Urdu "main" (I).
      if (/\b(street|road|avenue|blvd|building|block|sector|apartment|villa|floor|tower|highway|lane|drive)\b/i.test(context.message.text)) {
        return previous || crmLanguage || memoryLanguage || tenantDefault;
      }
      return explicit;
    }
    return previous || crmLanguage || memoryLanguage || explicit || tenantDefault;
  }
}
function detect(value) {
  const text = String(value || "");
  if (/[\u0600-\u06FF]/.test(text)) return "urdu";
  // v34.0: Check for English location words BEFORE Roman Urdu detection.
  // "123 Main Street Dubai" was false-positive matching "main" as Roman Urdu.
  if (/\b(street|road|avenue|blvd|building|block|sector|apartment|villa|floor|tower|highway|lane|drive)\b/i.test(text)) return "english";
  if (/\b(aap|ap|mujhe|mujhy|mujhay|mujy|main|mai|mein|ny|mera|meri|kya|kia|kaise|kaisay|hai|hain|chahiye|chahiy|chaheye|karo|kro|kar dein|karwani|karwana|krani|bata|batao|batain|shukriya|kon sy|kitna|kitni|kitne|kal|aaj|aj|parson|subah|subha|shaam|sham|raat|jumma|hafta waly|bhai|jnab|janab|theek|haan|han|bilkul|safai|saaf)\b/i.test(text)) return "roman_urdu";
  return "english";
}
module.exports = { ExperienceLanguageEngine, detect };
