const { normalizeText } = require('./text');
const { isConfirmation } = require('./confirmation');
class ValidationEngine {
  validatePending({ field, message }) {
    const raw = String(message || '').trim();
    const text = normalizeText(raw);
    if (!field) return { valid:true };
    if (field === 'name') {
      const words = raw.split(/\s+/).filter(Boolean);
      const banned = /\b(expensive|price|shoes|shirt|order|thanks|hello|cancel|mehng|delivery|phone|address|not my name|kia bat|kya baat)\b/i;
      return { valid: words.length >= 1 && words.length <= 5 && raw.length >= 2 && raw.length <= 70 && !banned.test(raw), reason:'not_name_like' };
    }
    if (field === 'phone') return { valid: raw.replace(/\D/g,'').length >= 10, reason:'invalid_phone' };
    if (field === 'time') return {
      valid:/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(raw)||/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(raw),
      reason:'invalid_time'
    };
    if (field === 'date') return {
      valid:/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw)
        ||/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(raw)
        ||/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(raw),
      reason:'invalid_date'
    };
    if (field === 'confirmation') return { valid:isConfirmation(text), reason:'not_confirmation' };
    if (field === 'city') return { valid: raw.length >= 2 && raw.length <= 80 && !/[?]/.test(raw), reason:'invalid_city' };
    if (field === 'address') return { valid: raw.length >= 8, reason:'invalid_address' };
    if (field === 'paymentMethod') return { valid:/\b(cash|cod|jazz|easy|bank|کیش|بینک)\b/.test(text), reason:'invalid_payment' };
    return { valid:true };
  }
}
module.exports = { ValidationEngine };
