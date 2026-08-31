const { MlIntentClassifier, CHANNEL_WEIGHTS, SOFTMAX_TEMPERATURE, CONFIDENCE_POWER, OOV_RAW_SCORE_THRESHOLD, CENTROID_PREFILTER_THRESHOLD } = require('./mlIntentClassifier');
const { HybridRouter } = require('./hybridRouter');
const { INTENT_CATALOG, INTENT_CAPABILITY_MAP, INTENT_PRIORITY } = require('./intentCatalog');
const { STOP_WORDS, tokenize, buildFeatureVector, DocumentFrequency, cosineSimilarity } = require('./featureExtractor');

module.exports = {
  MlIntentClassifier,
  HybridRouter,
  INTENT_CATALOG,
  INTENT_CAPABILITY_MAP,
  INTENT_PRIORITY,
  CHANNEL_WEIGHTS,
  SOFTMAX_TEMPERATURE,
  CONFIDENCE_POWER,
  OOV_RAW_SCORE_THRESHOLD,
  CENTROID_PREFILTER_THRESHOLD,
  // Feature extractor (exported for testing)
  STOP_WORDS,
  tokenize,
  buildFeatureVector,
  DocumentFrequency,
  cosineSimilarity,
};
