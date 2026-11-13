/**
 * packages/public-assistant — public product assistant + lead capture system.
 *
 * Implements the Nova Public Product Assistant Development Specification:
 *  - PublicAssistantService: §5 request lifecycle, §11 response strategy,
 *    §14 recommendations, §15 conversation memory.
 *  - PublicIntentRouter: §6 intent detection.
 *  - PublicAssistantPolicy: §4 isolation, §16 evidence rules, §20 security.
 *  - PublicFeatureRegistryService: §7 machine-readable feature registry.
 *  - PublicLeadService + PublicLeadRepository: §12 scoring, §13 lead/demo submission.
 */
const { PublicAssistantService, OUTCOMES, RECOMMENDATION_MAP, STARTERS, CONSENT_TEXT } = require("./src/publicAssistantService");
const { PublicIntentRouter, RULES, PRIORITY, INDUSTRY_KEYWORDS } = require("./src/publicIntentRouter");
const { PublicAssistantPolicy, REFUSE_PATTERNS, INTERNAL_INSTRUCTION_PATTERNS, SECRET_REDACT_PATTERNS } = require("./src/publicAssistantPolicy");
const { PublicFeatureRegistryService } = require("./src/publicFeatureRegistryService");
const { PublicLeadService, LEAD_SCORE_SIGNALS, bandForScore, LEAD_STATUSES, EMAIL_RE, PHONE_RE } = require("./src/publicLeadService");
const { PublicLeadRepository } = require("./src/publicLeadRepository");
const { UnansweredQuestionRepository } = require("./src/unansweredQuestionRepository");
const { PublicLlmAnswerService } = require("./src/publicLlmAnswerService");
const { PUBLIC_ASSISTANT_SYSTEM_PROMPT } = require("./src/publicProductAssistantPrompt");

module.exports = {
  PublicAssistantService, OUTCOMES, RECOMMENDATION_MAP, STARTERS, CONSENT_TEXT,
  PublicIntentRouter, RULES, PRIORITY, INDUSTRY_KEYWORDS,
  PublicAssistantPolicy, REFUSE_PATTERNS, INTERNAL_INSTRUCTION_PATTERNS, SECRET_REDACT_PATTERNS,
  PublicFeatureRegistryService,
  PublicLeadService, LEAD_SCORE_SIGNALS, bandForScore, LEAD_STATUSES, EMAIL_RE, PHONE_RE,
  PublicLeadRepository,
  UnansweredQuestionRepository,
  PublicLlmAnswerService,
  PUBLIC_ASSISTANT_SYSTEM_PROMPT
};
