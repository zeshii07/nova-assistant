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
    if (explicit && explicit !== "english") return explicit;
    return previous || crmLanguage || memoryLanguage || explicit || tenantDefault;
  }
}
function detect(value) {
  const text = String(value || "");
  if (/[\u0600-\u06FF]/.test(text)) return "urdu";
  if (/\b(aap|ap|mujhe|mujhy|mujhay|mujy|main|mai|mein|ny|mera|meri|kya|kia|kaise|kaisay|hai|hain|chahiye|chahiy|chaheye|karo|kro|kar dein|karwani|karwana|krani|bata|batao|batain|shukriya|kon sy|kitna|kitni|kitne|kal|aaj|aj|parson|subah|subha|shaam|sham|raat|jumma|hafta waly|bhai|jnab|janab|theek|haan|han|bilkul|safai|saaf)\b/i.test(text)) return "roman_urdu";
  return "english";
}
module.exports = { ExperienceLanguageEngine, detect };
