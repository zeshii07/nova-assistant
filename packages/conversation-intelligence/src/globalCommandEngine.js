const { normalizeText } = require('./text');

// v73.1: Expanded human-handoff detection.
//
// The original detector fired on the bare word "human" or "agent" — which
// false-positives on sentences like "what are your hours for a human agent?"
// or "are you a human or a bot?". The new pattern requires an *intent* verb
// (talk/speak/chat/connect/transfer/need/want) OR an explicit escalation noun
// (manager/supervisor/boss/owner/staff person). This keeps precision while
// broadening coverage to "let me talk to your manager", "I want a supervisor",
// "transfer me to a person", etc.
//
// Multilingual: English, Roman Urdu, Arabic. Match is case-insensitive after
// normalizeText(). The GlobalCommandEngine runs BEFORE the NLU/semantic-router
// layer, so a match here short-circuits straight to HandoffService.create().
const HANDOFF_PATTERNS = [
  // Explicit "talk/speak/chat/connect to a <person>" — English
  /\b(talk\s+to|speak\s+to|chat\s+with|connect\s+(?:me\s+)?(?:to|with)|transfer\s+(?:me\s+)?(?:to|with)|put\s+me\s+(?:through\s+)?to|route\s+me\s+to)\s+(?:a\s+|an\s+|the\s+|your\s+)?(human|person|real\s+person|agent|representative|manager|supervisor|boss|owner|staff\s+(?:member)?|someone|live\s+(?:person|agent))\b/i,
  // "I want/need a <person>" — English
  /\b(?:i\s+)?(?:want|need|would\s+like|wanna|gimme|give\s+me)\s+(?:a\s+|an\s+|the\s+|to\s+talk\s+to\s+|to\s+speak\s+(?:to|with)\s+)?(human|person|real\s+person|agent|representative|manager|supervisor|boss|owner|staff\s+member|live\s+(?:person|agent))\b/i,
  // Bare escalation nouns "manager/supervisor/boss/owner" — strong signal but
  // must avoid false positives on questions like "what does your manager do?"
  // or "is the supervisor available?". So we require the noun to appear at the
  // END of the message (e.g. "let me talk to the manager"), OR be the whole
  // message ("manager"), OR be preceded by a request verb (talk/need/want/
  // connect/transfer/manager please). The standalone "(manager)" case is
  // handled by the ^...$ pattern below.
  /\b(?:talk\s+to|speak\s+(?:to|with)|chat\s+with|connect\s+(?:me\s+)?(?:to|with)|transfer\s+(?:me\s+)?(?:to|with)|need|want|give\s+me|get\s+me)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:manager|supervisor|boss|owner)\b/i,
  // Or the noun at the end of the sentence (e.g. "let me talk to the manager")
  /\b(?:manager|supervisor|boss|owner)\s*$/i,
  // "real person", "live person" as compound nouns (NOT "human agent" — that
  // false-positives on "do you have a human agent available?")
  /\b(real\s+person|live\s+(?:person|agent|human)|actual\s+person)\b/i,
  // One-word demand: the entire message is just "human" or "agent" (after
  // normalizeText strips punctuation, "human!" → "human"). Anchored with ^...$
  // so it only fires when the whole message is that one word — not when the
  // word appears mid-sentence.
  /^(human|agent|manager|supervisor|owner|operator)$/i,
  // Roman Urdu: "insan se baat", "banday se baat", "manager se baat"
  /\b(insan\s+se\s+baat|banday?\s+se\s+baat|manager\s+se\s+baat|agent\s+se\s+baat|kisi\s+insan)\b/i,
  // Arabic: "أريد التحدث مع موظف", "حولني إلى الدعم", "نمائندے سے بات"
  /أريد\s+التحدث\s+مع\s+(?:موظف|إنسان|شخص\s+حقيقي)|حول(?:ني|ه)\s+إلى\s+الدعم|نمائندے?\s+سے?\s+بات|انسان\s+سے?\s+بات/i
];

class GlobalCommandEngine {
  detect(message) {
    const text = normalizeText(message);
    if (/\b(undo cancel|undo that|restore my order|restore order|sorry don'?t cancel|sorry do not cancel|actually confirm it|please confirm my order)\b/.test(text)) return { type: 'undo_cancel', confidence: 1 };
    // Questions about cancellation policy are informational; only an actual
    // command cancels active state.
    const cancellationQuestion=/\b(can i|could i|may i|how (?:can|do) i|is it possible to|what if i)\b.*\b(cancel|cancellation)\b|\b(cancel|cancellation)\b.*\b(policy|fee|allowed|possible|how)\b/.test(text);
    if (!cancellationQuestion && (text.includes('کینسل') || text.includes('منسوخ') || /\b(cancel|cancel order|stop order|forget order|drop order|order cancel|cancel booking|cancel request|rehne do|rehne dein|cancel kar)\b/.test(text))) return { type: 'cancel', confidence: 1 };
    if (/^(clear|reset)$/.test(text) || /\b(start over|restart|reset conversation|clear conversation|clear everything|new conversation|dobara shuru|phir se shuru|نیا شروع|دوبارہ شروع)\b/.test(text)) return { type: 'reset', confidence: 1 };
    // v73.1: human-handoff detection — expanded keyword set (see HANDOFF_PATTERNS).
    for (const pattern of HANDOFF_PATTERNS) {
      if (pattern.test(text)) return { type: 'human_handoff', confidence: .99 };
    }
    return null;
  }
}
module.exports = { GlobalCommandEngine, HANDOFF_PATTERNS };
