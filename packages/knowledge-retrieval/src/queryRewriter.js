/**
 * v56.0 — Query Rewriter
 *
 * Moves the existing KnowledgeService.expandQuery regex patterns behind a
 * dedicated interface. Adds normalization (turning "Do you allow dogs?" into
 * "Are pets permitted?") and generates bounded search variants.
 *
 * Spec reference: §4 Step 4 (Rewrite and expand the query)
 *
 * Rules:
 *   - Never change the meaning or polarity of the question.
 *   - Preserve names, service identifiers, dates, amounts, and other entities.
 *   - Record the original and rewritten queries for debugging.
 *   - Use a bounded number of expansions.
 *   - Avoid expanding every query with irrelevant synonyms.
 *   - Add regression tests for negation and exception handling.
 */

/**
 * Normalization rules: rewrite a customer phrasing into a canonical form
 * WITHOUT changing meaning. This is meaning-preserving, not expansion.
 */
const NORMALIZATIONS = [
  // Pet phrasings → canonical "pets permitted"
  [/\bdo you (?:allow|permit) (?:dogs|cats|pets|animals)\b/i, 'are pets permitted'],
  [/\bcan i (?:bring|take) (?:my )?(?:dog|cat|pet|animal)\b/i, 'are pets permitted'],
  [/\bpets? (?:allowed|permitted|welcome)\b/i, 'are pets permitted'],
  // Cancellation phrasings → canonical "cancellation policy"
  [/\b(?:how do i|how to) cancel\b/i, 'cancellation policy'],
  [/\bwhat(?:'s| is) (?:your )?cancellation\b/i, 'cancellation policy'],
  // Rescheduling
  [/\bhow (?:do i|to) reschedule\b/i, 'rescheduling policy'],
  // Pricing
  [/\bhow much (?:does|is|will) .{0,30} cost\b/i, 'price cost'],
  [/\bwhat(?:'s| is) the (?:price|cost|fee) (?:of|for)\b/i, 'price cost'],
  // Location
  [/\bwhere (?:are you|is your business|is the business) located\b/i, 'business location address'],
  [/\bwhat(?:'s| is) your (?:location|address)\b/i, 'business location address'],
];

/**
 * Expansion rules: add domain keywords to the query to improve BM25 recall.
 * These are the 13 patterns from KnowledgeService.expandQuery, moved here.
 * Each rule adds a bounded set of terms — never more than ~12 words total.
 */
const EXPANSIONS = [
  [/\bserving areas?\b|\bservice areas?\b|\bareas do you serve\b|\bareas you serve\b/g, ' service area serving areas areas serve locations coverage '],
  [/\bwho (?:will )?pay(?:s)? for parking\b|\bparking (?:fee|fees|charge|charges|cost|costs)\b/g, ' parking paid parking parking charge customer responsible '],
  [/\bpets?\b|\bdogs?\b|\bcats?\b/g, ' pets pet dog cat animals home '],
  [/\bheavy wardrobe\b|\bmove (?:my )?(?:heavy )?(?:wardrobe|furniture)\b/g, ' furniture moving heavy furniture wardrobe safety '],
  [/\b(cancel|cancellation|cancelled|canceled)\b/g, ' cancellation policy notice before scheduled start cancellation fee no fee '],
  [/\b(reschedule|rescheduling|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/g, ' rescheduling policy change booking notice fee scheduled start '],
  [/\b(haven(?:\'t| not) arrived|officially late|arrival window|how late)\b/g, ' arrival time policy normal arrival window minutes late cancellation fee '],
  [/\b(quote|quotation|estimate|price|cost|told me)\b.*\b(confirm|confirmed|confirmation)\b/g, ' booking confirmation quote alone booking reference confirmed date time window '],
  [/\b(high[ -]?rise|climb(?:ing)? outside|unsafe height)\b/g, ' safety service limitations exterior high-rise window cleaning not offered safely reachable '],
  [/\bfragrance[ -]?free\b/g, ' fragrance-free products advance notice hours before arrival guarantee '],
  [/\bpet (?:fee|surcharge)|pet hair|heavy pet hair\b/g, ' pets pet-hair surcharge heavy removal simply having pet '],
  [/\b(spoiled?|rotten|damaged|bruised)\b[\s\S]{0,40}\b(fruit|produce|item|order)|\b(fruit|produce|item|order)\b[\s\S]{0,40}\b(spoiled?|rotten|damaged|bruised)\b/g, ' fruit quality damaged spoiled claim photo replacement credit delivery '],
  [/\b(store|storage|keep|refrigerate|refrigerator|fridge)\b[\s\S]{0,50}\b(fruit|mango|apple|banana|orange|produce)|\bhow should i store\b/g, ' storage guidance ripe fruit room temperature refrigerate sunlight '],
];

class QueryRewriter {
  constructor({ normalizations = NORMALIZATIONS, expansions = EXPANSIONS, logger = null } = {}) {
    this.normalizations = normalizations;
    this.expansions = expansions;
    this.logger = logger;
  }

  /**
   * Produce the canonical rewritten query + bounded search variants.
   * @param {string} query
   * @returns {{original, normalized, expanded, variants}}
   */
  rewrite(query) {
    const original = String(query || '').trim();
    let normalized = original;
    for (const [pattern, replacement] of this.normalizations) {
      normalized = normalized.replace(pattern, replacement);
    }
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Expand: add domain keywords but preserve the original meaning.
    let expanded = normalized;
    for (const [pattern, addition] of this.expansions) {
      if (pattern.test(expanded)) {
        expanded = `${expanded} ${addition}`.replace(/\s+/g, ' ').trim();
      }
    }

    // Bounded variants: a small set of alternative phrasings for retrieval.
    // Never more than 4 variants to keep retrieval cost bounded.
    const variants = this._buildVariants(normalized);

    return { original, normalized, expanded, variants };
  }

  _buildVariants(normalized) {
    const variants = [normalized];
    // Pet variants
    if (/\bpets? permitted\b/i.test(normalized)) {
      variants.push('pet policy');
      variants.push('animals allowed');
    }
    // Cancellation variants
    if (/\bcancellation policy\b/i.test(normalized)) {
      variants.push('cancel booking notice');
      variants.push('cancellation fee');
    }
    // Pricing variants
    if (/\bprice cost\b/i.test(normalized)) {
      variants.push('pricing');
      variants.push('how much');
    }
    // Deduplicate + cap at 5.
    return [...new Set(variants)].slice(0, 5);
  }
}

module.exports = { QueryRewriter, NORMALIZATIONS, EXPANSIONS };
