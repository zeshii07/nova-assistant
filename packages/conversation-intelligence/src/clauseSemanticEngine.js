const { normalizeText } = require('./text');

/**
 * Domain-neutral clause pass. It separates asserted work from possibilities so
 * an optional future idea cannot replace the customer's current request.
 */
class ClauseSemanticEngine {
  analyze(value) {
    const text=String(value||'').trim();
    const pieces=splitClauses(text);
    const clauses=pieces.map((piece,index)=>({
      index,
      text:piece,
      normalizedText:normalizeText(piece),
      modality:futureOrConditional(piece)?'future_consideration':'asserted'
    }));
    const asserted=clauses.filter((clause)=>clause.modality==='asserted');
    return {
      version:'1.0',
      clauses,
      primaryText:(asserted.length?asserted:clauses).map((clause)=>clause.text).join(' ').trim() || text,
      secondaryIntents:clauses
        .filter((clause)=>clause.modality!=='asserted')
        .map((clause)=>({type:clause.modality,text:clause.text}))
    };
  }
}

function splitClauses(value){
  return String(value||'')
    .replace(/\s*,\s*(?=(?:as\s+)?i(?:\s+am|'m)\s+(?:considering|thinking)|(?:as\s+)?we(?:\s+are|'re)\s+(?:considering|thinking))/gi,'\n')
    // Urdu-script punctuation and conjunctions: full-stop ۔, Arabic comma ،,
    // "اور" (and), "لیکن"/"مگر"/"پر" (but/however), "کیونکہ" (because).
    // Arabic: ، ، و لكن لأن.
    .replace(/([۔!?؛])/gu,'$1\n')
    .replace(/\s*،\s*/gu,' ، ')
    .replace(/(\s(?:aur|لیکن|مگر|پر|کیونکہ|لہذا|اگر|و|لكن|لأن|لأنه|لأنها)\s)/giu,'\n$1')
    .split(/(?:\r?\n)+|(?<=[.!?;۔])\s+/u)
    .map((part)=>part.trim().replace(/^[,;،]+|[,;،]+$/g,''))
    .filter(Boolean);
}
function futureOrConditional(value){
  const n=normalizeText(value);
  return /^if\b/.test(n)
    || /\b(?:as\s+)?(?:i|we)\s+(?:am|are|m|re)\s+(?:considering|thinking)(?:\s+about)?\b/.test(n)
    || /\b(?:considering|thinking about|might|may|possibly|perhaps|in the future|later on)\b/.test(n)
    || /\bif (?:it|this|that|the service) (?:works|goes well|is good)\b/.test(n)
    || /(?:شاید|ہو سکتا|ہو\s*سکتی|मुमकिन|agar|اگر)/.test(String(value||''))
    || /(?:ربما|قد|يحتمل)/.test(String(value||''));
}

module.exports={ClauseSemanticEngine,splitClauses,futureOrConditional};
