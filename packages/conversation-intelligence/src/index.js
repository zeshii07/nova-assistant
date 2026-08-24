module.exports = {
  ...require('./conversationIntelligenceEngine'),
  ...require('./conversationAdapterRegistry'),
  ...require('./llmInterpreter'),
  ...require('./text'),
  ...require('./universalSemanticEngine'),
  ...require('./clauseSemanticEngine'),
  ...require('./temporalSemanticExtractor'),
  ...require('./universalMessageFrame'),
  ...require('./fieldAmendmentExtractor')
};

module.exports.GoalResolver = require('./goal-engine').GoalResolver;
