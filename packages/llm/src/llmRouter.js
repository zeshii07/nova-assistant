/**
 * Uses configured providers in order and returns a safe failure when all fail.
 */
class LlmRouter {
  constructor({ providers = [], logger } = {}) {
    this.providers = providers;
    this.logger = logger;
  }
  async complete(messages, options) {
    for (const provider of this.providers) {
      const result = await provider.complete(messages, options);
      if (result.success && result.text) return result;
    }
    this.logger?.info("llm.unavailable");
    return { success: false, text: null, reason: "all_providers_failed" };
  }
}
module.exports = { LlmRouter };
