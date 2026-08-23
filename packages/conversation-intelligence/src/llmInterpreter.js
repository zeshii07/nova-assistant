/**
 * LLM fallback adapter. It interprets language only; it never executes actions.
 * The returned capability must be enabled by the tenant and confidence must be
 * sufficiently high. Business capabilities still validate every entity.
 */
class LlmConversationInterpreter {
  constructor({ llmRouter, adapterRegistry } = {}) { this.llmRouter = llmRouter; this.adapterRegistry = adapterRegistry; }
  async interpret({ tenant, message, state }) {
    if (!this.llmRouter) return null;
    const enabled = this.adapterRegistry.list().filter((a) => tenant.capabilities?.includes(a.capabilityId)).map((a) => a.capabilityId);
    const prompt = `Interpret a customer message for Nova. Return ONLY JSON with capabilityId, intent, confidence, entities. Enabled capabilities: ${enabled.join(', ')}. Do not invent products, prices, services, availability or business facts. Current workflow: ${JSON.stringify(state.capabilityState || {})}. Message: ${JSON.stringify(message.text)}`;
    const response = await this.llmRouter.complete([{ role:'system', content:prompt }, { role:'user', content:message.text }], { maxTokens:180 });
    const raw = response?.text || '';
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed; try { parsed = JSON.parse(match[0]); } catch { return null; }
    const validCapability = enabled.includes(parsed.capabilityId);
    const confidence = Number(parsed.confidence || 0);
    if (!validCapability || confidence < .72) return { validated:false, interpretation:null };
    return { validated:true, interpretation:{ capabilityId:parsed.capabilityId, intent:String(parsed.intent || 'other'), confidence, entities:parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {}, reason:'llm_fallback' } };
  }
}
module.exports = { LlmConversationInterpreter };
