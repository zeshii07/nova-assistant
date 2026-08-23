const { BaseCapability } = require("../../../packages/capability-sdk/src/baseCapability");
const { createCapabilityResult } = require("../../../packages/capability-sdk/src/capabilityResult");

/** Bridges the Sprint 2 AssistantService into the Sprint 3 capability SDK. */
class AssistantCapability extends BaseCapability {
  constructor({ manifest, services }) {
    super({ manifest });
    if (!services?.assistantService) throw new TypeError("assistantService is required.");
    this.assistantService = services.assistantService;
  }

  async canHandle() {
    // Sprint 3 supports one winning capability. The assistant is the safe
    // baseline capability and receives a moderate confidence score so future
    // specialized capabilities can outrank it.
    return { confidence: 0.5, reason: "default_assistant" };
  }

  async execute(context) {
    const result = await this.assistantService.handle(context);
    const responseSequence=Number(context.state.context?.assistantResponseSequence||0)+1;
    result.statePatch={
      ...(result.statePatch||{}),
      context:{...(result.statePatch?.context||{}),assistantResponseSequence:responseSequence}
    };
    // Platform memory is optional and permission-scoped by the Execution Engine.
    // The capability never receives a repository or another tenant's identifiers.
    const detectedLanguage = result.statePatch?.language || context.language;
    if (context.services.memory) {
      await context.services.memory.setPreference("language", detectedLanguage);
      await context.services.memory.appendHistory("assistant.message", {
        intent: result.statePatch?.lastIntent || "other",
        text: context.message.text
      });
    }
    if (context.services.crm) {
      const customer = await context.services.crm.getCustomer();
      if (customer && customer.preferredLanguage !== detectedLanguage) {
        await context.services.crm.updateCustomer({ preferredLanguage: detectedLanguage });
      }
      await context.services.crm.recordActivity("assistant.message", {
        intent: result.statePatch?.lastIntent || "other",
        channel: context.channel
      });
      if (customer?.name && result.statePatch?.lastIntent === "greet" && detectedLanguage === "english") {
        result.reply = result.reply.replace(/^Hello!/, `Hello, ${customer.name}!`);
      }
    }
    return createCapabilityResult({
      ...result,
      confidence: 0.5,
      metadata: { ...(result.metadata || {}), intent: result.statePatch?.lastIntent || "other" },
      events: [
        ...(result.events || []),
        { name: "assistant.responded.v1", payload: { intent: result.statePatch?.lastIntent || "other" } }
      ]
    });
  }
}
module.exports = { Capability: AssistantCapability, AssistantCapability };
