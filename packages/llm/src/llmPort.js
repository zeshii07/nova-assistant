/**
 * Documents the provider contract used by the assistant engine.
 * Providers must return { success, text } and must never throw to callers.
 */
class LlmPort {
  async complete() {
    throw new Error("LlmPort.complete must be implemented");
  }
}
module.exports = { LlmPort };
