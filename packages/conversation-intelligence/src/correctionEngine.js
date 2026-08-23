const { normalizeText, numberFromText } = require('./text');
const { parseClock } = require('./temporalSemanticExtractor');
class CorrectionEngine {
  detect(message, state) {
    const text = normalizeText(message);
    const correctionCue = /\b(i meant|i mean|actually|sorry i said|sorry meant|change|make it|instead|wrong|not my|this is not|nahi|galat|mera naam nahi|یہ میرا نام نہیں|اصل میں)\b/.test(text);
    if (!correctionCue) return null;
    const startTimeChange = String(message || '').match(/\b(?:change|move|shift|correct)\s+(?:the\s+)?(?:starting|start)\s+time\s+from\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (startTimeChange) {
      const from = parseClock(startTimeChange[1], startTimeChange[2], startTimeChange[3] || startTimeChange[6]);
      const to = parseClock(startTimeChange[4], startTimeChange[5], startTimeChange[6] || startTimeChange[3]);
      if (to) return { type:'replace', target:'startTime', from:from?.value || null, value:to.value, confidence:1 };
    }
    // Natural reschedule messages often omit the literal words "start time":
    // "change my request from 2 PM to 6 PM" still means replace, not a
    // four-hour availability window.
    const timeReplacement = String(message || '').match(/\b(?:change|move|shift|reschedule|update)\b[\s\S]{0,80}?\bfrom\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
    if(timeReplacement){
      const from=parseClock(timeReplacement[1],timeReplacement[2],timeReplacement[3]);
      const to=parseClock(timeReplacement[4],timeReplacement[5],timeReplacement[6]);
      if(to)return {type:'replace',target:'startTime',from:from?.value||null,value:to.value,confidence:1};
    }
    if (/\b(name|naam|نام)\b/.test(text) && /\b(not|wrong|nahi|galat|نہیں|غلط)\b/.test(text)) return { type:'invalidate', target:'name', confidence:1 };
    if (/\b(phone|number|number wrong|فون|نمبر)\b/.test(text) && /\b(not|wrong|nahi|galat|نہیں|غلط)\b/.test(text)) return { type:'invalidate', target:'phone', confidence:1 };
    const quantity = numberFromText(text);
    if (quantity && (/\b(quantity|qty|pieces?|pcs?|items?)\b/.test(text) || /\b(i meant|make it|instead|actually)\b/.test(text))) return { type:'replace', target:'quantity', value:quantity, confidence:.99 };
    if (/\b(black|white|blue|navy|brown|silver|gold|grey|gray|red|maroon|kala|safed|neela|کالا|سفید)\b/.test(text)) return { type:'replace', target:'color', value:null, confidence:.94 };
    if (/\b(size|small|medium|large|xl|xxl|\d{2})\b/.test(text)) return { type:'replace', target:'size', value:null, confidence:.9 };
    const commerce = state?.capabilityState?.commerce;
    if (commerce?.mode === 'checkout') return { type:'generic', target: commerce.pendingField || null, confidence:.75 };
    return { type:'generic', target:null, confidence:.65 };
  }
}
module.exports = { CorrectionEngine };
