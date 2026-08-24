const { normalizeText, normalizeWeekdayTypos, closestKeywordToken } = require('./text');
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
      valid:/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(normalizeWeekdayTypos(raw))
        ||/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(raw)
        ||/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(raw),
      reason:'invalid_date'
    };
    if (field === 'confirmation') return { valid:isConfirmation(text), reason:'not_confirmation' };
    if (field === 'cleaningType') return {
      valid:/\b(?:standard|general|regular|routine|hourly|deep)\b/.test(text)
        || Boolean(closestKeywordToken(text,['standard','regular','routine','hourly'],{maxDistance:2,minLength:5})),
      reason:'invalid_cleaning_type'
    };
    if (field === 'cleanerCount') {
      const count=Number((raw.match(/\b(\d{1,2})\b/)||[])[1]||0);
      return {valid:count>=1&&count<=20||/\b(?:one|two|three|four|five|ek|aik|do|teen|char|chaar)\b/.test(text),reason:'invalid_cleaner_count'};
    }
    if (field === 'duration') return {
      valid:/^(?:(?:ok|okay|yes|sure|theek hai)\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar)(?:\s*(?:hours?|hrs?|hurs?|ghant(?:a|e|ay|y)?))?$/i.test(text),
      reason:'invalid_duration'
    };
    if (field === 'bedrooms') return {valid:/\b(?:\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar)\b/.test(text),reason:'invalid_bedrooms'};
    if (field === 'city') return { valid: raw.length >= 2 && raw.length <= 80 && !/[?]/.test(raw), reason:'invalid_city' };
    if (field === 'address') return { valid: raw.length >= 8, reason:'invalid_address' };
    if (field === 'paymentMethod') return { valid:/\b(cash|cod|jazz|easy|bank|کیش|بینک)\b/.test(text), reason:'invalid_payment' };
    return { valid:true };
  }
}
module.exports = { ValidationEngine };
