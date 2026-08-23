/**
 * Plugin adapter that exposes the AssistantService to the core plugin manager.
 */
class AssistantPlugin {
  constructor({ assistantService }) {
    this.id = "assistant";
    this.assistantService = assistantService;
  }
  async canHandle() { return true; }
  async execute(context) { return this.assistantService.handle(context); }
}
module.exports = { AssistantPlugin };
