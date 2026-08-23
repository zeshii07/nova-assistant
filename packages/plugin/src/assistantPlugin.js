/**
 * Backward-compatible Sprint 1 assistant plugin.
 * Sprint 2 production wiring uses packages/assistant/src/assistantPlugin.
 */
class AssistantPlugin {
  constructor() { this.id = "assistant"; }
  async canHandle() { return true; }
  async execute(context) {
    const text = context.message.text.trim().toLowerCase();
    const isGreeting = /^(hi|hello|hey|salam|salaam|assalam|السلام)/i.test(text);
    const reply = isGreeting
      ? context.tenant.branding?.welcomeMessage || `Hello from ${context.tenant.name}!`
      : `I received your message. ${context.tenant.name} is ready to help.`;
    return { reply, statePatch: { lastIntent: isGreeting ? "greet" : "assistant_message", activePlugin: this.id } };
  }
}
module.exports = { AssistantPlugin };
