const { normalizeText } = require('./text');
class GlobalCommandEngine {
  detect(message) {
    const text = normalizeText(message);
    if (/\b(undo cancel|undo that|restore my order|restore order|sorry don'?t cancel|sorry do not cancel|actually confirm it|please confirm my order)\b/.test(text)) return { type: 'undo_cancel', confidence: 1 };
    // Questions about cancellation policy are informational; only an actual
    // command cancels active state.
    const cancellationQuestion=/\b(can i|could i|may i|how (?:can|do) i|is it possible to|what if i)\b.*\b(cancel|cancellation)\b|\b(cancel|cancellation)\b.*\b(policy|fee|allowed|possible|how)\b/.test(text);
    if (!cancellationQuestion && (text.includes('کینسل') || text.includes('منسوخ') || /\b(cancel|cancel order|stop order|forget order|drop order|order cancel|cancel booking|cancel request|rehne do|rehne dein|cancel kar)\b/.test(text))) return { type: 'cancel', confidence: 1 };
    if (/^(clear|reset)$/.test(text) || /\b(start over|restart|reset conversation|clear conversation|clear everything|new conversation|dobara shuru|phir se shuru|نیا شروع|دوبارہ شروع)\b/.test(text)) return { type: 'reset', confidence: 1 };
    if (/\b(human|agent|real person|representative|insan se baat|banday se baat|انسان|نمائندہ)\b/.test(text)) return { type: 'human_handoff', confidence: .99 };
    return null;
  }
}
module.exports = { GlobalCommandEngine };
