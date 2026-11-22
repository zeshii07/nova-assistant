/**
 * PublicOptionResolver — H3 + H5 (Phase 1 items 3 & 5).
 *
 * The public assistant displays suggested actions / options to a visitor, then
 * the visitor often replies with a shorthand reference to one of them:
 *   - ordinals:     "first one", "1st", "option 2", "the second", "number 3"
 *   - bare digits:  "1", "2"
 *   - demonstratives (Roman Urdu + English): "wo" (that one), "usko" (that),
 *                   "yeh wala" (this one), "pehla wala" (the first one),
 *                   "dusra" (the second), "teesra" (the third)
 *
 * Before this module existed, those replies fell straight into the intent
 * classifier (PublicIntentRouter.classify) as `unknown` → routed to knowledge
 * retrieval, so the assistant ignored its OWN previous options and answered
 * with an unrelated document chunk (H3). The root cause was two-fold: the
 * state never stored what options had been shown (H5), and there was no
 * resolver to map the shorthand back to an option even if it had.
 *
 * This resolver is PURE (no I/O): given the visitor's text and the lastShown
 * options array (captured into state.context.lastShown by _updateMemory), it
 * returns { resolved: boolean, value, index, reason }.
 *
 * `value` is the option's `value` field if present, else its `label`, else the
 * raw text. Callers feed `value` back into the router as if the visitor had
 * typed it. When nothing resolves, `resolved:false` and `value` = original
 * text, so routing proceeds normally.
 */

// English ordinal words → 0-based index. Keys starting with a digit (e.g. "1st")
// must be quoted — bare numeric-prefixed identifiers are invalid JS keys.
const ORDINAL_WORDS = {
  first: 0, firstly: 0, "1st": 0,
  second: 1, secondly: 1, "2nd": 1,
  third: 2, thirdly: 2, "3rd": 2,
  fourth: 3, "4th": 3,
  fifth: 4, "5th": 4,
  sixth: 5, "6th": 5,
};

// Roman Urdu ordinal words → 0-based index.
const ROMAN_URDU_ORDINAL_WORDS = {
  pehla: 0, pehli: 0,        // first
  dusra: 1, doosra: 1, dusri: 1,  // second
  teesra: 2, teesri: 2,           // third
  chautha: 3,                     // fourth
};

// "that one" / "this one" demonstratives. Roman Urdu "wo"/"usko"/"yeh wala"
// all point to the FIRST/most-prominent option (the one the assistant just
// emphasized) — matching how a human reads "go with that one" = the top pick.
// English "the last one" / "the last" points to the last option.
const DEMONSTRATIVE_TO_INDEX = {
  // Roman Urdu — "that" / "this" → first option (the recommended one).
  wo: 0, woh: 0, usko: 0, uski: 0, uska: 0,
  yeh: 0, ye: 0, "yeh wala": 0, "wo wala": 0,
  pichla: -1,           // "the previous/last one" → last option (resolved below)
};

class PublicOptionResolver {
  /**
   * Resolve a visitor's shorthand reply against the last shown options.
   * @param {string} text - the visitor's raw message.
   * @param {Array<{label?:string, value?:string, action?:string}>} lastShown -
   *   the options the assistant displayed on the previous turn (from
   *   state.context.lastShown). May be null/empty.
   * @returns {{resolved:boolean, value:string, index:number|null, reason:string}}
   */
  resolve(text, lastShown) {
    const raw = String(text || "").trim();
    if (!raw) return { resolved: false, value: text, index: null, reason: "empty" };
    const options = Array.isArray(lastShown) ? lastShown.filter((o) => o && (o.value || o.label)) : [];
    if (options.length === 0) return { resolved: false, value: text, index: null, reason: "no_options_shown" };

    const lower = raw.toLowerCase();
    const tokens = lower.split(/\s+/).filter(Boolean);

    // 1. "option 2" / "number 3" / "choice 1" / "option two"
    let m = lower.match(/\b(?:option|number|choice|item|no\.?)\s+(one|two|three|four|five|six|\d)\b/);
    if (m) {
      const idx = wordToIndex(m[1]);
      if (idx != null && idx < options.length) return ok(idx, options, "option_N");
    }

    // 2. Bare digit ("1", "2", "3") — only when the whole message is a single
    //    token that is a small number, so "2" clearly means "the 2nd option".
    if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
      const idx = Number(tokens[0]) - 1;
      if (idx >= 0 && idx < options.length) return ok(idx, options, "bare_digit");
    }

    // 3. English ordinal words: "first one", "the second", "1st", "first".
    m = lower.match(/\b(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\b/);
    if (m) {
      const idx = ORDINAL_WORDS[m[1]];
      if (idx != null && idx < options.length) return ok(idx, options, "ordinal_word");
    }

    // 4. Roman Urdu ordinals: "pehla wala", "dusra", "peesra" → etc.
    m = lower.match(/\b(pehla|pehla|pehli|dusra|doosra|dusri|teesra|teesri|chautha)\b/);
    if (m) {
      const idx = ROMAN_URDU_ORDINAL_WORDS[m[1]];
      if (idx != null && idx >= 0 && idx < options.length) return ok(idx, options, "roman_urdu_ordinal");
    }

    // 5. Demonstratives — "wo", "usko", "that one", "this one" → first option.
    //    "the last one" / "pichla" → last option.
    if (/\b(the\s+)?last\s+(one|option)\b/.test(lower) || /\bpichla\b/.test(lower)) {
      return ok(options.length - 1, options, "last_option");
    }
    if (/\b(wo|woh|usko|uska|uski|yeh|ye)\b/.test(lower) || /\b(that|this)\s+(one|option)\b/.test(lower) || /\b(yeh|wo)\s*wala\b/.test(lower)) {
      return ok(0, options, "demonstrative");
    }

    // 6. Exact label match — the visitor typed (part of) an option's label.
    for (let i = 0; i < options.length; i++) {
      const label = String(options[i].label || "").toLowerCase();
      if (label && (lower === label || (label.length > 4 && lower.includes(label)))) {
        return ok(i, options, "label_match");
      }
    }

    return { resolved: false, value: text, index: null, reason: "no_match" };
  }
}

function wordToIndex(w) {
  const map = { one: 0, two: 1, three: 2, four: 3, five: 4, six: 5 };
  if (map[w] != null) return map[w];
  const n = Number(w);
  return Number.isFinite(n) ? n - 1 : null;
}

function ok(index, options, reason) {
  const opt = options[index];
  return { resolved: true, value: opt.value || opt.label || "", index, reason };
}

module.exports = { PublicOptionResolver, ORDINAL_WORDS, ROMAN_URDU_ORDINAL_WORDS };
