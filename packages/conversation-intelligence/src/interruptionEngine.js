const { normalizeText } = require('./text');
class InterruptionEngine {
  detect(message, state) {
    if (!activeWorkflow(state)) return null;
    const text = normalizeText(message);
    const commerce=state?.capabilityState?.commerce||{};
    // When Commerce explicitly asks for payment, payment words are answers,
    // not temporary business questions.
    if(commerce.mode==='checkout' && commerce.pendingField==='paymentMethod' && /\b(cash on delivery|cash|cod|jazz\s*cash|easypaisa|easy\s*paisa|bank transfer|bank)\b/.test(text)) return null;
    if (/\b(expensive|mehnga|mehngi|mehngy|costly|too much|price high|bohat mehnga|مہنگا|مہنگی)\b/.test(text)) return { type:'price_comment', confidence:.98 };
    const social=/\b(?:hello|hi|hey|salam|how are you|how r you|how are things|what are you doing|thanks|thank you|shukriya|شکریہ)\b/.test(text);
    const operational=/\b(?:book|schedule|order|buy|purchase|add|remove|change|cancel|clean(?:ing)?|product|service|appointment|reservation|price|cost|available)\b/.test(text);
    if(social&&!operational)return {type:'social',confidence:.97};
    if (/\b(refund|return policy|returns|cancellation policy|cancel a booked|can i cancel|how to cancel|delivery time|delivery charges|shipping|location|address of shop|where are you|contact|hours|timing|policy|payment|payment method|jazz\s*cash|easypaisa|easy\s*paisa|bank transfer|cash on delivery|parking|pets?|dog|cat|wardrobe|furniture|windows?|balcony|serving areas?|service areas?|واپسی|ڈیلیوری|پتہ)\b/.test(text)) return { type:'business_question', confidence:.95 };
    if (/^(who|what|where|when|why|how|do|does|is|are|can|could|will|would|should|which)\b/.test(text) && !/\b(confirm|cancel|book|schedule|order|buy|purchase)\b/.test(text)) return { type:'business_question', confidence:.82 };
    if (/\b(thanks|thank you|shukriya|ok thanks|شکریہ)\b/.test(text)) return { type:'social', confidence:.9 };
    return null;
  }
}
function activeWorkflow(state) {
  return ['checkout','paused_add_item','review'].includes(state?.capabilityState?.commerce?.mode) || Boolean(state?.capabilityState?.cleaning?.step) || ['collecting','ready'].includes(state?.capabilityState?.booking?.status);
}
module.exports = { InterruptionEngine, activeWorkflow };
