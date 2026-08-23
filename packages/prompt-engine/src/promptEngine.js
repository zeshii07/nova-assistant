/** Foundation for centralized, auditable LLM prompt composition. */
class PromptEngine {
  compose({ system = "", tenantContext = "", capabilityContext = "", memoryContext = "", userMessage = "" }) {
    return [system, tenantContext, capabilityContext, memoryContext].filter(Boolean).map((content) => ({ role: "system", content })).concat({ role: "user", content: userMessage });
  }
}
module.exports = { PromptEngine };
