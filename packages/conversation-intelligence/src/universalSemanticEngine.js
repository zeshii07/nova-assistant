const { normalizeText, numberFromText } = require('./text');

/**
 * Domain-neutral semantic pass. It does not know products, doctors, schools or
 * cleaners. It only identifies universal conversational acts and modifiers.
 */
class UniversalSemanticEngine {
  analyze(text) {
    const n = normalizeText(text);
    const acts = [];
    add(acts, /^(hi|hello|hey|salam|salaam|assalam|aoa|السلام)/.test(n), 'greeting');
    add(acts, /\b(how are you|how do you do|how is your day|what'?s up|kia hal|kya haal|kaise ho|kese ho|آپ کیسے ہیں)\b/.test(n), 'small_talk');
    add(acts, /\b(thanks|thank you|shukriya|شکریہ)\b/.test(n), 'gratitude');
    add(acts, /\b(cancel|stop|never mind|nevermind|cancel kar|rehne do|منسوخ)\b/.test(n), 'cancel');
    add(acts, /\b(i meant|actually|sorry i want|change|instead|not my|mera matlab|بلکہ)\b/.test(n), 'correction');
    add(acts, /\b(confirm|book|order|buy|purchase|reserve|schedule|appointment|admission|register|request|chahiye|karwa|کروا|چاہیے)\b/.test(n), 'action_request');
    add(acts, /\b(what|which|who|where|when|how|do you|can i|kya|kia|kon|kons|kab|kahan|kitn|کیا|کون|کب|کہاں)\b/.test(n), 'question');
    add(acts, /\b(other|another|else|more|aur|mazeed|dusre|doosre|مزید)\b/.test(n), 'alternative_request');

    const operation = inferOperation(n, acts);
    const genericEntities = {};
    const duration = extractDuration(n);
    if (duration) genericEntities.duration = duration;
    const quantity = numberFromText(n);
    if (!duration && quantity && /\b(qty|quantity|piece|pieces|pcs|items?|units?|one|two|three|four|five|ek|aik|do|teen|char|chaar|paanch|ایک|دو|تین|چار|پانچ|\d+)\b/.test(n)) genericEntities.quantity = quantity;
    if (/\b(today|aaj|آج)\b/.test(n)) genericEntities.dateReference = 'today';
    else if (/\b(tomorrow|kal|کل)\b/.test(n)) genericEntities.dateReference = 'tomorrow';
    if (/\b(morning|subah|صبح)\b/.test(n)) genericEntities.timeWindow = 'morning';
    else if (/\b(afternoon|dopahar|دوپہر)\b/.test(n)) genericEntities.timeWindow = 'afternoon';
    else if (/\b(evening|shaam|شام)\b/.test(n)) genericEntities.timeWindow = 'evening';

    return {
      version: '1.0',
      acts,
      primaryAct: choosePrimary(acts),
      operation,
      genericEntities,
      normalizedText: n
    };
  }
}
function extractDuration(n) {
  const m = n.match(/\b(\d{1,2}|one|two|three|four|five|six|eight|ten|ek|aik|do|teen|char|chaar|paanch)\s*(hours?|hrs?|ghant[ae]?|گھنٹ[ےہ]?)\b/);
  if (!m) return null;
  return { value:numberFromText(m[1]), unit:'hours', role:'duration' };
}
function add(arr, condition, type) { if (condition) arr.push({ type }); }
function choosePrimary(acts) {
  const order = ['cancel','correction','action_request','small_talk','question','alternative_request','gratitude','greeting'];
  return order.find((type) => acts.some((a) => a.type === type)) || 'statement';
}
function inferOperation(n, acts) {
  if (acts.some((a) => a.type === 'cancel')) return 'cancel';
  if (/\b(reschedule|change.*time|change.*date)\b/.test(n)) return 'reschedule';
  if (/\b(confirm|final|done)\b/.test(n)) return 'confirm';
  if (/\b(book|reserve|schedule|appointment|order|buy|purchase|request|register|admission|chahiye|karwa)\b/.test(n)) return 'acquire_or_book';
  if (/\b(show|list|what do you have|what.*available|kya kya|kia kia|kon kon|kons[ayi]* chee|کیا کیا)\b/.test(n)) return 'browse';
  if (acts.some((a) => a.type === 'question')) return 'ask';
  return 'converse';
}
module.exports = { UniversalSemanticEngine };
