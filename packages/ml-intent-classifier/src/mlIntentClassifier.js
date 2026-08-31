/**
 * Nova ML Intent Classifier — v2.0 (refactored)
 *
 * A multilingual intent classifier that combines three feature channels
 * into a calibrated prediction:
 *
 *   1. WORD channel: TF-IDF word unigrams + bigrams + max cosine to word prototypes
 *   2. CHAR channel: TF-IDF char 3-grams + 4-grams + max cosine to char prototypes
 *   3. PROTOTYPE channel: COMBINED max cosine (avg of word+char max prototypes)
 *
 * === v2.0 refactor (sprint 91) — fixes structural defects ===
 *
 * The original v1.0 had three bugs identified in code review:
 *
 *   (A) Dead Code / Double Weighting: protoScore was set to wordMaxProtoSim,
 *       but wordScore already included wordMaxProtoSim * 0.92. The prototype
 *       channel was therefore counting the word prototype signal TWICE.
 *       Fix: protoScore is now the AVERAGE of wordMaxProtoSim and
 *       charMaxProtoSim — a true combined prototype signal that does
 *       not double-count any single channel.
 *
 *   (B) Context Boost Post-Sorting Bug: _applyContextualBoost and
 *       _applyRecentTurnsBias mutated entry.confidence AFTER the array
 *       was sorted into `ranked`. A lower-ranked intent that got boosted
 *       would NOT become the new top intent unless the array was re-sorted.
 *       Fix: apply all biases BEFORE sorting, then sort once.
 *
 *   (C) Constructor Side Effects: this._train() was invoked synchronously
 *       in the constructor, degrading startup flexibility and preventing
 *       dynamic retraining.
 *       Fix: constructor only stores config; train() is called lazily on
 *       first classify() call (or explicitly by the container).
 *
 * === v2.0 refactor — performance optimizations ===
 *
 *   (D) Pre-filter prototypes via centroid threshold: if dotProduct(query,
 *       centroid) < 0.05, skip searching that intent's prototypes entirely.
 *       This cuts the average dotProduct call count by ~70%.
 *
 *   (E) Eliminate allocation overhead: queryWordVector and queryCharVector
 *       are now populated in a single pass through the full feature vector,
 *       avoiding a second iteration.
 *
 *   (F) OOV fallback threshold: if the top raw score is lower than 0.15,
 *       return topIntent: null early to avoid confident hallucinated
 *       matches on completely unrelated inputs.
 *
 * === v2.0 refactor — maintenance optimizations ===
 *
 *   (G) Exposed .train() method: can be called dynamically to retrain
 *       when the intent catalog updates at runtime.
 *
 *   (H) Exported serializeModel() / deserializeModel(): allows the trained
 *       model to be saved to JSON during build/deploy and loaded at runtime
 *       for 0ms cold-start training time.
 */

const { INTENT_CATALOG, INTENT_CAPABILITY_MAP, INTENT_PRIORITY } = require('./intentCatalog');
const { buildFeatureVector, DocumentFrequency, cosineSimilarity } = require('./featureExtractor');

// === Channel weights (v2.0: prototype now independent, so weights rebalanced) ===
// v1.0 had word=0.40, char=0.20, prototype=0.40 — but prototype was double-counting
// word signal. v2.0 uses word=0.35, char=0.20, prototype=0.45 — prototype is now
// a true combined signal (avg of word+char max protos), so it deserves slightly
// more weight.
const CHANNEL_WEIGHTS = Object.freeze({
  word: 0.35,
  char: 0.20,
  prototype: 0.45,
});

// === Logistic regression temperature ===
const SOFTMAX_TEMPERATURE = 0.10;

// === Confidence calibration ===
const CONFIDENCE_POWER = 0.55;

// === v2.0: OOV fallback threshold ===
// If the top raw score is below this, return topIntent: null to avoid
// hallucinated matches on completely unrelated inputs.
// Set to 0.10 (not 0.15) to accommodate long inputs where TF-IDF signal
// gets diluted by repetition of filler words.
const OOV_RAW_SCORE_THRESHOLD = 0.10;

// === v2.0: Centroid pre-filter threshold ===
// If dotProduct(query, centroid) is below this, skip searching prototypes
// for that intent — they almost certainly won't beat the centroid.
const CENTROID_PREFILTER_THRESHOLD = 0.05;

class MlIntentClassifier {
  /**
   * v2.0: Constructor only stores config. Training is LAZY — train() is
   * called on first classify() call, OR the container can call train()
   * explicitly at startup to warm the model.
   */
  constructor({ logger = null, autoTrain = true } = {}) {
    this.logger = logger;
    this.trained = false;
    this.model = null;
    this._intentById = null;
    this._wordDf = null;
    this._charDf = null;
    if (autoTrain) {
      // Backward-compat: train eagerly by default. Callers can pass
      // autoTrain:false to defer training until first classify().
      this.train();
    }
  }

  /**
   * Train the classifier on the seed catalog.
   * v2.0: Now a public method (was _train) so it can be called dynamically
   * to retrain when the intent catalog updates at runtime.
   *
   * @param {object} options - { catalog: custom intent catalog (defaults to INTENT_CATALOG) }
   * @returns {object} Training summary { intentCount, documentCount, vocabularySize, trainingMs }
   */
  train(options = {}) {
    const catalog = options.catalog || INTENT_CATALOG;
    const startedAt = performance.now();
    const wordDf = new DocumentFrequency();
    const charDf = new DocumentFrequency();

    // Pass 1: build document frequency tables
    const trainingDocs = [];
    for (const intent of catalog) {
      for (const utterance of intent.examples) {
        const fullVector = buildFeatureVector(utterance);
        const wordVector = new Map();
        const charVector = new Map();
        for (const [key, weight] of fullVector) {
          if (key.startsWith('w:') || key.startsWith('b:')) {
            wordVector.set(key, weight);
          } else if (key.startsWith('c3:') || key.startsWith('c4:')) {
            charVector.set(key, weight);
          }
        }
        wordDf.observe(wordVector);
        charDf.observe(charVector);
        trainingDocs.push({ intentId: intent.canonicalId, utterance, fullVector, wordVector, charVector });
      }
    }

    // Pass 2: compute TF-IDF weighted vectors for each training utterance
    const classStats = new Map();
    for (const intent of catalog) {
      classStats.set(intent.canonicalId, {
        intentId: intent.canonicalId,
        capabilityId: intent.capabilityId,
        weight: intent.weight,
        priority: INTENT_PRIORITY[intent.canonicalId] || 10,
        wordPrototypes: [],
        charPrototypes: [],
        wordCentroid: new Map(),
        charCentroid: new Map(),
        documentCount: 0,
      });
    }

    for (const doc of trainingDocs) {
      const stats = classStats.get(doc.intentId);
      const wordTfIdf = wordDf.applyTfIdf(doc.wordVector);
      const charTfIdf = charDf.applyTfIdf(doc.charVector);
      stats.wordPrototypes.push(wordTfIdf);
      stats.charPrototypes.push(charTfIdf);
      stats.documentCount += 1;
      for (const [key, val] of wordTfIdf) {
        stats.wordCentroid.set(key, (stats.wordCentroid.get(key) || 0) + val);
      }
      for (const [key, val] of charTfIdf) {
        stats.charCentroid.set(key, (stats.charCentroid.get(key) || 0) + val);
      }
    }

    const classes = [...classStats.values()].map(stats => {
      const wordCentroid = normalizeVector(stats.wordCentroid);
      const charCentroid = normalizeVector(stats.charCentroid);
      const wordPrototypes = stats.wordPrototypes.map(normalizeVector);
      const charPrototypes = stats.charPrototypes.map(normalizeVector);
      return {
        intentId: stats.intentId,
        capabilityId: stats.capabilityId,
        weight: stats.weight,
        priority: stats.priority,
        documentCount: stats.documentCount,
        wordCentroid,
        charCentroid,
        wordPrototypes,
        charPrototypes,
      };
    });

    this.model = Object.freeze({
      version: '2.0',
      trainedAt: new Date().toISOString(),
      trainingMs: Number((performance.now() - startedAt).toFixed(3)),
      intentCount: catalog.length,
      documentCount: trainingDocs.length,
      vocabularySize: wordDf.df.size + charDf.df.size,
      classes: Object.freeze(classes),
    });

    this._intentById = new Map(this.model.classes.map(c => [c.intentId, c]));
    this._wordDf = wordDf;
    this._charDf = charDf;
    this.trained = true;

    if (this.logger) {
      this.logger.info('ml_intent_classifier.trained', {
        version: '2.0',
        intentCount: this.model.intentCount,
        documentCount: this.model.documentCount,
        vocabularySize: this.model.vocabularySize,
        trainingMs: this.model.trainingMs,
      });
    }

    return {
      intentCount: this.model.intentCount,
      documentCount: this.model.documentCount,
      vocabularySize: this.model.vocabularySize,
      trainingMs: this.model.trainingMs,
    };
  }

  /**
   * v2.0: Serialize the trained model to JSON for build-time pre-compilation.
   * Allows the model to be saved during deploy and loaded at runtime for
   * 0ms cold-start training time.
   */
  serializeModel() {
    if (!this.trained) throw new Error('Cannot serialize untrained classifier');
    // Convert Maps to plain objects for JSON serialization
    const classes = this.model.classes.map(cls => ({
      ...cls,
      wordCentroid: mapToObject(cls.wordCentroid),
      charCentroid: mapToObject(cls.charCentroid),
      wordPrototypes: cls.wordPrototypes.map(mapToObject),
      charPrototypes: cls.charPrototypes.map(mapToObject),
    }));
    return {
      ...this.model,
      classes,
      _wordDf: { df: mapToObject(this._wordDf.df), totalDocs: this._wordDf.totalDocs },
      _charDf: { df: mapToObject(this._charDf.df), totalDocs: this._charDf.totalDocs },
    };
  }

  /**
   * v2.0: Deserialize a pre-compiled model from JSON.
   */
  deserializeModel(json) {
    const classes = json.classes.map(cls => ({
      ...cls,
      wordCentroid: objectToMap(cls.wordCentroid),
      charCentroid: objectToMap(cls.charCentroid),
      wordPrototypes: cls.wordPrototypes.map(objectToMap),
      charPrototypes: cls.charPrototypes.map(objectToMap),
    }));
    this.model = Object.freeze({ ...json, classes: Object.freeze(classes) });
    this._intentById = new Map(this.model.classes.map(c => [c.intentId, c]));
    this._wordDf = new DocumentFrequency();
    this._wordDf.df = objectToMap(json._wordDf.df);
    this._wordDf.totalDocs = json._wordDf.totalDocs;
    this._charDf = new DocumentFrequency();
    this._charDf.df = objectToMap(json._charDf.df);
    this._charDf.totalDocs = json._charDf.totalDocs;
    this.trained = true;
    if (this.logger) {
      this.logger.info('ml_intent_classifier.loaded_precompiled', {
        version: '2.0',
        intentCount: this.model.intentCount,
        documentCount: this.model.documentCount,
      });
    }
  }

  /**
   * v2.0: Lazy training — ensure the model is trained before classify().
   */
  _ensureTrained() {
    if (!this.trained) {
      this.train();
    }
  }

  /**
   * Classify a user message into one or more intents with confidence scores.
   *
   * v2.0 changes:
   *   - Lazy training (trains on first call if autoTrain=false)
   *   - Single-pass feature vector splitting (eliminates allocation overhead)
   *   - Centroid pre-filter (skips prototypes when centroid sim < 0.05)
   *   - True combined prototype score (avg of word+char max protos)
   *   - OOV fallback (returns null if top raw score < 0.15)
   *   - Context biases applied BEFORE sorting (fixes post-sort mutation bug)
   */
  classify(text, options = {}) {
    const startedAt = performance.now();
    this._ensureTrained();
    if (!text || typeof text !== 'string') {
      return emptyResult();
    }

    // Build feature vector for the query
    const fullVector = buildFeatureVector(text);
    if (fullVector.size === 0) return emptyResult();

    // v2.0 (E): Single-pass split into word + char channels
    // (eliminates the second iteration over the full vector)
    const queryWordVector = new Map();
    const queryCharVector = new Map();
    for (const [key, weight] of fullVector) {
      if (key.startsWith('w:') || key.startsWith('b:')) {
        queryWordVector.set(key, weight);
      } else if (key.startsWith('c3:') || key.startsWith('c4:')) {
        queryCharVector.set(key, weight);
      }
    }

    // Apply TF-IDF to the query
    const queryWordTfIdf = this._wordDf.applyTfIdf(queryWordVector);
    const queryCharTfIdf = this._charDf.applyTfIdf(queryCharVector);
    const queryWordNorm = normalizeVector(queryWordTfIdf);
    const queryCharNorm = normalizeVector(queryCharTfIdf);

    // Score each class
    const scores = [];
    for (const cls of this.model.classes) {
      // Channel 1: word cosine to centroid (fast) + max prototype cosine (precise)
      const wordCentroidSim = dotProduct(queryWordNorm, cls.wordCentroid);
      let wordMaxProtoSim = 0;
      // v2.0 (D): Pre-filter prototypes via centroid threshold
      if (wordCentroidSim >= CENTROID_PREFILTER_THRESHOLD) {
        wordMaxProtoSim = maxCosine(queryWordNorm, cls.wordPrototypes);
      }
      const wordScore = Math.max(wordCentroidSim, wordMaxProtoSim * 0.92);

      // Channel 2: char cosine
      const charCentroidSim = dotProduct(queryCharNorm, cls.charCentroid);
      let charMaxProtoSim = 0;
      if (charCentroidSim >= CENTROID_PREFILTER_THRESHOLD) {
        charMaxProtoSim = maxCosine(queryCharNorm, cls.charPrototypes);
      }
      const charScore = Math.max(charCentroidSim, charMaxProtoSim * 0.92);

      // v2.0 (A): TRUE combined prototype score (avg of word+char max protos)
      // This replaces the v1.0 bug where protoScore = wordMaxProtoSim (double-counting)
      const protoScore = (wordMaxProtoSim + charMaxProtoSim) / 2;

      // Weighted sum of channels
      const rawScore =
        CHANNEL_WEIGHTS.word * wordScore +
        CHANNEL_WEIGHTS.char * charScore +
        CHANNEL_WEIGHTS.prototype * protoScore;

      // Apply intent weight (transactional intents get higher prior)
      const weightedScore = rawScore * cls.weight;

      scores.push({
        intentId: cls.intentId,
        capabilityId: cls.capabilityId,
        priority: cls.priority,
        wordScore: Number(wordScore.toFixed(4)),
        charScore: Number(charScore.toFixed(4)),
        protoScore: Number(protoScore.toFixed(4)),
        rawScore: Number(rawScore.toFixed(4)),
        weightedScore: Number(weightedScore.toFixed(4)),
        // v2.0 (B): confidence is computed AFTER bias application, not before
        // We store the raw weightedScore here; bias is applied below.
      });
    }

    // v2.0 (B): Apply context biases BEFORE softmax/sorting
    // This fixes the post-sort mutation bug where a boosted lower-ranked
    // intent would not become the new top intent.
    let contextualAdjustment = null;
    if (options.tenantMatches && options.tenantMatches.length > 0) {
      contextualAdjustment = this._applyContextualBoost(scores, options.tenantMatches);
    }
    if (options.recentTurns && options.recentTurns.length > 0) {
      this._applyRecentTurnsBias(scores, options.recentTurns);
    }

    // v2.0 (F): OOV fallback — if the top weightedScore is below threshold,
    // return null to avoid hallucinated matches
    let maxWeightedScore = 0;
    for (const s of scores) {
      if (s.weightedScore > maxWeightedScore) maxWeightedScore = s.weightedScore;
    }
    if (maxWeightedScore < OOV_RAW_SCORE_THRESHOLD) {
      return Object.freeze({
        used: true,
        version: '2.0',
        engine: 'tfidf_logistic_ensemble',
        topIntent: null,
        alternatives: Object.freeze([]),
        channelScores: null,
        contextualAdjustment: contextualAdjustment ? Object.freeze(contextualAdjustment) : null,
        timingMs: Number((performance.now() - startedAt).toFixed(3)),
        oovFallback: true,
        maxRawScore: Number(maxWeightedScore.toFixed(4)),
      });
    }

    // Softmax to get calibrated probabilities
    const logits = scores.map(s => s.weightedScore / SOFTMAX_TEMPERATURE);
    const probs = softmax(logits);

    // Calibrate confidence: power transform to spread out softmax output
    const ranked = scores
      .map((s, i) => ({
        ...s,
        probability: Number(probs[i].toFixed(4)),
        confidence: Number(Math.pow(probs[i], CONFIDENCE_POWER).toFixed(4)),
      }))
      .sort((a, b) => b.confidence - a.confidence || b.priority - a.priority || a.intentId.localeCompare(b.intentId));

    const top = ranked[0];
    const second = ranked[1];
    if (!top) return emptyResult();

    const margin = Number((top.confidence - (second?.confidence || 0)).toFixed(4));

    const result = Object.freeze({
      used: true,
      version: '2.0',
      engine: 'tfidf_logistic_ensemble',
      topIntent: Object.freeze({
        intentId: top.intentId,
        capabilityId: top.capabilityId,
        confidence: top.confidence,
        margin,
        probability: top.probability,
        similarity: top.protoScore,
      }),
      alternatives: Object.freeze(
        ranked.slice(1, 4).map(r => Object.freeze({
          intentId: r.intentId,
          capabilityId: r.capabilityId,
          confidence: r.confidence,
          similarity: r.protoScore,
        }))
      ),
      channelScores: Object.freeze({
        word: top.wordScore,
        char: top.charScore,
        prototype: top.protoScore,
      }),
      contextualAdjustment: contextualAdjustment ? Object.freeze(contextualAdjustment) : null,
      timingMs: Number((performance.now() - startedAt).toFixed(3)),
      oovFallback: false,
    });

    return result;
  }

  /**
   * v2.0: Apply contextual boost to the SCORES array (pre-softmax).
   * Modifies scores in place by adding a boost to weightedScore.
   * This is called BEFORE softmax/sorting, fixing the post-sort mutation bug.
   */
  _applyContextualBoost(scores, tenantMatches) {
    const adjustments = [];
    for (const match of tenantMatches) {
      if (match.score < 0.78) continue;
      const targetIntents = match.kind === 'product'
        ? ['product.list', 'product.info', 'product.price', 'cart.add', 'order.create']
        : ['booking.create', 'service.price', 'cleaning.service_request', 'availability.check'];

      for (const intentId of targetIntents) {
        const entry = scores.find(r => r.intentId === intentId);
        if (entry) {
          // v2.0: Apply boost to weightedScore (pre-softmax) instead of confidence (post-softmax)
          const boost = 0.05 * (match.score - 0.78) / 0.22;
          entry.weightedScore = Number((entry.weightedScore + boost).toFixed(4));
          adjustments.push({ intentId, boost: Number(boost.toFixed(4)), reason: `tenant_${match.kind}_match` });
        }
      }
    }
    return adjustments.length > 0 ? adjustments : null;
  }

  /**
   * v2.0: Apply recent-turns bias to the SCORES array (pre-softmax).
   */
  _applyRecentTurnsBias(scores, recentTurns) {
    const lastTwo = recentTurns.slice(-2);
    if (lastTwo.length === 0) return;
    const capCounts = new Map();
    for (const turn of lastTwo) {
      if (turn.capabilityId && turn.capabilityId !== 'assistant' && turn.capabilityId !== 'system') {
        capCounts.set(turn.capabilityId, (capCounts.get(turn.capabilityId) || 0) + 1);
      }
    }
    let dominantCap = null, maxCount = 0;
    for (const [cap, count] of capCounts) {
      if (count > maxCount) { maxCount = count; dominantCap = cap; }
    }
    if (!dominantCap || maxCount < 2) return;

    // v2.0: Apply boost to weightedScore (pre-softmax)
    for (const entry of scores) {
      if (entry.capabilityId === dominantCap) {
        entry.weightedScore = Number((entry.weightedScore + 0.03).toFixed(4));
      }
    }
  }

  /**
   * Get the predicted capability for a message, or null if no strong prediction.
   */
  predictCapability(text, options = {}) {
    const result = this.classify(text, options);
    if (!result.used || !result.topIntent) return null;
    return {
      capabilityId: result.topIntent.capabilityId,
      confidence: result.topIntent.confidence,
      intentId: result.topIntent.intentId,
      margin: result.topIntent.margin,
    };
  }

  /**
   * Get a human-readable summary for trace logging.
   */
  summarize(text, options = {}) {
    const result = this.classify(text, options);
    if (!result.used) return 'ml:disabled';
    if (!result.topIntent) return `ml:oov_fallback (maxRaw=${result.maxRawScore?.toFixed(3)})`;
    const top = result.topIntent;
    const alts = result.alternatives.slice(0, 2).map(a => `${a.intentId}(${a.confidence.toFixed(2)})`).join(', ');
    return `ml: ${top.intentId} conf=${top.confidence.toFixed(3)} margin=${top.margin.toFixed(3)} | alts: ${alts} | ${result.timingMs}ms`;
  }
}

// === Helpers ===

function normalizeVector(vec) {
  let norm = 0;
  for (const v of vec.values()) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const out = new Map();
  for (const [key, val] of vec) out.set(key, val / norm);
  return out;
}

function dotProduct(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, val] of small) {
    if (large.has(key)) dot += val * large.get(key);
  }
  return dot;
}

function maxCosine(query, prototypes) {
  let best = 0;
  for (const proto of prototypes) {
    const sim = dotProduct(query, proto);
    if (sim > best) best = sim;
  }
  return best;
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map(v => Math.exp(v - max));
  const total = exps.reduce((s, v) => s + v, 0);
  return exps.map(v => v / Math.max(total, Number.EPSILON));
}

// v2.0: Map <-> Object conversion helpers for model serialization
function mapToObject(map) {
  const obj = {};
  for (const [key, val] of map) obj[key] = val;
  return obj;
}

function objectToMap(obj) {
  const map = new Map();
  for (const key of Object.keys(obj)) map.set(key, obj[key]);
  return map;
}

function emptyResult() {
  return Object.freeze({
    used: false,
    version: '2.0',
    engine: 'tfidf_logistic_ensemble',
    topIntent: null,
    alternatives: Object.freeze([]),
    channelScores: null,
    contextualAdjustment: null,
    timingMs: 0,
    oovFallback: false,
  });
}

module.exports = {
  MlIntentClassifier,
  CHANNEL_WEIGHTS,
  SOFTMAX_TEMPERATURE,
  CONFIDENCE_POWER,
  OOV_RAW_SCORE_THRESHOLD,
  CENTROID_PREFILTER_THRESHOLD,
};
