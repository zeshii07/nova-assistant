/**
 * Nova ML Intent Classifier — Feature Extractor
 *
 * Three-channel feature extractor used by the ML intent classifier:
 *
 * 1. WORD CHANNEL (TF-IDF word unigrams + bigrams)
 *    Captures lexical signal. TF-IDF down-weights common words like
 *    "the", "is", "a" so discriminative words ("book", "cancel", "price")
 *    dominate the score.
 *
 * 2. CHAR CHANNEL (TF-IDF char 3-grams + 4-grams)
 *    Captures sub-word structure: handles typos ("clening"→"cleaning"),
 *    OOV words, and morphological variations. Essential for the messy
 *    real-world queries we see in the stress-test kit.
 *
 * 3. PROTOTYPE CHANNEL (cosine similarity to training utterances)
 *    Captures word-order-aware semantic similarity. Each intent has a
 *    set of "prototype" feature vectors (one per training utterance);
 *    the query's max cosine to any prototype becomes the similarity score.
 *
 * The three channels are computed independently and combined by the
 * classifier (mlIntentClassifier.js) with learned weights.
 *
 * Why no external ML library?
 *   Nova runs in constrained environments (Render free tier, low-RAM VPS).
 *   Pulling in @tensorflow/tfjs or @xenova/transformers would balloon the
 *   image and slow cold-start. A hand-rolled TF-IDF + softmax achieves
 *   the same multilingual intent classification quality for our 38-intent
 *   catalog while remaining <500 lines and ~0 ms inference latency.
 */

const { canonicalize } = require('../../universal-vocabulary/src');

// === Stop words (English + Roman-Urdu + Arabic) ===
// These get TF-IDF down-weighting because they appear in many intents.
const STOP_WORDS = new Set([
  // English
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can','shall',
  'to','of','in','on','at','for','with','by','from','as','that','this','these',
  'those','it','its','i','me','my','we','our','you','your','he','she','they','them',
  'and','or','but','if','then','so','because','while','when','where','what','which',
  'how','why','who','whom','please','just','very','also','too','only','up','out',
  // Roman Urdu
  'hai','hain','ka','ki','ke','ko','se','mein','bhi','toh','hi','kya','aur',
  'ya','nahi','na','ho','kar','do','dein','ne','par','magar','jab','tab',
  // Arabic
  'في','من','على','إلى','أن','هذا','هذه','ذلك','التي','الذي','كان','قد'
]);

// === Tokenization ===
// Tokenize text into lowercase word tokens (Unicode-aware).
// Strips punctuation but preserves digits and CJK/Arabic characters.
function tokenize(text) {
  const normalized = canonicalize(text || '');
  // Match word characters across scripts (Latin, CJK, Arabic, Urdu)
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return tokens.filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

// === Feature vector builder ===
// Returns a Map<string, number> of feature -> weight.
// Weights:
//   word unigrams: tf (term frequency in this utterance)
//   word bigrams:  tf * 1.3 (slight boost for word order)
//   char 3-grams:  tf * 0.6 (lower weight, but catches typos)
//   char 4-grams:  tf * 0.85
function buildFeatureVector(text) {
  const features = new Map();
  const add = (key, weight) => features.set(key, (features.get(key) || 0) + weight);

  const normalized = canonicalize(text || '').slice(0, 600);
  const tokens = tokenize(normalized);

  // Word unigrams
  for (const token of tokens) {
    add(`w:${token}`, 1.0);
  }

  // Word bigrams (captures word order)
  for (let i = 0; i < tokens.length - 1; i++) {
    add(`b:${tokens[i]}_${tokens[i + 1]}`, 1.3);
  }

  // Char 3-grams and 4-grams on the compacted text
  // (handles typos and OOV words)
  const compact = `^${normalized.replace(/\s+/g, '_')}$`;
  for (let size of [3, 4]) {
    const weight = size === 3 ? 0.6 : 0.85;
    for (let i = 0; i <= compact.length - size; i++) {
      add(`c${size}:${compact.slice(i, i + size)}`, weight);
    }
  }

  return features;
}

// === Document frequency (DF) tracker ===
// Used during training to compute IDF: idf = log(N / (1 + df))
class DocumentFrequency {
  constructor() {
    this.df = new Map(); // feature -> doc count
    this.totalDocs = 0;
  }

  observe(featureVector) {
    this.totalDocs += 1;
    for (const key of featureVector.keys()) {
      this.df.set(key, (this.df.get(key) || 0) + 1);
    }
  }

  // Compute IDF for a feature
  idf(key) {
    const df = this.df.get(key) || 0;
    // Smoothed IDF (add-1 smoothing, like Lucene's default)
    return Math.log((this.totalDocs + 1) / (df + 1)) + 1;
  }

  // Apply TF-IDF weighting to a feature vector in place
  applyTfIdf(featureVector) {
    const out = new Map();
    for (const [key, tf] of featureVector) {
      // Log-normalized TF (commonly used in text classification)
      const tfWeight = 1 + Math.log(tf);
      out.set(key, tfWeight * this.idf(key));
    }
    return out;
  }
}

// === Cosine similarity ===
function cosineSimilarity(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (const v of a.values()) aa += v * v;
  for (const v of b.values()) bb += v * v;
  if (aa === 0 || bb === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [key, value] of small) {
    if (large.has(key)) dot += value * large.get(key);
  }
  return dot / Math.sqrt(aa * bb);
}

module.exports = {
  STOP_WORDS,
  tokenize,
  buildFeatureVector,
  DocumentFrequency,
  cosineSimilarity,
};
