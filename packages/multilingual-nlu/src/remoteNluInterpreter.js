const { validateNluOutput } = require('./nluValidator');
const { NluContextBuilder } = require('./nluContextBuilder');

const NLU_PROMPT_VERSION = 'nova-language-2.0';

class RemoteNluInterpreter {
  constructor({ client, mode = 'off', contextBuilder = new NluContextBuilder(), maxInputChars = 4000, logger = null } = {}) {
    this.client = client;
    this.mode = ['off', 'on'].includes(mode) ? mode : 'off';
    this.contextBuilder = contextBuilder;
    this.maxInputChars = maxInputChars;
    this.logger = logger;
  }

  isEnabled(tenant) {
    return this.mode === 'on' && tenant?.features?.remoteNlu !== false && Boolean(this.client);
  }

  async interpret({ tenant, message, state, services, pending }) {
    if (!this.isEnabled(tenant)) {
      return { used:false, validated:false, interpretation:null, mode:this.mode, promptVersion:NLU_PROMPT_VERSION };
    }
    const context = await this.contextBuilder.build({ tenant, state, services, pending });
    const customerText = String(message?.text || '').slice(0, this.maxInputChars);
    const system = [
      `You are Nova Multilingual NLU (${NLU_PROMPT_VERSION}). Interpret language only and return exactly the supplied JSON schema.`,
      'Do not answer the customer and do not provide reasoning.',
      'Never decide business facts, prices, availability, policies, permissions, or whether an action succeeds.',
      'Never request or call tools. Never mark a quote, question, conditional statement, or hypothetical as a confirmed action.',
      'Use domain-independent intents. Use the active workflow only to classify continue, interrupt, replace, cancel, or unrelated.',
      'For a multi-intent message, use the most important actionable intent as intent and list every distinct intent in intents. Preserve side questions, corrections, customer updates, and greetings.',
      'Set action_semantics to information_only for questions/quotes/browsing, draft_request for an explicit new request, change_request for an explicit modification/removal/cancellation, confirmation or rejection only when directly expressed, and none otherwise.',
      'Set certainty to explicit only when the meaning is directly stated, implicit when it is a reasonable linguistic implication, and ambiguous when two or more meanings remain plausible.',
      'Use service.list or product.list for general browse questions. Use booking.create for requesting an appointment. Use order.create or cart.add when the customer wants to buy/add products; use cart.remove or cart.update for cart changes. Use order.return or order.exchange when a customer wants to return or replace an already purchased item; never classify that as product browsing.',
      'A greeting uses message_type greeting and intent other unless the same message contains a more important business intent.',
      'Extract every field stated in this message: date, preferred and alternative times/dates, duration, staff count, quantity/unit, property size, address/location, name, phone, email, options, identifiers, and corrections.',
      'For messages containing multiple services or products, put every distinct requested item in service_items or product_items with its own quantity and options. Do not collapse one item into another.',
      'missing_information describes linguistically missing fields only; it is a hint. Nova independently decides which fields its workflow requires.',
      'Keep relative date/time wording in *_text. A normalized value is only a linguistic suggestion; Nova validates and normalizes it again.',
      'Set service_id or product_id only when it exactly matches an ID in tenant_context.vocabulary. Otherwise leave the ID null.',
      'Use null for entity/customer properties not stated and empty arrays when no list values apply. Do not invent a fact or identifier absent from the message or tenant_context.',
      `tenant_context=${JSON.stringify(stripAllowedLists(context))}`
    ].join('\n');
    const response = await this.client.complete([
      { role:'system', content:system },
      { role:'user', content:customerText }
    ]);
    if (!response.success) {
      return {
        used:true,
        validated:false,
        interpretation:null,
        error:response.error,
        model:response.model,
        latencyMs:response.latencyMs,
        retryAfterMs:response.retryAfterMs || 0,
        httpStatus:response.httpStatus || null,
        providerMessage:response.providerMessage || null,
        providerErrorType:response.providerErrorType || null,
        providerRequestId:response.providerRequestId || null,
        mode:this.mode,
        promptVersion:NLU_PROMPT_VERSION,
        allowed:allowed(context)
      };
    }
    const validated = validateNluOutput(response.data);
    if (!validated.valid) {
      this.logger?.warn?.('remote_nlu.schema_rejected', { errors:validated.errors });
      return {
        used:true,
        validated:false,
        interpretation:null,
        error:'schema_rejected',
        validationErrors:validated.errors,
        model:response.model,
        latencyMs:response.latencyMs,
        mode:this.mode,
        promptVersion:NLU_PROMPT_VERSION,
        allowed:allowed(context)
      };
    }
    return {
      used:true,
      validated:true,
      interpretation:validated.value,
      model:response.model,
      latencyMs:response.latencyMs,
      mode:this.mode,
      promptVersion:NLU_PROMPT_VERSION,
      allowed:allowed(context)
    };
  }
}

function stripAllowedLists(context) {
  const { allowed_service_ids, allowed_product_ids, ...safe } = context;
  return safe;
}
function allowed(context) {
  return { serviceIds:[...context.allowed_service_ids], productIds:[...context.allowed_product_ids] };
}

module.exports = { RemoteNluInterpreter, NLU_PROMPT_VERSION };
